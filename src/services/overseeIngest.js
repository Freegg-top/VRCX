// Oversee 客户端众包实时名单上报 (方案 D / M2).
// 仅内存保存当前公开实例名单; 所有失败均静默降级, 不影响游戏日志主流程.

import { watch } from 'vue';

import webApiService from './webapi';
import { watchState } from './watchState';
import { OVERSEE_API_BASE } from '../shared/constants/oversee';
import { useOverseeSettingsStore } from '../stores/settings/oversee';
import { useUserStore } from '../stores/user';

export const INGEST_DEBOUNCE_MS = 30 * 1000;
export const INGEST_HEARTBEAT_MS = 5 * 60 * 1000;
export const INGEST_RETRY_BASE_MS = 30 * 1000;
export const INGEST_RETRY_MAX_MS = 120 * 1000;
const CLIENT_VERSION = 'vrcx-dlc/2026.11.24';
const USR_ID_REGEX = /^usr_[a-z0-9-]+$/i;

/** @type {Map<string, { name: string; id?: string }>} */
const roster = new Map();
let currentLocation = '';
let debounceTimer = null;
let heartbeatTimer = null;
let retryTimer = null;
let retryAttempt = 0;
let activeRequestId = 0;
let nextRequestId = 0;
let queuedReport = false;
let queuedImmediateReport = false;
let initialized = false;
let settingsReady = false;
let authStopped = false;
let authWarningShown = false;
let unwatchFns = [];

/**
 * 仅允许 VRChat 实例 location, 并在客户端预过滤所有私密实例标记.
 *
 * @param {unknown} location
 * @returns {boolean}
 */
export function isPublicInstanceLocation(location) {
    const value = String(location || '').trim();
    if (!/^wrld_[^:]+:.+$/i.test(value)) {
        return false;
    }
    const lower = value.toLowerCase();
    return !lower.includes('~private') && !lower.includes('~friends') && !lower.includes('~hidden');
}

/**
 * @param {unknown} userId
 * @returns {string}
 */
function validUserId(userId) {
    const value = String(userId || '').trim();
    return USR_ID_REGEX.test(value) ? value : '';
}

/**
 * 构建契约 payload. 自己固定为第一项, 同名 roster 项合并, 无有效 usr_ ID 时仅报名字.
 *
 * @param {{
 *     location: string;
 *     roster: Map<string, { name: string; id?: string }>;
 *     self: { id?: string; displayName?: string };
 *     clientTs?: number;
 * }} input
 * @returns {{
 *     reporter: string;
 *     location: string;
 *     n_users: number;
 *     users: ({ name: string; id: string } | string)[];
 *     client_ts: number;
 *     client: string;
 * } | null}
 */
export function buildIngestPayload({ location, roster: currentRoster, self, clientTs = Date.now() }) {
    const reporter = validUserId(self?.id);
    const selfName = String(self?.displayName || '').trim();
    if (!reporter || !selfName || !location) {
        return null;
    }

    /** @type {{ name: string; id: string } | string} */
    const selfEntry = { name: selfName, id: reporter };
    /** @type {({ name: string; id: string } | string)[]} */
    const users = [selfEntry];
    for (const [displayName, entry] of currentRoster) {
        const name = String(entry?.name || displayName || '').trim();
        if (!name || name === selfName) {
            continue;
        }
        const id = validUserId(entry?.id);
        users.push(id ? { name, id } : name);
    }
    if (!users.length) {
        return null;
    }
    return {
        reporter,
        location,
        n_users: users.length,
        users,
        client_ts: clientTs,
        client: CLIENT_VERSION
    };
}

/**
 * 网络失败退避: 30s → 60s → 120s 封顶, 附加最多 20% 随机抖动.
 *
 * @param {number} attempt 已连续失败次数 (从 1 开始)
 * @param {number} [random]
 * @returns {number}
 */
export function getIngestRetryDelay(attempt, random = Math.random()) {
    const exponent = Math.max(0, Math.min(2, attempt - 1));
    const base = Math.min(INGEST_RETRY_MAX_MS, INGEST_RETRY_BASE_MS * 2 ** exponent);
    return base + Math.floor(base * 0.2 * Math.max(0, Math.min(1, random)));
}

function clearDebounce() {
    if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
}

function clearRetry() {
    if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
}

function stopHeartbeat() {
    if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

/**
 * 登出或关闭开关时撤销内存名单、定时器及在飞请求的结果处理.
 */
function clearIngestState() {
    currentLocation = '';
    roster.clear();
    clearDebounce();
    clearRetry();
    stopHeartbeat();
    retryAttempt = 0;
    activeRequestId = 0;
    queuedReport = false;
    queuedImmediateReport = false;
}

/**
 * @returns {boolean}
 */
function canReport() {
    try {
        const settings = useOverseeSettingsStore();
        return Boolean(
            settingsReady &&
            initialized &&
            watchState.isLoggedIn &&
            settings.ingestEnabled &&
            String(settings.licenseKey || '').trim() &&
            isPublicInstanceLocation(currentLocation) &&
            !authStopped
        );
    } catch {
        return false;
    }
}

/**
 * @returns {ReturnType<typeof buildIngestPayload>}
 */
function buildCurrentPayload() {
    try {
        const userStore = useUserStore();
        return buildIngestPayload({
            location: currentLocation,
            roster,
            self: userStore.currentUser || {}
        });
    } catch {
        return null;
    }
}

function scheduleBackoff() {
    clearRetry();
    if (!canReport()) {
        return;
    }
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        void requestReport(false).catch(() => {});
    }, getIngestRetryDelay(retryAttempt));
}

/**
 * 发送当前快照. immediate 仅用于换房/显式开启, 普通心跳与防抖尊重既有退避.
 *
 * @param {boolean} immediate
 * @returns {Promise<void>}
 */
async function requestReport(immediate) {
    if (!canReport()) {
        return;
    }
    if (activeRequestId) {
        queuedReport = true;
        queuedImmediateReport ||= immediate;
        return;
    }
    if (retryTimer !== null && !immediate) {
        return;
    }
    if (immediate) {
        clearRetry();
    }
    clearDebounce();

    const payload = buildCurrentPayload();
    if (!payload) {
        return;
    }
    const settings = useOverseeSettingsStore();
    const license = String(settings.licenseKey || '').trim();
    const apiBase = String(settings.apiBase || OVERSEE_API_BASE)
        .trim()
        .replace(/\/+$/, '');
    const requestId = ++nextRequestId;
    activeRequestId = requestId;
    let flushQueued = false;

    try {
        // C# WebApi.Execute 支持 method/headers/body; keepalive 字段会被忽略,
        // 代理请求本身由此处 await, 不依赖浏览器页面生命周期.
        /** @type {import('@/types/vrcx').WebApiOptions & { keepalive: boolean }} */
        const request = {
            url: `${apiBase || OVERSEE_API_BASE}/v1/ingest/instance`,
            method: 'POST',
            headers: {
                Authorization: `Bearer ${license}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            keepalive: true
        };
        const response = await webApiService.execute(request);
        if (activeRequestId !== requestId) {
            return;
        }
        if (response.status === 202) {
            retryAttempt = 0;
            authStopped = false;
            authWarningShown = false;
            flushQueued = true;
        } else if (response.status === 401 || response.status === 403) {
            authStopped = true;
            clearDebounce();
            clearRetry();
            stopHeartbeat();
            if (!authWarningShown) {
                authWarningShown = true;
                console.debug('[oversee] ingest stopped: license rejected');
            }
        } else if (response.status >= 500) {
            scheduleBackoff();
        }
        // 400/429 等响应不重试本周期; 后续新事件/心跳仍可触发.
    } catch {
        if (activeRequestId === requestId) {
            scheduleBackoff();
        }
    } finally {
        if (activeRequestId === requestId) {
            activeRequestId = 0;
            const shouldFlush = flushQueued && queuedReport;
            const queuedImmediate = queuedImmediateReport;
            queuedReport = false;
            queuedImmediateReport = false;
            if (shouldFlush) {
                void requestReport(queuedImmediate).catch(() => {});
            }
        }
    }
}

function reportNow() {
    try {
        void requestReport(true).catch(() => {});
    } catch {
        // 同步异常也不能泄漏到游戏日志处理链.
    }
}

function scheduleReport() {
    try {
        if (!canReport() || retryTimer !== null) {
            return;
        }
        // trailing debounce: 新事件重新计 30s, 合并为最新完整快照.
        clearDebounce();
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            void requestReport(false).catch(() => {});
        }, INGEST_DEBOUNCE_MS);
    } catch {
        // 静默降级.
    }
}

function startHeartbeat() {
    if (heartbeatTimer !== null || !canReport()) {
        return;
    }
    heartbeatTimer = setInterval(() => {
        void requestReport(false).catch(() => {});
    }, INGEST_HEARTBEAT_MS);
}

function reportNowIfReady() {
    if (canReport()) {
        startHeartbeat();
        reportNow();
    }
}

/**
 * 游戏日志协调器在原有 entry 落库后调用. 此函数自吞所有异常.
 *
 * @param {{ type?: string; location?: string; displayName?: string; userId?: string }} gameLog
 * @param {string} lastLocation
 */
export function notifyIngestGameLog(gameLog, lastLocation) {
    try {
        if (!gameLog || !watchState.isLoggedIn) {
            return;
        }
        if (gameLog.type === 'location') {
            const location = String(gameLog.location || lastLocation || '').trim();
            if (location === currentLocation) {
                return;
            }
            currentLocation = location;
            roster.clear();
            clearDebounce();
            clearRetry();
            retryAttempt = 0;
            queuedReport = false;
            queuedImmediateReport = false;
            reportNowIfReady();
            return;
        }
        const displayName = String(gameLog.displayName || '').trim();
        if (!displayName) {
            return;
        }
        if (gameLog.type === 'player-joined') {
            const id = validUserId(gameLog.userId);
            roster.set(displayName, id ? { name: displayName, id } : { name: displayName });
            scheduleReport();
        } else if (gameLog.type === 'player-left') {
            roster.delete(displayName);
            scheduleReport();
        }
    } catch {
        // 上报模块任何异常都不得影响主功能.
    }
}

/**
 * App onMounted 初始化, 幂等. 开关关闭或登出立即清理; 换 license/apiBase 后解除鉴权停止态.
 */
export function initOverseeIngest() {
    if (initialized) {
        return;
    }
    initialized = true;
    const settings = useOverseeSettingsStore();

    unwatchFns.push(
        watch(
            () => settings.ingestEnabled,
            (enabled) => {
                if (!enabled) {
                    clearIngestState();
                    return;
                }
                if (settingsReady) {
                    reportNowIfReady();
                }
            }
        ),
        watch(
            () => [settings.licenseKey, settings.apiBase],
            () => {
                authStopped = false;
                authWarningShown = false;
                retryAttempt = 0;
                clearRetry();
                if (settingsReady) {
                    reportNowIfReady();
                }
            }
        ),
        watch(
            () => watchState.isLoggedIn,
            (loggedIn) => {
                if (!loggedIn) {
                    clearIngestState();
                } else if (settingsReady) {
                    startHeartbeat();
                }
            }
        )
    );

    const ready = settings.ensureOverseeSettingsReady?.() || Promise.resolve();
    void Promise.resolve(ready)
        .then(() => {
            if (!initialized) {
                return;
            }
            settingsReady = true;
            reportNowIfReady();
        })
        .catch(() => {
            // 配置不可用时保持关闭, 不影响主流程.
        });
}

/**
 * 测试隔离: 清理全部状态及 watch, 允许重新初始化.
 */
export function resetOverseeIngestForTests() {
    clearIngestState();
    for (const unwatch of unwatchFns) {
        unwatch();
    }
    unwatchFns = [];
    initialized = false;
    settingsReady = false;
    authStopped = false;
    authWarningShown = false;
}

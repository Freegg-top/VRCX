// Oversee 客户端众包实时名单上报 (方案 D / M2).
// 直接读取 VRCX 已维护的实例快照; 所有失败均静默降级, 不影响游戏日志主流程.

import { watch } from 'vue';
import * as workerTimers from 'worker-timers';

import webApiService from './webapi';
import { watchState } from './watchState';
import { OVERSEE_API_BASE } from '../shared/constants/oversee';
import { useLocationStore } from '../stores/location';
import { useOverseeSettingsStore } from '../stores/settings/oversee';
import { useUserStore } from '../stores/user';

export const INGEST_POLL_INTERVAL_MS = 60 * 1000;
export const INGEST_HEARTBEAT_MS = 5 * 60 * 1000;
export const INGEST_RETRY_BASE_MS = 30 * 1000;
export const INGEST_RETRY_MAX_MS = 120 * 1000;
const CLIENT_VERSION = 'vrcx-dlc/2026.11.24';
const USR_ID_REGEX = /^usr_[a-z0-9-]+$/i;

let trackedLocation = '';
let lastSuccessfulSnapshotKey = '';
let lastSuccessfulReportAt = 0;
let pollTimer = null;
let retryTimer = null;
let retryAttempt = 0;
let activeRequestId = 0;
let nextRequestId = 0;
let queuedReport = false;
let queuedImmediateReport = false;
let queuedForcedReport = false;
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
 * 读取 VRCX 当前实例快照. playerList 通常已含自己, 缺失时用 currentUser 补齐;
 * 显示名是去重键, 自己的 currentUser ID 优先.
 *
 * @returns {{ location: string; users: { name: string; id?: string }[] } | null}
 */
export function buildSnapshot() {
    try {
        const locationStore = useLocationStore();
        const userStore = useUserStore();
        const lastLocation = locationStore.lastLocation;
        const selfName = String(userStore.currentUser?.displayName || '').trim();
        const selfId = validUserId(userStore.currentUser?.id);
        /** @type {{ name: string; id?: string }[]} */
        const users = [];
        const names = new Set();
        if (selfName) {
            users.push(selfId ? { name: selfName, id: selfId } : { name: selfName });
            names.add(selfName);
        }
        for (const [mapUserId, player] of lastLocation.playerList || new Map()) {
            const name = String(player?.displayName || '').trim();
            if (!name || names.has(name)) {
                continue;
            }
            const id = validUserId(player?.userId || mapUserId);
            users.push(id ? { name, id } : { name });
            names.add(name);
        }
        return {
            location: String(lastLocation.location || '').trim(),
            users
        };
    } catch {
        return null;
    }
}

/**
 * 构建契约 payload. 自己固定为第一项, 同名项合并, 无有效 usr_ ID 时仅报名字.
 *
 * @param {{
 *     location: string;
 *     users: { name: string; id?: string }[];
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
export function buildIngestPayload({ location, users: snapshotUsers, self, clientTs = Date.now() }) {
    const reporter = validUserId(self?.id);
    const selfName = String(self?.displayName || '').trim();
    if (!reporter || !selfName || !location) {
        return null;
    }

    /** @type {({ name: string; id: string } | string)[]} */
    const users = [{ name: selfName, id: reporter }];
    const names = new Set([selfName]);
    for (const entry of snapshotUsers) {
        const name = String(entry?.name || '').trim();
        if (!name || names.has(name)) {
            continue;
        }
        const id = validUserId(entry?.id);
        users.push(id ? { name, id } : name);
        names.add(name);
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
 * 快照对比键: location + 按 id/name 排序的名单, 与 Map 插入顺序无关.
 *
 * @param {{ location: string; users: { name: string; id?: string }[] }} snapshot
 * @returns {string}
 */
function getSnapshotKey(snapshot) {
    const users = snapshot.users.map((entry) => [validUserId(entry.id), entry.name]);
    users.sort((left, right) => {
        const idOrder = left[0].localeCompare(right[0]);
        return idOrder || left[1].localeCompare(right[1]);
    });
    return JSON.stringify([snapshot.location, users]);
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

function clearRetry() {
    if (retryTimer !== null) {
        workerTimers.clearTimeout(retryTimer);
        retryTimer = null;
    }
}

function stopPolling() {
    if (pollTimer !== null) {
        workerTimers.clearInterval(pollTimer);
        pollTimer = null;
    }
}

/**
 * 登出或关闭开关时撤销比较状态、定时器及在飞请求的结果处理.
 */
function clearIngestState() {
    trackedLocation = '';
    lastSuccessfulSnapshotKey = '';
    lastSuccessfulReportAt = 0;
    clearRetry();
    stopPolling();
    retryAttempt = 0;
    activeRequestId = 0;
    queuedReport = false;
    queuedImmediateReport = false;
    queuedForcedReport = false;
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
            !authStopped
        );
    } catch {
        return false;
    }
}

/**
 * @returns {{ payload: NonNullable<ReturnType<typeof buildIngestPayload>>; snapshotKey: string } | null}
 */
function buildCurrentReport() {
    try {
        const snapshot = buildSnapshot();
        if (!snapshot || !isPublicInstanceLocation(snapshot.location) || !snapshot.users.length) {
            return null;
        }
        const payload = buildIngestPayload({
            location: snapshot.location,
            users: snapshot.users,
            self: useUserStore().currentUser || {}
        });
        return payload ? { payload, snapshotKey: getSnapshotKey(snapshot) } : null;
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
    retryTimer = workerTimers.setTimeout(() => {
        retryTimer = null;
        void requestReport(false, false).catch(() => {});
    }, getIngestRetryDelay(retryAttempt));
}

/**
 * 发送当前快照. 轮询仅在快照较上次成功上报变化或心跳到期时发送;
 * immediate 用于换房/显式开启, 可绕过退避并强制发送.
 *
 * @param {boolean} immediate
 * @param {boolean} force
 * @returns {Promise<void>}
 */
async function requestReport(immediate, force) {
    if (!canReport()) {
        return;
    }
    if (activeRequestId) {
        queuedReport = true;
        queuedImmediateReport ||= immediate;
        queuedForcedReport ||= force || immediate;
        return;
    }
    if (retryTimer !== null && !immediate) {
        return;
    }
    if (immediate) {
        clearRetry();
    }

    const report = buildCurrentReport();
    if (!report) {
        return;
    }
    const heartbeatDue = Date.now() - lastSuccessfulReportAt >= INGEST_HEARTBEAT_MS;
    if (!immediate && !force && !heartbeatDue && report.snapshotKey === lastSuccessfulSnapshotKey) {
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
            body: JSON.stringify(report.payload),
            keepalive: true
        };
        const response = await webApiService.execute(request);
        if (activeRequestId !== requestId) {
            return;
        }
        if (response.status === 202) {
            retryAttempt = 0;
            lastSuccessfulSnapshotKey = report.snapshotKey;
            lastSuccessfulReportAt = Date.now();
            authStopped = false;
            authWarningShown = false;
            flushQueued = true;
        } else if (response.status === 401 || response.status === 403) {
            authStopped = true;
            clearRetry();
            stopPolling();
            if (!authWarningShown) {
                authWarningShown = true;
                console.debug('[oversee] ingest stopped: license rejected');
            }
        } else if (response.status >= 500) {
            scheduleBackoff();
        }
        // 400/429 等响应不重试本周期; 后续轮询仍可触发.
    } catch {
        if (activeRequestId === requestId) {
            scheduleBackoff();
        }
    } finally {
        if (activeRequestId === requestId) {
            activeRequestId = 0;
            const shouldFlush = flushQueued && queuedReport;
            const queuedImmediate = queuedImmediateReport;
            const queuedForce = queuedForcedReport;
            queuedReport = false;
            queuedImmediateReport = false;
            queuedForcedReport = false;
            if (shouldFlush) {
                void requestReport(queuedImmediate, queuedForce).catch(() => {});
            }
        }
    }
}

function reportNow() {
    try {
        void requestReport(true, true).catch(() => {});
    } catch {
        // 同步异常也不能泄漏到游戏日志处理链.
    }
}

function startPolling() {
    if (pollTimer !== null || !canReport()) {
        return;
    }
    // Web Worker 定时器避免 VR 中 CefSharp 隐藏页面后定时器被节流.
    pollTimer = workerTimers.setInterval(() => {
        void requestReport(false, false).catch(() => {});
    }, INGEST_POLL_INTERVAL_MS);
}

function reportNowIfReady() {
    if (canReport()) {
        startPolling();
        reportNow();
    }
}

/**
 * 游戏日志协调器在原有 entry 落库后调用. join/left 已由 playerList 快照覆盖,
 * 因而无需额外维护 roster 或 dirty 标记; 下一次 60s 轮询自然发现变化.
 *
 * @param {{ type?: string; location?: string; displayName?: string; userId?: string }} gameLog
 * @param {string} lastLocation
 */
export function notifyIngestGameLog(gameLog, lastLocation) {
    try {
        if (!gameLog || !watchState.isLoggedIn || gameLog.type !== 'location') {
            return;
        }
        const location = String(gameLog.location || lastLocation || '').trim();
        if (location === trackedLocation) {
            return;
        }
        trackedLocation = location;
        clearRetry();
        retryAttempt = 0;
        queuedReport = false;
        queuedImmediateReport = false;
        queuedForcedReport = false;
        reportNowIfReady();
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
                    startPolling();
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

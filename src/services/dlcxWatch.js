// DLCX 云端 SSE 全站人口流客户端单例.
// 用 fetch + ReadableStream 手动解析 SSE 而非 EventSource:
// - 需要读取 HTTP 状态码区分 401 (license 无效) / 403 (license 过期), 握手阶段识别并终止重连
// - 需要手动控制生命周期 (页面隐藏断流省内存, CefSharp 休眠场景)
// - AbortController 干净退出
// WebSocket 直连先例参考 src/services/websocket.js 的状态暴露风格.

import { ref } from 'vue';

import { useDLCXSettingsStore } from '../stores/settings/dlcx';
import { DLCX_API_BASE } from '../shared/constants/dlcx';

import { BeaconIdDeduper, SSE_DATA_EVENTS, parseSseChunk } from './dlcxWatchCore';

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 60000;
const DEDUPER_CAPACITY = 1024;
// 握手超时: fetch 无内置超时, 超时按网络错误进退避重连
const HANDSHAKE_TIMEOUT_MS = 15000;
// SSE 半行缓冲上限: 超过视为协议异常, 丢弃缓冲并强制重连
// (同时缓解半行残留导致的 parseSseChunk O(n²) 反复扫描)
const MAX_BUFFER_CHARS = 1024 * 1024;

/**
 * 连接状态 (供 UI 展示, 如 DLCX 页头状态圆点):
 * off 未启用 / connecting 握手中 / live 流式接收中 / reconnecting 退避等待重连 /
 * error 网络或服务端异常 (仍在退避重连) / expired 403 永久停止 /
 * invalid 401 永久停止 / notConfigured 未配置 license.
 */
const sseConnState = ref('off');

let abortController = null;
let reconnectTimer = null;
let backoffMs = RECONNECT_MIN_MS;
let desiredRunning = false;
let visibilityHooked = false;
let buffer = '';

/** @type {((userId: string) => boolean) | null} 第一道过滤谓词 */
let beaconFilter = null;
/** @type {((beacon: object) => void) | null} 过滤命中后的分发回调 */
let beaconHandler = null;

const beaconDeduper = new BeaconIdDeduper(DEDUPER_CAPACITY);

/**
 * 注册第一道过滤谓词: 返回 false 的 beacon 在本层直接丢弃, 不产生任何下游工作.
 *
 * @param {(userId: string) => boolean} predicate
 */
function setBeaconFilter(predicate) {
    beaconFilter = typeof predicate === 'function' ? predicate : null;
}

/**
 * 注册命中后的分发回调 (dlcxCoordinator).
 *
 * @param {(beacon: object) => void} handler
 */
function onBeacon(handler) {
    beaconHandler = typeof handler === 'function' ? handler : null;
}

/**
 * @param {string} userId
 * @returns {boolean}
 */
function passesFilter(userId) {
    if (!beaconFilter) {
        return true;
    }
    try {
        return Boolean(beaconFilter(userId));
    } catch {
        return false;
    }
}

/**
 * @param {object} store
 * @returns {boolean} 当前配置是否满足连接前提
 */
function isConfigured(store) {
    return (
        Boolean(String(store.licenseKey || '').trim()) &&
        (Boolean(store.enableWatchPush) || Boolean(store.enableBlockAlerts))
    );
}

/**
 * @returns {'off' | 'notConfigured'}
 */
function idleState() {
    return isConfigured(useDLCXSettingsStore()) ? 'off' : 'notConfigured';
}

function clearReconnectTimer() {
    if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function scheduleReconnect() {
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (desiredRunning && !document.hidden) {
            connect();
        }
    }, backoffMs);
    backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
}

/**
 * 处理单条 beacon data 行.
 *
 * @param {string} data
 */
function handleBeaconData(data) {
    let beacon;
    try {
        beacon = JSON.parse(data);
    } catch {
        return;
    }
    if (!beacon || typeof beacon !== 'object' || !beacon.user_id) {
        return;
    }
    if (!beaconDeduper.isNew(beacon.id)) {
        return;
    }
    if (!passesFilter(String(beacon.user_id))) {
        return;
    }
    beaconHandler?.(beacon);
}

/**
 * 握手被授权层拒绝 (401/403) 时释放响应体, 防止连接悬挂.
 *
 * @param {Response} response
 */
async function releaseResponseBody(response) {
    try {
        await response.body?.cancel();
    } catch {
        // ignore
    }
}

/**
 * @param {number} status
 * @returns {boolean} True = 握手被授权层拒绝, 永久停止
 */
function handleHandshakeAuthFailure(status) {
    const store = useDLCXSettingsStore();
    if (status === 401) {
        store.setLicenseStatus('invalid');
        sseConnState.value = 'invalid';
    } else if (status === 403) {
        store.setLicenseStatus('expired');
        sseConnState.value = 'expired';
    } else {
        return false;
    }
    desiredRunning = false;
    abortController = null;
    return true;
}

async function connect() {
    if (!desiredRunning || abortController !== null) {
        return;
    }
    const store = useDLCXSettingsStore();
    if (document.hidden) {
        sseConnState.value = idleState();
        return;
    }
    if (!isConfigured(store)) {
        sseConnState.value = 'notConfigured';
        desiredRunning = false;
        return;
    }
    const license = String(store.licenseKey || '').trim();
    const base = String(store.apiBase || '').trim() || DLCX_API_BASE;
    const url = `${base.replace(/\/+$/, '')}/v1/watch?license=${encodeURIComponent(license)}`;
    const controller = new AbortController();
    abortController = controller;
    sseConnState.value = 'connecting';
    // 握手超时: 超时 abort 走 fetch 的 catch → 按网络错误进退避
    const handshakeTimer = setTimeout(() => {
        try {
            controller.abort();
        } catch {
            // ignore
        }
    }, HANDSHAKE_TIMEOUT_MS);

    /** @type {Response | undefined} */
    let response;
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'text/event-stream' },
            cache: 'no-store',
            signal: controller.signal
        });
    } catch {
        clearTimeout(handshakeTimer);
        if (abortController === controller) {
            abortController = null;
            if (desiredRunning) {
                sseConnState.value = 'reconnecting';
                scheduleReconnect();
            } else {
                sseConnState.value = idleState();
            }
        }
        return;
    }
    clearTimeout(handshakeTimer);
    if (handleHandshakeAuthFailure(response.status)) {
        await releaseResponseBody(response);
        return;
    }
    if (!response.ok || !response.body) {
        if (abortController === controller) {
            abortController = null;
        }
        await releaseResponseBody(response);
        sseConnState.value = 'error';
        if (desiredRunning) {
            scheduleReconnect();
        }
        return;
    }

    sseConnState.value = 'live';
    backoffMs = RECONNECT_MIN_MS;
    buffer = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > MAX_BUFFER_CHARS) {
                // 半行缓冲失控 (服务端异常/恶意流): 丢弃并强制重连
                buffer = '';
                try {
                    await reader.cancel();
                } catch {
                    // ignore
                }
                break;
            }
            const { events, rest } = parseSseChunk(buffer);
            buffer = rest;
            for (const event of events) {
                if (SSE_DATA_EVENTS.has(event.event)) {
                    handleBeaconData(event.data);
                }
            }
        }
    } catch {
        // AbortController 中断或网络中断, 统一走 finally
    } finally {
        if (abortController === controller) {
            abortController = null;
            if (desiredRunning && !document.hidden) {
                sseConnState.value = 'reconnecting';
                scheduleReconnect();
            } else if (!desiredRunning) {
                sseConnState.value = idleState();
            }
            // desiredRunning 且页面隐藏: 由 visibilitychange 恢复可见时 connect
        }
    }
}

function handleVisibilityChange() {
    if (document.hidden) {
        if (abortController !== null) {
            try {
                abortController.abort();
            } catch {
                // ignore
            }
            abortController = null;
        }
        clearReconnectTimer();
        if (desiredRunning) {
            sseConnState.value = idleState();
        }
        return;
    }
    if (desiredRunning && abortController === null && reconnectTimer === null) {
        backoffMs = RECONNECT_MIN_MS;
        connect();
    }
}

function hookVisibility() {
    if (visibilityHooked || typeof document === 'undefined') {
        return;
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    visibilityHooked = true;
}

function unhookVisibility() {
    if (!visibilityHooked) {
        return;
    }
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    visibilityHooked = false;
}

/**
 * 开始订阅 (幂等): 条件不满足时记录状态但不连接.
 */
function start() {
    if (desiredRunning) {
        return;
    }
    if (!isConfigured(useDLCXSettingsStore())) {
        sseConnState.value = 'notConfigured';
        return;
    }
    desiredRunning = true;
    backoffMs = RECONNECT_MIN_MS;
    hookVisibility();
    connect();
}

/**
 * 停止订阅并断流 (401/403 后也会被调用, 状态覆盖为对应永久态).
 */
function stop() {
    desiredRunning = false;
    clearReconnectTimer();
    unhookVisibility();
    if (abortController !== null) {
        try {
            abortController.abort();
        } catch {
            // ignore
        }
        abortController = null;
    }
    buffer = '';
    sseConnState.value = idleState();
}

/**
 * 强制重连 (license/apiBase 变更后).
 */
function restart() {
    stop();
    start();
}

/**
 * 重置永久停止状态 (license 换新后由 restart 隐式完成; 单测/登出可显式调用).
 */
function resetAuthFailureState() {
    beaconDeduper.clear();
}

export { onBeacon, resetAuthFailureState, restart, setBeaconFilter, sseConnState, start, stop };

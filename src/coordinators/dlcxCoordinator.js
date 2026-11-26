// DLCX 云端监察分发/聚合协调器:
// 订阅 dlcxWatch 的过滤后 beacon 流, 实现
// - D3 关注提醒: 2.5s 窗口按 location 聚合同房名单, toast.info 推送
// - D6 黑名单告警: 命中 VRChat block 列表的目标时弹独立样式的 toast.warning
// REST 调用纪律: 仅对过滤命中的事件使用 getInstanceRoster, 且同 location 30s 内只调一次;
// 任何路径都不允许对每条未过滤事件发起 REST 请求 (先过滤后渲染, 次序不可反).

import { computed, watch } from 'vue';
import { toast } from 'vue-sonner';

import { i18n } from '../plugins/i18n';

import { database } from '../services/database';
import { getInstanceRoster } from '../services/dlcxApi';
import { BeaconWindowAggregator, PresenceToastDeduper, classifyBeacon } from '../services/dlcxWatchCore';
import {
    onBeacon,
    resetAuthFailureState,
    restart,
    setBeaconFilter,
    sseConnState,
    start,
    stop
} from '../services/dlcxWatch';
import { extractWorldIdFromLocation, shortenWorldId } from '../services/database/dlcxMerge';
import { useModerationStore } from '../stores/moderation';
import { useDLCXSettingsStore } from '../stores/settings/dlcx';
import { useUserStore } from '../stores/user';

const WINDOW_MS = 2500;
const ROSTER_TTL_MS = 30 * 1000;
const SAME_LOCATION_TTL_MS = 10 * 60 * 1000;
const BLOCK_TOAST_DURATION_MS = 12000;
const CO_ROOM_MAX_NAMES = 3;
const BLOCK_ROSTER_MAX_NAMES = 5;
const NAME_CACHE_TTL_MS = 5 * 60 * 1000;
// 各内存缓存 FIFO 上限, 防长期运行内存增长
const CACHE_MAX_ENTRIES = 300;

/** @type {Map<string, { name: string; fetchedAt: number }>} userId -> 本地解析缓存 */
const nameCache = new Map();
/** @type {Map<string, string>} worldId -> 世界名缓存 */
const worldNameCache = new Map();
/** @type {Map<string, { fetchedAt: number; nameById: Map<string, string> }>} location -> 在场名单缓存 */
const rosterCache = new Map();
/** @type {Map<string, Promise<Map<string, string> | null>>} location -> 在飞 roster 请求 */
const rosterPending = new Map();

let initialized = false;
let aggregator = null;
let toastDeduper = null;
let watchIdsComputed = null;
let blockedIdsComputed = null;
let licenseAlertShown = false;
let unwatchFns = [];

/**
 * FIFO 上限写入: 超限时淘汰最早写入的键.
 *
 * @template V
 * @param {Map<string, V>} map
 * @param {string} key
 * @param {V} value
 */
function cacheSetBounded(map, key, value) {
    if (!map.has(key) && map.size >= CACHE_MAX_ENTRIES) {
        map.delete(map.keys().next().value);
    }
    map.set(key, value);
}

/**
 * 包装异步处理器: 顶层兜底 catch, 防 unhandled rejection.
 *
 * @template A
 * @param {(...args: A[]) => Promise<void>} handler
 * @returns {(...args: A[]) => void}
 */
function safeAsyncHandler(handler) {
    return (...args) => {
        try {
            void Promise.resolve()
                .then(() => handler(...args))
                .catch((error) => console.error('[dlcx] async handler failed:', error));
        } catch (error) {
            console.error('[dlcx] async handler failed:', error);
        }
    };
}

/**
 * 关注名单集合 (缓存 Set, watchlist 变化时由 computed 失效重建).
 *
 * @returns {Set<string>}
 */
function getWatchUserIdSet() {
    try {
        return watchIdsComputed?.value || new Set();
    } catch {
        return new Set();
    }
}

/**
 * 黑名单集合 (登录后 moderation store 才会加载, 加载前视为空集; 过期条目不算).
 *
 * @returns {Set<string>}
 */
function getBlockedUserIdSet() {
    try {
        return blockedIdsComputed?.value || new Set();
    } catch {
        return new Set();
    }
}

function buildBlockedUserIdSet() {
    const moderationStore = useModerationStore();
    const userStore = useUserStore();
    const selfId = userStore.currentUser?.id || '';
    const result = new Set();
    for (const ref of moderationStore.cachedPlayerModerations.values()) {
        if (ref?.$isExpired) {
            continue;
        }
        if (ref?.type === 'block' && ref.targetUserId && (!selfId || ref.sourceUserId === selfId)) {
            result.add(ref.targetUserId);
        }
    }
    return result;
}

/**
 * Location 的在场名单 (userId -> display_name), 30s 缓存 + 在飞去重.
 * 失败返回 null, 调用方自行兜底.
 *
 * @param {string} location
 * @returns {Promise<Map<string, string> | null>}
 */
function getRoster(location) {
    const cached = rosterCache.get(location);
    if (cached && Date.now() - cached.fetchedAt < ROSTER_TTL_MS) {
        return Promise.resolve(cached.nameById);
    }
    let pending = rosterPending.get(location);
    if (!pending) {
        pending = getInstanceRoster(location)
            .then((json) => {
                const nameById = new Map();
                for (const row of json?.results || []) {
                    if (row?.user_id) {
                        nameById.set(row.user_id, row.display_name || '');
                    }
                }
                cacheSetBounded(rosterCache, location, { fetchedAt: Date.now(), nameById });
                return nameById;
            })
            .catch(() => null)
            .finally(() => rosterPending.delete(location));
        rosterPending.set(location, pending);
    }
    return pending;
}

/**
 * 显示名解析顺序: 本地缓存 → 用户缓存 → 本地 sqlite → 云端 roster → 空串 (调用方截短 user_id).
 *
 * @param {string} userId
 * @param {string} location
 * @returns {Promise<string>}
 */
async function resolveDisplayName(userId, location) {
    if (!userId) {
        return '';
    }
    const userStore = useUserStore();
    const cachedRef = userStore.cachedUsers.get(userId);
    if (cachedRef?.displayName) {
        return cachedRef.displayName;
    }
    const cached = nameCache.get(userId);
    if (cached && Date.now() - cached.fetchedAt < NAME_CACHE_TTL_MS) {
        return cached.name;
    }
    let name = '';
    try {
        name = (await database.getDisplayNameByUserId(userId)) || '';
    } catch {
        name = '';
    }
    if (!name) {
        const roster = await getRoster(location);
        name = roster?.get(userId) || '';
    }
    cacheSetBounded(nameCache, userId, { name, fetchedAt: Date.now() });
    return name;
}

/**
 * 世界名: 本地映射缓存 → sqlite → world_id 截短兜底.
 *
 * @param {string} worldId
 * @param {string} location
 * @returns {Promise<string>}
 */
async function resolveWorldName(worldId, location) {
    const id = worldId || extractWorldIdFromLocation(location);
    if (!id) {
        return shortenWorldId(location);
    }
    if (worldNameCache.has(id)) {
        return worldNameCache.get(id);
    }
    let name = '';
    try {
        name = (await database.getGameLogWorldNameByWorldId(id)) || '';
    } catch {
        name = '';
    }
    const display = name || shortenWorldId(id);
    cacheSetBounded(worldNameCache, id, display);
    return display;
}

/**
 * User_id 截短兜底显示.
 *
 * @param {string} userId
 * @returns {string}
 */
function fallbackDisplayName(userId) {
    const id = String(userId || '');
    return id.length <= 12 ? id : `${id.slice(0, 12)}…`;
}

/**
 * 同房名单文案: ≤3 人列出全部, 超出取前 3 + "等 N 人" (文案走 i18n, 分隔符由语言文案决定).
 * 名单本体用 ", " 连接 (三语通用), 具体措辞在 view.dlcx.push.watch_with* 键内.
 *
 * @param {string[]} names
 * @param {(key: string, named?: Record<string, unknown>) => string} t
 * @returns {string}
 */
function formatCoRoomNames(names, t) {
    if (names.length <= CO_ROOM_MAX_NAMES) {
        return t('view.dlcx.push.watch_with', { names: names.join(', ') });
    }
    return t('view.dlcx.push.watch_with_more', {
        names: names.slice(0, CO_ROOM_MAX_NAMES).join(', '),
        count: names.length
    });
}

/**
 * D3 窗口关闭: 同 location 的命中事件聚合为一条 toast.
 *
 * @param {string} location
 * @param {object[]} beacons
 */
async function handleWatchFlush(location, beacons) {
    const t = i18n.global.t;
    // 同 user_id + location 10 分钟去重
    const unique = beacons.filter((beacon) => toastDeduper?.shouldNotify(beacon.user_id, location));
    if (!unique.length) {
        return;
    }
    const main = unique[0];
    const worldName = await resolveWorldName(main.world_id, location);
    let mainName = await resolveDisplayName(main.user_id, location);
    if (!mainName) {
        mainName = fallbackDisplayName(main.user_id);
    }
    const title = t('view.dlcx.push.watch_title', { name: mainName, world: worldName });

    // 同房其他命中事件 (副行)
    const otherIds = [...new Set(unique.slice(1).map((beacon) => String(beacon.user_id)))];
    let description = '';
    if (otherIds.length) {
        const names = [];
        for (const userId of otherIds) {
            let name = await resolveDisplayName(userId, location);
            if (!name) {
                name = fallbackDisplayName(userId);
            }
            names.push(name);
        }
        description = formatCoRoomNames(names, t);
    }
    if (description) {
        toast.info(title, { description });
    } else {
        toast.info(title);
    }
}

/**
 * D6 黑名单告警: 独立样式 (warning + 更长 duration), 副行带在场名单前 5 人.
 *
 * @param {object} beacon
 */
async function handleBlockBeacon(beacon) {
    const t = i18n.global.t;
    if (!toastDeduper?.shouldNotify(beacon.user_id, beacon.location)) {
        return;
    }
    const worldName = await resolveWorldName(beacon.world_id, beacon.location);
    let name = await resolveDisplayName(beacon.user_id, beacon.location);
    if (!name) {
        name = fallbackDisplayName(beacon.user_id);
    }
    const title = t('view.dlcx.push.block_title', { name });
    const description = t('view.dlcx.push.block_world', { world: worldName });

    const roster = await getRoster(beacon.location);
    if (roster && roster.size) {
        const names = [];
        for (const [userId, displayName] of roster) {
            if (userId === beacon.user_id) {
                continue;
            }
            names.push(displayName || fallbackDisplayName(userId));
            if (names.length >= BLOCK_ROSTER_MAX_NAMES) {
                break;
            }
        }
        if (names.length) {
            // sonner description 不渲染 \n, 多行信息用 ' · ' 单行连接
            const rosterLine = t('view.dlcx.push.block_roster', { names: names.join(', ') });
            toast.warning(title, {
                description: `${description} · ${rosterLine}`,
                duration: BLOCK_TOAST_DURATION_MS
            });
            return;
        }
    }
    toast.warning(title, { description, duration: BLOCK_TOAST_DURATION_MS });
}

/**
 * 过滤命中后的分发入口: 命中分类决定进入 D3 窗口 / D6 告警.
 *
 * @param {object} beacon
 */
function dispatchBeacon(beacon) {
    const store = useDLCXSettingsStore();
    const kind = classifyBeacon({
        userId: String(beacon.user_id),
        watchSet: getWatchUserIdSet(),
        blockSet: getBlockedUserIdSet(),
        enableWatchPush: Boolean(store.enableWatchPush),
        enableBlockAlerts: Boolean(store.enableBlockAlerts)
    });
    if (!kind) {
        return;
    }
    if (kind === 'both') {
        // block 优先: 同命中两名单时只发 D6 告警, 不再聚合 D3, 避免双通道互相抑制/重复提醒
        safeAsyncHandler(handleBlockBeacon)(beacon);
        return;
    }
    if (kind === 'watch') {
        aggregator?.add(beacon);
        return;
    }
    safeAsyncHandler(handleBlockBeacon)(beacon);
}

/**
 * 依据设置开关同步 SSE 连接: 关注提醒与黑名单提醒全关或未配置 license 时停流.
 */
function syncWatchConnection() {
    const store = useDLCXSettingsStore();
    const license = String(store.licenseKey || '').trim();
    if (!license || (!store.enableWatchPush && !store.enableBlockAlerts)) {
        licenseAlertShown = false;
        stop();
        return;
    }
    start();
}

/**
 * 初始化协调器 (App.vue onMounted 调用一次, 幂等).
 */
export function initDLCXCoordinator() {
    if (initialized) {
        return;
    }
    initialized = true;

    const dlcxSettingsStore = useDLCXSettingsStore();
    toastDeduper = new PresenceToastDeduper(SAME_LOCATION_TTL_MS);
    aggregator = new BeaconWindowAggregator({
        windowMs: WINDOW_MS,
        onFlush: safeAsyncHandler(handleWatchFlush)
    });
    // 过滤集合缓存: watchlist/moderations 变化时由 computed 失效重建, 热路径不再每条 new Set
    watchIdsComputed = computed(() => new Set(dlcxSettingsStore.watchlist || []));
    blockedIdsComputed = computed(() => buildBlockedUserIdSet());

    setBeaconFilter((userId) => {
        const store = useDLCXSettingsStore();
        return (
            classifyBeacon({
                userId,
                watchSet: getWatchUserIdSet(),
                blockSet: getBlockedUserIdSet(),
                enableWatchPush: Boolean(store.enableWatchPush),
                enableBlockAlerts: Boolean(store.enableBlockAlerts)
            }) !== null
        );
    });
    onBeacon(dispatchBeacon);

    // 开关/license/apiBase 变化 → 重连或停流; 换新 key 后重置永久停止态
    unwatchFns.push(
        watch(
            () => [
                dlcxSettingsStore.licenseKey,
                dlcxSettingsStore.apiBase,
                dlcxSettingsStore.enableWatchPush,
                dlcxSettingsStore.enableBlockAlerts
            ],
            (values, prevValues) => {
                const [license, apiBase] = values;
                const prevLicense = prevValues?.[0] ?? '';
                const prevApiBase = prevValues?.[1] ?? '';
                if (String(prevLicense) !== String(license ?? '')) {
                    resetAuthFailureState();
                    licenseAlertShown = false;
                    restart();
                    return;
                }
                if (String(prevApiBase) !== String(apiBase ?? '')) {
                    restart();
                    return;
                }
                syncWatchConnection();
            }
        )
    );

    // 401/403 → 停流 + 一次性 toast (license 换新后重置)
    unwatchFns.push(
        watch(
            () => dlcxSettingsStore.licenseStatus,
            (status) => {
                if (status === 'invalid' || status === 'expired') {
                    stop();
                    // stop() 会把状态覆写为 off, 恢复永久停止态供 UI 圆点展示
                    sseConnState.value = status;
                    if (!licenseAlertShown) {
                        licenseAlertShown = true;
                        const t = i18n.global.t;
                        toast.error(
                            status === 'invalid'
                                ? t('view.dlcx.push.license_invalid')
                                : t('view.dlcx.push.license_expired')
                        );
                    }
                } else if (status === 'ok' || status === 'unknown') {
                    licenseAlertShown = false;
                }
            }
        )
    );

    syncWatchConnection();
}

/**
 * 重置模块级单例状态 (仅测试用: 每个用例需要独立 pinia 与协调器状态).
 */
export function resetDLCXCoordinatorForTests() {
    for (const unwatch of unwatchFns) {
        unwatch();
    }
    unwatchFns = [];
    aggregator?.reset();
    aggregator = null;
    toastDeduper?.clear();
    toastDeduper = null;
    watchIdsComputed = null;
    blockedIdsComputed = null;
    initialized = false;
    licenseAlertShown = false;
    stop();
}

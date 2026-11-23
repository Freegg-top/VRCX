import { OVERSEE_CONFIG_KEYS } from '../shared/constants/oversee';

import configRepository from '../services/config';
import { dbVars } from '../services/database';
import { useFriendStore } from '../stores/friend';
import { useOverseeSettingsStore } from '../stores/settings/oversee';
import { useWatchedStore } from '../stores/watched';

/** @type {Promise<unknown>} */
let syncQueue = Promise.resolve();

/**
 * @param {unknown} id
 * @returns {string}
 */
function normalizeUserId(id) {
    const userId = String(id ?? '')
        .trim()
        .toLowerCase();
    return /^usr_[a-z0-9-]+$/.test(userId) ? userId : '';
}

/**
 * DbVars.userId is set by the login flow before watched users are initialized;
 * unlike watchState.isLoggedIn it does not depend on a microtask boundary.
 *
 * @returns {boolean}
 */
function canSyncWatchedUsers() {
    return Boolean(dbVars.userId);
}

/**
 * @param {{ licenseKey?: string }} settings
 * @returns {boolean}
 */
function hasLicenseKey(settings) {
    return Boolean(String(settings?.licenseKey || '').trim());
}

/**
 * ConfigRepository 的读写并非事务，串行化操作可避免并发关注/取关覆盖标记。
 *
 * @template T
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
function enqueueSyncOperation(operation) {
    const result = syncQueue.then(operation, operation);
    syncQueue = result.catch(() => {});
    return result;
}

/**
 * @param {string} key
 * @returns {Promise<Set<string>>}
 */
async function readUserIdSet(key) {
    const raw = await configRepository.getString(key, '[]');
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return new Set();
        }
        return new Set(parsed.map((id) => normalizeUserId(id)).filter(Boolean));
    } catch {
        return new Set();
    }
}

/**
 * @param {string} key
 * @param {Set<string>} userIds
 * @returns {Promise<void>}
 */
async function persistUserIdSet(key, userIds) {
    await configRepository.setString(key, JSON.stringify(Array.from(userIds)));
}

/**
 * @param {Set<string>} left
 * @param {Set<string>} right
 * @returns {boolean}
 */
function setsEqual(left, right) {
    return left.size === right.size && Array.from(left).every((id) => right.has(id));
}

/**
 * @param {ReturnType<typeof useOverseeSettingsStore>} overseeSettingsStore
 * @param {string[]} initialWatchlist
 * @returns {Promise<boolean>}
 */
async function persistWatchlistIfChanged(overseeSettingsStore, initialWatchlist) {
    if (JSON.stringify(initialWatchlist) === JSON.stringify(overseeSettingsStore.watchlist)) {
        return true;
    }
    return overseeSettingsStore.persistWatchlist();
}

/**
 * 本地关注成功后单向加入 Oversee 名单。已存在的手动项不会转成自动项。
 * 自动标记先持久化，写入失败时绝不留下无法随取关删除的无标记条目。
 *
 * @param {string} userId
 * @returns {Promise<boolean>} 是否新增了自动同步项
 */
export function syncWatchedAdd(userId) {
    return enqueueSyncOperation(async () => {
        const normalizedUserId = normalizeUserId(userId);
        if (!normalizedUserId || normalizedUserId === dbVars.userId || !canSyncWatchedUsers()) {
            return false;
        }
        const overseeSettingsStore = useOverseeSettingsStore();
        await overseeSettingsStore.ensureOverseeSettingsReady();
        if (!overseeSettingsStore.syncWatched || !hasLicenseKey(overseeSettingsStore)) {
            return false;
        }

        const syncedUserIds = await readUserIdSet(OVERSEE_CONFIG_KEYS.watchedSync);
        const ignoredUserIds = await readUserIdSet(OVERSEE_CONFIG_KEYS.watchedIgnore);
        if (ignoredUserIds.delete(normalizedUserId)) {
            // A new local follow explicitly overrides an earlier manual removal.
            await persistUserIdSet(OVERSEE_CONFIG_KEYS.watchedIgnore, ignoredUserIds);
        }
        if (overseeSettingsStore.isWatched(normalizedUserId)) {
            return false;
        }

        syncedUserIds.add(normalizedUserId);
        await persistUserIdSet(OVERSEE_CONFIG_KEYS.watchedSync, syncedUserIds);
        if (await overseeSettingsStore.addWatchPersisted(normalizedUserId)) {
            return true;
        }

        // Do not leave an in-memory automatic item after its awaited write failed.
        overseeSettingsStore.removeWatch(normalizedUserId, false);
        syncedUserIds.delete(normalizedUserId);
        await persistUserIdSet(OVERSEE_CONFIG_KEYS.watchedSync, syncedUserIds);
        return false;
    });
}

/**
 * 本地取关只移除带自动标记的条目，用户手动加入的 Oversee 项保持不变。
 *
 * @param {string} userId
 * @returns {Promise<boolean>} 是否移除了自动同步项
 */
export function syncWatchedRemove(userId) {
    return enqueueSyncOperation(async () => {
        const normalizedUserId = normalizeUserId(userId);
        if (!normalizedUserId || !canSyncWatchedUsers()) {
            return false;
        }
        const overseeSettingsStore = useOverseeSettingsStore();
        await overseeSettingsStore.ensureOverseeSettingsReady();
        const syncedUserIds = await readUserIdSet(OVERSEE_CONFIG_KEYS.watchedSync);
        if (!syncedUserIds.has(normalizedUserId)) {
            return false;
        }

        if (overseeSettingsStore.isWatched(normalizedUserId)) {
            const removed = await overseeSettingsStore.removeWatchPersisted(normalizedUserId);
            if (!removed) {
                overseeSettingsStore.addWatch(normalizedUserId, false);
                return false;
            }
        }
        syncedUserIds.delete(normalizedUserId);
        await persistUserIdSet(OVERSEE_CONFIG_KEYS.watchedSync, syncedUserIds);
        return true;
    });
}

/**
 * 启动时按 watched 表、sync 标记、ignore 和 watchlist 四方对账，可重复执行。
 * 标记存在但名单缺失代表用户手动删除：记录 ignore 后不再加回。
 *
 * @returns {Promise<void>}
 */
export function reconcileWatchedSync() {
    return enqueueSyncOperation(async () => {
        if (!canSyncWatchedUsers()) {
            return;
        }
        const overseeSettingsStore = useOverseeSettingsStore();
        await overseeSettingsStore.ensureOverseeSettingsReady();
        if (!hasLicenseKey(overseeSettingsStore)) {
            return;
        }
        const syncedUserIds = await readUserIdSet(OVERSEE_CONFIG_KEYS.watchedSync);
        const ignoredUserIds = await readUserIdSet(OVERSEE_CONFIG_KEYS.watchedIgnore);
        const initialWatchlist = [...overseeSettingsStore.watchlist];

        if (!overseeSettingsStore.syncWatched) {
            for (const userId of syncedUserIds) {
                overseeSettingsStore.removeWatch(userId, false);
            }
            if (!(await persistWatchlistIfChanged(overseeSettingsStore, initialWatchlist))) {
                return;
            }
            if (syncedUserIds.size) {
                await persistUserIdSet(OVERSEE_CONFIG_KEYS.watchedSync, new Set());
            }
            if (ignoredUserIds.size) {
                await persistUserIdSet(OVERSEE_CONFIG_KEYS.watchedIgnore, new Set());
            }
            return;
        }

        const watchedStore = useWatchedStore();
        const friendStore = useFriendStore();
        const watchedNonFriendIds = new Set();
        for (const watchedUserId of watchedStore.watchedUsers.keys()) {
            const userId = normalizeUserId(watchedUserId);
            if (userId && userId !== dbVars.userId && !friendStore.friends.has(watchedUserId)) {
                watchedNonFriendIds.add(userId);
            }
        }

        const nextSyncedUserIds = new Set(syncedUserIds);
        const nextIgnoredUserIds = new Set(ignoredUserIds);
        for (const userId of syncedUserIds) {
            if (!watchedNonFriendIds.has(userId)) {
                overseeSettingsStore.removeWatch(userId, false);
                nextSyncedUserIds.delete(userId);
                nextIgnoredUserIds.delete(userId);
            }
        }
        for (const userId of watchedNonFriendIds) {
            // 未带 sync 标记的既有条目属于手动名单，不能接管其归属。
            if (overseeSettingsStore.isWatched(userId)) {
                continue;
            }
            if (syncedUserIds.has(userId)) {
                // A marker without its watchlist entry is an intentional manual
                // removal, not missing data that should be recreated.
                nextIgnoredUserIds.add(userId);
                continue;
            }
            if (nextIgnoredUserIds.has(userId)) {
                continue;
            }
            if (overseeSettingsStore.addWatch(userId, false)) {
                nextSyncedUserIds.add(userId);
            }
        }

        // Batch mode suppresses every per-item write above. Persist the final
        // array once and only advance markers after that write is confirmed.
        if (!(await persistWatchlistIfChanged(overseeSettingsStore, initialWatchlist))) {
            return;
        }
        if (!setsEqual(syncedUserIds, nextSyncedUserIds)) {
            await persistUserIdSet(OVERSEE_CONFIG_KEYS.watchedSync, nextSyncedUserIds);
        }
        if (!setsEqual(ignoredUserIds, nextIgnoredUserIds)) {
            await persistUserIdSet(OVERSEE_CONFIG_KEYS.watchedIgnore, nextIgnoredUserIds);
        }
    });
}

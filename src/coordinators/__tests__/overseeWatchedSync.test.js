import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const state = vi.hoisted(() => ({
    config: new Map(),
    dbVars: { userId: 'usr_current' },
    watch: { isLoggedIn: true },
    friends: new Map()
}));

const configMock = vi.hoisted(() => ({
    getString: vi.fn((key, defaultValue) =>
        Promise.resolve(state.config.has(key) ? state.config.get(key) : defaultValue)
    ),
    setString: vi.fn((key, value) => {
        state.config.set(key, String(value));
        return Promise.resolve();
    }),
    getBool: vi.fn((key, defaultValue) => {
        if (!state.config.has(key)) {
            return Promise.resolve(defaultValue);
        }
        return Promise.resolve(state.config.get(key) === 'true');
    }),
    setBool: vi.fn((key, value) => {
        state.config.set(key, String(value));
        return Promise.resolve();
    })
}));

vi.mock('../../services/config', () => ({
    default: configMock
}));
vi.mock('../../services/database', () => ({
    dbVars: state.dbVars
}));
vi.mock('../../services/watchState', () => ({
    watchState: state.watch
}));
vi.mock('../../stores/friend', () => ({
    useFriendStore: () => ({
        get friends() {
            return state.friends;
        }
    })
}));

import { useOverseeSettingsStore } from '../../stores/settings/oversee';
import { useWatchedStore } from '../../stores/watched';
import { reconcileWatchedSync, syncWatchedAdd, syncWatchedRemove } from '../overseeWatchedSync';

const WATCHLIST_KEY = 'VRCX_oversee_watchlist';
const SYNC_KEY = 'VRCX_oversee_watchedSync';
const IGNORE_KEY = 'VRCX_oversee_watched_ignore';
const SYNC_ENABLED_KEY = 'VRCX_oversee_syncWatched';
const LICENSE_KEY = 'VRCX_oversee_licenseKey';

/**
 * @param {string} userId
 * @returns {{ userId: string; displayName: string; created_at: string }}
 */
function watchedUser(userId) {
    return {
        userId,
        displayName: userId,
        created_at: '2026-11-23T00:00:00.000Z'
    };
}

/**
 * @returns {string[]}
 */
function storedSyncedIds() {
    return JSON.parse(state.config.get(SYNC_KEY) || '[]');
}

/**
 * @returns {string[]}
 */
function storedIgnoredIds() {
    return JSON.parse(state.config.get(IGNORE_KEY) || '[]');
}

describe('oversee watched sync', () => {
    let overseeSettingsStore;
    let watchedStore;

    beforeEach(async () => {
        vi.clearAllMocks();
        state.config.clear();
        state.config.set(LICENSE_KEY, 'test-license');
        state.dbVars.userId = 'usr_current';
        state.watch.isLoggedIn = true;
        state.friends = new Map();
        setActivePinia(createPinia());
        overseeSettingsStore = useOverseeSettingsStore();
        watchedStore = useWatchedStore();
        await overseeSettingsStore.ensureOverseeSettingsReady();
    });

    test('add/remove 联动 watchlist 并持久化自动标记', async () => {
        await expect(syncWatchedAdd(' usr_Auto-1 ')).resolves.toBe(true);
        expect(overseeSettingsStore.watchlist).toEqual(['usr_auto-1']);
        expect(storedSyncedIds()).toEqual(['usr_auto-1']);

        await expect(syncWatchedRemove('usr_auto-1')).resolves.toBe(true);
        expect(overseeSettingsStore.watchlist).toEqual([]);
        expect(storedSyncedIds()).toEqual([]);
        expect(configMock.setString).toHaveBeenLastCalledWith(SYNC_KEY, '[]');
    });

    test('手动项不会被接管或随本地取关删除', async () => {
        overseeSettingsStore.addWatch('usr_manual');

        await expect(syncWatchedAdd('usr_manual')).resolves.toBe(false);
        expect(storedSyncedIds()).toEqual([]);

        await expect(syncWatchedRemove('usr_manual')).resolves.toBe(false);
        expect(overseeSettingsStore.watchlist).toEqual(['usr_manual']);
        expect(configMock.setString).toHaveBeenCalledTimes(1);
    });

    test('开启对账补齐非好友、忽略手动删除的自动项且不接管手动项', async () => {
        state.config.set(WATCHLIST_KEY, JSON.stringify(['usr_manual', 'usr_stale']));
        state.config.set(SYNC_KEY, JSON.stringify(['usr_stale', 'usr_readd']));
        setActivePinia(createPinia());
        overseeSettingsStore = useOverseeSettingsStore();
        watchedStore = useWatchedStore();
        await overseeSettingsStore.ensureOverseeSettingsReady();

        for (const userId of ['usr_manual', 'usr_nonfriend', 'usr_friend', 'usr_readd', 'invalid']) {
            watchedStore.setWatchedUser(watchedUser(userId));
        }
        state.friends = new Map([['usr_friend', {}]]);

        await reconcileWatchedSync();

        expect(new Set(overseeSettingsStore.watchlist)).toEqual(new Set(['usr_manual', 'usr_nonfriend']));
        expect(overseeSettingsStore.watchlist).not.toContain('usr_friend');
        expect(overseeSettingsStore.watchlist).not.toContain('usr_stale');
        expect(overseeSettingsStore.watchlist).not.toContain('usr_readd');
        expect(new Set(storedSyncedIds())).toEqual(new Set(['usr_readd', 'usr_nonfriend']));
        expect(storedIgnoredIds()).toEqual(['usr_readd']);
    });

    test('关闭对账只撤销自动项并清空标记', async () => {
        state.config.set(WATCHLIST_KEY, JSON.stringify(['usr_auto', 'usr_manual']));
        state.config.set(SYNC_KEY, JSON.stringify(['usr_auto']));
        state.config.set(SYNC_ENABLED_KEY, 'false');
        setActivePinia(createPinia());
        overseeSettingsStore = useOverseeSettingsStore();
        await overseeSettingsStore.ensureOverseeSettingsReady();

        await reconcileWatchedSync();

        expect(overseeSettingsStore.watchlist).toEqual(['usr_manual']);
        expect(storedSyncedIds()).toEqual([]);
    });

    test('未登录、非法 ID 和本人均不写名单或标记', async () => {
        state.dbVars.userId = '';
        state.config.set(WATCHLIST_KEY, JSON.stringify(['usr_auto', 'usr_manual']));
        state.config.set(SYNC_KEY, JSON.stringify(['usr_auto']));
        setActivePinia(createPinia());
        overseeSettingsStore = useOverseeSettingsStore();
        await overseeSettingsStore.ensureOverseeSettingsReady();

        await expect(syncWatchedAdd('usr_new')).resolves.toBe(false);
        await expect(syncWatchedRemove('usr_auto')).resolves.toBe(false);
        await reconcileWatchedSync();
        expect(overseeSettingsStore.watchlist).toEqual(['usr_auto', 'usr_manual']);
        expect(storedSyncedIds()).toEqual(['usr_auto']);

        state.dbVars.userId = 'usr_current';
        await expect(syncWatchedAdd('invalid')).resolves.toBe(false);
        await expect(syncWatchedAdd('usr_current')).resolves.toBe(false);
        expect(overseeSettingsStore.watchlist).toEqual(['usr_auto', 'usr_manual']);
        expect(storedSyncedIds()).toEqual(['usr_auto']);
    });

    test('自动标记持久化失败时不添加无法删除的名单项', async () => {
        configMock.setString.mockRejectedValueOnce(new Error('disk full'));

        await expect(syncWatchedAdd('usr_auto')).rejects.toThrow('disk full');

        expect(overseeSettingsStore.watchlist).toEqual([]);
        expect(storedSyncedIds()).toEqual([]);
        expect(configMock.setString).toHaveBeenCalledTimes(1);
        expect(configMock.setString).toHaveBeenCalledWith(SYNC_KEY, '["usr_auto"]');
    });

    test('新关注覆盖旧 ignore 并恢复手动删除的自动项', async () => {
        state.config.set(SYNC_KEY, JSON.stringify(['usr_ignored']));
        state.config.set(IGNORE_KEY, JSON.stringify(['usr_ignored']));
        setActivePinia(createPinia());
        overseeSettingsStore = useOverseeSettingsStore();
        await overseeSettingsStore.ensureOverseeSettingsReady();

        await expect(syncWatchedAdd('usr_ignored')).resolves.toBe(true);

        expect(overseeSettingsStore.watchlist).toEqual(['usr_ignored']);
        expect(storedSyncedIds()).toEqual(['usr_ignored']);
        expect(storedIgnoredIds()).toEqual([]);
    });

    test('没有 license key 时不执行新增或对账动作', async () => {
        state.config.set(LICENSE_KEY, '');
        state.config.set(SYNC_KEY, JSON.stringify(['usr_auto']));
        state.config.set(WATCHLIST_KEY, JSON.stringify(['usr_manual']));
        setActivePinia(createPinia());
        overseeSettingsStore = useOverseeSettingsStore();
        watchedStore = useWatchedStore();
        await overseeSettingsStore.ensureOverseeSettingsReady();
        watchedStore.setWatchedUser(watchedUser('usr_new'));

        await expect(syncWatchedAdd('usr_new')).resolves.toBe(false);
        await reconcileWatchedSync();

        expect(overseeSettingsStore.watchlist).toEqual(['usr_manual']);
        expect(storedSyncedIds()).toEqual(['usr_auto']);
        expect(configMock.setString).not.toHaveBeenCalled();
    });

    test('16 条批量新增只写一次完整 watchlist 和一次 sync 标记', async () => {
        const userIds = Array.from({ length: 16 }, (_, index) => `usr_batch-${index}`);
        for (const userId of userIds) {
            watchedStore.setWatchedUser(watchedUser(userId));
        }

        await reconcileWatchedSync();

        expect(watchedStore.watchedUsers.size).toBe(16);
        expect(overseeSettingsStore.licenseKey).toBe('test-license');
        expect(overseeSettingsStore.syncWatched).toBe(true);
        expect(overseeSettingsStore.watchlist).toHaveLength(16);
        const watchlistWrites = configMock.setString.mock.calls.filter(([key]) => key === WATCHLIST_KEY);
        const markerWrites = configMock.setString.mock.calls.filter(([key]) => key === SYNC_KEY);
        expect(watchlistWrites).toHaveLength(1);
        expect(JSON.parse(watchlistWrites[0][1])).toEqual(userIds);
        expect(markerWrites).toHaveLength(1);
        expect(JSON.parse(markerWrites[0][1])).toEqual(userIds);
        expect(JSON.parse(state.config.get(WATCHLIST_KEY))).toEqual(userIds);
        expect(overseeSettingsStore.watchlist).toEqual(userIds);
    });

    test('三次并发 add/remove 按队列串行落盘且保留最终状态', async () => {
        const writes = [];
        configMock.setString.mockImplementation(async (key, value) => {
            await new Promise((resolve) => setTimeout(resolve, 0));
            writes.push([key, value]);
            state.config.set(key, String(value));
        });

        const results = await Promise.all([
            syncWatchedAdd('usr_first'),
            syncWatchedAdd('usr_second'),
            syncWatchedRemove('usr_first')
        ]);

        expect(results).toEqual([true, true, true]);
        expect(overseeSettingsStore.watchlist).toEqual(['usr_second']);
        expect(storedSyncedIds()).toEqual(['usr_second']);
        expect(writes.filter(([key]) => key === SYNC_KEY).map(([, value]) => value)).toEqual([
            '["usr_first"]',
            '["usr_first","usr_second"]',
            '["usr_second"]'
        ]);
    });

    test('批量 watchlist 写失败会记录错误且不推进 sync 标记', async () => {
        watchedStore.setWatchedUser(watchedUser('usr_batch'));
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        configMock.setString.mockImplementation((key, value) => {
            if (key === WATCHLIST_KEY) {
                return Promise.reject(new Error('database busy'));
            }
            state.config.set(key, String(value));
            return Promise.resolve();
        });

        await reconcileWatchedSync();

        expect(configMock.setString.mock.calls.filter(([key]) => key === WATCHLIST_KEY)).toHaveLength(2);
        expect(configMock.setString.mock.calls.some(([key]) => key === SYNC_KEY)).toBe(false);
        expect(storedSyncedIds()).toEqual([]);
        expect(errorSpy).toHaveBeenCalledWith('[oversee] failed to persist watchlist:', expect.any(Error));
        errorSpy.mockRestore();
    });

    test('单条新增等待 watchlist 写入并在失败时回滚内存和标记', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        configMock.setString.mockImplementation((key, value) => {
            if (key === WATCHLIST_KEY) {
                return Promise.reject(new Error('database busy'));
            }
            state.config.set(key, String(value));
            return Promise.resolve();
        });

        await expect(syncWatchedAdd('usr_auto')).resolves.toBe(false);

        expect(overseeSettingsStore.watchlist).toEqual([]);
        expect(state.config.has(WATCHLIST_KEY)).toBe(false);
        expect(storedSyncedIds()).toEqual([]);
        expect(errorSpy).toHaveBeenCalledWith('[oversee] failed to persist watchlist:', expect.any(Error));
        errorSpy.mockRestore();
    });
});

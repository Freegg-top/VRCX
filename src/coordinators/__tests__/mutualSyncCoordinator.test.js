import { beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
    watch: { isLoggedIn: true, isFriendsLoaded: true },
    dbVars: { userId: 'usr_current', userPrefix: 'prefix' },
    database: {},
    friends: new Map(),
    friendLog: new Set(),
    fetchMutual: vi.fn(),
    chartsFetching: false,
    addEntry: vi.fn()
}));

vi.mock('../../services/database', () => ({
    get database() {
        return state.database;
    },
    dbVars: state.dbVars
}));
vi.mock('../../stores/friend', () => ({
    useFriendStore: () => ({
        get friends() {
            return state.friends;
        },
        friendLog: { has: (id) => state.friendLog.has(id) }
    })
}));
vi.mock('../../stores/charts', () => ({
    useChartsStore: () => ({
        mutualGraphStatus: {
            get isFetching() {
                return state.chartsFetching;
            }
        },
        fetchMutualFriendsForUser: state.fetchMutual
    })
}));
vi.mock('../../stores/sharedFeed', () => ({
    useSharedFeedStore: () => ({
        get addEntry() {
            return state.addEntry;
        }
    })
}));
vi.mock('../../stores/user', () => ({
    useUserStore: () => ({
        currentUser: { hasSharedConnectionsOptOut: false },
        cachedUsers: new Map()
    })
}));
vi.mock('../../services/watchState', () => ({
    watchState: state.watch
}));
vi.mock('../../services/config', () => ({
    default: { getInt: async () => 30 }
}));
vi.mock('../../shared/utils/throttle', () => ({
    createRateLimiter: () => ({ wait: async () => {} })
}));

import { runMutualSyncBatch } from '../mutualSyncCoordinator';

const OLD = '2026-11-17T00:00:00.000Z';

describe('runMutualSyncBatch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.watch.isLoggedIn = true;
        state.watch.isFriendsLoaded = true;
        state.dbVars.userId = 'usr_current';
        state.chartsFetching = false;
        state.friends = new Map([
            ['A1', { id: 'A1' }],
            ['A2', { id: 'A2' }]
        ]);
        state.friendLog = new Set(['B']);
        state.addEntry = vi.fn();
        state.database = {
            getMutualGraphMeta: vi.fn(async () => new Map()),
            getMutualsForFriend: vi.fn(async () => null),
            updateMutualsForFriend: vi.fn(),
            upsertMutualGraphMeta: vi.fn(),
            getRecentMutualEvents: vi.fn(async () => []),
            hasMutualEvent: vi.fn(async () => false),
            addMutualEvent: vi.fn(),
            deleteMutualEventsBefore: vi.fn()
        };
        state.fetchMutual.mockReset();
        state.fetchMutual.mockImplementation(async () => []);
    });

    test('首抓(无旧基线) -> 只建立基线, 不产生事件', async () => {
        state.fetchMutual.mockResolvedValue([{ id: 'B' }]);

        await runMutualSyncBatch();

        // B 是我的好友: 若基线 bug 存在会误产生 FriendshipStart
        expect(state.database.updateMutualsForFriend).toHaveBeenCalledWith('A1', ['B']);
        expect(state.database.upsertMutualGraphMeta).toHaveBeenCalledWith(
            'A1',
            expect.objectContaining({ optedOut: false })
        );
        expect(state.database.addMutualEvent).not.toHaveBeenCalled();
        expect(state.addEntry).not.toHaveBeenCalled();
    });

    test('403 -> 标记 opted-out, 不覆盖旧边, 记录 MutualOptOut 事件', async () => {
        state.fetchMutual.mockRejectedValue({ status: 403 });

        await runMutualSyncBatch();

        expect(state.database.updateMutualsForFriend).not.toHaveBeenCalled();
        expect(state.database.upsertMutualGraphMeta).toHaveBeenCalledWith(
            'A1',
            expect.objectContaining({ optedOut: true, optOutDetectedAt: expect.any(String) })
        );
        expect(state.database.addMutualEvent).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: 'MutualOptOut', friendIdA: 'A1', friendIdB: 'A1' })
        );
        expect(state.addEntry).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'MutualOptOut', friendIdB: 'A1' })
        );
    });

    test('抓取被取消(返回 null) -> 不落库不 diff', async () => {
        state.fetchMutual.mockResolvedValue(null);

        await runMutualSyncBatch();

        expect(state.database.updateMutualsForFriend).not.toHaveBeenCalled();
        expect(state.database.upsertMutualGraphMeta).not.toHaveBeenCalled();
        expect(state.database.addMutualEvent).not.toHaveBeenCalled();
    });

    test('批内登出 -> 中止后续好友', async () => {
        state.fetchMutual.mockImplementation(async () => {
            const result = state.fetchMutual.mock.calls.length === 1 ? [{ id: 'B' }] : null;
            if (state.fetchMutual.mock.calls.length >= 1) {
                state.watch.isLoggedIn = false;
            }
            return result;
        });

        await runMutualSyncBatch();

        // 首个好友取消导致 null 后即 break, 不再处理第二个
        expect(state.fetchMutual).toHaveBeenCalledTimes(1);
        expect(state.database.updateMutualsForFriend).not.toHaveBeenCalled();
    });

    test('批内切换用户(dbVars.userId 变化) -> 中止', async () => {
        state.friends = new Map([['A1', { id: 'A1' }]]);
        state.fetchMutual.mockImplementation(async () => {
            state.dbVars.userId = 'usr_other';
            return null;
        });

        await runMutualSyncBatch();

        expect(state.database.updateMutualsForFriend).not.toHaveBeenCalled();
        expect(state.database.upsertMutualGraphMeta).not.toHaveBeenCalled();
    });

    test('opted-out 好友超 24h -> 纳入重试, 恢复成功清空检测时间且不覆盖旧边', async () => {
        state.friends = new Map([['A1', { id: 'A1' }]]);
        state.database.getMutualGraphMeta = vi.fn(
            async () =>
                new Map([
                    ['A1', { lastFetchedAt: OLD, optedOut: true, optOutDetectedAt: OLD }]
                ])
        );
        // 旧边存在(空列表): 恢复场景应保留冻结期前数据
        state.database.getMutualsForFriend = vi.fn(async () => []);
        state.fetchMutual.mockResolvedValue([{ id: 'B' }]);

        await runMutualSyncBatch();

        expect(state.fetchMutual).toHaveBeenCalledWith('A1', expect.anything());
        expect(state.database.upsertMutualGraphMeta).toHaveBeenCalledWith(
            'A1',
            expect.objectContaining({
                optedOut: false,
                optOutDetectedAt: null,
                clearOptOutDetectedAt: true
            })
        );
        expect(state.database.updateMutualsForFriend).not.toHaveBeenCalled();
        expect(state.database.addMutualEvent).not.toHaveBeenCalled();
    });

    test('手动全图抓取进行中 -> 本周期跳过, 不发请求', async () => {
        state.chartsFetching = true;

        await runMutualSyncBatch();

        expect(state.fetchMutual).not.toHaveBeenCalled();
        expect(state.database.getMutualGraphMeta).not.toHaveBeenCalled();
    });
});

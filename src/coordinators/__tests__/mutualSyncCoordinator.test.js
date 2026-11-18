import { beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
    watch: { isLoggedIn: true, isFriendsLoaded: true },
    dbVars: { userId: 'usr_current', userPrefix: 'prefix' },
    database: {},
    friends: new Map(),
    friendLog: new Set(),
    fetchMutual: vi.fn(),
    chartsFetching: false,
    addEntry: vi.fn(),
    queueFriendLogNoty: vi.fn()
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
vi.mock('../../stores/notification', () => ({
    useNotificationStore: () => ({
        queueFriendLogNoty: state.queueFriendLogNoty || (() => {})
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

    test('首抓 403 (无旧基线) -> 只写 meta, 不发 MutualOptOut 事件, 不推进 last_fetched_at', async () => {
        state.friends = new Map([['A1', { id: 'A1' }]]);
        state.fetchMutual.mockRejectedValue({ status: 403 });

        await runMutualSyncBatch();

        expect(state.database.updateMutualsForFriend).not.toHaveBeenCalled();
        expect(state.database.upsertMutualGraphMeta).toHaveBeenCalledWith(
            'A1',
            expect.objectContaining({
                optedOut: true,
                optOutDetectedAt: expect.any(String),
                lastFetchedAt: null
            })
        );
        expect(state.database.addMutualEvent).not.toHaveBeenCalled();
        expect(state.addEntry).not.toHaveBeenCalled();
    });

    test('有旧基线 403 -> 发 MutualOptOut 事件, 不覆盖旧边, 不推进 last_fetched_at', async () => {
        state.friends = new Map([['A1', { id: 'A1' }]]);
        state.database.getMutualGraphMeta = vi.fn(
            async () => new Map([['A1', { lastFetchedAt: OLD, optedOut: false }]])
        );
        // friend 行存在(空边): 有基线
        state.database.getMutualsForFriend = vi.fn(async () => []);
        state.fetchMutual.mockRejectedValue({ status: 403 });

        await runMutualSyncBatch();

        expect(state.database.updateMutualsForFriend).not.toHaveBeenCalled();
        expect(state.database.upsertMutualGraphMeta).toHaveBeenCalledWith(
            'A1',
            expect.objectContaining({
                optedOut: true,
                optOutDetectedAt: expect.any(String),
                // 保留真实最后成功抓取时间, 快照日期才正确
                lastFetchedAt: OLD
            })
        );
        expect(state.database.addMutualEvent).toHaveBeenCalledWith(
            expect.objectContaining({ eventType: 'MutualOptOut', friendIdA: 'A1', friendIdB: 'A1' })
        );
        expect(state.addEntry).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'MutualOptOut', friendIdB: 'A1' })
        );
        // noty: 事件产生时桌面通知走 queueFriendLogNoty
        expect(state.queueFriendLogNoty).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'MutualOptOut', userId: 'A1' })
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

    test('opted-out 好友超 24h -> 纳入重试, 恢复时第三参数清检测时间且不推进 last_fetched_at', async () => {
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
        // clearOptOutDetectedAt 是第三参数 (options), 不是 meta 字段;
        // 边没更新, 不写 lastFetchedAt
        expect(state.database.upsertMutualGraphMeta).toHaveBeenCalledWith(
            'A1',
            { optedOut: false },
            { clearOptOutDetectedAt: true }
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

    test('批选中后好友被删除 -> 跳过该好友 (删除竞态)', async () => {
        state.friends = new Map([['A1', { id: 'A1' }]]);
        state.friendLog = new Set(['B']);
        // 模拟批次选中后、循环处理前用户删除了该好友
        state.database.getRecentMutualEvents = vi.fn(async () => {
            state.friends.delete('A1');
            return [];
        });
        state.database.getMutualsForFriend = vi.fn(async () => ['B']);
        state.fetchMutual.mockResolvedValue([]);

        await runMutualSyncBatch();

        expect(state.fetchMutual).not.toHaveBeenCalled();
        expect(state.database.updateMutualsForFriend).not.toHaveBeenCalled();
        expect(state.database.addMutualEvent).not.toHaveBeenCalled();
    });

    test('补抓 B 后对 B 自身 diff 产生 B 的事件 (B 作为 owner)', async () => {
        state.friends = new Map([
            ['A1', { id: 'A1' }],
            ['B', { id: 'B' }],
            ['C', { id: 'C' }]
        ]);
        state.friendLog = new Set(['B', 'C']);
        // B 的数据过旧 -> A1 的消失边把 B 排入补抓
        state.database.getMutualGraphMeta = vi.fn(
            async () =>
                new Map([
                    ['B', { lastFetchedAt: OLD, optedOut: false }],
                    ['C', { lastFetchedAt: OLD, optedOut: false }]
                ])
        );
        state.database.getMutualsForFriend = vi.fn(async (friendId) => {
            const links = { A1: ['B'], B: ['A1'], C: null };
            return links[friendId];
        });
        state.fetchMutual.mockImplementation(async (friendId) => {
            if (friendId === 'A1') {
                return []; // A1 与 B 的边消失 -> 触发补抓 B
            }
            if (friendId === 'B') {
                // B 重抓后与 C 成为好友: B 自身的 diff 应产生 FriendshipStart(B,C)
                return [{ id: 'A1' }, { id: 'C' }];
            }
            return [];
        });

        await runMutualSyncBatch();

        // B 补抓结果落库 (B 作为 owner 的新边基线)
        expect(state.database.updateMutualsForFriend).toHaveBeenCalledWith('B', ['A1', 'C']);
        // B 自身 diff 产生的事件 (字典序规范化: B < C)
        expect(state.database.addMutualEvent).toHaveBeenCalledTimes(1);
        expect(state.database.addMutualEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                eventType: 'FriendshipStart',
                friendIdA: 'B',
                friendIdB: 'C'
            })
        );
        expect(state.addEntry).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'MutualFriendshipStart', friendIdA: 'B', friendIdB: 'C' })
        );
    });
});

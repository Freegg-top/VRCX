import { describe, expect, test, vi } from 'vitest';

import { computeMutualEvents } from '../mutualEvents';

// 计算固定时间戳, 避免跨天导致当日去重判断抖动
const NOW = new Date('2026-11-18T12:00:00.000Z');
const FRESH = '2026-11-18T11:00:00.000Z'; // 恰好在 1h 新鲜窗口边界内
const STALE = '2026-11-17T00:00:00.000Z';

const OWNER = 'usr_owner';
const B1 = 'usr_b1';
const B2 = 'usr_b2';

function makeArgs(overrides = {}) {
    return {
        ownerId: OWNER,
        oldFriendIds: [],
        newFriendIds: [],
        isFriend: () => true,
        getMeta: () => undefined,
        getLinks: () => undefined,
        now: NOW,
        freshnessMs: 60 * 60 * 1000,
        ...overrides
    };
}

describe('computeMutualEvents', () => {
    test('双方确认解除 -> FriendshipEnd', () => {
        const result = computeMutualEvents(
            makeArgs({
                oldFriendIds: [B1],
                newFriendIds: [],
                getMeta: () => ({ optedOut: false, lastFetchedAt: FRESH }),
                getLinks: () => []
            })
        );
        expect(result.events).toEqual([
            {
                eventType: 'FriendshipEnd',
                friendIdA: OWNER,
                friendIdB: B1,
                createdAt: NOW.toISOString()
            }
        ]);
        expect(result.refetchIds).toEqual([]);
    });

    test('成为好友 -> FriendshipStart (oldFriendIds 明确为空数组 [])', () => {
        const result = computeMutualEvents(
            makeArgs({
                oldFriendIds: [],
                newFriendIds: [B1]
            })
        );
        expect(result.events).toEqual([
            {
                eventType: 'FriendshipStart',
                friendIdA: OWNER,
                friendIdB: B1,
                createdAt: NOW.toISOString()
            }
        ]);
    });

    test('oldFriendIds 为 null (首抓无基线) -> 不产生任何事件', () => {
        const result = computeMutualEvents(
            makeArgs({
                oldFriendIds: null,
                newFriendIds: [B1, B2]
            })
        );
        expect(result.events).toEqual([]);
        expect(result.refetchIds).toEqual([]);
    });

    test('B 不是我的好友 -> 忽略(消失边与新边都不发)', () => {
        const result = computeMutualEvents(
            makeArgs({
                oldFriendIds: [B1, B2],
                newFriendIds: [B2],
                isFriend: (id) => id === B2
            })
        );
        expect(result.events).toEqual([]);
        expect(result.refetchIds).toEqual([]);
    });

    test('B opted-out 数据冻结 -> 消失边忽略', () => {
        const result = computeMutualEvents(
            makeArgs({
                oldFriendIds: [B1],
                newFriendIds: [],
                getMeta: () => ({ optedOut: true, lastFetchedAt: FRESH }),
                getLinks: () => []
            })
        );
        expect(result.events).toEqual([]);
        expect(result.refetchIds).toEqual([]);
    });

    test('数据矛盾(B 数据新鲜且仍包含 A) -> 不发事件', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const result = computeMutualEvents(
            makeArgs({
                oldFriendIds: [B1],
                newFriendIds: [],
                getMeta: () => ({ optedOut: false, lastFetchedAt: FRESH }),
                getLinks: () => [OWNER]
            })
        );
        expect(result.events).toEqual([]);
        expect(result.refetchIds).toEqual([]);
        expect(logSpy).toHaveBeenCalled();
        logSpy.mockRestore();
    });

    test('B 数据过旧 -> 标记补抓且不发事件', () => {
        const result = computeMutualEvents(
            makeArgs({
                oldFriendIds: [B1],
                newFriendIds: [],
                getMeta: () => ({ optedOut: false, lastFetchedAt: STALE }),
                getLinks: () => []
            })
        );
        expect(result.events).toEqual([]);
        expect(result.refetchIds).toEqual([B1]);
    });

    test('B 无本地 links 数据 -> 标记补抓', () => {
        const result = computeMutualEvents(
            makeArgs({
                oldFriendIds: [B1],
                newFriendIds: [],
                getMeta: () => ({ optedOut: false, lastFetchedAt: FRESH }),
                getLinks: () => undefined
            })
        );
        expect(result.events).toEqual([]);
        expect(result.refetchIds).toEqual([B1]);
    });

    test('B 曾 opted-out 后恢复 -> 不发 FriendshipStart', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const result = computeMutualEvents(
            makeArgs({
                oldFriendIds: [],
                newFriendIds: [B1],
                getMeta: () => ({
                    optedOut: false,
                    lastFetchedAt: FRESH,
                    optOutDetectedAt: STALE
                })
            })
        );
        expect(result.events).toEqual([]);
        expect(logSpy).toHaveBeenCalled();
        logSpy.mockRestore();
    });

    test('当日同键事件去重', () => {
        const result = computeMutualEvents(
            makeArgs({
                oldFriendIds: [],
                newFriendIds: [B1],
                recentEvents: [
                    {
                        eventType: 'FriendshipStart',
                        friendIdA: OWNER,
                        friendIdB: B1,
                        createdAt: NOW.toISOString()
                    }
                ]
            })
        );
        expect(result.events).toEqual([]);
    });

    test('往日的同键事件不去重', () => {
        const result = computeMutualEvents(
            makeArgs({
                oldFriendIds: [],
                newFriendIds: [B1],
                recentEvents: [
                    {
                        eventType: 'FriendshipStart',
                        friendIdA: OWNER,
                        friendIdB: B1,
                        createdAt: '2026-11-01T00:00:00.000Z'
                    }
                ]
            })
        );
        expect(result.events).toHaveLength(1);
    });

    test('同批同时出现消失与新边时互不干扰', () => {
        const result = computeMutualEvents(
            makeArgs({
                oldFriendIds: [B1],
                newFriendIds: [B2],
                getMeta: () => ({ optedOut: false, lastFetchedAt: FRESH }),
                getLinks: () => []
            })
        );
        expect(result.events).toEqual([
            {
                eventType: 'FriendshipEnd',
                friendIdA: OWNER,
                friendIdB: B1,
                createdAt: NOW.toISOString()
            },
            {
                eventType: 'FriendshipStart',
                friendIdA: OWNER,
                friendIdB: B2,
                createdAt: NOW.toISOString()
            }
        ]);
    });

    test('ownerId 自身出现在边中时忽略', () => {
        const result = computeMutualEvents(
            makeArgs({
                oldFriendIds: [OWNER],
                newFriendIds: [OWNER]
            })
        );
        expect(result.events).toEqual([]);
    });
});

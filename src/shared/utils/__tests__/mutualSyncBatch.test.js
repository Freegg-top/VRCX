import { describe, expect, test } from 'vitest';

import { selectMutualSyncBatch, compareByLastFetched } from '../mutualSyncBatch';

const NOW = Date.parse('2026-11-18T12:00:00.000Z');
const OLD = '2026-11-17T00:00:00.000Z';
const RECENT = '2026-11-18T11:00:00.000Z';

function makeMetaMap(entries = {}) {
    return new Map(Object.entries(entries));
}

describe('compareByLastFetched', () => {
    test('同一对象返回 0', () => {
        const a = { friendId: 'a', lastFetchedAt: null };
        expect(compareByLastFetched(a, a)).toBe(0);
    });

    test('两者都无 lastFetchedAt 返回 0', () => {
        expect(
            compareByLastFetched({ friendId: 'a', lastFetchedAt: null }, { friendId: 'b', lastFetchedAt: null })
        ).toBe(0);
    });

    test('无 lastFetchedAt (从未抓取) 排最前', () => {
        expect(
            compareByLastFetched({ friendId: 'a', lastFetchedAt: null }, { friendId: 'b', lastFetchedAt: OLD })
        ).toBe(-1);
        expect(
            compareByLastFetched({ friendId: 'a', lastFetchedAt: OLD }, { friendId: 'b', lastFetchedAt: null })
        ).toBe(1);
    });
});

describe('selectMutualSyncBatch', () => {
    test('常规候选按 lastFetchedAt 最旧优先, 批大小截断', () => {
        const metaMap = makeMetaMap({
            a: { lastFetchedAt: RECENT, optedOut: false },
            b: { lastFetchedAt: OLD, optedOut: false },
            c: { lastFetchedAt: null, optedOut: false }
        });
        const batch = selectMutualSyncBatch({
            friendIds: ['a', 'b', 'c'],
            metaMap,
            now: NOW,
            batchSize: 2
        });
        expect(batch.map((x) => x.friendId)).toEqual(['c', 'b']);
    });

    test('opted-out 未超重试窗口 -> 不入选', () => {
        const metaMap = makeMetaMap({
            a: { lastFetchedAt: OLD, optedOut: true, optOutDetectedAt: RECENT }
        });
        const batch = selectMutualSyncBatch({ friendIds: ['a'], metaMap, now: NOW });
        expect(batch).toEqual([]);
    });

    test('opted-out 超过 24h -> 纳入重试且标记 isOptOutRetry, 每批最多 1 个', () => {
        const metaMap = makeMetaMap({
            a: { lastFetchedAt: OLD, optedOut: true, optOutDetectedAt: OLD },
            b: { lastFetchedAt: OLD, optedOut: true, optOutDetectedAt: OLD },
            c: { lastFetchedAt: RECENT, optedOut: false }
        });
        const batch = selectMutualSyncBatch({
            friendIds: ['a', 'b', 'c'],
            metaMap,
            now: NOW,
            batchSize: 8
        });
        // 常规候选在前, 附带 1 个 opted-out 重试
        expect(batch[0].friendId).toBe('c');
        expect(batch[0].isOptOutRetry).toBeUndefined();
        expect(batch).toHaveLength(2);
        const retryCount = batch.filter((x) => x.isOptOutRetry).length;
        expect(retryCount).toBe(1);

        // 无常规候选时: 只取 1 个 opted-out 重试
        const retryBatch = selectMutualSyncBatch({
            friendIds: ['a', 'b'],
            metaMap,
            now: NOW,
            batchSize: 8
        });
        expect(retryBatch).toHaveLength(1);
        expect(retryBatch[0].isOptOutRetry).toBe(true);
    });

    test('正常候选 ≥ batchSize 时重试仍占预留槽位 (不饿死)', () => {
        const metaMap = makeMetaMap({
            a: { lastFetchedAt: OLD, optedOut: false },
            b: { lastFetchedAt: OLD, optedOut: false },
            c: { lastFetchedAt: OLD, optedOut: true, optOutDetectedAt: OLD }
        });
        const batch = selectMutualSyncBatch({
            friendIds: ['a', 'b', 'c'],
            metaMap,
            now: NOW,
            batchSize: 2
        });
        // 正常候选满批时 opt-out 重试仍进批, 否则对方重新开放展示后永远无法恢复
        expect(batch).toHaveLength(2);
        const retryItems = batch.filter((x) => x.isOptOutRetry);
        expect(retryItems).toHaveLength(1);
        expect(retryItems[0].friendId).toBe('c');
        expect(batch[0].friendId).toBe('a');
    });

    test('opted-out 检测时间缺失 -> 视为可重试', () => {
        const metaMap = makeMetaMap({
            a: { lastFetchedAt: null, optedOut: true, optOutDetectedAt: null }
        });
        const batch = selectMutualSyncBatch({ friendIds: ['a'], metaMap, now: NOW, batchSize: 8 });
        expect(batch[0].friendId).toBe('a');
        expect(batch[0].isOptOutRetry).toBe(true);
    });

    test('无候选时返回空数组', () => {
        expect(selectMutualSyncBatch({ friendIds: [], metaMap: makeMetaMap(), now: NOW })).toEqual([]);
    });
});

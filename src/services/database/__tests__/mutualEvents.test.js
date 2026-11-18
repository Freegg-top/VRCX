import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    executeNonQuery: vi.fn()
}));

vi.mock('../../sqlite.js', () => ({
    default: {
        execute: mocks.execute,
        executeNonQuery: mocks.executeNonQuery
    }
}));
vi.mock('../index.js', () => ({
    dbVars: {
        userPrefix: 'prefix'
    }
}));

import { mutualEvents } from '../mutualEvents.js';

describe('mutualEvents.getMutualEvents', () => {
    beforeEach(() => {
        mocks.execute.mockReset();
        mocks.execute.mockResolvedValue(undefined);
    });

    test('limit 负数/NaN -> 夹到 0', async () => {
        await mutualEvents.getMutualEvents({ limit: -5 });
        expect(mocks.execute.mock.calls[0][1]).toContain('LIMIT 0');

        await mutualEvents.getMutualEvents({ limit: 'abc' });
        expect(mocks.execute.mock.calls[1][1]).toContain('LIMIT 0');
    });

    test('limit Infinity/超大 -> 夹到上限 10000', async () => {
        await mutualEvents.getMutualEvents({ limit: Infinity });
        expect(mocks.execute.mock.calls[0][1]).toContain('LIMIT 10000');

        await mutualEvents.getMutualEvents({ limit: 99999999 });
        expect(mocks.execute.mock.calls[1][1]).toContain('LIMIT 10000');
    });

    test('offset 负数 -> 夹到 0', async () => {
        await mutualEvents.getMutualEvents({ offset: -3 });
        expect(mocks.execute.mock.calls[0][1]).toContain('OFFSET 0');
    });
});

describe('mutualEvents.hasMutualEvent', () => {
    beforeEach(() => {
        mocks.execute.mockReset();
        mocks.execute.mockResolvedValue(undefined);
    });

    test('去重键按双方任一顺序匹配 (规范化对键)', async () => {
        mocks.execute.mockImplementation(async (callback) => {
            callback([1]);
            return undefined;
        });

        const found = await mutualEvents.hasMutualEvent({
            eventType: 'FriendshipStart',
            friendIdA: 'usr_a',
            friendIdB: 'usr_b',
            sinceDate: '2026-11-18T00:00:00.000Z'
        });

        expect(found).toBe(true);
        const [, sql, params] = mocks.execute.mock.calls[0];
        // 历史行可能未规范化 ((B,A) 顺序), 查询需覆盖两种顺序
        expect(sql).toContain('(friend_id_a = @friend_id_a AND friend_id_b = @friend_id_b)');
        expect(sql).toContain('(friend_id_a = @friend_id_b AND friend_id_b = @friend_id_a)');
        expect(params).toMatchObject({
            '@friend_id_a': 'usr_a',
            '@friend_id_b': 'usr_b',
            '@since': '2026-11-18T00:00:00.000Z'
        });
    });

    test('无匹配 -> false', async () => {
        mocks.execute.mockImplementation(async (callback) => {
            callback([0]);
            return undefined;
        });

        const found = await mutualEvents.hasMutualEvent({
            eventType: 'FriendshipStart',
            friendIdA: 'usr_a',
            friendIdB: 'usr_b'
        });

        expect(found).toBe(false);
    });
});

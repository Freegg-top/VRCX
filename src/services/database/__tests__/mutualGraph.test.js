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

import { mutualGraph } from '../mutualGraph.js';

function nonQuerySqls() {
    return mocks.executeNonQuery.mock.calls.map((call) => call[0]);
}

describe('mutualGraph', () => {
    beforeEach(() => {
        mocks.execute.mockReset();
        mocks.executeNonQuery.mockReset();
        mocks.executeNonQuery.mockResolvedValue(undefined);
    });

    test('deleteMutualsForFriend -> 事务内删 friend+links+meta (重加好友首抓保护)', async () => {
        await mutualGraph.deleteMutualsForFriend('usr_f1');

        const sqls = nonQuerySqls();
        // friend 行必须一并删除, 否则重加好友后 getMutualsForFriend
        // 返回 [] 被误当旧基线, 批量假 FriendshipStart
        expect(sqls).toEqual([
            'BEGIN',
            expect.stringContaining('DELETE FROM prefix_mutual_graph_links'),
            expect.stringContaining('DELETE FROM prefix_mutual_graph_friends'),
            expect.stringContaining('DELETE FROM prefix_mutual_graph_meta'),
            'COMMIT'
        ]);
        expect(sqls[1]).toContain("friend_id='usr_f1'");
    });

    test('deleteMutualsForFriend 失败 -> ROLLBACK 并抛出', async () => {
        mocks.executeNonQuery.mockImplementation(async (sql) => {
            if (sql === 'DELETE FROM prefix_mutual_graph_friends WHERE friend_id=\'usr_f1\'') {
                throw new Error('boom');
            }
            return undefined;
        });

        await expect(mutualGraph.deleteMutualsForFriend('usr_f1')).rejects.toThrow('boom');

        const sqls = nonQuerySqls();
        expect(sqls[sqls.length - 1]).toBe('ROLLBACK');
        expect(sqls).not.toContain('COMMIT');
    });

    test('updateMutualsForFriend -> 事务内 DELETE+INSERT, 崩溃不留空基线', async () => {
        await mutualGraph.updateMutualsForFriend('usr_f1', ['usr_a', 'usr_b']);

        const sqls = nonQuerySqls();
        expect(sqls[0]).toBe('BEGIN');
        expect(sqls.at(-1)).toBe('COMMIT');
        const joined = sqls.join('\n');
        expect(joined).toContain('INSERT OR REPLACE INTO prefix_mutual_graph_friends');
        expect(joined).toContain("DELETE FROM prefix_mutual_graph_links WHERE friend_id='usr_f1'");
        expect(joined).toContain("VALUES ('usr_f1', 'usr_a'),('usr_f1', 'usr_b')");
    });

    test('updateMutualsForFriend 失败 -> ROLLBACK 并抛出', async () => {
        mocks.executeNonQuery.mockImplementation(async (sql) => {
            if (sql.includes('DELETE FROM prefix_mutual_graph_links')) {
                throw new Error('boom');
            }
            return undefined;
        });

        await expect(mutualGraph.updateMutualsForFriend('usr_f1', [])).rejects.toThrow('boom');

        const sqls = nonQuerySqls();
        expect(sqls.at(-1)).toBe('ROLLBACK');
        expect(sqls).not.toContain('COMMIT');
    });

    test('upsertMutualGraphMeta 不传 lastFetchedAt -> 新行 NULL/冲突保留旧值', async () => {
        await mutualGraph.upsertMutualGraphMeta('usr_f1', { optedOut: true });

        const sql = mocks.executeNonQuery.mock.calls[0][0];
        expect(sql).toContain("VALUES ('usr_f1', NULL, 1,");
        expect(sql).toContain('last_fetched_at = COALESCE(excluded.last_fetched_at, prefix_mutual_graph_meta.last_fetched_at)');
    });

    test('upsertMutualGraphMeta 显式 lastFetchedAt -> 按传值写入', async () => {
        await mutualGraph.upsertMutualGraphMeta('usr_f1', {
            lastFetchedAt: '2026-11-18T00:00:00.000Z',
            optedOut: false
        });

        const sql = mocks.executeNonQuery.mock.calls[0][0];
        expect(sql).toContain("VALUES ('usr_f1', '2026-11-18T00:00:00.000Z', 0,");
    });

    test('upsertMutualGraphMeta 第三参数 clearOptOutDetectedAt -> 置 NULL', async () => {
        await mutualGraph.upsertMutualGraphMeta(
            'usr_f1',
            { optedOut: false },
            { clearOptOutDetectedAt: true }
        );

        const sql = mocks.executeNonQuery.mock.calls[0][0];
        expect(sql).toContain('opt_out_detected_at = NULL');
    });

    test('bulkUpsertMutualGraphMeta 恢复(optedOut 1->0)时清 opt_out_detected_at', async () => {
        const entries = new Map([
            ['usr_f1', { optedOut: false }],
            ['usr_f2', { optedOut: true }]
        ]);
        await mutualGraph.bulkUpsertMutualGraphMeta(entries);

        const sql = mocks.executeNonQuery.mock.calls[0][0];
        expect(sql).toContain(
            'opt_out_detected_at = CASE WHEN excluded.opted_out = 0 THEN NULL ELSE prefix_mutual_graph_meta.opt_out_detected_at END'
        );
    });

    test('getMutualsForFriend: friend 行存在 -> 边列表; 行不存在 -> null', async () => {
        // 场景 1: friend 行存在有边
        mocks.execute.mockImplementationOnce(async (callback) => {
            callback(['usr_f1', 'usr_a']);
            callback(['usr_f1', 'usr_b']);
            return undefined;
        });
        expect(await mutualGraph.getMutualsForFriend('usr_f1')).toEqual(['usr_a', 'usr_b']);

        // 场景 2: friend 行不存在 -> null (首抓保护依赖该语义)
        mocks.execute.mockImplementationOnce(async () => undefined);
        expect(await mutualGraph.getMutualsForFriend('usr_missing')).toBe(null);
    });
});

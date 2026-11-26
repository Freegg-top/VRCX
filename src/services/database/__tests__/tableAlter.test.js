import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

// tableAlter 依赖的 dbVars 用可变的普通对象模拟, 测试里直接改 userId
vi.mock('../index.js', () => ({
    dbVars: { userId: '', userPrefix: '' }
}));

// 内存 SQLite 模拟迁移序列: node:sqlite 的 DatabaseSync 与 VRCX 实际使用的
// System.Data.SQLite 是同一 SQL 方言, 足以覆盖迁移/回填顺序问题
vi.mock('../../sqlite.js', () => {
    const db = new DatabaseSync(':memory:');
    const run = (sql, args) => db.prepare(sql).run(args ?? {});
    return {
        default: {
            execute: async (callback, sql, args) => {
                const stmt = db.prepare(sql);
                if (/^\s*(select|pragma)\b/i.test(sql)) {
                    const rows = stmt.all(args ?? {});
                    rows.forEach((row) => callback(Object.values(row)));
                    return;
                }
                stmt.run(args ?? {});
            },
            executeNonQuery: async (sql, args) => run(sql, args),
            __db: db
        }
    };
});

import sqliteService from '../../sqlite.js';
import { tableAlter } from '../tableAlter.js';
import { dbVars } from '../index.js';

const db = sqliteService.__db;

/**
 * 造一个「版本 17 之前」的老库: favorite 表没有 owner 列, watched_user 是旧主键
 */
function createLegacySchema() {
    db.exec(`CREATE TABLE favorite_world (id INTEGER PRIMARY KEY, created_at TEXT, world_id TEXT, group_name TEXT)`);
    db.exec(`CREATE TABLE favorite_avatar (id INTEGER PRIMARY KEY, created_at TEXT, avatar_id TEXT, group_name TEXT)`);
    db.exec(`CREATE TABLE favorite_friend (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, group_name TEXT)`);
    db.exec(`CREATE TABLE watched_user (user_id TEXT NOT NULL PRIMARY KEY, display_name TEXT, created_at TEXT)`);
    db.exec(`INSERT INTO favorite_world (created_at, world_id) VALUES ('2026-01-01', 'wrld_legacy')`);
    db.exec(
        `INSERT INTO watched_user (user_id, display_name, created_at) VALUES ('usr_watched', 'Watched', '2026-01-01')`
    );
}

function columnNames(table) {
    return db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name);
}

function oneRow(sql) {
    return db.prepare(sql).get();
}

beforeEach(() => {
    const rows = db.prepare(`SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'`).all();
    rows.forEach(({ name, type }) => {
        db.exec(`DROP ${type === 'view' ? 'VIEW' : 'TABLE'} IF EXISTS ${name}`);
    });
    createLegacySchema();
    dbVars.userId = '';
});

describe('P0-2: 版本 19 迁移在登录前执行不得写空 owner', () => {
    test('空 userId 下 addFavoriteOwnerColumn 只加列不回填, 不产生空 owner 行', async () => {
        await tableAlter.addFavoriteOwnerColumn();
        expect(columnNames('favorite_world')).toContain('owner_user_id');
        expect(oneRow(`SELECT owner_user_id FROM favorite_world WHERE world_id = 'wrld_legacy'`).owner_user_id).toBe(
            null
        );
    });

    test('空 userId 下 migrateWatchedUserOwner 跳过迁移, 旧表结构原样保留', async () => {
        await tableAlter.migrateWatchedUserOwner();
        expect(columnNames('watched_user')).not.toContain('owner_user_id');
        expect(oneRow(`SELECT user_id FROM watched_user`).user_id).toBe('usr_watched');
    });
});

describe('P0-2: 登录后的回填序列(initUserTables 等价调用)能救回历史空 owner 行', () => {
    test('backfillWatchedUserOwner 把历史 "" 行修回当前用户, 已有归属不动', async () => {
        dbVars.userId = 'usr_me';
        // 模拟历史 bug 场景: 迁移已在未登录时跑过, owner 写成了 ''
        db.exec(`DROP TABLE watched_user`);
        db.exec(
            `CREATE TABLE watched_user (user_id TEXT NOT NULL, display_name TEXT, created_at TEXT, owner_user_id TEXT NOT NULL DEFAULT '', PRIMARY KEY (user_id, owner_user_id))`
        );
        db.exec(
            `INSERT INTO watched_user (user_id, display_name, created_at, owner_user_id) VALUES ('usr_a', 'A', '2026-01-01', '')`
        );
        db.exec(
            `INSERT INTO watched_user (user_id, display_name, created_at, owner_user_id) VALUES ('usr_b', 'B', '2026-01-02', 'usr_other')`
        );

        await tableAlter.migrateWatchedUserOwner();
        await tableAlter.backfillWatchedUserOwner();

        expect(oneRow(`SELECT owner_user_id FROM watched_user WHERE user_id = 'usr_a'`).owner_user_id).toBe('usr_me');
        expect(oneRow(`SELECT owner_user_id FROM watched_user WHERE user_id = 'usr_b'`).owner_user_id).toBe(
            'usr_other'
        );
    });

    test('backfillWatchedUserOwner 遇到同名已归属行时清除无主副本且不报主键冲突', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        dbVars.userId = 'usr_me';
        db.exec(`DROP TABLE watched_user`);
        db.exec(
            `CREATE TABLE watched_user (user_id TEXT NOT NULL, display_name TEXT, created_at TEXT, owner_user_id TEXT NOT NULL DEFAULT '', PRIMARY KEY (user_id, owner_user_id))`
        );
        // 历史无主行 + 用户重新添加后产生的已归属行, 同一 user_id 两行
        db.exec(
            `INSERT INTO watched_user (user_id, display_name, created_at, owner_user_id) VALUES ('usr_a', 'A', '2026-01-01', '')`
        );
        db.exec(
            `INSERT INTO watched_user (user_id, display_name, created_at, owner_user_id) VALUES ('usr_a', 'A', '2026-01-02', 'usr_me')`
        );

        await tableAlter.backfillWatchedUserOwner();

        expect(db.prepare(`SELECT user_id, owner_user_id FROM watched_user`).all()).toEqual([
            { user_id: 'usr_a', owner_user_id: 'usr_me' }
        ]);
        expect(errorSpy).not.toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    test('migrateWatchedUserOwner 对老结构按当前账号重建表并迁移数据', async () => {
        dbVars.userId = 'usr_me';
        await tableAlter.migrateWatchedUserOwner();
        expect(columnNames('watched_user')).toContain('owner_user_id');
        expect(oneRow(`SELECT owner_user_id FROM watched_user WHERE user_id = 'usr_watched'`).owner_user_id).toBe(
            'usr_me'
        );
    });

    test('backfillFavoriteOwner 同时修回 IS NULL 与 "" 的行', async () => {
        dbVars.userId = 'usr_me';
        await tableAlter.addFavoriteOwnerColumn();
        db.exec(`UPDATE favorite_world SET owner_user_id = '' WHERE world_id = 'wrld_legacy'`);
        db.exec(
            `INSERT INTO favorite_world (created_at, world_id, owner_user_id) VALUES ('2026-02-01', 'wrld_null', NULL)`
        );

        await tableAlter.backfillFavoriteOwner();

        const rows = db.prepare(`SELECT world_id, owner_user_id FROM favorite_world`).all();
        expect(rows).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ world_id: 'wrld_legacy', owner_user_id: 'usr_me' }),
                expect.objectContaining({ world_id: 'wrld_null', owner_user_id: 'usr_me' })
            ])
        );
    });
});

describe('P2-1: watched_user 迁移事务化, 中途失败回滚且不卡死', () => {
    test('残留的 watched_user_new 被清掉, 迁移可重跑成功', async () => {
        dbVars.userId = 'usr_me';
        db.exec(`CREATE TABLE watched_user_new (user_id TEXT)`); // 上次失败的残留
        await tableAlter.migrateWatchedUserOwner();
        expect(columnNames('watched_user')).toContain('owner_user_id');
        expect(oneRow(`SELECT owner_user_id FROM watched_user WHERE user_id = 'usr_watched'`).owner_user_id).toBe(
            'usr_me'
        );
    });

    test('迁移失败时回滚, 旧表数据完好', async () => {
        dbVars.userId = 'usr_me';
        // 残留成 view 时 DROP TABLE 报错, 使事务中途失败 -> 走 ROLLBACK 分支
        db.exec(`CREATE VIEW watched_user_new AS SELECT user_id FROM watched_user`);
        await tableAlter.migrateWatchedUserOwner();
        expect(columnNames('watched_user')).not.toContain('owner_user_id');
        expect(oneRow(`SELECT user_id FROM watched_user`).user_id).toBe('usr_watched');
    });
});

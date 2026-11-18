import { dbVars } from '../database';

import sqliteService from '../sqlite.js';

// P0-2: owner 归属回填不再放全局迁移里做 —— upgradeDatabaseVersion 在 store 初始化
// (登录前) 执行, 当时 dbVars.userId 为空, 回填会把收藏/关注写成无主行且永不自愈。
// 加列/重建表留在迁移里; 数据回填由 initUserTables 登录后调 backfillFavoriteOwner /
// backfillWatchedUserOwner / migrateWatchedUserOwner 完成。
const FAVORITE_TABLES = ['favorite_world', 'favorite_avatar', 'favorite_friend'];

const tableAlter = {
    async upgradeDatabaseVersion() {
        await this.initTables();
        await this.cleanLegendFromFriendLog(); // fix friendLog spammed with crap
        await this.fixGameLogTraveling(); // fix bug with gameLog location being set as traveling
        await this.fixNegativeGPS(); // fix GPS being a negative value due to VRCX bug with traveling
        await this.fixBrokenLeaveEntries(); // fix user instance timer being higher than current user location timer
        await this.fixBrokenGroupInvites(); // fix notification v2 in wrong table
        await this.fixBrokenNotifications(); // fix notifications being null
        await this.fixBrokenGroupChange(); // fix spam group left & name change
        await this.fixCancelFriendRequestTypo(); // fix CancelFriendRequst typo
        await this.fixBrokenGameLogDisplayNames(); // fix gameLog display names "DisplayName (userId)"
        await this.updateTableForGroupNames();
        await this.addFriendLogFriendNumber();
        await this.updateTableForAvatarHistory();
        await this.addPerformanceIndexes(); // 16
        await this.addGameLogAccountColumn(); // 17
        await this.addFavoriteOwnerColumn(); // 17 (只加列, 回填见 backfillFavoriteOwner)
        await this.migrateWatchedUserOwner(); // 17 (userId 为空时自身跳过, initUserTables 重跑)
        await this.addFeedBioLinks(); // 18
    },

    async addGameLogAccountColumn() {
        var tables = [];
        await sqliteService.execute((dbRow) => {
            tables.push(dbRow[0]);
        }, `SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'gamelog_%'`);
        // P2-6: ALTER 批量包进事务, 中途失败不留下半迁移状态
        await sqliteService.executeNonQuery('BEGIN');
        try {
            for (var tableName of tables) {
                try {
                    await sqliteService.executeNonQuery(`ALTER TABLE ${tableName} ADD account_user_id TEXT`);
                } catch (e) {
                    const msg = e.toString();
                    if (msg.indexOf('duplicate column name') === -1) {
                        console.error(msg);
                    }
                }
            }
        } finally {
            await sqliteService.executeNonQuery('COMMIT');
        }
    },

    async addFavoriteOwnerColumn() {
        // P0-2: 只负责加列, 不在这里回填 owner —— 历史收藏归属哪个账号要等登录后
        // 由 initUserTables -> backfillFavoriteOwner 决定, 登录前回填必然写空
        await sqliteService.executeNonQuery('BEGIN');
        try {
            for (var tableName of FAVORITE_TABLES) {
                try {
                    await sqliteService.executeNonQuery(`ALTER TABLE ${tableName} ADD owner_user_id TEXT`);
                } catch (e) {
                    const msg = e.toString();
                    if (msg.indexOf('duplicate column name') === -1) {
                        console.error(msg);
                    }
                }
            }
        } finally {
            await sqliteService.executeNonQuery('COMMIT');
        }
    },

    /**
     * P0-2: 把无主收藏行(IS NULL 或历史迁移写成的 '')归属给当前登录用户。
     * 只在登录后由 initUserTables 调用; 历史数据本身无法区分归属,
     * 归给当前登录用户 —— 单账号用户占绝大多数, 这是正确取舍;
     * 多账号场景下升级后第一个登录的账号吸收全部无主行。
     */
    async backfillFavoriteOwner() {
        if (!dbVars.userId) {
            return;
        }
        for (var tableName of FAVORITE_TABLES) {
            try {
                await sqliteService.executeNonQuery(
                    `UPDATE ${tableName} SET owner_user_id = @owner WHERE owner_user_id IS NULL OR owner_user_id = ''`,
                    { '@owner': dbVars.userId }
                );
            } catch (e) {
                console.error(`[tableAlter] favorite owner backfill failed (${tableName}):`, e);
            }
        }
    },

    async migrateWatchedUserOwner() {
        // P0-2: 登录前 dbVars.userId 为空时跳过, 否则全部行会写成无主;
        // initUserTables 登录后会重跑本迁移, 版本门槛一次性跳过也不会卡住
        if (!dbVars.userId) {
            return;
        }
        var schema = '';
        await sqliteService.execute((dbRow) => {
            schema = String(dbRow[0] || '');
        }, `SELECT sql FROM sqlite_schema WHERE type='table' AND name = 'watched_user'`);
        if (!schema || schema.includes('owner_user_id')) {
            return;
        }
        // 主键从 user_id 变成 (user_id, owner_user_id) 只能重建表, ALTER 改不了主键
        try {
            // P2-1: 整体包事务, 开头清掉上次失败残留的 watched_user_new,
            // 防止中途失败永久卡死在半迁移状态
            await sqliteService.executeNonQuery('BEGIN');
            await sqliteService.executeNonQuery('DROP TABLE IF EXISTS watched_user_new');
            await sqliteService.executeNonQuery(
                `CREATE TABLE watched_user_new (user_id TEXT NOT NULL, display_name TEXT, created_at TEXT, owner_user_id TEXT NOT NULL DEFAULT '', PRIMARY KEY (user_id, owner_user_id))`
            );
            await sqliteService.executeNonQuery(
                `INSERT OR IGNORE INTO watched_user_new (user_id, display_name, created_at, owner_user_id)
                 SELECT user_id, display_name, created_at, @owner FROM watched_user`,
                { '@owner': dbVars.userId }
            );
            await sqliteService.executeNonQuery('DROP TABLE watched_user');
            await sqliteService.executeNonQuery('ALTER TABLE watched_user_new RENAME TO watched_user');
            await sqliteService.executeNonQuery('COMMIT');
        } catch (e) {
            try {
                await sqliteService.executeNonQuery('ROLLBACK');
            } catch (rollbackErr) {
                console.error('[tableAlter] watched_user migration rollback failed:', rollbackErr);
            }
            console.error('[tableAlter] watched_user migration failed:', e);
        }
    },

    /**
     * P0-2: 把无主关注行(历史迁移写成的 '')修回当前登录用户。
     * 只在登录后由 initUserTables 调用。
     */
    async backfillWatchedUserOwner() {
        if (!dbVars.userId) {
            return;
        }
        try {
            await sqliteService.executeNonQuery(
                `UPDATE watched_user SET owner_user_id = @owner WHERE owner_user_id IS NULL OR owner_user_id = ''`,
                { '@owner': dbVars.userId }
            );
        } catch (e) {
            console.error('[tableAlter] watched_user owner backfill failed:', e);
        }
    },

    async updateTableForGroupNames() {
        var tables = [];
        await sqliteService.execute((dbRow) => {
            tables.push(dbRow[0]);
        }, `SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE '%_feed_gps' OR name LIKE '%_feed_online_offline' OR name = 'gamelog_location'`);
        for (var tableName of tables) {
            try {
                await sqliteService.executeNonQuery(`ALTER TABLE ${tableName} ADD group_name TEXT DEFAULT ''`);
            } catch (e) {
                const msg = e.toString();
                if (msg.indexOf('duplicate column name') === -1) {
                    console.error(msg);
                }
            }
        }
        // Fix gamelog_location column typo
        try {
            await sqliteService.executeNonQuery(`ALTER TABLE gamelog_location DROP COLUMN groupName`);
        } catch (e) {
            const msg = e.toString();
            if (msg.indexOf('no such column') === -1) {
                console.error(msg);
            }
        }
    },

    async addFriendLogFriendNumber() {
        var tables = [];
        await sqliteService.execute((dbRow) => {
            tables.push(dbRow[0]);
        }, `SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE '%_friend_log_current' OR name LIKE '%_friend_log_history'`);
        for (var tableName of tables) {
            try {
                await sqliteService.executeNonQuery(`ALTER TABLE ${tableName} ADD friend_number INTEGER DEFAULT 0`);
            } catch (e) {
                const msg = e.toString();
                if (msg.indexOf('duplicate column name') === -1) {
                    console.error(msg);
                }
            }
        }
    },

    async updateTableForAvatarHistory() {
        var tables = [];
        await sqliteService.execute((dbRow) => {
            tables.push(dbRow[0]);
        }, `SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE '%_avatar_history'`);
        for (var tableName of tables) {
            try {
                await sqliteService.executeNonQuery(`ALTER TABLE ${tableName} ADD time INTEGER DEFAULT 0`);
            } catch (e) {
                const msg = e.toString();
                if (msg.indexOf('duplicate column name') === -1) {
                    console.error(msg);
                }
            }
        }
    },

    async addPerformanceIndexes() {
        // per-user friend_log_history: covers getFriendLogHistoryForUserId
        var tables = [];
        await sqliteService.execute((dbRow) => {
            tables.push(dbRow[0]);
        }, `SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE '%_friend_log_history'`);
        for (var tableName of tables) {
            try {
                await sqliteService.executeNonQuery(
                    `CREATE INDEX IF NOT EXISTS ${tableName}_user_id_idx ON ${tableName} (user_id)`
                );
            } catch (e) {
                console.error(e);
            }
        }
    },

    async addFeedBioLinks() {
        var tables = [];
        await sqliteService.execute((dbRow) => {
            tables.push(dbRow[0]);
        }, `SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE '%_feed_bio'`);
        for (var tableName of tables) {
            for (var column of ['bio_links', 'previous_bio_links']) {
                try {
                    await sqliteService.executeNonQuery(`ALTER TABLE ${tableName} ADD ${column} TEXT DEFAULT '[]'`);
                } catch (e) {
                    const msg = e.toString();
                    if (msg.indexOf('duplicate column name') === -1) {
                        console.error(msg);
                    }
                }
            }
        }
    }
};

export { tableAlter };

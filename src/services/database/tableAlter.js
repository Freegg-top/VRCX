import { dbVars } from '../database';

import sqliteService from '../sqlite.js';

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
        await this.addFavoriteOwnerColumn(); // 17
        await this.migrateWatchedUserOwner(); // 17
        await this.addFeedBioLinks(); // 18
    },

    async addGameLogAccountColumn() {
        var tables = [];
        await sqliteService.execute((dbRow) => {
            tables.push(dbRow[0]);
        }, `SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'gamelog_%'`);
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
    },

    async addFavoriteOwnerColumn() {
        var tables = ['favorite_world', 'favorite_avatar', 'favorite_friend'];
        for (var tableName of tables) {
            try {
                await sqliteService.executeNonQuery(`ALTER TABLE ${tableName} ADD owner_user_id TEXT`);
            } catch (e) {
                const msg = e.toString();
                if (msg.indexOf('duplicate column name') === -1) {
                    console.error(msg);
                    continue;
                }
            }
            // 历史收藏无法判断当初属于哪个账号, 归给执行本次升级的账号
            await sqliteService.executeNonQuery(
                `UPDATE ${tableName} SET owner_user_id = @owner WHERE owner_user_id IS NULL`,
                { '@owner': dbVars.userId }
            );
        }
    },

    async migrateWatchedUserOwner() {
        var schema = '';
        await sqliteService.execute((dbRow) => {
            schema = String(dbRow[0] || '');
        }, `SELECT sql FROM sqlite_schema WHERE type='table' AND name = 'watched_user'`);
        if (!schema || schema.includes('owner_user_id')) {
            return;
        }
        // 主键从 user_id 变成 (user_id, owner_user_id) 只能重建表, ALTER 改不了主键
        try {
            await sqliteService.executeNonQuery(
                `CREATE TABLE watched_user_new (user_id TEXT NOT NULL, display_name TEXT, created_at TEXT, owner_user_id TEXT NOT NULL DEFAULT '', PRIMARY KEY (user_id, owner_user_id))`
            );
            await sqliteService.executeNonQuery(
                `INSERT OR IGNORE INTO watched_user_new (user_id, display_name, created_at, owner_user_id)
                 SELECT user_id, display_name, created_at, @owner FROM watched_user`,
                { '@owner': dbVars.userId }
            );
            await sqliteService.executeNonQuery(`DROP TABLE watched_user`);
            await sqliteService.executeNonQuery(`ALTER TABLE watched_user_new RENAME TO watched_user`);
        } catch (e) {
            console.error('[tableAlter] watched_user migration failed:', e);
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

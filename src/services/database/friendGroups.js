import { dbVars } from '../database';

import sqliteService from '../sqlite.js';

const friendGroups = {
    async getFriendGroupSnapshots() {
        const map = new Map();
        if (!dbVars.userPrefix) {
            return map;
        }
        await sqliteService.execute((dbRow) => {
            const userId = dbRow[0];
            if (!userId) {
                return;
            }
            let groups = [];
            try {
                groups = JSON.parse(dbRow[1]) || [];
            } catch {
                groups = [];
            }
            map.set(userId, {
                groups: Array.isArray(groups) ? groups.filter((g) => g?.id) : [],
                updatedAt: dbRow[2]
            });
        }, `SELECT user_id, group_ids, updated_at FROM ${dbVars.userPrefix}_friend_group_snapshot`);
        return map;
    },

    async saveFriendGroupSnapshot(userId, groups) {
        if (!dbVars.userPrefix || !userId) {
            return;
        }
        await sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${dbVars.userPrefix}_friend_group_snapshot (user_id, group_ids, updated_at) VALUES (@user_id, @group_ids, @updated_at)`,
            {
                '@user_id': userId,
                '@group_ids': JSON.stringify(groups || []),
                '@updated_at': new Date().toJSON()
            }
        );
    },

    /**
     * 好友的好友的群组快照 (好友的模型页同理: 跨应用重启持久化, 避免重取)。
     * @returns {Promise<Map<string, {displayName: string, groups: Array<{id: string, name: string}>}>>}
     */
    async getFofGroupSnapshots() {
        const map = new Map();
        if (!dbVars.userPrefix) {
            return map;
        }
        await sqliteService.execute((dbRow) => {
            const userId = dbRow[0];
            if (!userId) {
                return;
            }
            let groups = [];
            try {
                groups = JSON.parse(dbRow[2]) || [];
            } catch {
                groups = [];
            }
            map.set(userId, {
                displayName: dbRow[1] || userId,
                groups: Array.isArray(groups) ? groups.filter((g) => g?.id) : []
            });
        }, `SELECT user_id, display_name, group_ids FROM ${dbVars.userPrefix}_friend_fof_snapshot`);
        return map;
    },

    /**
     * @param {string} userId
     * @param {string} displayName
     * @param {Array<{id: string, name: string}>} groups
     */
    async saveFofGroupSnapshot(userId, displayName, groups) {
        if (!dbVars.userPrefix || !userId) {
            return;
        }
        await sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${dbVars.userPrefix}_friend_fof_snapshot (user_id, display_name, group_ids, updated_at) VALUES (@user_id, @display_name, @group_ids, @updated_at)`,
            {
                '@user_id': userId,
                '@display_name': displayName,
                '@group_ids': JSON.stringify(groups || []),
                '@updated_at': new Date().toJSON()
            }
        );
    }
};

export { friendGroups };

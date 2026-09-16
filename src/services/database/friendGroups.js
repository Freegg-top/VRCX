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
    }
};

export { friendGroups };

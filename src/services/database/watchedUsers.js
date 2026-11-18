import { dbVars } from '../database';

import sqliteService from '../sqlite.js';

const watchedUsers = {
    // P2-2: 改 async —— 调用方(coordinator)现在能 await 并真正捕获失败;
    // 未登录(dbVars.userId 为空)时直接不写库, 防止产生无主行
    async addWatchedUser(userId, displayName) {
        if (!dbVars.userId) {
            return;
        }
        await sqliteService.executeNonQuery(
            'INSERT OR REPLACE INTO watched_user (user_id, display_name, created_at, owner_user_id) VALUES (@user_id, @display_name, @created_at, @owner_user_id)',
            {
                '@user_id': userId,
                '@display_name': displayName,
                '@created_at': new Date().toJSON(),
                '@owner_user_id': dbVars.userId
            }
        );
    },

    async removeWatchedUser(userId) {
        if (!dbVars.userId) {
            return;
        }
        await sqliteService.executeNonQuery(
            'DELETE FROM watched_user WHERE user_id = @user_id AND owner_user_id = @owner_user_id',
            {
                '@user_id': userId,
                '@owner_user_id': dbVars.userId
            }
        );
    },

    async getWatchedUsers() {
        const data = [];
        await sqliteService.execute(
            (dbRow) => {
                const row = {
                    userId: dbRow[0],
                    displayName: dbRow[1],
                    created_at: dbRow[2]
                };
                data.push(row);
            },
            `SELECT user_id, display_name, created_at FROM watched_user WHERE owner_user_id = @owner_user_id ORDER BY created_at DESC`,
            { '@owner_user_id': dbVars.userId }
        );
        return data;
    }
};

export { watchedUsers };

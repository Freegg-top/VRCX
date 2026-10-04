import { dbVars } from '../database';

import sqliteService from '../sqlite.js';

const watchedUsers = {
    addWatchedUser(userId, displayName) {
        sqliteService.executeNonQuery(
            'INSERT OR REPLACE INTO watched_user (user_id, display_name, created_at, owner_user_id) VALUES (@user_id, @display_name, @created_at, @owner_user_id)',
            {
                '@user_id': userId,
                '@display_name': displayName,
                '@created_at': new Date().toJSON(),
                '@owner_user_id': dbVars.userId
            }
        );
    },

    removeWatchedUser(userId) {
        sqliteService.executeNonQuery(
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

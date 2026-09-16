import sqliteService from '../sqlite.js';

const watchedUsers = {
    addWatchedUser(userId, displayName) {
        sqliteService.executeNonQuery(
            'INSERT OR REPLACE INTO watched_user (user_id, display_name, created_at) VALUES (@user_id, @display_name, @created_at)',
            {
                '@user_id': userId,
                '@display_name': displayName,
                '@created_at': new Date().toJSON()
            }
        );
    },

    removeWatchedUser(userId) {
        sqliteService.executeNonQuery(
            'DELETE FROM watched_user WHERE user_id = @user_id',
            {
                '@user_id': userId
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
            'SELECT user_id, display_name, created_at FROM watched_user ORDER BY created_at DESC'
        );
        return data;
    }
};

export { watchedUsers };

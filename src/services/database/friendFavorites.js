import { dbVars } from '../database';

import sqliteService from '../sqlite.js';

const friendFavorites = {
    addFriendToLocalFavorites(userId, groupName) {
        sqliteService.executeNonQuery(
            'INSERT OR REPLACE INTO favorite_friend (user_id, group_name, created_at, owner_user_id) VALUES (@user_id, @group_name, @created_at, @owner_user_id)',
            {
                '@user_id': userId,
                '@group_name': groupName,
                '@created_at': new Date().toJSON(),
                '@owner_user_id': dbVars.userId
            }
        );
    },

    removeFriendFromLocalFavorites(userId, groupName) {
        sqliteService.executeNonQuery(
            `DELETE FROM favorite_friend WHERE user_id = @user_id AND group_name = @group_name AND owner_user_id = @owner_user_id`,
            {
                '@user_id': userId,
                '@group_name': groupName,
                '@owner_user_id': dbVars.userId
            }
        );
    },

    renameFriendFavoriteGroup(newGroupName, groupName) {
        sqliteService.executeNonQuery(
            `UPDATE favorite_friend SET group_name = @new_group_name WHERE group_name = @group_name AND owner_user_id = @owner_user_id`,
            {
                '@new_group_name': newGroupName,
                '@group_name': groupName,
                '@owner_user_id': dbVars.userId
            }
        );
    },

    deleteFriendFavoriteGroup(groupName) {
        sqliteService.executeNonQuery(
            `DELETE FROM favorite_friend WHERE group_name = @group_name AND owner_user_id = @owner_user_id`,
            {
                '@group_name': groupName,
                '@owner_user_id': dbVars.userId
            }
        );
    },

    async getFriendFavorites() {
        const data = [];
        await sqliteService.execute(
            (dbRow) => {
                const row = {
                    created_at: dbRow[1],
                    userId: dbRow[2],
                    groupName: dbRow[3]
                };
                data.push(row);
            },
            `SELECT * FROM favorite_friend WHERE owner_user_id = @owner_user_id`,
            { '@owner_user_id': dbVars.userId }
        );
        return data;
    }
};

export { friendFavorites };

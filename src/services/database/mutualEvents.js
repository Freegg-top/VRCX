import { dbVars } from '../database';

import sqliteService from '../sqlite.js';

// 共同好友变化事件表 (FriendshipEnd / FriendshipStart / MutualOptOut)
// 表名含用户前缀只能拼接; 值一律走 @param 绑定 (见 feed.js 现有用法)
const mutualEvents = {
    /**
     * @param {object} args
     * @param {string} args.eventType 'FriendshipEnd' | 'FriendshipStart' | 'MutualOptOut'
     * @param {string} args.friendIdA 列表所有者(被检测方)
     * @param {string} args.friendIdB 变化的对象
     * @param {string} [args.createdAt] ISO 时间, 默认当前
     */
    async addMutualEvent({ eventType, friendIdA, friendIdB, createdAt }) {
        if (!dbVars.userPrefix || !eventType || !friendIdA || !friendIdB) {
            return;
        }
        const table = `${dbVars.userPrefix}_mutual_event_history`;
        await sqliteService.executeNonQuery(
            `INSERT INTO ${table} (created_at, event_type, friend_id_a, friend_id_b)
             VALUES (@created_at, @event_type, @friend_id_a, @friend_id_b)`,
            {
                '@created_at': createdAt || new Date().toISOString(),
                '@event_type': eventType,
                '@friend_id_a': friendIdA,
                '@friend_id_b': friendIdB
            }
        );
    },

    /**
     * 动态流拉取, 按时间倒序分页
     * @param {object} [args]
     * @param {number} [args.limit]
     * @param {number} [args.offset]
     * @returns {Promise<Array<{id: number, createdAt: string, eventType: string, friendIdA: string, friendIdB: string}>>}
     */
    async getMutualEvents({ limit = 100, offset = 0 } = {}) {
        const events = [];
        if (!dbVars.userPrefix) {
            return events;
        }
        const table = `${dbVars.userPrefix}_mutual_event_history`;
        // LIMIT/OFFSET 仅数字, Number() 强转防注入
        await sqliteService.execute((dbRow) => {
            events.push({
                id: dbRow[0],
                createdAt: dbRow[1],
                eventType: dbRow[2],
                friendIdA: dbRow[3],
                friendIdB: dbRow[4]
            });
        }, `SELECT id, created_at, event_type, friend_id_a, friend_id_b FROM ${table} ORDER BY created_at DESC LIMIT ${Number(limit) || 100} OFFSET ${Number(offset) || 0}`);
        return events;
    },

    /**
     * 启动时补查, 供去重用
     * @param {object} args
     * @param {string} args.sinceDate ISO 时间下限
     * @returns {Promise<Array<{eventType: string, friendIdA: string, friendIdB: string, createdAt: string}>>}
     */
    async getRecentMutualEvents({ sinceDate }) {
        const events = [];
        if (!dbVars.userPrefix || !sinceDate) {
            return events;
        }
        const table = `${dbVars.userPrefix}_mutual_event_history`;
        await sqliteService.execute((dbRow) => {
            events.push({
                eventType: dbRow[0],
                friendIdA: dbRow[1],
                friendIdB: dbRow[2],
                createdAt: dbRow[3]
            });
        }, `SELECT event_type, friend_id_a, friend_id_b, created_at FROM ${table} WHERE created_at >= @since`, {
            '@since': sinceDate
        });
        return events;
    },

    /**
     * 同 (eventType, friendIdA, friendIdB) 在 sinceDate 之后是否已有事件
     * @param {object} args
     * @param {string} args.eventType
     * @param {string} args.friendIdA
     * @param {string} args.friendIdB
     * @param {string} [args.sinceDate] ISO 时间下限, 默认当日零点
     * @returns {Promise<boolean>}
     */
    async hasMutualEvent({ eventType, friendIdA, friendIdB, sinceDate }) {
        if (!dbVars.userPrefix || !eventType || !friendIdA || !friendIdB) {
            return false;
        }
        const table = `${dbVars.userPrefix}_mutual_event_history`;
        let found = false;
        await sqliteService.execute((dbRow) => {
            if (dbRow[0] > 0) {
                found = true;
            }
        }, `SELECT COUNT(*) FROM ${table} WHERE event_type = @event_type AND friend_id_a = @friend_id_a AND friend_id_b = @friend_id_b AND created_at >= @since`, {
            '@event_type': eventType,
            '@friend_id_a': friendIdA,
            '@friend_id_b': friendIdB,
            '@since': sinceDate || new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
        });
        return found;
    },

    /**
     * 删除指定时间之前的事件 (保留策略清理, 协调器每天调一次, 默认留 180 天)
     * @param {string} cutoffDate ISO 时间, 早于此的事件被删除
     */
    async deleteMutualEventsBefore(cutoffDate) {
        if (!dbVars.userPrefix || !cutoffDate) {
            return;
        }
        const table = `${dbVars.userPrefix}_mutual_event_history`;
        await sqliteService.executeNonQuery(`DELETE FROM ${table} WHERE created_at < @cutoff`, {
            '@cutoff': cutoffDate
        });
    }
};

export { mutualEvents };

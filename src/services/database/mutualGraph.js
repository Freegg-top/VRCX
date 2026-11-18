import { dbVars } from '../database';

import sqliteService from '../sqlite.js';

const mutualGraph = {
    async getMutualGraphSnapshot() {
        const snapshot = new Map();
        if (!dbVars.userPrefix) {
            return snapshot;
        }
        const friendTable = `${dbVars.userPrefix}_mutual_graph_friends`;
        const linkTable = `${dbVars.userPrefix}_mutual_graph_links`;
        await sqliteService.execute((dbRow) => {
            const friendId = dbRow[0];
            if (friendId && !snapshot.has(friendId)) {
                snapshot.set(friendId, []);
            }
        }, `SELECT friend_id FROM ${friendTable}`);
        await sqliteService.execute((dbRow) => {
            const friendId = dbRow[0];
            const mutualId = dbRow[1];
            if (!friendId || !mutualId) {
                return;
            }
            let list = snapshot.get(friendId);
            if (!list) {
                list = [];
                snapshot.set(friendId, list);
            }
            list.push(mutualId);
        }, `SELECT friend_id, mutual_id FROM ${linkTable}`);
        return snapshot;
    },

    async saveMutualGraphSnapshot(entries) {
        if (!dbVars.userPrefix) {
            return;
        }
        const friendTable = `${dbVars.userPrefix}_mutual_graph_friends`;
        const linkTable = `${dbVars.userPrefix}_mutual_graph_links`;
        const metaTable = `${dbVars.userPrefix}_mutual_graph_meta`;
        const pairs = entries instanceof Map ? entries : new Map();
        await sqliteService.executeNonQuery('BEGIN');
        try {
            // 只清理本次 entries 涉及的 friend_id (且保留其中 opted-out
            // 好友的旧边), 不再全局删除 —— 后台同步批次刚写入的其他好友
            // 数据不受影响, 也不会出现「meta 说刚抓过、边表为空」的状态。
            if (pairs.size > 0) {
                const friendIds = [];
                pairs.forEach((_, friendId) => {
                    if (friendId) friendIds.push(friendId);
                });
                if (friendIds.length > 0) {
                    const idsSql = friendIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
                    const frozenIds = new Set();
                    await sqliteService.execute((dbRow) => {
                        if (dbRow[0]) frozenIds.add(dbRow[0]);
                    }, `SELECT friend_id FROM ${metaTable} WHERE opted_out = 1 AND friend_id IN (${idsSql})`);
                    const cleanableIds = friendIds.filter((id) => !frozenIds.has(id));
                    if (cleanableIds.length > 0) {
                        const cleanSql = cleanableIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',');
                        await sqliteService.executeNonQuery(
                            `DELETE FROM ${linkTable} WHERE friend_id IN (${cleanSql})`
                        );
                        await sqliteService.executeNonQuery(
                            `DELETE FROM ${friendTable} WHERE friend_id IN (${cleanSql})`
                        );
                    }
                    // opted-out 好友的边保持冻结: 跳过其边与 friend 行写入
                    pairs.forEach((mutualIds, rawFriendId) => {
                        if (rawFriendId && frozenIds.has(rawFriendId)) {
                            pairs.delete(rawFriendId);
                        }
                    });
                }
            }
            let friendValues = '';
            let edgeValues = '';
            pairs.forEach((mutualIds, friendId) => {
                if (!friendId) {
                    return;
                }
                const safeFriendId = friendId.replace(/'/g, "''");
                friendValues += `('${safeFriendId}'),`;
                let collection = [];
                if (Array.isArray(mutualIds)) {
                    collection = mutualIds;
                } else if (mutualIds instanceof Set) {
                    collection = Array.from(mutualIds);
                }
                for (const mutual of collection) {
                    if (!mutual) {
                        continue;
                    }
                    const safeMutualId = String(mutual).replace(/'/g, "''");
                    edgeValues += `('${safeFriendId}', '${safeMutualId}'),`;
                }
            });
            if (friendValues) {
                friendValues = friendValues.slice(0, -1);
                await sqliteService.executeNonQuery(
                    `INSERT OR REPLACE INTO ${friendTable} (friend_id) VALUES ${friendValues}`
                );
            }
            if (edgeValues) {
                edgeValues = edgeValues.slice(0, -1);
                await sqliteService.executeNonQuery(
                    `INSERT OR REPLACE INTO ${linkTable} (friend_id, mutual_id) VALUES ${edgeValues}`
                );
            }
            await sqliteService.executeNonQuery('COMMIT');
        } catch (err) {
            await sqliteService.executeNonQuery('ROLLBACK');
            throw err;
        }
    },

    async updateMutualsForFriend(friendId, mutualIds) {
        if (!dbVars.userPrefix || !friendId) {
            return;
        }
        const friendTable = `${dbVars.userPrefix}_mutual_graph_friends`;
        const linkTable = `${dbVars.userPrefix}_mutual_graph_links`;
        const safeFriendId = friendId.replace(/'/g, "''");
        await sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${friendTable} (friend_id) VALUES ('${safeFriendId}')`
        );
        await sqliteService.executeNonQuery(`DELETE FROM ${linkTable} WHERE friend_id='${safeFriendId}'`);
        let edgeValues = '';
        for (const mutual of mutualIds) {
            if (!mutual) {
                continue;
            }
            const safeMutualId = String(mutual).replace(/'/g, "''");
            edgeValues += `('${safeFriendId}', '${safeMutualId}'),`;
        }
        if (edgeValues) {
            edgeValues = edgeValues.slice(0, -1);
            await sqliteService.executeNonQuery(
                `INSERT OR REPLACE INTO ${linkTable} (friend_id, mutual_id) VALUES ${edgeValues}`
            );
        }
    },

    /**
     * 单个好友的 mutual 边列表(避免整表快照载入), 单次查询: friend 行存在
     * 但无边时返回 [], friend 行不存在时返回 null
     * @param {string} friendId
     * @returns {Promise<string[]|null>}
     */
    async getMutualsForFriend(friendId) {
        if (!dbVars.userPrefix || !friendId) {
            return null;
        }
        const friendTable = `${dbVars.userPrefix}_mutual_graph_friends`;
        const linkTable = `${dbVars.userPrefix}_mutual_graph_links`;
        const mutualIds = [];
        let exists = false;
        await sqliteService.execute((dbRow) => {
            exists = true;
            if (dbRow[1]) {
                mutualIds.push(dbRow[1]);
            }
        }, `SELECT f.friend_id, l.mutual_id FROM ${friendTable} f LEFT JOIN ${linkTable} l ON l.friend_id = f.friend_id WHERE f.friend_id = @friendId`, {
            '@friendId': friendId
        });
        return exists ? mutualIds : null;
    },

    async deleteMutualsForFriend(friendId) {
        if (!dbVars.userPrefix || !friendId) {
            return;
        }
        const linkTable = `${dbVars.userPrefix}_mutual_graph_links`;
        const metaTable = `${dbVars.userPrefix}_mutual_graph_meta`;
        const safeFriendId = friendId.replace(/'/g, "''");
        await sqliteService.executeNonQuery(`DELETE FROM ${linkTable} WHERE friend_id='${safeFriendId}'`);
        await sqliteService.executeNonQuery(`DELETE FROM ${metaTable} WHERE friend_id='${safeFriendId}'`);
    },

    async getMutualCountForAllUsers() {
        const mutualCountMap = new Map();
        if (!dbVars.userPrefix) {
            return mutualCountMap;
        }
        const linkTable = `${dbVars.userPrefix}_mutual_graph_links`;
        await sqliteService.execute((dbRow) => {
            const mutualId = dbRow[0];
            const count = dbRow[1];
            if (mutualId) {
                mutualCountMap.set(mutualId, count);
            }
        }, `SELECT mutual_id, COUNT(*) FROM ${linkTable} GROUP BY mutual_id`);
        return mutualCountMap;
    },

    /**
     * @param {string} friendId
     * @param {{ lastFetchedAt?: string; optedOut: boolean; optOutDetectedAt?: string|null }} meta
     * @param {object} [options]
     * @param {boolean} [options.clearOptOutDetectedAt] 为 true 时把 opt_out_detected_at 置 NULL
     *   (恢复场景显式清空); 默认不传 optOutDetectedAt 时保留旧值 (COALESCE)
     */
    async upsertMutualGraphMeta(friendId, { lastFetchedAt, optedOut, optOutDetectedAt }, { clearOptOutDetectedAt = false } = {}) {
        if (!dbVars.userPrefix || !friendId) {
            return;
        }
        const metaTable = `${dbVars.userPrefix}_mutual_graph_meta`;
        const escapedId = friendId.replace(/'/g, "''");
        const time = (lastFetchedAt || new Date().toISOString()).replace(/'/g, "''");
        const optedOutInt = optedOut ? 1 : 0;
        // opt_out_detected_at 不传时保留旧值 (恢复/常规刷新不抹掉首次检测时间);
        // clearOptOutDetectedAt 时显式置 NULL
        const detectedAt = clearOptOutDetectedAt || !optOutDetectedAt
            ? 'NULL'
            : `'${optOutDetectedAt.replace(/'/g, "''")}'`;
        const detectedUpdate = clearOptOutDetectedAt
            ? 'NULL'
            : `COALESCE(excluded.opt_out_detected_at, ${metaTable}.opt_out_detected_at)`;
        await sqliteService.executeNonQuery(
            `INSERT INTO ${metaTable} (friend_id, last_fetched_at, opted_out, opt_out_detected_at) VALUES ('${escapedId}', '${time}', ${optedOutInt}, ${detectedAt})
             ON CONFLICT(friend_id) DO UPDATE SET last_fetched_at = excluded.last_fetched_at, opted_out = excluded.opted_out, opt_out_detected_at = ${detectedUpdate}`
        );
    },

    /**
     * 批量写 meta。entries 可带 per-friend lastFetchedAt (真实抓取时刻),
     * 未带时使用当前时间 (向后兼容)
     * @param {Map<string, { optedOut: boolean, lastFetchedAt?: string }>} entries
     */
    async bulkUpsertMutualGraphMeta(entries) {
        if (!dbVars.userPrefix || !entries || entries.size === 0) {
            return;
        }
        const metaTable = `${dbVars.userPrefix}_mutual_graph_meta`;
        let values = '';
        const now = new Date().toISOString();
        entries.forEach(({ optedOut, lastFetchedAt }, friendId) => {
            if (!friendId) return;
            const escapedId = friendId.replace(/'/g, "''");
            const optedOutInt = optedOut ? 1 : 0;
            const time = (lastFetchedAt || now).replace(/'/g, "''");
            values += `('${escapedId}', '${time}', ${optedOutInt}),`;
        });
        if (values) {
            values = values.slice(0, -1);
            await sqliteService.executeNonQuery(
                `INSERT INTO ${metaTable} (friend_id, last_fetched_at, opted_out) VALUES ${values}
                 ON CONFLICT(friend_id) DO UPDATE SET last_fetched_at = excluded.last_fetched_at, opted_out = excluded.opted_out`
            );
        }
    },

    async getMutualGraphMeta() {
        const metaMap = new Map();
        if (!dbVars.userPrefix) {
            return metaMap;
        }
        const metaTable = `${dbVars.userPrefix}_mutual_graph_meta`;
        await sqliteService.execute((dbRow) => {
            const friendId = dbRow[0];
            if (friendId) {
                metaMap.set(friendId, {
                    lastFetchedAt: dbRow[1] || null,
                    optedOut: dbRow[2] === 1,
                    optOutDetectedAt: dbRow[3] || null
                });
            }
        }, `SELECT friend_id, last_fetched_at, opted_out, opt_out_detected_at FROM ${metaTable}`);
        return metaMap;
    }
};

export { mutualGraph };

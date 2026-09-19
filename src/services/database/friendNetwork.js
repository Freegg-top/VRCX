import { dbVars } from '../database';

import sqliteService from '../sqlite.js';

const friendNetwork = {
    async getAnalyzedUsers() {
        const map = new Map();
        if (!dbVars.userPrefix) {
            return map;
        }
        await sqliteService.execute((dbRow) => {
            const userId = dbRow[0];
            if (!userId) {
                return;
            }
            let ids = [];
            try {
                const parsed = JSON.parse(dbRow[1]);
                if (Array.isArray(parsed)) {
                    ids = parsed.filter(Boolean);
                }
            } catch {
                // keep the empty list on malformed rows
            }
            map.set(userId, {
                friendIds: Array.isArray(ids) ? ids.filter(Boolean) : [],
                lastFetchedAt: dbRow[2],
                optedOut: !!dbRow[3]
            });
        }, `SELECT user_id, mutual_ids, last_fetched_at, opted_out FROM ${dbVars.userPrefix}_friend_network_user`);
        return map;
    },

    async getOwnerCandidates() {
        const rows = [];
        if (!dbVars.userPrefix) {
            return rows;
        }
        await sqliteService.execute((dbRow) => {
            if (dbRow[0]) {
                rows.push({
                    userId: dbRow[0],
                    displayName: dbRow[1] || '',
                    lastSeen: dbRow[2] || ''
                });
            }
        }, `SELECT owner_id, display_name, last_seen FROM ${dbVars.userPrefix}_friend_network_owner ORDER BY last_seen DESC`);
        return rows;
    },

    async saveOwnerCandidate(ownerId, displayName) {
        if (!dbVars.userPrefix || !ownerId) {
            return;
        }
        await sqliteService.executeNonQuery(
            `INSERT INTO ${dbVars.userPrefix}_friend_network_owner (owner_id, display_name, last_seen) VALUES (@owner_id, @display_name, @last_seen) ON CONFLICT(owner_id) DO UPDATE SET last_seen = @last_seen, display_name = CASE WHEN @display_name != '' THEN @display_name ELSE display_name END`,
            {
                '@owner_id': ownerId,
                '@display_name': displayName || '',
                '@last_seen': new Date().toJSON()
            }
        );
    },

    async saveAnalyzedUser(userId, friendIds, optedOut = false) {
        if (!dbVars.userPrefix || !userId) {
            return;
        }
        await sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${dbVars.userPrefix}_friend_network_user (user_id, mutual_ids, last_fetched_at, opted_out) VALUES (@user_id, @mutual_ids, @last_fetched_at, @opted_out)`,
            {
                '@user_id': userId,
                '@mutual_ids': JSON.stringify(friendIds || []),
                '@last_fetched_at': new Date().toJSON(),
                '@opted_out': optedOut ? 1 : 0
            }
        );
    }
};

export { friendNetwork };

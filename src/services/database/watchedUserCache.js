import { dbVars } from '../database';

import sqliteService from '../sqlite.js';

function parseLanguageTags(value) {
    try {
        const languages = JSON.parse(value || '[]');
        return Array.isArray(languages) ? languages : [];
    } catch {
        return [];
    }
}

function parseRow(dbRow) {
    return {
        userId: dbRow[0],
        displayName: dbRow[1] || '',
        avatarUrl: dbRow[2] || '',
        languageTags: parseLanguageTags(dbRow[3]),
        trust: dbRow[4] || '',
        updatedAt: dbRow[5] || ''
    };
}

const watchedUserCache = {
    async getWatchedUserCache() {
        if (!dbVars.userPrefix) {
            return [];
        }
        const data = [];
        await sqliteService.execute((dbRow) => {
            data.push(parseRow(dbRow));
        }, `SELECT user_id, display_name, avatar_url, language_tags, trust, updated_at FROM ${dbVars.userPrefix}_watched_user_cache`);
        return data;
    },

    async setWatchedUserCache(profile) {
        if (!dbVars.userPrefix || !profile?.id) {
            return '';
        }
        const updatedAt = profile.updatedAt || new Date().toJSON();
        await sqliteService.executeNonQuery(
            `INSERT OR REPLACE INTO ${dbVars.userPrefix}_watched_user_cache (user_id, display_name, avatar_url, language_tags, trust, updated_at) VALUES (@user_id, @display_name, @avatar_url, @language_tags, @trust, @updated_at)`,
            {
                '@user_id': profile.id,
                '@display_name': profile.displayName || '',
                '@avatar_url': profile.avatarUrl || '',
                '@language_tags': JSON.stringify(profile.languageTags || []),
                '@trust': profile.trust || '',
                '@updated_at': updatedAt
            }
        );
        return updatedAt;
    }
};

export { watchedUserCache, parseLanguageTags };

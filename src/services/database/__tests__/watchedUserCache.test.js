import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    executeNonQuery: vi.fn()
}));

vi.mock('../../sqlite.js', () => ({
    default: { execute: mocks.execute, executeNonQuery: mocks.executeNonQuery }
}));

vi.mock('../index.js', () => ({
    dbVars: { userPrefix: '' }
}));

import { watchedUserCache, parseLanguageTags } from '../watchedUserCache.js';
import { dbVars } from '../index.js';

describe('watchedUserCache', () => {
    beforeEach(() => {
        mocks.execute.mockReset();
        mocks.executeNonQuery.mockReset().mockResolvedValue(1);
        dbVars.userPrefix = 'usrme';
    });

    test('reads and parses cached profile rows from the account-scoped table', async () => {
        mocks.execute.mockImplementation((callback) => {
            callback([
                'usr_a',
                'Cached Name',
                'https://example.com/avatar.png',
                '[{"key":"eng","value":"English"}]',
                'system_trust_trusted',
                '2026-11-20T00:00:00.000Z'
            ]);
            callback(['usr_b', null, null, '{invalid', null, null]);
        });

        const rows = await watchedUserCache.getWatchedUserCache();

        expect(mocks.execute.mock.calls[0][1]).toContain('usrme_watched_user_cache');
        expect(rows).toEqual([
            {
                userId: 'usr_a',
                displayName: 'Cached Name',
                avatarUrl: 'https://example.com/avatar.png',
                languageTags: [{ key: 'eng', value: 'English' }],
                trust: 'system_trust_trusted',
                updatedAt: '2026-11-20T00:00:00.000Z'
            },
            {
                userId: 'usr_b',
                displayName: '',
                avatarUrl: '',
                languageTags: [],
                trust: '',
                updatedAt: ''
            }
        ]);
    });

    test('upserts display fields, language JSON, trust and refresh timestamp', async () => {
        const profile = {
            id: 'usr_a',
            displayName: 'Fresh Name',
            avatarUrl: 'https://example.com/fresh.png',
            languageTags: [{ key: 'jpn', value: 'Japanese' }],
            trust: 'system_trust_veteran',
            updatedAt: '2026-11-26T00:00:00.000Z'
        };

        await expect(watchedUserCache.setWatchedUserCache(profile)).resolves.toBe(profile.updatedAt);

        expect(mocks.executeNonQuery).toHaveBeenCalledTimes(1);
        expect(mocks.executeNonQuery.mock.calls[0][0]).toContain('INSERT OR REPLACE INTO usrme_watched_user_cache');
        expect(mocks.executeNonQuery.mock.calls[0][1]).toEqual({
            '@user_id': 'usr_a',
            '@display_name': 'Fresh Name',
            '@avatar_url': 'https://example.com/fresh.png',
            '@language_tags': '[{"key":"jpn","value":"Japanese"}]',
            '@trust': 'system_trust_veteran',
            '@updated_at': profile.updatedAt
        });
    });

    test('skips database access before the account prefix is initialized', async () => {
        dbVars.userPrefix = '';

        await expect(watchedUserCache.getWatchedUserCache()).resolves.toEqual([]);
        await expect(watchedUserCache.setWatchedUserCache({ id: 'usr_a' })).resolves.toBe('');
        expect(mocks.execute).not.toHaveBeenCalled();
        expect(mocks.executeNonQuery).not.toHaveBeenCalled();
    });

    test('returns an empty language list for invalid persisted JSON', () => {
        expect(parseLanguageTags('not-json')).toEqual([]);
        expect(parseLanguageTags('{}')).toEqual([]);
    });
});

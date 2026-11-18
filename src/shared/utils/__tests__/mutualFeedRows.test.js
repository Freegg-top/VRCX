import { describe, expect, test } from 'vitest';

import { mutualEventToFeedRow } from '../mutualFeedRows';

describe('mutualEventToFeedRow', () => {
    test('resolves both display names and preserves user ids as fallbacks', () => {
        const names = new Map([
            ['usr_a', 'Alice'],
            ['usr_b', 'Bob']
        ]);
        const resolveDisplayName = (userId) => names.get(userId) || userId;

        expect(
            mutualEventToFeedRow(
                {
                    id: 7,
                    createdAt: '2026-11-18T00:00:00.000Z',
                    eventType: 'FriendshipStart',
                    friendIdA: 'usr_a',
                    friendIdB: 'usr_b'
                },
                resolveDisplayName
            )
        ).toEqual({
            rowId: 7,
            created_at: '2026-11-18T00:00:00.000Z',
            type: 'MutualFriendshipStart',
            userId: 'usr_a',
            friendIdA: 'usr_a',
            friendIdB: 'usr_b',
            displayNameA: 'Alice',
            displayName: 'Bob'
        });

        expect(
            mutualEventToFeedRow(
                {
                    createdAt: '2026-11-18T00:00:00.000Z',
                    eventType: 'MutualOptOut',
                    friendIdA: 'usr_deleted',
                    friendIdB: 'usr_b'
                },
                resolveDisplayName
            )
        ).toMatchObject({
            displayNameA: 'usr_deleted',
            displayName: 'Bob'
        });
    });

    test('keeps the existing row shape when no resolver is supplied', () => {
        const row = mutualEventToFeedRow({
            createdAt: '2026-11-18T00:00:00.000Z',
            eventType: 'FriendshipEnd',
            friendIdA: 'usr_a',
            friendIdB: 'usr_b'
        });

        expect(row).not.toHaveProperty('displayNameA');
        expect(row).not.toHaveProperty('displayName');
    });
});

import { describe, expect, test } from 'vitest';

import { mergeCloudIntoMetPool } from '../friendNetworkCloud';

const LOCAL = [
    {
        userId: 'usr_local_recent',
        displayName: 'Local Recent',
        joinCount: 4,
        lastSeen: '2026-11-22 10:00:00'
    },
    {
        userId: 'usr_local_old',
        displayName: 'Local Old',
        joinCount: 1,
        lastSeen: '2026-11-20 10:00:00'
    }
];

describe('friendNetworkCloud.mergeCloudIntoMetPool', () => {
    test('returns the original local list when cloud data is unavailable', () => {
        expect(mergeCloudIntoMetPool(LOCAL, null)).toBe(LOCAL);
    });

    test('adds metadata to overlapping local users without appending cloud-only users', () => {
        const result = mergeCloudIntoMetPool(
            LOCAL,
            new Map([
                [
                    'usr_local_old',
                    {
                        count: 7,
                        lastSeen: '2026-11-23T01:00:00.000Z',
                        displayName: 'Cloud Old Name',
                        avatarUrl: 'old.png'
                    }
                ],
                [
                    'usr_cloud_only',
                    {
                        count: 2,
                        lastSeen: '2026-11-22T20:00:00.000Z',
                        displayName: 'Cloud Only',
                        avatarUrl: 'cloud.png'
                    }
                ]
            ])
        );

        expect(result.map((user) => user.userId)).toEqual(['usr_local_recent', 'usr_local_old']);
        expect(result).toHaveLength(LOCAL.length);
        expect(result[1]).toMatchObject({
            displayName: 'Local Old',
            joinCount: 1,
            lastSeen: '2026-11-20 10:00:00'
        });
        expect(result[1].cloud).toEqual({
            count: 7,
            lastSeen: '2026-11-23T01:00:00.000Z',
            displayName: 'Cloud Old Name',
            avatarUrl: 'old.png'
        });
        expect(result.some((user) => user.userId === 'usr_cloud_only')).toBe(false);
        expect(LOCAL[1].cloud).toBeUndefined();
    });

    test('keeps an empty local pool empty even when cloud has strangers', () => {
        const result = mergeCloudIntoMetPool(
            [],
            new Map([
                [
                    'usr_stranger',
                    {
                        count: 1,
                        lastSeen: '2026-11-22T01:00:00.000Z',
                        displayName: '',
                        avatarUrl: ''
                    }
                ]
            ])
        );
        expect(result).toEqual([]);
    });
});

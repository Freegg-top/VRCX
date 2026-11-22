import { describe, expect, test } from 'vitest';

import {
    buildPresenceIntervals,
    computeLocalCoSeen,
    extractLocationFromText,
    extractUsrId,
    extractWorldIdFromLocation,
    groupHistoryByWorld,
    mergeEncounterEntries,
    resolveOpenIntervalEnd,
    shortenInstanceId,
    shortenWorldId
} from '../overseeMerge';

describe('overseeMerge.extractLocationFromText', () => {
    test('extracts location token from pasted text and URLs', () => {
        expect(extractLocationFromText('wrld_abc-123:45678~region(eu)')).toBe('wrld_abc-123:45678');
        expect(extractLocationFromText('join me https://vrchat.com/home/launch?worldId=wrld_abc&ref=1')).toBe(
            'wrld_abc'
        );
        expect(extractLocationFromText('wrld_01234567-89ab-cdef:0')).toBe('wrld_01234567-89ab-cdef:0');
    });

    test('returns empty string when nothing extractable', () => {
        expect(extractLocationFromText('hello world')).toBe('');
        expect(extractLocationFromText('')).toBe('');
        expect(extractLocationFromText(null)).toBe('');
    });
});

describe('overseeMerge.resolveOpenIntervalEnd (未关闭区间截断口径)', () => {
    const interval = { entityKey: 'usr_a', start: '2026-01-01T00:00:00Z', end: null };

    test('closed intervals keep their end', () => {
        const closed = { ...interval, end: '2026-01-01T01:00:00Z' };
        expect(resolveOpenIntervalEnd(closed, '2026-01-01T02:00:00Z', undefined)).toBe('2026-01-01T01:00:00Z');
    });

    test('open intervals use the earliest available candidate', () => {
        expect(resolveOpenIntervalEnd(interval, '2026-01-01T02:00:00Z', '2026-01-01T01:00:00Z')).toBe(
            '2026-01-01T01:00:00Z'
        );
        expect(resolveOpenIntervalEnd(interval, undefined, '2026-01-01T02:00:00Z')).toBe('2026-01-01T02:00:00Z');
        expect(resolveOpenIntervalEnd(interval, '2026-01-01T00:30:00Z', undefined)).toBe('2026-01-01T00:30:00Z');
    });

    test('falls back to start + 4h cap when no candidates exist', () => {
        expect(resolveOpenIntervalEnd(interval, undefined, undefined)).toBe('2026-01-01T04:00:00.000Z');
        // 候选晚于 4h 时同样封顶 4h
        expect(resolveOpenIntervalEnd(interval, '2026-01-01T09:00:00Z', undefined)).toBe('2026-01-01T04:00:00.000Z');
    });
});

describe('overseeMerge.extractUsrId', () => {
    const ID = 'usr_01234567-89ab-cdef-0123-456789abcdef';

    test('extracts from plain id, url and surrounding text', () => {
        expect(extractUsrId(ID)).toBe(ID);
        expect(extractUsrId(`https://vrchat.com/home/user/${ID}`)).toBe(ID);
        expect(extractUsrId(`看看这个人 ${ID} 吧`)).toBe(ID);
    });

    test('rejects malformed ids', () => {
        expect(extractUsrId('usr_short')).toBe('');
        expect(extractUsrId('')).toBe('');
        expect(extractUsrId(null)).toBe('');
        expect(extractUsrId('usr_zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toBe('');
    });
});

describe('overseeMerge helpers', () => {
    test('shortenWorldId truncates long ids and keeps short ones', () => {
        expect(shortenWorldId('wrld_abc')).toBe('wrld_abc');
        expect(shortenWorldId('wrld_01234567-89ab-cdef-0123-456789abcdef')).toBe('wrld_01234…');
        expect(shortenWorldId(null)).toBe('');
    });

    test('extractWorldIdFromLocation', () => {
        expect(extractWorldIdFromLocation('wrld_01234567-89ab:12345~region(eu)')).toBe('wrld_01234567-89ab');
        expect(extractWorldIdFromLocation('local')).toBe('');
    });

    test('shortenInstanceId shortens embedded guids', () => {
        expect(shortenInstanceId('wrld_x:12345~region(eu)')).toBe('wrld_x:12345~region(eu)');
        expect(shortenInstanceId('01234567-89ab-cdef-0123-456789abcdef')).toBe('01234567…');
    });
});

describe('overseeMerge local co-seen', () => {
    test('buildPresenceIntervals pairs join/leave and keeps unclosed joins open', () => {
        const intervals = buildPresenceIntervals([
            {
                userId: 'usr_a',
                displayName: 'A',
                location: 'loc1',
                createdAt: '2026-01-01T00:00:00Z',
                type: 'OnPlayerJoined'
            },
            {
                userId: 'usr_a',
                displayName: 'A',
                location: 'loc1',
                createdAt: '2026-01-01T01:00:00Z',
                type: 'OnPlayerLeft'
            },
            {
                userId: 'usr_b',
                displayName: 'B',
                location: 'loc1',
                createdAt: '2026-01-01T02:00:00Z',
                type: 'OnPlayerJoined'
            }
        ]);
        expect(intervals).toHaveLength(2);
        expect(intervals[0].end).toBe('2026-01-01T01:00:00Z');
        expect(intervals[1].end).toBeNull();
    });

    test('computeLocalCoSeen counts overlaps and tracks lastSeen', () => {
        const rows = [
            {
                userId: 'usr_self',
                displayName: 'Me',
                location: 'loc1',
                createdAt: '2026-01-01T00:00:00Z',
                type: 'OnPlayerJoined'
            },
            {
                userId: 'usr_x',
                displayName: '',
                location: 'loc1',
                createdAt: '2026-01-01T00:10:00Z',
                type: 'OnPlayerJoined'
            },
            {
                userId: 'usr_x',
                displayName: '',
                location: 'loc1',
                createdAt: '2026-01-01T00:20:00Z',
                type: 'OnPlayerLeft'
            },
            {
                userId: 'usr_y',
                displayName: 'Y',
                location: 'loc2',
                createdAt: '2026-01-01T00:30:00Z',
                type: 'OnPlayerJoined'
            },
            {
                userId: 'usr_self',
                displayName: 'Me',
                location: 'loc1',
                createdAt: '2026-01-01T01:00:00Z',
                type: 'OnPlayerLeft'
            },
            {
                userId: 'usr_z',
                displayName: 'Z',
                location: 'loc1',
                createdAt: '2026-01-01T02:00:00Z',
                type: 'OnPlayerJoined'
            }
        ];
        const result = computeLocalCoSeen(rows, 'usr_self');
        expect(result.has('usr_x')).toBe(true);
        expect(result.get('usr_x').count).toBe(1);
        expect(result.get('usr_x').lastSeen).toBe('2026-01-01T00:10:00Z');
        expect(result.has('usr_y')).toBe(false);
        expect(result.has('usr_z')).toBe(false);
        expect(result.has('usr_self')).toBe(false);
    });

    test('open self interval still counts later joins', () => {
        const rows = [
            {
                userId: 'usr_self',
                displayName: 'Me',
                location: 'loc1',
                createdAt: '2026-01-01T00:00:00Z',
                type: 'OnPlayerJoined'
            },
            {
                userId: 'usr_x',
                displayName: 'X',
                location: 'loc1',
                createdAt: '2026-01-01T00:10:00Z',
                type: 'OnPlayerJoined'
            }
        ];
        const result = computeLocalCoSeen(rows, 'usr_self');
        expect(result.get('usr_x').count).toBe(1);
    });

    test('open self interval caps at 4h and drops late joins (防持续至今虚高)', () => {
        const rows = [
            {
                userId: 'usr_self',
                displayName: 'Me',
                location: 'loc1',
                createdAt: '2026-01-01T00:00:00Z',
                type: 'OnPlayerJoined'
            },
            {
                userId: 'usr_x',
                displayName: 'X',
                location: 'loc1',
                createdAt: '2026-01-01T00:10:00Z',
                type: 'OnPlayerJoined'
            },
            {
                userId: 'usr_late',
                displayName: 'Late',
                location: 'loc1',
                createdAt: '2026-01-01T10:00:00Z',
                type: 'OnPlayerJoined'
            }
        ];
        const result = computeLocalCoSeen(rows, 'usr_self');
        expect(result.has('usr_x')).toBe(true);
        expect(result.has('usr_late')).toBe(false);
    });

    test('no self presence returns empty', () => {
        const result = computeLocalCoSeen(
            [
                {
                    userId: 'usr_x',
                    displayName: 'X',
                    location: 'loc1',
                    createdAt: '2026-01-01T00:10:00Z',
                    type: 'OnPlayerJoined'
                }
            ],
            'usr_self'
        );
        expect(result.size).toBe(0);
    });
});

describe('overseeMerge.mergeEncounterEntries', () => {
    test('merges sources, prefers cloud counts and sorts by count desc', () => {
        const localMap = new Map([
            ['usr_local', { userId: 'usr_local', displayName: 'Local', count: 5, lastSeen: '2026-01-02' }],
            ['usr_both', { userId: 'usr_both', displayName: 'Both', count: 1, lastSeen: '2026-01-01' }]
        ]);
        const cloud = [
            {
                other_id: 'usr_both',
                display_name: '',
                avatar_url: 'http://a',
                co_seen_count: 9,
                last_seen: '2026-01-03'
            },
            { other_id: 'usr_cloud', display_name: 'Cloud', avatar_url: '', co_seen_count: 2, last_seen: '2026-01-02' }
        ];
        const merged = mergeEncounterEntries(localMap, cloud);
        expect(merged.map((row) => row.userId)).toEqual(['usr_both', 'usr_local', 'usr_cloud']);
        const both = merged[0];
        expect(both.source).toBe('both');
        expect(both.count).toBe(9);
        expect(both.lastSeen).toBe('2026-01-03');
        expect(both.displayName).toBe('Both');
        expect(merged[2].source).toBe('cloud');
    });

    test('cloud-only display name falls back to other_id', () => {
        const merged = mergeEncounterEntries(new Map(), [
            { other_id: 'usr_c', display_name: '', co_seen_count: 1, last_seen: '' }
        ]);
        expect(merged[0].displayName).toBe('usr_c');
    });

    test('rows without a valid usr_ id are marked hasUserId=false (禁用点击)', () => {
        const merged = mergeEncounterEntries(
            new Map([
                [
                    'Display Only',
                    { userId: 'Display Only', displayName: 'Display Only', count: 3, lastSeen: '2026-01-01' }
                ]
            ]),
            []
        );
        expect(merged[0].hasUserId).toBe(false);
        const valid = mergeEncounterEntries(
            new Map([
                [
                    'usr_01234567-89ab-cdef-0123-456789abcdef',
                    {
                        userId: 'usr_01234567-89ab-cdef-0123-456789abcdef',
                        displayName: 'A',
                        count: 1,
                        lastSeen: '2026-01-01'
                    }
                ]
            ]),
            []
        );
        expect(valid[0].hasUserId).toBe(true);
    });
});

describe('overseeMerge.groupHistoryByWorld', () => {
    test('groups by world and tracks count/first/last', () => {
        const groups = groupHistoryByWorld([
            { at: '2026-01-03', world_id: 'wrld_a', instance_id: '1' },
            { at: '2026-01-02', world_id: 'wrld_b', instance_id: '2' },
            { at: '2026-01-01', world_id: 'wrld_a', instance_id: '3' },
            { at: '2026-01-04', world_id: '', instance_id: '4' }
        ]);
        expect(groups).toHaveLength(2);
        expect(groups[0].worldId).toBe('wrld_a');
        expect(groups[0].count).toBe(2);
        expect(groups[0].lastAt).toBe('2026-01-03');
        expect(groups[0].firstAt).toBe('2026-01-01');
        expect(groups[0].entries).toHaveLength(2);
    });
});

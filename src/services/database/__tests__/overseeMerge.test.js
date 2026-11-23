import { describe, expect, test } from 'vitest';

import {
    extractLocationFromText,
    extractUsrId,
    extractWorldIdFromLocation,
    groupHistoryByWorld,
    shortenInstanceId,
    shortenWorldId
} from '../overseeMerge';

describe('overseeMerge.extractLocationFromText', () => {
    test('preserves the complete location including every instance qualifier', () => {
        const location =
            'wrld_dec35e59-53f5-4def-b29c-2d7b649b8638:15717~group(grp_ad7333f3-5452-44df-abc6-267de156e762)~groupAccessType(public)~region(eu)';
        expect(extractLocationFromText(location)).toBe(location);
        expect(extractLocationFromText(`join me ${location} now`)).toBe(location);
    });

    test('preserves parenthesized group qualifiers', () => {
        expect(extractLocationFromText('wrld_abc-123:45678~group(grp_abc-123)~region(eu)')).toBe(
            'wrld_abc-123:45678~group(grp_abc-123)~region(eu)'
        );
    });

    test('keeps short locations and world-only IDs unchanged', () => {
        expect(extractLocationFromText('wrld_01234567-89ab-cdef:0')).toBe('wrld_01234567-89ab-cdef:0');
        expect(extractLocationFromText('join me https://vrchat.com/home/launch?worldId=wrld_abc&ref=1')).toBe(
            'wrld_abc'
        );
    });

    test('extracts a qualified location from a URL query value', () => {
        expect(
            extractLocationFromText(
                'https://vrchat.com/home/launch?location=wrld_abc:45678~group(grp_123)~groupAccessType(public)~region(eu)'
            )
        ).toBe('wrld_abc:45678~group(grp_123)~groupAccessType(public)~region(eu)');
    });

    test('returns empty string when nothing extractable', () => {
        expect(extractLocationFromText('hello world')).toBe('');
        expect(extractLocationFromText('')).toBe('');
        expect(extractLocationFromText(null)).toBe('');
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

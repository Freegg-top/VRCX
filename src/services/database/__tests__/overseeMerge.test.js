import { describe, expect, test } from 'vitest';

import { extractUsrId, extractWorldIdFromLocation, shortenWorldId } from '../overseeMerge';

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

describe('overseeMerge world helpers', () => {
    test('shortenWorldId truncates long ids and keeps short ones', () => {
        expect(shortenWorldId('wrld_abc')).toBe('wrld_abc');
        expect(shortenWorldId('wrld_01234567-89ab-cdef-0123-456789abcdef')).toBe('wrld_01234…');
        expect(shortenWorldId(null)).toBe('');
    });

    test('extractWorldIdFromLocation', () => {
        expect(extractWorldIdFromLocation('wrld_01234567-89ab:12345~region(eu)')).toBe('wrld_01234567-89ab');
        expect(extractWorldIdFromLocation('local')).toBe('');
    });
});

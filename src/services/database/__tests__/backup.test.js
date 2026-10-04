import { buildSnapshotPath, escapeSqlLiteral, snapshotFileName, sqliteVersionSupported } from '../backup.js';

// sqliteService 会牵出 stores -> 组件图, 这里只测纯函数
vi.mock('../../sqlite.js', () => ({
    default: { execute: vi.fn(), executeNonQuery: vi.fn() }
}));

describe('escapeSqlLiteral', () => {
    test('doubles single quotes because VACUUM INTO takes no bound parameters', () => {
        expect(escapeSqlLiteral(`C:\\a'b\\VRCX.db`)).toBe(`C:\\a''b\\VRCX.db`);
    });

    test('leaves ordinary paths untouched', () => {
        expect(escapeSqlLiteral('/home/user/.config/VRCX/VRCX.sqlite3')).toBe('/home/user/.config/VRCX/VRCX.sqlite3');
    });
});

describe('buildSnapshotPath', () => {
    const date = new Date(2026, 8, 28, 1, 2, 3);

    test('keeps the snapshot next to a windows database file', () => {
        expect(buildSnapshotPath('C:\\Users\\HHH\\AppData\\Roaming\\VRCX\\VRCX.sqlite3', date)).toBe(
            'C:\\Users\\HHH\\AppData\\Roaming\\VRCX\\VRCX-snapshot-2026.09.28-01.02.03.sqlite3'
        );
    });

    test('keeps the snapshot next to a posix database file', () => {
        expect(buildSnapshotPath('/home/h/.config/VRCX/VRCX.sqlite3', date)).toBe(
            '/home/h/.config/VRCX/VRCX-snapshot-2026.09.28-01.02.03.sqlite3'
        );
    });

    test('refuses to guess a directory when the path has none', () => {
        expect(buildSnapshotPath('VRCX.sqlite3', date)).toBe('');
    });
});

describe('snapshotFileName', () => {
    test('avoids windows illegal characters in timestamps', () => {
        expect(snapshotFileName(new Date(2026, 0, 5, 23, 59, 59))).toBe(
            'VRCX-snapshot-2026.01.05-23.59.59.sqlite3'
        );
    });
});

describe('sqliteVersionSupported', () => {
    test.each([
        ['3.26.0', false],
        ['3.27.0', true],
        ['3.53.4', true],
        ['4.0.0', true],
        ['unknown', false]
    ])('%s -> %s', (version, expected) => {
        expect(sqliteVersionSupported(version)).toBe(expected);
    });
});

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
    backupNow: null,
    createSnapshot: vi.fn(),
    getDatabasePath: vi.fn(),
    getDatabaseSize: vi.fn(),
    isRunningFromSnapshot: vi.fn(),
    listSnapshots: vi.fn(),
    returnToMainDatabase: vi.fn(),
    restoreSnapshot: vi.fn(),
    confirm: vi.fn(),
    getBool: vi.fn(),
    getInt: vi.fn(),
    getString: vi.fn(),
    remove: vi.fn(),
    setBool: vi.fn(),
    setInt: vi.fn(),
    setString: vi.fn()
}));

vi.mock('../../services/database/backup', () => ({
    databaseBackup: {
        createSnapshot: mocks.createSnapshot,
        getDatabasePath: mocks.getDatabasePath,
        getDatabaseSize: mocks.getDatabaseSize,
        isRunningFromSnapshot: mocks.isRunningFromSnapshot,
        listSnapshots: mocks.listSnapshots,
        returnToMainDatabase: mocks.returnToMainDatabase,
        restoreSnapshot: mocks.restoreSnapshot
    }
}));
vi.mock('../../services/config', () => ({
    default: {
        getArray: vi.fn(async () => []),
        getBool: mocks.getBool,
        getInt: mocks.getInt,
        getObject: vi.fn(),
        getSet: vi.fn(),
        getString: mocks.getString,
        remove: mocks.remove,
        setArray: vi.fn(),
        setBool: mocks.setBool,
        setInt: mocks.setInt,
        setObject: vi.fn(),
        setString: mocks.setString
    }
}));
vi.mock('../../services/watchState', () => ({ watchState: { isLoggedIn: true } }));
vi.mock('../modal', () => ({ useModalStore: () => ({ confirm: mocks.confirm }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { useBackupStore } from '../backup';

const GIB_BYTES = 1024 * 1024 * 1024;

function daysAgo(days) {
    return new Date(Date.now() - days * 86400000).toJSON();
}

async function seedStore({ enabled = true, intervalDays = 7, lastBackupDate = '' } = {}) {
    mocks.getBool.mockImplementation(async (key, fallback) => (key === 'VRCX_autoBackupEnabled' ? enabled : fallback));
    mocks.getInt.mockImplementation(async (key, fallback) =>
        key === 'VRCX_backupIntervalDays' ? intervalDays : fallback
    );
    mocks.getString.mockImplementation(async (key, fallback) => {
        if (key === 'VRCX_backupLastDate') {
            return lastBackupDate;
        }
        if (key === 'VRCX_backupMainDbPath') {
            return null;
        }
        return fallback ?? '';
    });
    const store = useBackupStore();
    // store 创建时的 initBackupSettings 没有被 await, 这里等设置真正落到 refs 上
    await store.initBackupSettings();
    return store;
}

describe('useBackupStore', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        mocks.getDatabasePath.mockResolvedValue('C:\\Users\\h\\AppData\\Roaming\\VRCX\\VRCX.sqlite3');
        mocks.getDatabaseSize.mockResolvedValue(10 * 1024 * 1024);
        mocks.isRunningFromSnapshot.mockResolvedValue(false);
        mocks.listSnapshots.mockResolvedValue([]);
        mocks.createSnapshot.mockResolvedValue({ path: 'snapshot', date: new Date().toJSON(), size: 1 });
    });

    test('automatic backup is skipped when disabled', async () => {
        const store = await seedStore({ enabled: false });

        await store.runAutoBackup();

        expect(mocks.createSnapshot).not.toHaveBeenCalled();
    });

    test('automatic backup waits for the configured interval', async () => {
        const store = await seedStore({ intervalDays: 7, lastBackupDate: daysAgo(2) });

        await store.runAutoBackup();

        expect(mocks.createSnapshot).not.toHaveBeenCalled();
    });

    test('automatic backup runs once the interval has elapsed', async () => {
        const store = await seedStore({ intervalDays: 7, lastBackupDate: daysAgo(8) });

        await store.runAutoBackup();

        expect(mocks.createSnapshot).toHaveBeenCalledWith('Auto Backup');
    });

    test('automatic backup refuses to write snapshots of a huge database', async () => {
        mocks.getDatabaseSize.mockResolvedValue(3 * GIB_BYTES);
        const store = await seedStore();

        await store.runAutoBackup();

        expect(mocks.createSnapshot).not.toHaveBeenCalled();
    });

    test('manual backup ignores the automatic size limit', async () => {
        mocks.getDatabaseSize.mockResolvedValue(3 * GIB_BYTES);
        const store = await seedStore();

        await store.backupNow();

        expect(mocks.createSnapshot).toHaveBeenCalledWith('Manual Backup');
    });

    test('restore only moves the database pointer after confirmation', async () => {
        const store = await seedStore();
        mocks.confirm.mockResolvedValue({ ok: true, reason: 'ok' });

        await store.restoreSnapshot({ path: 'C:\\snap.sqlite3' });

        expect(mocks.restoreSnapshot).toHaveBeenCalledWith('C:\\snap.sqlite3');
        // a second confirm asks for the restart, so confirm is called twice
        expect(mocks.confirm).toHaveBeenCalledTimes(2);
    });

    test('restore is a no-op when the user cancels', async () => {
        const store = await seedStore();
        mocks.confirm.mockResolvedValue({ ok: false, reason: 'cancel' });

        await store.restoreSnapshot({ path: 'C:\\snap.sqlite3' });

        expect(mocks.restoreSnapshot).not.toHaveBeenCalled();
    });

    test('returning to the main database is confirmed before restarting', async () => {
        const store = await seedStore();
        mocks.confirm.mockResolvedValue({ ok: true, reason: 'ok' });

        await store.returnToMainDatabase();

        expect(mocks.returnToMainDatabase).toHaveBeenCalledTimes(1);
    });
});

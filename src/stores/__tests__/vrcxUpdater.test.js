import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
    configRepository: {
        getString: vi.fn(),
        setString: vi.fn()
    },
    changeLogRemoveLinks: vi.fn((value) => value),
    toast: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn()
    }
}));

vi.mock('../../services/config', () => ({
    default: mocks.configRepository
}));

vi.mock('../../shared/utils', () => ({
    changeLogRemoveLinks: (...args) => mocks.changeLogRemoveLinks(...args)
}));

vi.mock('vue-sonner', () => ({
    toast: mocks.toast
}));

vi.mock('vue-i18n', () => ({
    useI18n: () => ({
        t: (key) => key,
        locale: require('vue').ref('en')
    })
}));

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

import { useVRCXUpdaterStore } from '../vrcxUpdater';

describe('useVRCXUpdaterStore.setAutoUpdateVRCX', () => {
    beforeEach(async () => {
        mocks.configRepository.getString.mockImplementation((key, defaultValue) => {
            if (key === 'VRCX_autoUpdateVRCX') {
                return Promise.resolve('Off');
            }
            if (key === 'VRCX_id') {
                return Promise.resolve('test-vrcx-id');
            }
            if (key === 'VRCX_lastVRCXVersion') {
                return Promise.resolve('2026.1.0');
            }
            return Promise.resolve(defaultValue ?? '');
        });
        mocks.configRepository.setString.mockResolvedValue(undefined);

        globalThis.AppApi = {
            GetVersion: vi.fn().mockResolvedValue('2026.1.0')
        };

        setActivePinia(createPinia());
        useVRCXUpdaterStore();
        await flushPromises();
        vi.clearAllMocks();
    });

    test('sets autoUpdateVRCX to Off, clears pending flag, and persists config', async () => {
        const store = useVRCXUpdaterStore();
        store.pendingVRCXUpdate = true;

        await store.setAutoUpdateVRCX('Off');

        expect(store.autoUpdateVRCX).toBe('Off');
        expect(store.pendingVRCXUpdate).toBe(false);
        expect(mocks.configRepository.setString).toHaveBeenCalledWith('VRCX_autoUpdateVRCX', 'Off');
    });

    test('updates autoUpdateVRCX for non-Off values and keeps pending flag', async () => {
        const store = useVRCXUpdaterStore();
        store.pendingVRCXUpdate = true;

        await store.setAutoUpdateVRCX('Notify');

        expect(store.autoUpdateVRCX).toBe('Notify');
        expect(store.pendingVRCXUpdate).toBe(true);
        expect(mocks.configRepository.setString).toHaveBeenCalledWith('VRCX_autoUpdateVRCX', 'Notify');
    });

    test('switches the update source and persists the selection', async () => {
        const store = useVRCXUpdaterStore();

        expect(store.updateSource).toBe('s3');
        await store.setUpdateSource('github');

        expect(store.updateSource).toBe('github');
        expect(mocks.configRepository.setString).toHaveBeenCalledWith('VRCX_dlcx_updateSource', 'github');
    });

    test('uses the selected source and release tag for installer downloads', async () => {
        const store = useVRCXUpdaterStore();
        const asset = {
            name: 'VRCX_Setup.exe',
            browser_download_url: 'https://s3.freegg.top/vrcx/2026.2.0/VRCX_Setup.exe',
            content_type: 'application/x-msdownload',
            state: 'uploaded',
            size: 198000000
        };
        store.VRCXUpdateDialog.release = 'VRCX DLC 2026.2.0';
        store.VRCXUpdateDialog.releases = [
            {
                name: 'VRCX DLC 2026.2.0',
                tag_name: 'v2026.2.0-dlc.1',
                assets: [asset]
            }
        ];
        globalThis.AppApi.CheckUpdateProgress = vi.fn().mockResolvedValue(0);
        globalThis.AppApi.DownloadUpdate = vi.fn().mockResolvedValue(undefined);

        store.installVRCXUpdate();
        await flushPromises();

        expect(globalThis.AppApi.DownloadUpdate).toHaveBeenLastCalledWith(asset.browser_download_url, '', asset.size);

        await store.setUpdateSource('github');
        store.installVRCXUpdate();
        await flushPromises();

        expect(globalThis.AppApi.DownloadUpdate).toHaveBeenLastCalledWith(
            'https://github.com/Freegg-top/VRCX/releases/download/v2026.2.0-dlc.1/VRCX_Setup.exe',
            '',
            asset.size
        );
    });

    test('loads the packaged DLC changelog before the embedded fallback', async () => {
        const store = useVRCXUpdaterStore();
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve('## Local release notes')
        });

        await store.loadDlcChangeLog();

        expect(store.dlcChangeLogText).toBe('## Local release notes');
        expect(store.dlcChangeLogLoaded).toBe(true);
        expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('changelog.txt?t='));
    });

    test('uses localized embedded changelog content when the local file is unavailable', async () => {
        const store = useVRCXUpdaterStore();
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

        await store.loadDlcChangeLog();

        expect(store.dlcChangeLogText).toBe('dialog.change_log.dlc_fallback');
        expect(store.dlcChangeLogLoaded).toBe(true);
    });
});

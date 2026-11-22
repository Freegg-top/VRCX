import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const configMock = vi.hoisted(() => ({
    getString: vi.fn(),
    setString: vi.fn(),
    getBool: vi.fn(),
    setBool: vi.fn()
}));

vi.mock('../../../services/config', () => ({
    default: configMock
}));

const webApiMock = vi.hoisted(() => ({
    execute: vi.fn()
}));

vi.mock('../../../services/webapi', () => ({
    default: webApiMock
}));

import { getUserHistory, probeLicense } from '../../../services/overseeApi';
import { useOverseeSettingsStore } from '../oversee';

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('oversee settings store', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        configMock.getString.mockImplementation((key, defaultValue) => Promise.resolve(defaultValue ?? ''));
        configMock.getBool.mockImplementation((key, defaultValue) => Promise.resolve(defaultValue));
        configMock.setString.mockResolvedValue(undefined);
        configMock.setBool.mockResolvedValue(undefined);
    });

    test('watchlist helpers validate, normalize, dedupe and persist', async () => {
        const store = useOverseeSettingsStore();
        await flushPromises();

        expect(store.addWatch(' usr_DeadBeef ')).toBe(true);
        expect(store.addWatch('usr_deadbeef')).toBe(false);
        expect(store.addWatch('not_a_user_id')).toBe(false);
        expect(store.watchlist).toEqual(['usr_deadbeef']);
        expect(store.isWatched('USR_DEADBEEF')).toBe(true);
        expect(store.isWatched('usr_other')).toBe(false);
        expect(configMock.setString).toHaveBeenCalledWith('VRCX_oversee_watchlist', JSON.stringify(['usr_deadbeef']));

        expect(store.removeWatch('usr_deadbeef')).toBe(true);
        expect(store.removeWatch('usr_deadbeef')).toBe(false);
        expect(store.watchlist).toEqual([]);
    });

    test('feature toggle setters persist new values', async () => {
        const store = useOverseeSettingsStore();
        await flushPromises();

        store.setEnableTrace();
        expect(store.enableTrace).toBe(false);
        expect(configMock.setBool).toHaveBeenCalledWith('VRCX_oversee_enableTrace', false);

        store.setSseEnabled();
        expect(store.sseEnabled).toBe(false);
        expect(configMock.setBool).toHaveBeenCalledWith('VRCX_oversee_sseEnabled', false);
    });

    test('setApiBase falls back to default endpoint when blank', async () => {
        const store = useOverseeSettingsStore();
        await flushPromises();

        store.setApiBase('https://example.test/');
        expect(store.apiBase).toBe('https://example.test');

        store.setApiBase('  ');
        expect(store.apiBase).toBe('https://api.freegg.top');
    });

    test('probeLicense maps API statuses to license states', async () => {
        const store = useOverseeSettingsStore();
        await flushPromises();

        // 未配置 license: 不发请求, 直接判 invalid
        store.setLicenseKey('');
        await expect(probeLicense()).resolves.toBe('invalid');
        expect(webApiMock.execute).not.toHaveBeenCalled();
        expect(store.licenseStatus).toBe('invalid');

        store.setLicenseKey('test-key');

        webApiMock.execute.mockResolvedValueOnce({ status: 200, data: '{"results":[]}' });
        await expect(probeLicense()).resolves.toBe('ok');
        expect(store.licenseStatus).toBe('ok');

        webApiMock.execute.mockResolvedValueOnce({ status: 401, data: '{"detail":"Unauthorized"}' });
        await expect(probeLicense()).resolves.toBe('invalid');
        expect(store.licenseStatus).toBe('invalid');

        webApiMock.execute.mockResolvedValueOnce({ status: 403, data: '{"detail":"Forbidden"}' });
        await expect(probeLicense()).resolves.toBe('expired');
        expect(store.licenseStatus).toBe('expired');

        webApiMock.execute.mockRejectedValueOnce('network down');
        await expect(probeLicense()).resolves.toBe('offline');
        expect(store.licenseStatus).toBe('offline');

        const lastCall = webApiMock.execute.mock.calls.at(-1)[0];
        expect(lastCall.url).toContain('/v1/instance/wrld_oversee-probe%3A0');
        expect(lastCall.headers.Authorization).toBe('Bearer test-key');
    });

    test('getUserHistory throws typed OverseeApiError and updates license status', async () => {
        const store = useOverseeSettingsStore();
        await flushPromises();

        // 未配置 license 直接抛 notConfigured, 不出网
        store.setLicenseKey('');
        await expect(getUserHistory('usr_deadbeef', 10)).rejects.toMatchObject({ kind: 'notConfigured' });
        expect(webApiMock.execute).not.toHaveBeenCalled();

        store.setLicenseKey('test-key');

        webApiMock.execute.mockResolvedValueOnce({ status: 401, data: '{"detail":"Unauthorized"}' });
        await expect(getUserHistory('usr_deadbeef', 10)).rejects.toMatchObject({ kind: 'unauthorized', status: 401 });
        expect(store.licenseStatus).toBe('invalid');

        webApiMock.execute.mockResolvedValueOnce({ status: 404, data: '{"detail":"Not Found"}' });
        await expect(getUserHistory('usr_missing', 10)).rejects.toMatchObject({ kind: 'notFound', status: 404 });

        webApiMock.execute.mockResolvedValueOnce({ status: 200, data: '{"user":{"usr_id":"usr_a"},"history":[]}' });
        await expect(getUserHistory('usr_a', 200)).resolves.toEqual({ user: { usr_id: 'usr_a' }, history: [] });
        expect(store.licenseStatus).toBe('ok');

        const url = new URL(webApiMock.execute.mock.calls.at(-1)[0].url);
        expect(url.pathname).toBe('/v1/user/usr_a/history');
        expect(url.searchParams.get('limit')).toBe('200');
        expect(url.origin).toBe('https://api.freegg.top');
    });
});

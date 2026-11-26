import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';

import en from '../../localization/en.json';

vi.mock('../../views/Feed/Feed.vue', () => ({
    default: { template: '<div />' }
}));
vi.mock('../../views/Feed/columns.jsx', () => ({ columns: [] }));
vi.mock('../../plugins/router', () => ({
    router: {
        beforeEach: vi.fn(),
        push: vi.fn(),
        replace: vi.fn(),
        currentRoute: ref({ path: '/', name: '', meta: {} }),
        isReady: vi.fn().mockResolvedValue(true)
    },
    initRouter: vi.fn()
}));
vi.mock('vue-router', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useRouter: vi.fn(() => ({
            push: vi.fn(),
            replace: vi.fn(),
            currentRoute: ref({ path: '/', name: '', meta: {} })
        }))
    };
});
vi.mock('../../plugins/interopApi', () => ({ initInteropApi: vi.fn() }));
vi.mock('../../services/database', () => ({
    database: new Proxy(
        {},
        {
            get: (_target, prop) => {
                if (prop === '__esModule') return false;
                return vi.fn().mockResolvedValue(null);
            }
        }
    )
}));
vi.mock('../../services/jsonStorage', () => ({ default: vi.fn() }));
vi.mock('../../services/config', () => ({
    default: {
        init: vi.fn(),
        getString: vi.fn().mockImplementation((_k, d) => d ?? ''),
        setString: vi.fn(),
        getBool: vi.fn().mockImplementation((_k, d) => d ?? false),
        setBool: vi.fn(),
        getInt: vi.fn().mockImplementation((_k, d) => d ?? 0),
        setInt: vi.fn(),
        getFloat: vi.fn().mockImplementation((_k, d) => d ?? 0),
        setFloat: vi.fn(),
        getObject: vi.fn().mockReturnValue(null),
        setObject: vi.fn(),
        getArray: vi.fn().mockReturnValue([]),
        setArray: vi.fn(),
        remove: vi.fn()
    }
}));
vi.mock('../../services/watchState', () => ({
    watchState: { isLoggedIn: true }
}));
vi.mock('../../services/appConfig', () => ({
    AppApi: { FocusWindow: vi.fn() },
    AppDebug: { log: vi.fn() }
}));
vi.mock('vue-i18n', async (importOriginal) => {
    const actual = await importOriginal();
    const i18n = actual.createI18n({
        locale: 'en',
        fallbackLocale: 'en',
        legacy: false,
        missingWarn: false,
        fallbackWarn: false,
        messages: { en }
    });
    return {
        ...actual,
        useI18n: () => i18n.global
    };
});
vi.mock('../../api', () => ({
    avatarRequest: { getUser: vi.fn().mockResolvedValue(null) },
    queryRequest: { fetch: vi.fn().mockResolvedValue({ json: null }) }
}));
vi.mock('vue-sonner', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn()
    }
}));

// location 命令的目标：launch store 的「在 VRChat 中打开」
const mockTryOpenInstanceInVrc = vi.fn().mockResolvedValue(undefined);
vi.mock('../launch', () => ({
    useLaunchStore: () => ({
        tryOpenInstanceInVrc: mockTryOpenInstanceInVrc
    })
}));

import { queryRequest } from '../../api';
import { useVrcxStore } from '../vrcx';

const mockQueryRequestFetch = vi.mocked(queryRequest.fetch);

describe('useVrcxStore eventLaunchCommand location', () => {
    let store;

    beforeEach(() => {
        setActivePinia(createPinia());
        store = useVrcxStore();
        vi.clearAllMocks();
    });

    test('vrcx://location/<full location> calls tryOpenInstanceInVrc with intact location', () => {
        store.eventLaunchCommand(
            'location/wrld_4b293ce2-5df0-4299-83a2-37b9f856c3af:82180~group(grp_07501080-2055-4d62-8a28-890c234b8d39)~groupAccessType(public)~region(use)'
        );

        expect(mockTryOpenInstanceInVrc).toHaveBeenCalledTimes(1);
        expect(mockTryOpenInstanceInVrc).toHaveBeenCalledWith(
            'wrld_4b293ce2-5df0-4299-83a2-37b9f856c3af:82180~group(grp_07501080-2055-4d62-8a28-890c234b8d39)~groupAccessType(public)~region(use)'
        );
        expect(mockQueryRequestFetch).toHaveBeenCalledWith('world.location', {
            worldId: 'wrld_4b293ce2-5df0-4299-83a2-37b9f856c3af'
        });
    });

    test('bare public instance location without suffixes', () => {
        store.eventLaunchCommand('location/wrld_123:45678');

        expect(mockTryOpenInstanceInVrc).toHaveBeenCalledWith('wrld_123:45678');
        expect(mockQueryRequestFetch).toHaveBeenCalledWith('world.location', { worldId: 'wrld_123' });
    });

    test('encoded location prefetches the decoded world id', () => {
        const location = 'wrld_123:45678~region(use)';
        store.eventLaunchCommand(`location/${encodeURIComponent(location)}`);

        expect(mockTryOpenInstanceInVrc).toHaveBeenCalledWith(location);
        expect(mockQueryRequestFetch).toHaveBeenCalledWith('world.location', { worldId: 'wrld_123' });
    });

    test('world prefetch failure does not block opening the instance', async () => {
        mockQueryRequestFetch.mockRejectedValueOnce(new Error('world request failed'));
        store.eventLaunchCommand('location/wrld_123:45678');

        expect(mockTryOpenInstanceInVrc).toHaveBeenCalledWith('wrld_123:45678');
        await Promise.resolve();
    });

    test('missing location argument does not call tryOpenInstanceInVrc', () => {
        store.eventLaunchCommand('location/');

        expect(mockTryOpenInstanceInVrc).not.toHaveBeenCalled();
        expect(mockQueryRequestFetch).not.toHaveBeenCalled();
    });

    test('empty string argument does not call tryOpenInstanceInVrc', () => {
        store.eventLaunchCommand('location/ ');

        expect(mockTryOpenInstanceInVrc).not.toHaveBeenCalled();
        expect(mockQueryRequestFetch).not.toHaveBeenCalled();
    });
});

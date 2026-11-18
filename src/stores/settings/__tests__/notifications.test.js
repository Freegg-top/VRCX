import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { sharedFeedFiltersDefaults } from '../../../shared/constants';

const configMock = vi.hoisted(() => ({
    getString: vi.fn(),
    getBool: vi.fn((key, defaultValue) => Promise.resolve(defaultValue))
}));

vi.mock('../../../services/config', () => ({
    default: configMock
}));
vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key) => key })
}));
vi.mock('../../vr', () => ({
    useVrStore: () => ({ updateVRConfigVars: vi.fn() })
}));
vi.mock('../../modal', () => ({
    useModalStore: () => ({ prompt: vi.fn() })
}));

import { useNotificationsSettingsStore } from '../notifications';

function flushPromises() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('notifications shared feed filters', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        configMock.getBool.mockImplementation((key, defaultValue) => Promise.resolve(defaultValue));
    });

    test('fills every missing default key while preserving existing values', async () => {
        configMock.getString.mockImplementation((key, defaultValue) => {
            if (key === 'sharedFeedFilters') {
                return Promise.resolve(
                    JSON.stringify({
                        noty: { GPS: 'Friends' },
                        wrist: { Online: 'VIP' }
                    })
                );
            }
            return Promise.resolve(defaultValue ?? '');
        });
        const store = useNotificationsSettingsStore();
        await flushPromises();

        expect(store.sharedFeedFilters.noty).toEqual({
            ...sharedFeedFiltersDefaults.noty,
            GPS: 'Friends'
        });
        expect(store.sharedFeedFilters.wrist).toEqual({
            ...sharedFeedFiltersDefaults.wrist,
            Online: 'VIP'
        });
        expect(store.sharedFeedFilters.wrist.MutualFriendshipStart).toBe('On');
        expect(store.sharedFeedFilters.wrist.MutualOptOut).toBe('On');
    });
});

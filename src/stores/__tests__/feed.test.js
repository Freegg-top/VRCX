import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

const mocks = vi.hoisted(() => ({
    currentRoute: null,
    lookupFeedDatabase: vi.fn(),
    searchFeedDatabase: vi.fn(),
    getMutualEvents: vi.fn()
}));

vi.mock('vue-router', () => ({
    useRouter: () => ({ currentRoute: mocks.currentRoute })
}));
vi.mock('../../services/database', () => ({
    database: {
        lookupFeedDatabase: mocks.lookupFeedDatabase,
        searchFeedDatabase: mocks.searchFeedDatabase,
        getMutualEvents: mocks.getMutualEvents
    }
}));
vi.mock('../../services/config', () => ({
    default: {
        getString: vi.fn((key, defaultValue) => Promise.resolve(defaultValue)),
        getBool: vi.fn((key, defaultValue) => Promise.resolve(defaultValue)),
        setString: vi.fn().mockResolvedValue(undefined),
        setBool: vi.fn().mockResolvedValue(undefined)
    }
}));
vi.mock('../friend', () => ({
    useFriendStore: () => ({ localFavoriteFriends: new Set() })
}));
vi.mock('../user', () => ({
    useUserStore: () => ({ cachedUsers: new Map() })
}));
vi.mock('../vrcx', () => ({
    useVrcxStore: () => ({ searchLimit: 100, maxTableSize: 500 })
}));
vi.mock('../dashboard', () => ({
    useDashboardStore: () => ({ dashboards: [], getDashboard: () => null })
}));
vi.mock('../../services/watchState', () => ({
    watchState: { isLoggedIn: false, isFavoritesLoaded: false }
}));

import { useFeedStore } from '../feed';

describe('feed mutual history route refresh', () => {
    beforeEach(async () => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        const { ref } = await import('vue');
        mocks.currentRoute = ref({ name: 'other', params: {} });
        mocks.lookupFeedDatabase.mockResolvedValue([]);
        mocks.searchFeedDatabase.mockResolvedValue([]);
        mocks.getMutualEvents.mockResolvedValue([]);
    });

    test('reloads mutual history when the feed route becomes active', async () => {
        const store = useFeedStore();
        expect(mocks.getMutualEvents).not.toHaveBeenCalled();

        mocks.currentRoute.value = { name: 'feed', params: {} };
        await nextTick();
        await vi.waitFor(() => expect(mocks.getMutualEvents).toHaveBeenCalledWith({ limit: 500 }));
        await vi.waitFor(() => expect(store.feedTable.loading).toBe(false));

        expect(mocks.lookupFeedDatabase).toHaveBeenCalled();
    });
});

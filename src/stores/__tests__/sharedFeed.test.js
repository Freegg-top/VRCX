import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const mocks = vi.hoisted(() => ({
    getMutualEvents: vi.fn(),
    cachedUsers: new Map()
}));

vi.mock('../../services/database', () => ({
    database: {
        lookupFeedDatabase: vi.fn().mockResolvedValue([]),
        lookupGameLogDatabase: vi.fn().mockResolvedValue([]),
        lookupNotificationDatabase: vi.fn().mockResolvedValue([]),
        getMutualEvents: mocks.getMutualEvents
    }
}));
vi.mock('../friend', () => ({
    useFriendStore: () => ({
        localFavoriteFriends: new Set(),
        friends: new Map([['usr_a', {}]])
    })
}));
vi.mock('../settings/notifications', () => ({
    useNotificationsSettingsStore: () => ({
        sharedFeedFilters: {
            wrist: {
                MutualFriendshipEnd: 'Friends',
                MutualFriendshipStart: 'On',
                MutualOptOut: 'On'
            },
            noty: {}
        }
    })
}));
vi.mock('../user', () => ({
    useUserStore: () => ({
        currentTravelers: new Map(),
        currentUser: { id: 'usr_me' },
        cachedUsers: mocks.cachedUsers,
        customUserTags: new Map()
    })
}));
vi.mock('../location', () => ({ useLocationStore: () => ({ lastLocation: {} }) }));
vi.mock('../instance', () => ({
    useInstanceStore: () => ({ getInstanceName: vi.fn().mockResolvedValue('') })
}));
vi.mock('../moderation', () => ({
    useModerationStore: () => ({ cachedPlayerModerations: new Map() })
}));
vi.mock('../notification', () => ({
    useNotificationStore: () => ({ queueGameLogNoty: vi.fn() })
}));
vi.mock('../settings/wristOverlay', () => ({
    useWristOverlaySettingsStore: () => ({ hidePrivateFromFeed: false })
}));
vi.mock('../../services/watchState', () => ({
    watchState: { isFriendsLoaded: false, isFavoritesLoaded: false }
}));

import { useSharedFeedStore } from '../sharedFeed';

describe('sharedFeed mutual history', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        mocks.cachedUsers = new Map([
            ['usr_a', { id: 'usr_a', displayName: 'Alice' }],
            ['usr_b', { id: 'usr_b', displayName: 'Bob' }]
        ]);
        mocks.getMutualEvents.mockResolvedValue([
            {
                id: 1,
                createdAt: '2026-11-18T00:00:00.000Z',
                eventType: 'FriendshipStart',
                friendIdA: 'usr_a',
                friendIdB: 'usr_b'
            },
            {
                id: 2,
                createdAt: '2026-11-17T00:00:00.000Z',
                eventType: 'FriendshipEnd',
                friendIdA: 'usr_a',
                friendIdB: 'usr_deleted'
            }
        ]);
    });

    test('loads names from cached users and falls back to ids', async () => {
        const store = useSharedFeedStore();
        await store.loadSharedFeed();

        const mutualRows = store.sharedFeedData.filter((row) => row.type.startsWith('Mutual'));
        expect(mutualRows).toHaveLength(2);
        expect(mutualRows[0]).toMatchObject({ displayNameA: 'Alice', displayName: 'Bob' });
        expect(mutualRows[1]).toMatchObject({ displayNameA: 'Alice', displayName: 'usr_deleted' });
    });
});

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref, shallowReactive } from 'vue';

const state = vi.hoisted(() => ({
    watchlist: null,
    licenseKey: null,
    licenseStatus: null,
    cachedUsers: null,
    showUserDialog: vi.fn(),
    getUser: vi.fn(),
    getWatchedUserCache: vi.fn(),
    setWatchedUserCache: vi.fn(),
    setCachedUser: vi.fn(),
    applyUserTrustLevel: vi.fn(),
    addWatch: vi.fn(),
    removeWatch: vi.fn(),
    routerPush: vi.fn(),
    rateWait: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    getCloudObservationSummary: vi.fn(),
    getUserHistory: vi.fn()
}));

vi.mock('pinia', () => ({
    storeToRefs: (store) => store
}));

vi.mock('vue-router', () => ({
    useRouter: () => ({ push: (...args) => state.routerPush(...args) })
}));

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key) => key })
}));

vi.mock('vue-sonner', () => ({
    toast: {
        error: (...args) => state.toastError(...args),
        success: (...args) => state.toastSuccess(...args)
    }
}));

vi.mock('@/components/ui/avatar', () => ({
    Avatar: { template: '<span><slot /></span>' },
    AvatarImage: { props: ['src'], template: '<img :src="src" />' },
    AvatarFallback: { template: '<span><slot /></span>' }
}));

vi.mock('@/components/ui/button', () => ({
    buttonVariants: () => '',
    Button: {
        emits: ['click'],
        template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>'
    }
}));

vi.mock('@/components/ui/input', () => ({
    Input: {
        props: ['modelValue'],
        emits: ['update:modelValue'],
        template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keydown.enter="$emit(\'keydown\', $event)" />'
    }
}));

vi.mock('@/components/ui/label', () => ({
    Label: { template: '<label><slot /></label>' }
}));

vi.mock('../../../components/IconFrame.vue', () => ({
    default: { template: '<span class="icon-frame" />' }
}));

vi.mock('../../../components/Location.vue', () => ({
    default: { props: ['location'], template: '<span class="location">{{ location }}</span>' }
}));

vi.mock('@/components/ui/item', () => ({
    Item: { template: '<div class="item"><slot /></div>' },
    ItemActions: { template: '<div><slot /></div>' },
    ItemContent: { template: '<div><slot /></div>' },
    ItemDescription: { template: '<p><slot /></p>' },
    ItemMedia: { template: '<div><slot /></div>' },
    ItemTitle: { template: '<div><slot /></div>' }
}));

vi.mock('../../../composables/useUserDisplay', () => ({
    useUserDisplay: () => ({ userImage: (user) => user?.iconUrl || '' })
}));

vi.mock('../../../stores', () => ({
    useUserStore: () => ({
        cachedUsers: state.cachedUsers,
        setCachedUser: state.setCachedUser
    }),
    useAppearanceSettingsStore: () => ({
        randomUserColours: ref(false),
        applyUserTrustLevel: state.applyUserTrustLevel
    }),
    useDLCXSettingsStore: () => ({
        watchlist: state.watchlist,
        licenseKey: state.licenseKey,
        licenseStatus: state.licenseStatus,
        addWatch: state.addWatch,
        removeWatch: state.removeWatch
    })
}));

vi.mock('../../../coordinators/userCoordinator', () => ({
    showUserDialog: (...args) => state.showUserDialog(...args)
}));

vi.mock('../../../api', () => ({
    userRequest: { getUser: (...args) => state.getUser(...args) }
}));

vi.mock('../../../services/database', () => ({
    database: {
        getWatchedUserCache: (...args) => state.getWatchedUserCache(...args),
        setWatchedUserCache: (...args) => state.setWatchedUserCache(...args)
    }
}));

vi.mock('../../../services/dlcxUserCardData', () => ({
    isDLCXLicenseAvailable: ({ licenseKey, licenseStatus }) =>
        Boolean(String(licenseKey || '').trim()) && ['ok', 'unknown', 'checking'].includes(licenseStatus),
    getCloudObservationSummary: (...args) => state.getCloudObservationSummary(...args)
}));

vi.mock('../../../services/dlcxApi', () => ({
    getUserHistory: (...args) => state.getUserHistory(...args)
}));

vi.mock('../../../shared/utils', () => ({
    languageClass: (key) => `flag-${key}`
}));

vi.mock('../../../shared/utils/retry', () => ({
    executeWithBackoff: (fn) => fn()
}));

vi.mock('../../../shared/utils/throttle', () => ({
    createRateLimiter: () => ({ wait: (...args) => state.rateWait(...args) })
}));

import WatchedUsersPage from '../WatchedUsersPage.vue';

describe('WatchedUsersPage.vue', () => {
    beforeEach(() => {
        state.watchlist = ref([]);
        state.licenseKey = ref('license');
        state.licenseStatus = ref('ok');
        state.cachedUsers = shallowReactive(new Map());
        state.showUserDialog.mockReset();
        state.getUser.mockReset();
        state.getUser.mockResolvedValue({});
        state.getWatchedUserCache.mockReset().mockResolvedValue([]);
        state.setWatchedUserCache.mockReset().mockResolvedValue('');
        state.setCachedUser.mockReset().mockImplementation((user) => {
            state.cachedUsers.set(user.id, user);
        });
        state.applyUserTrustLevel.mockReset().mockImplementation((user) => {
            const trustLevels = {
                system_trust_basic: 'New User',
                system_trust_known: 'User',
                system_trust_trusted: 'Known User',
                system_trust_veteran: 'Trusted User'
            };
            user.$trustLevel = trustLevels[user.tags[0]] || 'Visitor';
            user.$trustClass = user.tags[0] ? `trust-${user.tags[0]}` : 'trust-untrusted';
        });
        state.rateWait.mockReset();
        state.rateWait.mockResolvedValue(undefined);
        state.routerPush.mockReset();
        state.toastError.mockReset();
        state.toastSuccess.mockReset();
        state.getCloudObservationSummary.mockReset().mockResolvedValue(null);
        state.getUserHistory.mockReset().mockResolvedValue({ user: null, history: [] });
        state.addWatch.mockReset();
        state.addWatch.mockImplementation((id) => {
            const userId = String(id).trim().toLowerCase();
            if (state.watchlist.value.includes(userId)) {
                return false;
            }
            state.watchlist.value = [...state.watchlist.value, userId];
            return true;
        });
        state.removeWatch.mockReset();
        state.removeWatch.mockImplementation((id) => {
            if (!state.watchlist.value.includes(id)) {
                return false;
            }
            state.watchlist.value = state.watchlist.value.filter((userId) => userId !== id);
            return true;
        });
    });

    test('shows a settings prompt and skips profile requests without a usable license', async () => {
        state.licenseKey.value = '';
        state.watchlist.value = ['usr_abc'];
        const wrapper = mount(WatchedUsersPage);
        await flushPromises();

        expect(wrapper.text()).toContain('view.feed.watched.license_required_title');
        expect(wrapper.find('input').exists()).toBe(false);
        expect(state.getUser).not.toHaveBeenCalled();

        await wrapper.get('button').trigger('click');
        expect(state.routerPush).toHaveBeenCalledWith({ name: 'settings', query: { tab: 'dlcx' } });
    });

    test('shows the empty cloud watchlist guide', () => {
        const wrapper = mount(WatchedUsersPage);

        expect(wrapper.text()).toContain('view.feed.watched.empty_title');
        expect(wrapper.text()).toContain('view.feed.watched.guide_add');
        expect(wrapper.text()).toContain('view.feed.watched.guide_load');
        expect(wrapper.text()).toContain('view.feed.watched.guide_alerts');
        expect(wrapper.text()).not.toContain('view.feed.watched.count');
    });

    test('renders cloud watchlist entries with cached display names', () => {
        state.watchlist.value = ['usr_abc'];
        state.cachedUsers.set('usr_abc', { id: 'usr_abc', displayName: 'Cached Name' });

        const wrapper = mount(WatchedUsersPage);

        expect(wrapper.findAll('.item')).toHaveLength(1);
        expect(wrapper.text()).toContain('Cached Name');
        expect(wrapper.text()).toContain('usr_abc');
        expect(wrapper.text()).toContain('view.feed.watched.count');
        expect(state.getUser).not.toHaveBeenCalled();
    });

    test('hydrates fresh persistent users for instant display without API requests', async () => {
        state.watchlist.value = ['usr_cached'];
        state.getWatchedUserCache.mockResolvedValue([
            {
                userId: 'usr_cached',
                displayName: 'Persistent Name',
                avatarUrl: 'https://example.com/persistent.png',
                languageTags: [{ key: 'eng', value: 'English' }],
                trust: 'system_trust_trusted',
                updatedAt: new Date().toISOString()
            },
            {
                userId: 'usr_not_watched',
                displayName: 'Not Watched',
                avatarUrl: '',
                languageTags: [],
                trust: '',
                updatedAt: new Date().toISOString()
            }
        ]);

        const wrapper = mount(WatchedUsersPage);
        await flushPromises();

        expect(wrapper.text()).toContain('Persistent Name');
        expect(wrapper.get('.item img').attributes('src')).toBe('https://example.com/persistent.png');
        expect(wrapper.text()).toContain('Known User');
        expect(wrapper.get('.flags').attributes('title')).toBe('English');
        expect(state.cachedUsers.has('usr_not_watched')).toBe(false);
        expect(state.setCachedUser).toHaveBeenCalledTimes(1);
        expect(state.getUser).not.toHaveBeenCalled();
    });

    test('fetches missing users before stale users and persists successful API profiles', async () => {
        const freshDate = new Date().toISOString();
        const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
        state.watchlist.value = ['usr_stale', 'usr_fresh', 'usr_new'];
        state.getWatchedUserCache.mockResolvedValue([
            {
                userId: 'usr_stale',
                displayName: 'Stale Name',
                avatarUrl: 'https://example.com/stale.png',
                languageTags: [],
                trust: 'system_trust_basic',
                updatedAt: staleDate
            },
            {
                userId: 'usr_fresh',
                displayName: 'Fresh Name',
                avatarUrl: 'https://example.com/fresh.png',
                languageTags: [],
                trust: 'system_trust_known',
                updatedAt: freshDate
            }
        ]);
        state.getUser.mockImplementation(async ({ userId }) => {
            const ref = {
                id: userId,
                displayName: `${userId} refreshed`,
                iconUrl: `https://example.com/${userId}.png`,
                tags: ['system_trust_veteran'],
                $languages: [{ key: 'jpn', value: 'Japanese' }]
            };
            state.cachedUsers.set(userId, ref);
            return { ref };
        });

        const wrapper = mount(WatchedUsersPage);
        await flushPromises();

        expect(state.getUser.mock.calls.map(([params]) => params.userId)).toEqual(['usr_new', 'usr_stale']);
        expect(wrapper.text()).toContain('usr_stale refreshed');
        expect(wrapper.text()).toContain('Fresh Name');
        expect(state.setWatchedUserCache).toHaveBeenCalledTimes(2);
        expect(state.setWatchedUserCache).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'usr_stale',
                displayName: 'usr_stale refreshed',
                avatarUrl: 'https://example.com/usr_stale.png',
                languageTags: [{ key: 'jpn', value: 'Japanese' }],
                trust: 'system_trust_veteran'
            })
        );
    });

    test('paginates watched users in pages of 20 and clamps a removed last page', async () => {
        state.watchlist.value = Array.from({ length: 21 }, (_, index) => `usr_${index + 1}`);
        for (const userId of state.watchlist.value) {
            state.cachedUsers.set(userId, {
                id: userId,
                displayName: userId
            });
        }
        const wrapper = mount(WatchedUsersPage);
        await flushPromises();

        expect(wrapper.findAll('.item')).toHaveLength(20);
        expect(wrapper.text()).not.toContain('usr_21');

        const secondPage = wrapper.findAll('button').find((button) => button.text() === '2');
        await secondPage.trigger('click');

        expect(wrapper.findAll('.item')).toHaveLength(1);
        expect(wrapper.text()).toContain('usr_21');

        state.removeWatch('usr_21');
        await flushPromises();

        expect(wrapper.findAll('.item')).toHaveLength(20);
        expect(wrapper.text()).toContain('usr_1');
    });

    test('renders the shared user-card badges and cloud observation summary', async () => {
        state.watchlist.value = ['usr_abc'];
        state.cachedUsers.set('usr_abc', {
            id: 'usr_abc',
            displayName: 'Cached Name',
            $trustLevel: 'Trusted',
            $trustClass: 'trust-trusted',
            $languages: [{ key: 'eng', value: 'English' }]
        });
        state.getCloudObservationSummary.mockResolvedValue({
            firstSeen: '2026-01-01T00:00:00.000Z',
            lastSeen: '2026-11-20T12:30:00.000Z',
            lastLocation: 'wrld_test:12345'
        });

        const wrapper = mount(WatchedUsersPage);
        await flushPromises();

        expect(wrapper.text()).toContain('Trusted');
        expect(wrapper.get('.flags').attributes('title')).toBe('English');
        expect(wrapper.text()).toContain('view.feed.watched.last_seen');
        expect(wrapper.get('.location').text()).toBe('wrld_test:12345');
        expect(state.getCloudObservationSummary).toHaveBeenCalledWith('usr_abc');
    });

    test('lazy-loads cloud history only when a card expands and caches the result', async () => {
        state.watchlist.value = ['usr_abc'];
        state.getUserHistory.mockResolvedValue({
            user: {},
            history: [
                { at: '2026-11-19T10:00:00.000Z', location: 'wrld_old:1', world_id: 'wrld_old' },
                { at: '2026-11-20T10:00:00.000Z', location: 'wrld_new:2', world_id: 'wrld_new' }
            ]
        });
        const wrapper = mount(WatchedUsersPage);
        await flushPromises();

        expect(state.getUserHistory).not.toHaveBeenCalled();
        expect(wrapper.text()).not.toContain('view.feed.watched.history_title');

        const toggle = wrapper.get('[data-testid="watched-user-toggle-usr_abc"]');
        await toggle.trigger('click');
        await flushPromises();

        expect(state.getUserHistory).toHaveBeenCalledWith('usr_abc', 50);
        expect(wrapper.text()).toContain('view.feed.watched.history_title');
        expect(wrapper.findAll('.location').map((node) => node.text())).toEqual(['wrld_new:2', 'wrld_old:1']);

        await toggle.trigger('click');
        await toggle.trigger('click');
        expect(state.getUserHistory).toHaveBeenCalledTimes(1);
    });

    test('allows a failed lazy history request to be retried', async () => {
        state.watchlist.value = ['usr_abc'];
        state.getUserHistory.mockRejectedValueOnce(new Error('offline'));
        const wrapper = mount(WatchedUsersPage);
        await flushPromises();

        await wrapper.get('[data-testid="watched-user-toggle-usr_abc"]').trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain('view.feed.watched.history_error');

        const retry = wrapper.findAll('button').find((button) => button.text() === 'view.feed.watched.retry');
        await retry.trigger('click');
        await flushPromises();

        expect(state.getUserHistory).toHaveBeenCalledTimes(2);
        expect(wrapper.text()).toContain('view.feed.watched.history_empty');
    });

    test('fetches missing users once and automatically backfills names and avatars', async () => {
        state.watchlist.value = ['usr_abc', 'usr_cached'];
        state.cachedUsers.set('usr_cached', { id: 'usr_cached', displayName: 'Already Cached' });
        state.getUser.mockImplementation(async ({ userId }) => {
            state.cachedUsers.set(userId, {
                id: userId,
                displayName: 'Fetched Name',
                iconUrl: 'https://example.com/avatar.png'
            });
            return {};
        });

        const wrapper = mount(WatchedUsersPage);
        await flushPromises();

        expect(state.getUser).toHaveBeenCalledTimes(1);
        expect(state.getUser).toHaveBeenCalledWith({ userId: 'usr_abc' });
        expect(wrapper.text()).toContain('Fetched Name');
        expect(wrapper.get('.item img').attributes('src')).toBe('https://example.com/avatar.png');
    });

    test('loads the missing batch sequentially without concurrent requests', async () => {
        state.watchlist.value = ['usr_a', 'usr_b'];
        let resolveFirst;
        state.getUser.mockImplementation(
            ({ userId }) =>
                new Promise((resolve) => {
                    if (userId === 'usr_a') {
                        resolveFirst = () => {
                            state.cachedUsers.set(userId, { id: userId, displayName: 'A' });
                            resolve({});
                        };
                    } else {
                        state.cachedUsers.set(userId, { id: userId, displayName: 'B' });
                        resolve({});
                    }
                })
        );

        mount(WatchedUsersPage);
        await flushPromises();
        expect(state.getUser).toHaveBeenCalledTimes(1);
        expect(state.getUser).toHaveBeenLastCalledWith({ userId: 'usr_a' });

        resolveFirst();
        await flushPromises();
        expect(state.getUser).toHaveBeenCalledTimes(2);
        expect(state.getUser).toHaveBeenLastCalledWith({ userId: 'usr_b' });
    });

    test('fetches users added to the cloud list after mount', async () => {
        const wrapper = mount(WatchedUsersPage);
        await flushPromises();

        state.watchlist.value = ['usr_new'];
        await flushPromises();

        expect(state.getUser).toHaveBeenCalledWith({ userId: 'usr_new' });
        expect(wrapper.text()).toContain('usr_new');
    });

    test('opens the user profile when the player name is clicked', async () => {
        state.watchlist.value = ['usr_abc'];
        const wrapper = mount(WatchedUsersPage);
        await flushPromises();

        await wrapper.get('.item button').trigger('click');
        expect(state.showUserDialog).toHaveBeenCalledWith('usr_abc');
    });

    test('removes a player directly from the cloud watchlist', async () => {
        state.watchlist.value = ['usr_abc'];
        const wrapper = mount(WatchedUsersPage);
        await flushPromises();

        const buttons = wrapper.findAll('.item button');
        await buttons[buttons.length - 1].trigger('click');

        expect(state.removeWatch).toHaveBeenCalledWith('usr_abc');
        expect(state.watchlist.value).toEqual([]);
        expect(state.toastSuccess).toHaveBeenCalledWith('view.feed.watched.removed');
    });

    test('rejects malformed user ids', async () => {
        const wrapper = mount(WatchedUsersPage);

        await wrapper.get('input').setValue('not-a-user');
        await wrapper.get('button').trigger('click');

        expect(state.toastError).toHaveBeenCalledWith('view.feed.watched.invalid_id');
        expect(state.addWatch).not.toHaveBeenCalled();
    });

    test('rejects duplicate user ids', async () => {
        state.watchlist.value = ['usr_abc'];
        const wrapper = mount(WatchedUsersPage);
        await flushPromises();

        await wrapper.get('input').setValue('usr_abc');
        await wrapper.findAll('button')[0].trigger('click');

        expect(state.toastError).toHaveBeenCalledWith('view.feed.watched.duplicate_id');
        expect(state.watchlist.value).toEqual(['usr_abc']);
    });

    test('adds a normalized user id directly to the cloud list and clears the input', async () => {
        const wrapper = mount(WatchedUsersPage);

        await wrapper.get('input').setValue('  USR_ABC-123  ');
        await wrapper.findAll('button')[0].trigger('click');

        expect(state.addWatch).toHaveBeenCalledWith('usr_abc-123');
        expect(state.watchlist.value).toEqual(['usr_abc-123']);
        expect(state.toastSuccess).toHaveBeenCalledWith('view.feed.watched.added');
        expect(wrapper.get('input').element.value).toBe('');
    });
});

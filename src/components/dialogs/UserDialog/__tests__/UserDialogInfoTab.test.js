import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createTestingPinia } from '@pinia/testing';
import { flushPromises, shallowMount } from '@vue/test-utils';

const dlcxMocks = vi.hoisted(() => ({
    getUserHistory: vi.fn()
}));

vi.mock('../../../../services/dlcxApi', () => ({
    getUserHistory: dlcxMocks.getUserHistory
}));

vi.mock('vue-i18n', () => ({
    useI18n: () => {
        const { ref } = require('vue');
        return {
            t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
            locale: ref('en')
        };
    },
    createI18n: () => ({
        global: { t: (key) => key },
        install: vi.fn()
    })
}));

vi.mock('../../../../plugins/router', () => {
    const { ref } = require('vue');
    return {
        router: {
            beforeEach: vi.fn(),
            push: vi.fn(),
            replace: vi.fn(),
            currentRoute: ref({ path: '/', name: '', meta: {} }),
            isReady: vi.fn().mockResolvedValue(true)
        },
        initRouter: vi.fn()
    };
});

vi.mock('vue-router', async (importOriginal) => {
    const actual = await importOriginal();
    const { ref } = require('vue');
    return {
        ...actual,
        useRouter: vi.fn(() => ({
            push: vi.fn(),
            replace: vi.fn(),
            currentRoute: ref({ path: '/', name: '', meta: {} })
        }))
    };
});

vi.mock('../../../../plugins/interopApi', () => ({ initInteropApi: vi.fn() }));
vi.mock('../../../../services/database', () => ({
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

vi.mock('../../../../services/config', () => ({
    default: {
        init: vi.fn(),
        getString: vi.fn().mockImplementation((_k, d) => d ?? '{}'),
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

vi.mock('../../../../services/jsonStorage', () => ({ default: vi.fn() }));
vi.mock('../../../../services/watchState', () => ({
    watchState: { isLoggedIn: false }
}));
vi.mock('../../../../services/request', () => ({
    request: vi.fn().mockResolvedValue({ json: {} }),
    processBulk: vi.fn(),
    buildRequestInit: vi.fn(),
    parseResponse: vi.fn(),
    shouldIgnoreError: vi.fn(),
    $throw: vi.fn(),
    failedGetRequests: new Map()
}));

import UserDialogInfoTab from '../UserDialogInfoTab.vue';
import { queryRequest } from '../../../../api';
import {
    useAdvancedSettingsStore,
    useAppearanceSettingsStore,
    useLocationStore,
    useModalStore,
    useDLCXSettingsStore,
    useUserStore
} from '../../../../stores';
import { clearCloudObservationCache } from '../../../../services/dlcxUserCardData';

/**
 * @param overrides
 */
function mountComponent(overrides = {}) {
    const pinia = createTestingPinia({
        stubActions: true
    });

    const appearanceSettingsStore = useAppearanceSettingsStore(pinia);
    appearanceSettingsStore.$patch({
        hideUserNotes: false,
        hideUserMemos: false
    });

    const advancedSettingsStore = useAdvancedSettingsStore(pinia);
    advancedSettingsStore.$patch({
        bioLanguage: 'en',
        translationApi: '',
        translationApiType: 'google'
    });
    const advancedSettings = advancedSettingsStore;
    advancedSettings.translateText = vi.fn().mockResolvedValue('');

    const dlcxSettingsStore = useDLCXSettingsStore(pinia);
    dlcxSettingsStore.$patch({
        licenseKey: '',
        licenseStatus: 'unknown',
        enableTrace: true,
        ...overrides.dlcx
    });

    const userStore = useUserStore(pinia);
    userStore.$patch({
        userDialog: {
            id: 'usr_target',
            friend: {
                state: 'online',
                ref: {
                    location: 'wrld_test:123'
                }
            },
            ref: {
                id: 'usr_target',
                location: 'wrld_test:123',
                travelingToLocation: '',
                profilePicOverride: '',
                currentAvatarImageUrl: '',
                currentAvatarTags: [],
                bio: '',
                bioLinks: [],
                state: 'online',
                $online_for: 1000,
                last_login: '2025-01-01T00:00:00.000Z',
                last_activity: '2025-01-01T00:00:00.000Z',
                date_joined: '2020-01-01',
                allowAvatarCopying: true,
                displayName: 'Target'
            },
            $location: {
                tag: 'wrld_test:123',
                shortName: 'Test',
                userId: '',
                user: null
            },
            instance: {
                ref: {},
                friendCount: 0
            },
            users: [
                {
                    id: 'usr_friend_1',
                    displayName: 'Friend A',
                    $userColour: '#ffffff',
                    location: 'traveling',
                    $travelingToTime: Date.now(),
                    $location_at: Date.now()
                }
            ],
            note: '',
            memo: '',
            isRepresentedGroupLoading: false,
            representedGroup: null,
            lastSeen: '2025-01-01T00:00:00.000Z',
            joinCount: 0,
            timeSpent: 0,
            dateFriendedInfo: [],
            unFriended: false,
            dateFriended: '2025-01-01T00:00:00.000Z',
            $homeLocationName: '',
            ...overrides.userDialog
        },
        currentUser: {
            id: 'usr_me',
            allowAvatarCopying: true,
            isBoopingEnabled: true,
            hasSharedConnectionsOptOut: false,
            hasDiscordFriendsOptOut: false,
            homeLocation: '',
            ...overrides.currentUser
        }
    });

    const locationStore = useLocationStore(pinia);
    locationStore.$patch({
        lastLocation: {
            location: 'wrld_test:123'
        }
    });

    const modal = useModalStore(pinia);
    modal.confirm = vi.fn().mockResolvedValue({ ok: false });

    return shallowMount(UserDialogInfoTab, {
        global: {
            plugins: [pinia],
            stubs: {
                Location: true,
                Timer: true,
                TooltipWrapper: true,
                AvatarInfo: true
            }
        }
    });
}

describe('UserDialogInfoTab.vue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearCloudObservationCache();
        dlcxMocks.getUserHistory.mockReset().mockResolvedValue({ user: null, history: [] });
    });

    describe('unit behavior', () => {
        test('onTabActivated fetches VRChat credits only once after first success', async () => {
            const creditsSpy = vi.spyOn(queryRequest, 'fetch').mockResolvedValue({ json: { balance: 42 } });
            const wrapper = mountComponent();

            wrapper.vm.onTabActivated();
            await flushPromises();
            wrapper.vm.onTabActivated();
            await flushPromises();

            expect(creditsSpy).toHaveBeenCalledTimes(0);
            expect(dlcxMocks.getUserHistory).not.toHaveBeenCalled();
        });

        test('renders the cloud observation row for a trace-enabled other user', async () => {
            dlcxMocks.getUserHistory.mockResolvedValue({
                user: {
                    first_seen: '2026-01-01T00:00:00.000Z',
                    last_seen: '2026-11-22T00:00:00.000Z'
                },
                history: []
            });
            const wrapper = mountComponent({ dlcx: { licenseKey: 'key', licenseStatus: 'unknown' } });
            await flushPromises();
            useDLCXSettingsStore().$patch({
                licenseKey: 'key',
                licenseStatus: 'unknown',
                enableTrace: true
            });

            wrapper.vm.onTabActivated();
            await flushPromises();

            expect(dlcxMocks.getUserHistory).toHaveBeenCalledWith('usr_target', 1);
            expect(wrapper.text()).toContain('dialog.user.info.cloud_observation');
            expect(wrapper.text()).toContain('dialog.user.info.cloud_observation_last');
            expect(wrapper.text()).not.toContain('dialog.user.info.cloud_observation_summary');
        });

        test('hides cloud observation when only first-seen data is available', async () => {
            dlcxMocks.getUserHistory.mockResolvedValue({
                user: { first_seen: '2026-01-01T00:00:00.000Z', last_seen: '' },
                history: []
            });
            const wrapper = mountComponent({ dlcx: { licenseKey: 'key', licenseStatus: 'ok' } });
            await flushPromises();
            useDLCXSettingsStore().$patch({
                licenseKey: 'key',
                licenseStatus: 'ok',
                enableTrace: true
            });

            wrapper.vm.onTabActivated();
            await flushPromises();

            expect(wrapper.text()).not.toContain('dialog.user.info.cloud_observation');
            expect(wrapper.text()).not.toContain('dialog.user.info.cloud_observation_first');
            expect(wrapper.text()).not.toContain('dialog.user.info.cloud_observation_summary');
            expect(wrapper.text()).not.toContain('dialog.user.info.cloud_observation_last');
        });

        test('hides the cloud observation row for empty or failed cloud data', async () => {
            const wrapper = mountComponent({ dlcx: { licenseKey: 'key', licenseStatus: 'ok' } });
            wrapper.vm.onTabActivated();
            await flushPromises();
            expect(wrapper.text()).not.toContain('dialog.user.info.cloud_observation');

            const failedWrapper = mountComponent({ dlcx: { licenseKey: 'key', licenseStatus: 'ok' } });
            dlcxMocks.getUserHistory.mockRejectedValueOnce(new Error('offline'));
            failedWrapper.vm.onTabActivated();
            await flushPromises();
            expect(failedWrapper.text()).not.toContain('dialog.user.info.cloud_observation');
        });

        test.each(['invalid', 'expired', 'offline'])(
            'stays invisible without requests for %s licenses',
            async (status) => {
                const wrapper = mountComponent({ dlcx: { licenseKey: 'key', licenseStatus: status } });
                wrapper.vm.onTabActivated();
                await flushPromises();
                expect(dlcxMocks.getUserHistory).not.toHaveBeenCalled();
                expect(wrapper.text()).not.toContain('dialog.user.info.cloud_observation');
            }
        );
    });

    describe('dom rendering', () => {
        test('renders Markdown and raw bio URLs as safe clickable anchors', () => {
            const wrapper = mountComponent({
                userDialog: {
                    publicProfileRef: {
                        bio: 'Site: [Example](https://example.com) and https://example.org.'
                    }
                }
            });

            const links = wrapper.findAll('pre a');
            expect(links).toHaveLength(2);
            expect(links[0].attributes('href')).toBe('https://example.com');
            expect(links[0].attributes('target')).toBe('_blank');
            expect(links[0].attributes('rel')).toBe('noopener noreferrer');
            expect(links[0].text()).toBe('Example');
            expect(links[1].attributes('href')).toBe('https://example.org');
            expect(wrapper.text()).toContain('and');
        });

        test('renders bioLinks as visible chips with middle-truncated URLs and full titles', () => {
            const shortUrl = 'https://example.com/profile';
            const longUrl = `https://example.com/${'very-long-segment/'.repeat(8)}profile`;
            const wrapper = mountComponent({
                userDialog: {
                    publicProfileRef: {
                        bio: '',
                        bioLinks: [shortUrl, longUrl]
                    }
                }
            });

            const chips = wrapper.findAll('a[title]');
            expect(chips).toHaveLength(2);
            expect(chips[0].attributes('href')).toBe(shortUrl);
            expect(chips[0].attributes('target')).toBe('_blank');
            expect(chips[0].attributes('rel')).toBe('noopener noreferrer');
            expect(chips[0].text()).toContain(shortUrl);
            expect(chips[0].find('img').exists()).toBe(true);
            expect(chips[1].attributes('title')).toBe(longUrl);
            expect(chips[1].text()).toContain('…');
            expect(chips[1].text()).not.toContain(longUrl);
        });

        test('renders imported InstanceActionBar and Spinner components when conditions are met', () => {
            const wrapper = mountComponent();

            expect(wrapper.find('instance-action-bar-stub').exists()).toBe(true);
            expect(wrapper.find('spinner-stub').exists()).toBe(true);
        });
    });
});

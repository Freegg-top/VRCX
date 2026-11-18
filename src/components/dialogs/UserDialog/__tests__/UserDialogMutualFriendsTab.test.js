import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';

// ─── Mocks ───────────────────────────────────────────────────────────

vi.mock('vue-i18n', () => ({
    useI18n: () => ({
        t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
        locale: require('vue').ref('en')
    }),
    createI18n: () => ({
        global: { t: (key) => key, locale: require('vue').ref('en') },
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

// 可配置的 database mock: 默认所有方法 resolve null, 测试中可覆盖单个方法
// (vi.hoisted: mock 工厂会被提升到文件顶部, 变量需随之提升)
const databaseMockHandlers = vi.hoisted(() => ({
    getMutualGraphMeta: vi.fn().mockResolvedValue(new Map()),
    getMutualsForFriend: vi.fn().mockResolvedValue(null),
    updateMutualsForFriend: vi.fn().mockResolvedValue(undefined),
    upsertMutualGraphMeta: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../../../../services/database', () => ({
    database: new Proxy(databaseMockHandlers, {
        get: (target, prop) => {
            if (prop === '__esModule') return false;
            if (prop in target) return target[prop];
            return vi.fn().mockResolvedValue(null);
        }
    })
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

import { processBulk } from '../../../../services/request';

import * as userCoordinatorModule from '../../../../coordinators/userCoordinator';
vi.mock('../../../../coordinators/userCoordinator', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, showUserDialog: vi.fn() };
});

import UserDialogMutualFriendsTab from '../UserDialogMutualFriendsTab.vue';
import { useFriendStore, useUserStore } from '../../../../stores';
import { userDialogMutualFriendSortingOptions } from '../../../../shared/constants';

// ─── Helpers ─────────────────────────────────────────────────────────

const MOCK_MUTUAL_FRIENDS = [
    {
        id: 'usr_1',
        displayName: 'Charlie',
        $userColour: '#ff0000',
        currentAvatarThumbnailImageUrl: 'https://img/charlie.png'
    },
    {
        id: 'usr_2',
        displayName: 'Alice',
        $userColour: '#00ff00',
        currentAvatarThumbnailImageUrl: 'https://img/alice.png'
    },
    {
        id: 'usr_3',
        displayName: 'Bob',
        $userColour: '#0000ff',
        currentAvatarThumbnailImageUrl: 'https://img/bob.png'
    }
];

/**
 * @param overrides
 */
function mountComponent(overrides = {}) {
    const pinia = createTestingPinia({
        stubActions: false
    });

    const userStore = useUserStore(pinia);
    userStore.$patch({
        userDialog: {
            id: 'usr_target',
            ref: { id: 'usr_target' },
            mutualFriends: [...MOCK_MUTUAL_FRIENDS],
            mutualFriendSorting: userDialogMutualFriendSortingOptions.alphabetical,
            isMutualFriendsLoading: false,
            ...overrides
        },
        currentUser: {
            id: 'usr_me',
            hasSharedConnectionsOptOut: false,
            ...overrides.currentUser
        }
    });

    // done(success) 分支只对当前好友落库: 把 usr_target 标为好友,
    // 使 P1-2 时序断言里的 updateMutualsForFriend 路径可达
    // (friends 是 reactive Map, 不能 $patch 替换, 直接 set)
    const friendStore = useFriendStore(pinia);
    friendStore.friends.set('usr_target', { id: 'usr_target' });

    return mount(UserDialogMutualFriendsTab, {
        global: {
            plugins: [pinia],
            stubs: {
                RefreshCw: { template: '<svg class="refresh-icon" />' }
            }
        }
    });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('UserDialogMutualFriendsTab.vue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        databaseMockHandlers.getMutualGraphMeta.mockReset().mockResolvedValue(new Map());
        databaseMockHandlers.getMutualsForFriend.mockReset().mockResolvedValue(null);
        databaseMockHandlers.updateMutualsForFriend.mockReset().mockResolvedValue(undefined);
        databaseMockHandlers.upsertMutualGraphMeta.mockReset().mockResolvedValue(undefined);
        processBulk.mockReset();
    });

    describe('rendering', () => {
        test('renders mutual friend count', () => {
            const wrapper = mountComponent();
            expect(wrapper.text()).toContain('3');
        });

        test('renders all mutual friends', () => {
            const wrapper = mountComponent();
            const items = wrapper.findAll('li');
            expect(items).toHaveLength(3);
        });

        test('renders friend display names', () => {
            const wrapper = mountComponent();
            expect(wrapper.text()).toContain('Charlie');
            expect(wrapper.text()).toContain('Alice');
            expect(wrapper.text()).toContain('Bob');
        });

        test('renders friend avatar images', () => {
            const wrapper = mountComponent();
            const images = wrapper.findAll('img');
            expect(images).toHaveLength(3);
        });

        test('applies user colour to display name', () => {
            const wrapper = mountComponent();
            const nameSpan = wrapper.find('span[style*="color"]');
            expect(nameSpan.exists()).toBe(true);
        });

        test('renders empty list when no mutual friends', () => {
            const wrapper = mountComponent({ mutualFriends: [] });
            const items = wrapper.findAll('li');
            expect(items).toHaveLength(0);
            expect(wrapper.text()).toContain('0');
        });
    });

    describe('loading state', () => {
        test('disables refresh button when loading', () => {
            const wrapper = mountComponent({ isMutualFriendsLoading: true });
            const button = wrapper.find('button');
            expect(button.attributes('disabled')).toBeDefined();
        });

        test('refresh button is enabled when not loading', () => {
            const wrapper = mountComponent({ isMutualFriendsLoading: false });
            const button = wrapper.find('button');
            expect(button.attributes('disabled')).toBeUndefined();
        });
    });

    describe('click interactions', () => {
        test('calls showUserDialog when a friend is clicked', async () => {
            const pinia = createTestingPinia({ stubActions: false });
            const userStore = useUserStore(pinia);
            userStore.$patch({
                userDialog: {
                    id: 'usr_target',
                    ref: { id: 'usr_target' },
                    mutualFriends: [...MOCK_MUTUAL_FRIENDS],
                    mutualFriendSorting: userDialogMutualFriendSortingOptions.alphabetical,
                    isMutualFriendsLoading: false
                },
                currentUser: { id: 'usr_me' }
            });
            const showUserDialogSpy = vi.spyOn(userCoordinatorModule, 'showUserDialog').mockImplementation(() => {});

            const wrapper = mount(UserDialogMutualFriendsTab, {
                global: {
                    plugins: [pinia],
                    stubs: {
                        RefreshCw: { template: '<svg class="refresh-icon" />' }
                    }
                }
            });

            const firstItem = wrapper.findAll('li')[0];
            await firstItem.trigger('click');
            expect(showUserDialogSpy).toHaveBeenCalledWith('usr_1');
        });
    });

    describe('retrospective mutuals (opted-out target)', () => {
        /**
         * 模拟抓取流程: 触发 getUserMutualFriends 并让 processBulk 立即回调 handle/done
         * @param {boolean} success
         * @param {ReturnType<typeof mount>} wrapper
         * @param {Array} fetched 抓取返回的 mutual 列表 (success 时经 handle 回填)
         */
        async function runFetch(wrapper, success, fetched = []) {
            processBulk.mockImplementation(({ handle, done }) => {
                if (success && typeof handle === 'function') {
                    handle({ json: fetched });
                }
                if (typeof done === 'function') {
                    done(success);
                }
                return Promise.resolve();
            });
            wrapper.vm.getUserMutualFriends('usr_target');
            // processBulk done -> loadRetrospectiveData 中有两个 await, 多刷几个微任务
            await vi.waitFor(() => {
                expect(processBulk).toHaveBeenCalled();
            });
            await new Promise((r) => setTimeout(r, 0));
            await wrapper.vm.$nextTick();
            await new Promise((r) => setTimeout(r, 0));
            await wrapper.vm.$nextTick();
        }

        test('shows retrospective list when target opted out (DB meta)', async () => {
            databaseMockHandlers.getMutualGraphMeta.mockResolvedValue(
                new Map([['usr_target', { lastFetchedAt: null, optedOut: true, optOutDetectedAt: '2026-01-15T00:00:00.000Z' }]])
            );
            databaseMockHandlers.getMutualsForFriend.mockResolvedValue(['usr_1', 'usr_2']);
            const wrapper = mountComponent({ mutualFriends: [] });
            await runFetch(wrapper, false);
            const text = wrapper.text();
            expect(text).toContain('dialog.user.mutual_friends.opted_out_notice');
            expect(text).toContain('opted_out_snapshot_hint');
            // 回溯名单渲染了快照中的两个用户 (无 cachedUsers 时回退为 id)
            expect(text).toContain('usr_1');
            expect(text).toContain('usr_2');
            databaseMockHandlers.getMutualGraphMeta.mockResolvedValue(new Map());
            databaseMockHandlers.getMutualsForFriend.mockResolvedValue(null);
        });

        test('hides retrospective list and shows normal list when target is not opted out', async () => {
            databaseMockHandlers.getMutualGraphMeta.mockResolvedValue(new Map());
            databaseMockHandlers.getMutualsForFriend.mockResolvedValue(['usr_1', 'usr_2']);
            const wrapper = mountComponent({ mutualFriends: [] });
            await runFetch(wrapper, true, [...MOCK_MUTUAL_FRIENDS]);
            const text = wrapper.text();
            expect(text).not.toContain('opted_out_notice');
            expect(text).not.toContain('hidden_mutuals_hint');
            expect(text).toContain('Charlie');
        });

        test('renders hidden mutuals section for members that vanished and opted out', async () => {
            // 旧快照含 usr_1..usr_4; 新抓取只剩 usr_1..usr_3; usr_4 optedOut -> Hidden Mutual
            databaseMockHandlers.getMutualGraphMeta.mockResolvedValue(
                new Map([['usr_4', { lastFetchedAt: null, optedOut: true, optOutDetectedAt: '2026-02-01T00:00:00.000Z' }]])
            );
            databaseMockHandlers.getMutualsForFriend.mockResolvedValue(['usr_1', 'usr_2', 'usr_3', 'usr_4']);
            const wrapper = mountComponent({ mutualFriends: [] });
            await runFetch(wrapper, true, [...MOCK_MUTUAL_FRIENDS]);
            const text = wrapper.text();
            expect(text).toContain('dialog.user.mutual_friends.hidden_mutuals_hint');
            expect(text).toContain('usr_4');
            // usr_1 不是 hidden, 只在主列表出现
            databaseMockHandlers.getMutualGraphMeta.mockResolvedValue(new Map());
            databaseMockHandlers.getMutualsForFriend.mockResolvedValue(null);
        });

        test('does not render hidden mutuals for members that vanished without opting out', async () => {
            // usr_4 消失但未 optedOut (可能真的解除了好友关系) -> 不应出现在 hidden 区
            databaseMockHandlers.getMutualGraphMeta.mockResolvedValue(new Map());
            databaseMockHandlers.getMutualsForFriend.mockResolvedValue(['usr_1', 'usr_2', 'usr_3', 'usr_4']);
            const wrapper = mountComponent({ mutualFriends: [] });
            await runFetch(wrapper, true, [...MOCK_MUTUAL_FRIENDS]);
            expect(wrapper.text()).not.toContain('hidden_mutuals_hint');
        });

        test('P1-2: reads old snapshot before updateMutualsForFriend overwrites it', async () => {
            // 时序断言: getMutualsForFriend 必须在 updateMutualsForFriend 之前被调,
            // 否则 Hidden Mutual diff 读到的永远是覆盖后的新数据
            const callOrder = [];
            databaseMockHandlers.getMutualsForFriend.mockImplementation(async () => {
                callOrder.push('getMutualsForFriend');
                return ['usr_1', 'usr_2', 'usr_3', 'usr_4'];
            });
            databaseMockHandlers.updateMutualsForFriend.mockImplementation(async () => {
                callOrder.push('updateMutualsForFriend');
            });
            databaseMockHandlers.getMutualGraphMeta.mockResolvedValue(
                new Map([['usr_4', { lastFetchedAt: null, optedOut: true, optOutDetectedAt: '2026-02-01T00:00:00.000Z' }]])
            );
            const wrapper = mountComponent({ mutualFriends: [] });
            await runFetch(wrapper, true, [...MOCK_MUTUAL_FRIENDS]);
            expect(callOrder).toEqual(['getMutualsForFriend', 'updateMutualsForFriend']);
            // 渲染的是差集: usr_4 在旧快照但不在新抓取 -> hidden
            expect(wrapper.text()).toContain('usr_4');
            databaseMockHandlers.getMutualGraphMeta.mockResolvedValue(new Map());
            databaseMockHandlers.getMutualsForFriend.mockResolvedValue(null);
        });

        test('P1-2: hidden diff uses pre-write snapshot even when update overwrites DB', async () => {
            // 用内存 Map 模拟真实覆盖写: 若组件在写库后才读快照, 差集必然为空
            const db = new Map([['usr_target', ['usr_1', 'usr_2', 'usr_3', 'usr_4']]]);
            databaseMockHandlers.getMutualsForFriend.mockImplementation(async (id) => db.get(id) ?? null);
            databaseMockHandlers.updateMutualsForFriend.mockImplementation(async (id, ids) => {
                db.set(id, ids);
            });
            databaseMockHandlers.getMutualGraphMeta.mockResolvedValue(
                new Map([['usr_4', { lastFetchedAt: null, optedOut: true, optOutDetectedAt: '2026-02-01T00:00:00.000Z' }]])
            );
            const wrapper = mountComponent({ mutualFriends: [] });
            await runFetch(wrapper, true, [...MOCK_MUTUAL_FRIENDS]);
            // DB 已被覆盖为新列表 (内容等价于 usr_1..usr_3, 顺序按 alphabetical 排序),
            // 但 hidden 区仍应展示 usr_4
            expect([...db.get('usr_target')].sort()).toEqual(['usr_1', 'usr_2', 'usr_3']);
            expect(wrapper.text()).toContain('hidden_mutuals_hint');
            expect(wrapper.text()).toContain('usr_4');
            databaseMockHandlers.getMutualGraphMeta.mockResolvedValue(new Map());
            databaseMockHandlers.getMutualsForFriend.mockResolvedValue(null);
            databaseMockHandlers.updateMutualsForFriend.mockResolvedValue(undefined);
        });

        test('P1-3: ignores stale callbacks when user dialog switches target mid-flight', async () => {
            let staleDone;
            processBulk.mockImplementation(({ done }) => {
                staleDone = done;
                return new Promise(() => {});
            });
            const wrapper = mountComponent({ mutualFriends: [] });
            wrapper.vm.getUserMutualFriends('usr_target');
            await vi.waitFor(() => expect(processBulk).toHaveBeenCalledTimes(1));

            const userStore = useUserStore();
            userStore.$patch({
                userDialog: {
                    id: 'usr_other',
                    ref: { id: 'usr_other' },
                    mutualFriends: [],
                    mutualFriendSorting: userDialogMutualFriendSortingOptions.alphabetical,
                    isMutualFriendsLoading: false
                }
            });
            processBulk.mockImplementation(({ done }) => {
                done(true);
                return Promise.resolve();
            });
            wrapper.vm.getUserMutualFriends('usr_other');
            await new Promise((resolve) => setTimeout(resolve, 0));

            staleDone(true);
            await new Promise((resolve) => setTimeout(resolve, 0));
            await wrapper.vm.$nextTick();
            expect(wrapper.text()).not.toContain('opted_out_notice');
            expect(wrapper.text()).not.toContain('hidden_mutuals_hint');
        });

        test('P1-4: a successful fetch clears DB opt-out state without changing snapshot time', async () => {
            databaseMockHandlers.getMutualGraphMeta.mockResolvedValue(
                new Map([
                    [
                        'usr_target',
                        {
                            lastFetchedAt: '2026-01-15T00:00:00.000Z',
                            optedOut: true,
                            optOutDetectedAt: '2026-01-16T00:00:00.000Z'
                        }
                    ]
                ])
            );
            const wrapper = mountComponent({ mutualFriends: [] });

            await runFetch(wrapper, true, [...MOCK_MUTUAL_FRIENDS]);

            expect(wrapper.text()).not.toContain('opted_out_notice');
            expect(wrapper.text()).toContain('Charlie');
            expect(databaseMockHandlers.upsertMutualGraphMeta).toHaveBeenCalledWith('usr_target', {
                optedOut: false
            });
        });

        test('P2-11: shows a normal error when fetching fails without opt-out evidence', async () => {
            const wrapper = mountComponent({ mutualFriends: [] });

            await runFetch(wrapper, false);

            expect(wrapper.text()).toContain('dialog.user.mutual_friends.fetch_failed_notice');
            expect(wrapper.text()).not.toContain('opted_out_notice');
        });

        test('P3: total count includes hidden mutuals', async () => {
            databaseMockHandlers.getMutualGraphMeta.mockResolvedValue(
                new Map([['usr_4', { lastFetchedAt: null, optedOut: true }]])
            );
            databaseMockHandlers.getMutualsForFriend.mockResolvedValue(['usr_1', 'usr_2', 'usr_3', 'usr_4']);
            const wrapper = mountComponent({ mutualFriends: [] });

            await runFetch(wrapper, true, [...MOCK_MUTUAL_FRIENDS]);

            expect(wrapper.text()).toContain('dialog.user.groups.total_count:{"count":4}');
        });

        test('P2-12: ignores retrospective metadata returned after the target changes', async () => {
            let resolveStaleMeta;
            databaseMockHandlers.getMutualGraphMeta
                .mockImplementationOnce(() => new Promise((resolve) => (resolveStaleMeta = resolve)))
                .mockResolvedValueOnce(new Map());
            processBulk.mockImplementation(({ params, handle, done }) => {
                if (params.userId === 'usr_other') {
                    handle({ json: [...MOCK_MUTUAL_FRIENDS] });
                    done(true);
                } else {
                    done(false);
                }
                return Promise.resolve();
            });
            const wrapper = mountComponent({ mutualFriends: [] });
            wrapper.vm.getUserMutualFriends('usr_target');
            await vi.waitFor(() => expect(resolveStaleMeta).toBeTypeOf('function'));

            const userStore = useUserStore();
            userStore.$patch({
                userDialog: {
                    id: 'usr_other',
                    ref: { id: 'usr_other' },
                    mutualFriends: [],
                    mutualFriendSorting: userDialogMutualFriendSortingOptions.alphabetical,
                    isMutualFriendsLoading: false
                }
            });
            wrapper.vm.getUserMutualFriends('usr_other');
            await vi.waitFor(() => expect(wrapper.text()).toContain('Charlie'));

            resolveStaleMeta(new Map([['usr_target', { optedOut: true }]]));
            await new Promise((resolve) => setTimeout(resolve, 0));
            await wrapper.vm.$nextTick();

            expect(wrapper.text()).not.toContain('opted_out_notice');
            expect(wrapper.text()).toContain('Charlie');
        });
    });
});

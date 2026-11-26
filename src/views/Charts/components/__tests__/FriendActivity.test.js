import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref, shallowReactive } from 'vue';

import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

const state = vi.hoisted(() => ({
    friends: null,
    cachedWorlds: null,
    getFriendWorldActivity: vi.fn(),
    getWorld: vi.fn(),
    showWorldDialog: vi.fn(),
    getActivityData: vi.fn()
}));

vi.mock('pinia', () => ({
    storeToRefs: (store) => store
}));

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key) => key })
}));

vi.mock('@/components/BackToTop.vue', () => ({
    default: { template: '<div />' }
}));

vi.mock('../../../../components/ui/button', () => ({
    Button: {
        template: '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
        emits: ['click']
    }
}));

vi.mock('../../../../components/ui/button-group', () => ({
    ButtonGroup: { template: '<div><slot /></div>' }
}));

vi.mock('../../../../components/ui/calendar', () => ({
    Calendar: { template: '<div />' }
}));

vi.mock('../../../../components/ui/popover', () => ({
    Popover: { template: '<div><slot /></div>' },
    PopoverContent: { template: '<div><slot /></div>' },
    PopoverTrigger: { template: '<div><slot /></div>' }
}));

vi.mock('../../../../components/ui/tooltip', () => ({
    TooltipWrapper: { template: '<div><slot /></div>' }
}));

vi.mock('../../../../components/ui/badge', () => ({
    Badge: { template: '<span><slot /></span>' }
}));

vi.mock('../../../../components/ui/virtual-combobox', () => ({
    VirtualCombobox: {
        name: 'VirtualCombobox',
        props: ['modelValue'],
        emits: ['update:modelValue'],
        template: '<div />'
    }
}));

vi.mock('../InstanceActivityDetail.vue', () => ({
    default: { template: '<div />' }
}));

vi.mock('../../../../stores', () => ({
    useAppearanceSettingsStore: () => ({ weekStartsOn: ref(1) }),
    useFriendStore: () => ({
        friends: state.friends,
        allFavoriteFriendIds: ref(new Set())
    }),
    useUserStore: () => ({
        currentUser: ref({ id: 'usr_self' })
    })
}));

vi.mock('../../../../stores/world', () => ({
    useWorldStore: () => ({ cachedWorlds: state.cachedWorlds })
}));

vi.mock('../../../../services/database', () => ({
    database: {
        getFriendWorldActivity: (...args) => state.getFriendWorldActivity(...args)
    }
}));

vi.mock('../../../../api', () => ({
    worldRequest: {
        getWorld: (...args) => state.getWorld(...args)
    }
}));

vi.mock('../../../../coordinators/worldCoordinator', () => ({
    showWorldDialog: (...args) => state.showWorldDialog(...args)
}));

vi.mock('../../../../shared/utils', async () => {
    const { parseLocation } = await import('../../../../shared/utils/locationParser');
    return {
        parseLocation,
        timeToText: (value) => `${value}ms`
    };
});

vi.mock('../../../../composables/useUserDisplay', () => ({
    useUserDisplay: () => ({ userImage: () => '' })
}));

vi.mock('../../composables/useInstanceActivityData', () => ({
    useInstanceActivityData: () => ({
        activityDetailData: ref([]),
        getActivityData: state.getActivityData
    })
}));

vi.mock('../../composables/useInstanceActivitySettings', () => ({
    useInstanceActivitySettings: () => ({ barWidth: ref(25) })
}));

import FriendActivity from '../FriendActivity.vue';

beforeAll(() => {
    dayjs.extend(duration);
    dayjs.extend(utc);
    dayjs.extend(timezone);
    dayjs.extend(isSameOrAfter);
    dayjs.tz.setDefault('UTC');
});

describe('FriendActivity world timeline', () => {
    beforeEach(() => {
        state.friends = ref(new Map([['usr_friend', { ref: { id: 'usr_friend', displayName: 'Friend' } }]]));
        state.cachedWorlds = shallowReactive(new Map());
        state.getFriendWorldActivity.mockReset();
        state.getWorld.mockReset();
        state.showWorldDialog.mockReset();
        state.getActivityData.mockReset().mockResolvedValue(undefined);
    });

    test('renders a cached cover and instance, then opens the full room location', async () => {
        const location = 'wrld_one:12345~region(use)';
        state.cachedWorlds.set('wrld_one', {
            name: 'Cached World',
            thumbnailImageUrl: 'https://example.com/256/cover.png'
        });
        state.getFriendWorldActivity.mockResolvedValue([
            {
                created_at: '2026-11-20T10:00:00.000Z',
                location,
                worldName: 'World One',
                groupName: 'Group One'
            }
        ]);
        const wrapper = mount(FriendActivity);
        await flushPromises();

        wrapper.findComponent({ name: 'VirtualCombobox' }).vm.$emit('update:modelValue', 'usr_friend');
        await flushPromises();

        expect(wrapper.get('[data-testid="friend-world-timeline"]').text()).toContain('World One');
        expect(wrapper.text()).toContain('#12345');
        expect(wrapper.text()).toContain('Group One');
        expect(wrapper.get('img').attributes('src')).toBe('https://example.com/128/cover.png');
        expect(state.getWorld).not.toHaveBeenCalled();

        await wrapper.get('[data-testid="friend-world-record-wrld_one"]').trigger('click');
        expect(state.showWorldDialog).toHaveBeenCalledWith(location);
    });

    test('fetches a missing world cover once and deduplicates adjacent records', async () => {
        const location = 'wrld_two:67890';
        const row = {
            created_at: '2026-11-20T10:00:00.000Z',
            location,
            worldName: 'World Two',
            groupName: ''
        };
        state.getFriendWorldActivity.mockResolvedValue([row, { ...row, created_at: '2026-11-20T10:01:00.000Z' }]);
        state.getWorld.mockImplementation(async ({ worldId }) => {
            state.cachedWorlds.set(worldId, {
                name: 'World Two',
                thumbnailImageUrl: 'https://example.com/world-two-256.png'
            });
            return {};
        });
        const wrapper = mount(FriendActivity);
        await flushPromises();

        wrapper.findComponent({ name: 'VirtualCombobox' }).vm.$emit('update:modelValue', 'usr_friend');
        await flushPromises();

        expect(wrapper.findAll('[data-testid="friend-world-record-wrld_two"]')).toHaveLength(1);
        expect(state.getWorld).toHaveBeenCalledTimes(1);
        expect(state.getWorld).toHaveBeenCalledWith({ worldId: 'wrld_two' });
        expect(wrapper.get('img').attributes('src')).toBe('https://example.com/world-two-128.png');
    });
});

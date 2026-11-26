import { beforeEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref, toRef } from 'vue';

const state = vi.hoisted(() => ({
    friends: null,
    rows: null,
    avatarIdsByFileId: null,
    getAvatar: vi.fn(),
    getFile: vi.fn(),
    lookupAuthorPublicFileIds: vi.fn(),
    showAvatarAuthorDialog: vi.fn()
}));

vi.mock('pinia', () => ({
    storeToRefs: (store) => Object.fromEntries(Object.keys(store).map((key) => [key, toRef(store, key)]))
}));

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key) => key })
}));

vi.mock('vue-sonner', () => ({
    toast: { warning: vi.fn() }
}));

vi.mock('../../../components/CacheedImage.vue', () => ({
    default: {
        props: ['url'],
        template: '<div><slot name="fallback" /></div>'
    }
}));

vi.mock('../../../components/ui/badge', () => ({
    Badge: { template: '<span v-bind="$attrs"><slot /></span>' }
}));

vi.mock('../../../components/ui/button', () => ({
    Button: { template: '<button><slot /></button>' }
}));

vi.mock('../../../components/ui/input', () => ({
    Input: { template: '<input />' }
}));

vi.mock('../../../components/ui/virtual-combobox', () => ({
    VirtualCombobox: {
        name: 'VirtualCombobox',
        props: ['modelValue'],
        emits: ['update:modelValue'],
        template: '<div />'
    }
}));

vi.mock('../../../stores/settings/advanced', () => ({
    useAdvancedSettingsStore: () => ({ avatarRemoteDatabase: false })
}));

vi.mock('../../../stores', () => ({
    useFriendStore: () => ({
        get friends() {
            return state.friends.value;
        }
    }),
    useUserStore: () => ({})
}));

vi.mock('../../../services/database', () => ({
    database: {
        getFriendAvatarHistory: () => Promise.resolve(state.rows)
    }
}));

vi.mock('../../../coordinators/avatarCoordinator', () => ({
    checkAvatarCache: (fileId) => state.avatarIdsByFileId.get(fileId) || '',
    lookupAuthorPublicFileIds: (...args) => state.lookupAuthorPublicFileIds(...args),
    showAvatarAuthorDialog: (...args) => state.showAvatarAuthorDialog(...args)
}));

vi.mock('../../../api', () => ({
    avatarRequest: {
        getAvatar: (...args) => state.getAvatar(...args)
    },
    miscRequest: {
        getFile: (...args) => state.getFile(...args)
    }
}));

vi.mock('../../../shared/utils', () => ({
    extractFileId: (value) => String(value).match(/file_[0-9A-Za-z-]+/)?.[0] || ''
}));

vi.mock('../../../shared/utils/throttle', () => ({
    createRateLimiter: () => ({ wait: () => Promise.resolve() })
}));

vi.mock('../../../composables/useUserDisplay', () => ({
    useUserDisplay: () => ({ userImage: () => '' })
}));

import FriendAvatars from '../FriendAvatars.vue';

function makeRow(avatarName, thumbnail = '') {
    return {
        userId: 'usr_friend',
        displayName: 'Friend',
        ownerId: 'usr_friend',
        avatarName,
        thumbnail,
        firstSeen: '2026-11-01T00:00:00.000Z',
        lastSeen: '2026-11-20T00:00:00.000Z',
        count: 1
    };
}

async function mountSelectedFriend() {
    const wrapper = mount(FriendAvatars);
    await flushPromises();
    wrapper.findComponent({ name: 'VirtualCombobox' }).vm.$emit('update:modelValue', 'usr_friend');
    await flushPromises();
    return wrapper;
}

describe('FriendAvatars deleted badge', () => {
    beforeEach(() => {
        state.friends = ref(new Map([['usr_friend', { ref: { id: 'usr_friend', displayName: 'Friend' } }]]));
        state.rows = [];
        state.avatarIdsByFileId = new Map();
        state.getAvatar.mockReset();
        state.getFile.mockReset();
        state.lookupAuthorPublicFileIds.mockReset();
        state.showAvatarAuthorDialog.mockReset();
    });

    test('marks an avatar only after its model-info request returns 404', async () => {
        state.rows = [makeRow('Deleted Avatar', 'https://example.com/file_deleted/1/image.png')];
        state.avatarIdsByFileId.set('file_deleted', 'avtr_deleted');
        state.getAvatar.mockRejectedValue(Object.assign(new Error('Avatar not found'), { status: 404 }));

        const wrapper = await mountSelectedFriend();

        expect(state.getAvatar).toHaveBeenCalledWith({
            avatarId: 'avtr_deleted'
        });
        expect(wrapper.get('[data-testid="deleted-avatar-badge"]').text()).toBe('view.friend_avatars.deleted_badge');
    });

    test('does not mark network failures or avatars without a resolvable model ID', async () => {
        state.rows = [
            makeRow('Network Avatar', 'https://example.com/file_network/1/image.png'),
            makeRow('No Cover Avatar')
        ];
        state.avatarIdsByFileId.set('file_network', 'avtr_network');
        state.getAvatar.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }));

        const wrapper = await mountSelectedFriend();

        expect(state.getAvatar).toHaveBeenCalledTimes(1);
        expect(state.getAvatar).toHaveBeenCalledWith({
            avatarId: 'avtr_network'
        });
        expect(wrapper.find('[data-testid="deleted-avatar-badge"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('No Cover Avatar');
    });

    test('marks deleted private avatars by cover file 404 when no avatar ID is resolvable', async () => {
        state.rows = [
            makeRow('阴湿妹FT', 'https://example.com/file_5d240d09/1/file'),
            makeRow('Kaguya_FT', 'https://example.com/file_f5d7fe02/1/file')
        ];
        state.getFile.mockRejectedValue(Object.assign(new Error('File not found'), { status: 404 }));

        const wrapper = await mountSelectedFriend();

        expect(state.getAvatar).not.toHaveBeenCalled();
        expect(state.getFile).toHaveBeenCalledWith({ fileId: 'file_5d240d09' });
        expect(state.getFile).toHaveBeenCalledWith({ fileId: 'file_f5d7fe02' });
        expect(wrapper.findAll('[data-testid="deleted-avatar-badge"]')).toHaveLength(2);
    });

    test('does not mark cover file failures other than 404', async () => {
        state.rows = [
            makeRow('Existing Private Avatar', 'https://example.com/file_existing/1/file'),
            makeRow('Forbidden Avatar', 'https://example.com/file_forbidden/1/file')
        ];
        state.getFile.mockImplementation(({ fileId }) => {
            if (fileId === 'file_forbidden') {
                return Promise.reject(Object.assign(new Error('forbidden'), { status: 403 }));
            }
            return Promise.resolve({ json: {} });
        });

        const wrapper = await mountSelectedFriend();

        expect(state.getFile).toHaveBeenCalledTimes(2);
        expect(wrapper.find('[data-testid="deleted-avatar-badge"]').exists()).toBe(false);
    });

    test('prefers avatar ID status and does not probe the cover file when an ID exists', async () => {
        state.rows = [makeRow('Alive Avatar', 'https://example.com/file_alive/1/file')];
        state.avatarIdsByFileId.set('file_alive', 'avtr_alive');
        state.getAvatar.mockResolvedValue({ json: { id: 'avtr_alive' } });
        state.getFile.mockRejectedValue(Object.assign(new Error('File not found'), { status: 404 }));

        const wrapper = await mountSelectedFriend();

        expect(state.getAvatar).toHaveBeenCalledWith({ avatarId: 'avtr_alive' });
        expect(state.getFile).not.toHaveBeenCalled();
        expect(wrapper.find('[data-testid="deleted-avatar-badge"]').exists()).toBe(false);
    });

    test('does not mark non-404 HTTP errors as deleted', async () => {
        state.rows = [makeRow('Server Error Avatar', 'https://example.com/file_error/1/image.png')];
        state.avatarIdsByFileId.set('file_error', 'avtr_error');
        state.getAvatar.mockRejectedValue(Object.assign(new Error('server error'), { status: 500 }));

        const wrapper = await mountSelectedFriend();

        expect(wrapper.find('[data-testid="deleted-avatar-badge"]').exists()).toBe(false);
    });
});

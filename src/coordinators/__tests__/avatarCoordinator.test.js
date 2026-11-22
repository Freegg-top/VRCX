import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    cachedAvatarNames: new Map(),
    getFile: vi.fn()
}));

vi.mock('vue-sonner', () => ({
    toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn() })
}));

vi.mock('../../plugins/i18n', () => ({
    i18n: { global: { t: (key) => key } }
}));

vi.mock('../../shared/utils', async () => {
    const { extractFileId } = await import('../../shared/utils/fileUtils');
    const { storeAvatarImage } = await import('../../shared/utils/avatar');
    return { extractFileId, storeAvatarImage };
});

vi.mock('../../api', () => ({
    avatarRequest: {},
    miscRequest: { getFile: mocks.getFile },
    queryRequest: {}
}));

vi.mock('../../services/appConfig', () => ({ logWebRequest: vi.fn() }));
vi.mock('../../services/database', () => ({ database: {} }));
vi.mock('../../queries', () => ({ patchAvatarFromEvent: vi.fn() }));
vi.mock('../../services/request', () => ({ processBulk: vi.fn() }));
vi.mock('../favoriteCoordinator', () => ({ applyFavorite: vi.fn() }));
vi.mock('../userCoordinator', () => ({
    refreshUserDialogAvatars: vi.fn(),
    showUserDialog: vi.fn()
}));
vi.mock('../searchIndexCoordinator', () => ({
    syncAvatarSearchIndex: vi.fn(),
    removeAvatarSearchIndex: vi.fn()
}));
vi.mock('../../stores/settings/advanced', () => ({ useAdvancedSettingsStore: vi.fn() }));
vi.mock('../../stores/avatarProvider', () => ({ useAvatarProviderStore: vi.fn() }));
vi.mock('../../stores/avatar', () => ({
    useAvatarStore: () => ({ cachedAvatarNames: mocks.cachedAvatarNames })
}));
vi.mock('../../stores/favorite', () => ({ useFavoriteStore: vi.fn() }));
vi.mock('../../stores/modal', () => ({ useModalStore: vi.fn() }));
vi.mock('../../stores/ui', () => ({ useUiStore: vi.fn() }));
vi.mock('../../stores/user', () => ({ useUserStore: vi.fn() }));
vi.mock('../../stores/vrcxUpdater', () => ({ useVRCXUpdaterStore: vi.fn() }));
vi.mock('../../services/webapi', () => ({ default: {} }));

import { isCloudflareBlocked, resolveProfileAvatarInfo } from '../avatarCoordinator';
import webApiService from '../../services/webapi';
import { useAvatarProviderStore } from '../../stores/avatarProvider';
import { useVRCXUpdaterStore } from '../../stores/vrcxUpdater';

const BANNER_URL = 'https://api.vrchat.cloud/api/1/file/file_banner/1/file';
const ICON_URL = 'https://api.vrchat.cloud/api/1/file/file_icon/1/file';

/**
 * @param {string} fileId
 * @param {string} name
 * @param {string[]} tags
 * @returns {object}
 */
function makeFileArgs(fileId, name, tags = []) {
    return {
        json: {
            tags,
            name,
            ownerId: 'usr_a',
            versions: [{ created_at: '2026-01-01T00:00:00Z' }]
        },
        params: { fileId }
    };
}

describe('resolveProfileAvatarInfo', () => {
    beforeEach(() => {
        mocks.cachedAvatarNames.clear();
        mocks.getFile.mockReset();
    });

    test('resolves an avatar banner before the profile icon', async () => {
        mocks.getFile.mockResolvedValue(makeFileArgs('file_banner', 'Avatar - TestAvatar - Image - 2026.01.01'));

        const result = await resolveProfileAvatarInfo({
            bannerType: 'avatarBanner',
            bannerUrl: BANNER_URL,
            iconUrl: ICON_URL
        });

        expect(result).toEqual({
            url: BANNER_URL,
            ownerId: 'usr_a',
            avatarName: 'TestAvatar'
        });
        expect(mocks.getFile).toHaveBeenCalledTimes(1);
        expect(mocks.getFile).toHaveBeenCalledWith({ fileId: 'file_banner' });
    });

    test('falls back to the profile icon when the avatar banner is an icon', async () => {
        mocks.getFile.mockImplementation(({ fileId }) => {
            if (fileId === 'file_banner') {
                return Promise.resolve(makeFileArgs(fileId, 'Avatar - BannerAvatar - Image - 2026.01.01', ['icon']));
            }
            return Promise.resolve(makeFileArgs(fileId, 'Avatar - IconAvatar - Image - 2026.01.01'));
        });

        const result = await resolveProfileAvatarInfo({
            bannerType: 'avatarBanner',
            bannerUrl: BANNER_URL,
            iconUrl: ICON_URL
        });

        expect(result).toEqual({
            url: ICON_URL,
            ownerId: 'usr_a',
            avatarName: 'IconAvatar'
        });
        expect(mocks.getFile).toHaveBeenCalledTimes(2);
    });

    test('skips a custom image banner and resolves the profile icon', async () => {
        mocks.getFile.mockResolvedValue(makeFileArgs('file_icon', 'Avatar - IconAvatar - Image - 2026.01.01'));

        const result = await resolveProfileAvatarInfo({
            bannerType: 'customImage',
            bannerUrl: BANNER_URL,
            iconUrl: ICON_URL
        });

        expect(result).toEqual({
            url: ICON_URL,
            ownerId: 'usr_a',
            avatarName: 'IconAvatar'
        });
        expect(mocks.getFile).toHaveBeenCalledTimes(1);
        expect(mocks.getFile).toHaveBeenCalledWith({ fileId: 'file_icon' });
    });

    test('returns null when neither image resolves to an avatar', async () => {
        mocks.getFile.mockImplementation(({ fileId }) =>
            Promise.resolve(makeFileArgs(fileId, 'Custom profile image', ['icon']))
        );

        const result = await resolveProfileAvatarInfo({
            bannerType: 'avatarBanner',
            bannerUrl: BANNER_URL,
            iconUrl: ICON_URL
        });

        expect(result).toBeNull();
        expect(mocks.getFile).toHaveBeenCalledTimes(2);
    });

    test('returns null without requesting files when both URLs are empty or undefined', async () => {
        await expect(
            resolveProfileAvatarInfo({ bannerType: 'avatarBanner', bannerUrl: '', iconUrl: '' })
        ).resolves.toBeNull();
        await expect(resolveProfileAvatarInfo({})).resolves.toBeNull();
        expect(mocks.getFile).not.toHaveBeenCalled();
    });

    test('uses the profile icon when bannerType is missing', async () => {
        mocks.getFile.mockResolvedValue(makeFileArgs('file_icon', 'Avatar - IconAvatar - Image - 2026.01.01'));

        const result = await resolveProfileAvatarInfo({
            bannerUrl: BANNER_URL,
            iconUrl: ICON_URL
        });

        expect(result).toEqual({
            url: ICON_URL,
            ownerId: 'usr_a',
            avatarName: 'IconAvatar'
        });
        expect(mocks.getFile).toHaveBeenCalledTimes(1);
        expect(mocks.getFile).toHaveBeenCalledWith({ fileId: 'file_icon' });
    });
});

describe('isCloudflareBlocked', () => {
    test.each([
        ['error code: 1015', true],
        ['error code: 1020', true],
        ['{"id":"avtr_x"}', false],
        ['', false],
        [undefined, false]
    ])('returns %s -> %s', (body, expected) => {
        expect(isCloudflareBlocked(body)).toBe(expected);
    });
});

describe('lookupAvatarByImageFileId remote database cooldown', () => {
    test('short-circuits further requests after a Cloudflare block', async () => {
        vi.resetModules();
        webApiService.execute = vi.fn().mockResolvedValue({
            status: 403,
            data: 'error code: 1015'
        });
        useAvatarProviderStore.mockReturnValue({
            avatarRemoteDatabaseProviderList: ['https://api.avtrdb.com/v3/avatar/search/vrcx']
        });
        useVRCXUpdaterStore.mockReturnValue({ vrcxId: 'test-vrcx-id' });
        const { lookupAvatarByImageFileId } = await import('../avatarCoordinator');

        await expect(lookupAvatarByImageFileId('usr_author', 'file_target')).resolves.toBeNull();
        // fileId + authorId lookups for the single provider
        expect(webApiService.execute).toHaveBeenCalledTimes(2);

        await expect(lookupAvatarByImageFileId('usr_author', 'file_target')).resolves.toBeNull();
        expect(webApiService.execute).toHaveBeenCalledTimes(2);
    });
});

describe('lookupAuthorPublicFileIds', () => {
    const PROVIDERS = [
        'https://api.avtrdb.com/v3/avatar/search/vrcx',
        'https://avtrdb.alt-dev.xyz/v3/avatar/search/vrcx'
    ];

    function makeAvatar(fileId) {
        return {
            id: `avtr_${fileId}`,
            imageUrl: `https://api.vrchat.cloud/api/1/file/${fileId}/1/file`
        };
    }

    function mockProviderStore() {
        useAvatarProviderStore.mockReturnValue({
            avatarRemoteDatabaseProviderList: PROVIDERS
        });
        useVRCXUpdaterStore.mockReturnValue({ vrcxId: 'test-vrcx-id' });
    }

    test('collects image file ids from the first provider with data', async () => {
        vi.resetModules();
        mockProviderStore();
        webApiService.execute = vi.fn().mockResolvedValue({
            status: 200,
            data: JSON.stringify([makeAvatar('file_aaa'), makeAvatar('file_bbb')])
        });
        const { lookupAuthorPublicFileIds } = await import('../avatarCoordinator');

        const fileIds = await lookupAuthorPublicFileIds('usr_author');

        expect(fileIds).toBeInstanceOf(Set);
        expect([...fileIds]).toEqual(['file_aaa', 'file_bbb']);
        expect(webApiService.execute).toHaveBeenCalledTimes(1);
        expect(webApiService.execute.mock.calls[0][0].url).toBe(`${PROVIDERS[0]}?authorId=usr_author`);
    });

    test('falls back to the next provider when the first returns no avatars', async () => {
        vi.resetModules();
        mockProviderStore();
        webApiService.execute = vi
            .fn()
            .mockResolvedValueOnce({ status: 200, data: '[]' })
            .mockResolvedValueOnce({
                status: 200,
                data: JSON.stringify([makeAvatar('file_ccc')])
            });
        const { lookupAuthorPublicFileIds } = await import('../avatarCoordinator');

        const fileIds = await lookupAuthorPublicFileIds('usr_author');

        expect(fileIds).toBeInstanceOf(Set);
        expect([...fileIds]).toEqual(['file_ccc']);
        expect(webApiService.execute).toHaveBeenCalledTimes(2);
        expect(webApiService.execute.mock.calls[1][0].url).toBe(`${PROVIDERS[1]}?authorId=usr_author`);
    });

    test('returns null and short-circuits after a Cloudflare block', async () => {
        vi.resetModules();
        mockProviderStore();
        webApiService.execute = vi.fn().mockResolvedValue({
            status: 403,
            data: 'error code: 1015'
        });
        const { lookupAuthorPublicFileIds } = await import('../avatarCoordinator');

        await expect(lookupAuthorPublicFileIds('usr_author')).resolves.toBeNull();
        // every configured provider is tried once before the cooldown kicks in
        expect(webApiService.execute).toHaveBeenCalledTimes(PROVIDERS.length);

        await expect(lookupAuthorPublicFileIds('usr_author')).resolves.toBeNull();
        expect(webApiService.execute).toHaveBeenCalledTimes(PROVIDERS.length);
    });
});

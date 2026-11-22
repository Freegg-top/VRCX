import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import CacheedImage from '../CacheedImage.vue';

const getImage = vi.fn();

function mountComponent(url, options = {}) {
    return mount(CacheedImage, {
        props: { url },
        ...options
    });
}

describe('CacheedImage.vue', () => {
    beforeEach(() => {
        getImage.mockReset();
        vi.stubGlobal('AppApi', { GetImage: getImage });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uses the local file when GetImage returns a path', async () => {
        const url = 'https://api.vrchat.cloud/api/1/image/file_cached/1/256';
        getImage.mockResolvedValue('C:/Users/test/AppData/VRCX/ImageCache/file_cached/1.png');

        const wrapper = mountComponent(url, {
            attrs: { class: 'avatar-thumbnail' }
        });
        await flushPromises();

        expect(getImage).toHaveBeenCalledWith(url, 'file_cached', '1');
        expect(wrapper.find('img').attributes('src')).toBe(
            'file:///C:/Users/test/AppData/VRCX/ImageCache/file_cached/1.png'
        );
        expect(wrapper.find('img').classes()).toContain('avatar-thumbnail');
    });

    it('keeps the remote source when GetImage returns an empty path', async () => {
        const url = 'https://api.vrchat.cloud/api/1/image/file_uncached/2/256';
        getImage.mockResolvedValue('');

        const wrapper = mountComponent(url);
        await flushPromises();

        expect(wrapper.find('img').attributes('src')).toBe(url);
    });

    it('does not call GetImage for a URL without an image segment', async () => {
        const url = 'https://example.com/avatar.png';

        const wrapper = mountComponent(url);
        await flushPromises();

        expect(getImage).not.toHaveBeenCalled();
        expect(wrapper.find('img').attributes('src')).toBe(url);
    });

    it('renders the fallback slot when the image fails to load', async () => {
        const url = 'https://api.vrchat.cloud/api/1/image/file_missing/3/256';
        getImage.mockResolvedValue('');

        const wrapper = mountComponent(url, {
            slots: {
                fallback: '<div data-testid="fallback">No image</div>'
            }
        });
        await wrapper.find('img').trigger('error');

        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.find('[data-testid="fallback"]').text()).toBe('No image');
    });

    it('deduplicates GetImage calls for the same URL', async () => {
        const url = 'https://api.vrchat.cloud/api/1/image/file_shared/4/256';
        getImage.mockResolvedValue('C:/Users/test/AppData/VRCX/ImageCache/file_shared/4.png');

        const firstWrapper = mountComponent(url);
        const secondWrapper = mountComponent(url);
        await flushPromises();

        expect(getImage).toHaveBeenCalledTimes(1);
        expect(firstWrapper.find('img').attributes('src')).toBe(
            'file:///C:/Users/test/AppData/VRCX/ImageCache/file_shared/4.png'
        );
        expect(secondWrapper.find('img').attributes('src')).toBe(
            'file:///C:/Users/test/AppData/VRCX/ImageCache/file_shared/4.png'
        );
    });
});

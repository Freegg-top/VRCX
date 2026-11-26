import { beforeEach, describe, expect, test, vi } from 'vitest';
import { mount } from '@vue/test-utils';

const mocks = vi.hoisted(() => ({
    userStore: null,
    appearanceStore: null,
    vrcxStore: null
}));

vi.mock('pinia', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        storeToRefs: (store) => store
    };
});

vi.mock('../../stores', async () => {
    const { ref: vueRef, shallowReactive: vueShallowReactive } = await import('vue');
    mocks.userStore = {
        cachedIconFrames: vueRef(vueShallowReactive(new Map())),
        currentUserClientConfig: vueRef({ accessReduceDecorAnim: false })
    };
    mocks.appearanceStore = { displayVRCProfileCosmetics: vueRef(false) };
    mocks.vrcxStore = { isBrowserFocused: vueRef(true) };
    return {
        useUserStore: () => mocks.userStore,
        useAppearanceSettingsStore: () => mocks.appearanceStore,
        useVrcxStore: () => mocks.vrcxStore
    };
});

import IconFrame from '../IconFrame.vue';

function setFrame(assets) {
    mocks.userStore.cachedIconFrames.value.set('invt_1', { id: 'invt_1', metadata: { assets } });
}

async function mountFrame(props = {}) {
    const wrapper = mount(IconFrame, { props: { iconFrame: 'invt_1', ...props } });
    await wrapper.vm.$nextTick();
    return wrapper;
}

function visibleImages(wrapper) {
    return wrapper.findAll('img').filter((img) => img.element.style.display !== 'none');
}

describe('IconFrame.vue', () => {
    beforeEach(() => {
        mocks.userStore.cachedIconFrames.value.clear();
        mocks.appearanceStore.displayVRCProfileCosmetics.value = false;
        mocks.vrcxStore.isBrowserFocused.value = true;
        mocks.userStore.currentUserClientConfig.value = { accessReduceDecorAnim: false };
    });

    test('renders nothing when explicitly disabled', async () => {
        setFrame([{ type: 'base', url: 'base.png' }]);
        const wrapper = await mountFrame({ enabled: false });
        expect(wrapper.findAll('img')).toHaveLength(0);
    });

    test('follows the global setting when enabled is not provided', async () => {
        setFrame([{ type: 'base', url: 'base.png' }]);
        expect((await mountFrame()).findAll('img')).toHaveLength(0);

        mocks.appearanceStore.displayVRCProfileCosmetics.value = true;
        expect(visibleImages(await mountFrame())).toHaveLength(1);
    });

    test('falls back to the base asset for static frames while animated', async () => {
        setFrame([{ type: 'base', url: 'base.png' }]);
        const wrapper = await mountFrame({ enabled: true });
        const images = visibleImages(wrapper);
        expect(images).toHaveLength(1);
        expect(images[0].attributes('src')).toBe('base.png');
    });

    test('shows the main animation instead of the base asset for animated frames', async () => {
        setFrame([
            { type: 'base', url: 'base.png' },
            { type: 'mainAnimation', url: 'main.png' }
        ]);
        const wrapper = await mountFrame({ enabled: true });
        const images = visibleImages(wrapper);
        expect(images).toHaveLength(1);
        expect(images[0].attributes('src')).toBe('main.png');
    });

    test('shows the base asset when animations are reduced', async () => {
        mocks.userStore.currentUserClientConfig.value = { accessReduceDecorAnim: true };
        setFrame([
            { type: 'base', url: 'base.png' },
            { type: 'mainAnimation', url: 'main.png' }
        ]);
        const wrapper = await mountFrame({ enabled: true });
        const images = visibleImages(wrapper);
        expect(images).toHaveLength(1);
        expect(images[0].attributes('src')).toBe('base.png');
    });
});

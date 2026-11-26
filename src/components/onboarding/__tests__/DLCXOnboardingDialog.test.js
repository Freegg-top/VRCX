import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('vue-i18n', () => ({
    useI18n: () => ({ t: (key) => key })
}));

vi.mock('@/components/ui/dialog', () => ({
    Dialog: {
        props: ['open'],
        template: '<div v-if="open"><slot /></div>'
    },
    DialogContent: { template: '<div><slot /></div>' },
    DialogDescription: { template: '<p><slot /></p>' },
    DialogFooter: { template: '<div><slot /></div>' },
    DialogHeader: { template: '<div><slot /></div>' },
    DialogTitle: { template: '<h2><slot /></h2>' }
}));

import DLCXOnboardingDialog from '../DLCXOnboardingDialog.vue';

function mountDialog() {
    return mount(DLCXOnboardingDialog, {
        global: {
            stubs: {
                Dialog: {
                    props: ['open'],
                    template: '<div v-if="open"><slot /></div>'
                },
                DialogContent: { template: '<div><slot /></div>' },
                DialogDescription: { template: '<p><slot /></p>' },
                DialogFooter: { template: '<div><slot /></div>' },
                DialogHeader: { template: '<div><slot /></div>' },
                DialogTitle: { template: '<h2><slot /></h2>' }
            }
        }
    });
}

describe('DLCXOnboardingDialog', () => {
    beforeEach(() => {
        localStorage.removeItem('VRCX_dlcx_onboarded');
    });

    it('advances through all six steps and records completion', async () => {
        const wrapper = mountDialog();
        expect(wrapper.text()).toContain('onboarding.dlcx.welcome.title');
        expect(wrapper.text()).toContain('1 / 6');

        for (const expectedTitle of ['features', 'watch', 'dlc', 'sharing', 'background']) {
            await wrapper.findAll('button').at(-1).trigger('click');
            expect(wrapper.text()).toContain(`onboarding.dlcx.${expectedTitle}.title`);
        }

        expect(wrapper.text()).toContain('6 / 6');
        expect(wrapper.text()).toContain('onboarding.dlcx.done.ready');
        await wrapper.findAll('button').at(-1).trigger('click');
        expect(localStorage.getItem('VRCX_dlcx_onboarded')).toBe('true');
    });

    it('records onboarding as complete when skipped', async () => {
        const wrapper = mountDialog();
        const skip = wrapper.findAll('button').find((button) => button.text() === 'onboarding.dlcx.actions.skip');

        await skip.trigger('click');
        expect(localStorage.getItem('VRCX_dlcx_onboarded')).toBe('true');
    });

    it('reopens at the first step without a reload when replay is requested', async () => {
        localStorage.setItem('VRCX_dlcx_onboarded', 'true');
        const wrapper = mountDialog();
        expect(wrapper.text()).not.toContain('onboarding.dlcx.welcome.title');

        window.dispatchEvent(new CustomEvent('dlcx:replay-onboarding'));
        await wrapper.vm.$nextTick();

        expect(wrapper.text()).toContain('onboarding.dlcx.welcome.title');
        expect(wrapper.text()).toContain('1 / 6');
    });

    it('does not open for an onboarded user', () => {
        localStorage.setItem('VRCX_dlcx_onboarded', 'true');
        const wrapper = mountDialog();

        expect(wrapper.text()).not.toContain('onboarding.dlcx.welcome.title');
    });
});

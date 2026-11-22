import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';

// ─── Mocks ───────────────────────────────────────────────────────────

const changeLogDialog = ref({
    visible: true,
    buildName: 'VRCX 2025.1.0',
    changeLog: '## New Features\n- Feature A\n- Feature B'
});

const isDlcBuild = ref(false);
const currentVersion = ref('VRCX DLC 2026.09.20-dlc.10');
const dlcChangeLogText = ref('');
const dlcChangeLogLoaded = ref(false);
const loadDlcChangeLogFn = vi.fn();

const openExternalLinkFn = vi.fn();

vi.mock('pinia', () => ({
    storeToRefs: () => ({ changeLogDialog, currentVersion, isDlcBuild, dlcChangeLogText, dlcChangeLogLoaded }),
    defineStore: (id, fn) => fn
}));

vi.mock('vue-i18n', () => ({
    useI18n: () => ({
        t: (key) => key,
        locale: require('vue').ref('en')
    })
}));

vi.mock('../../../../stores', () => ({
    useVRCXUpdaterStore: () => ({ loadDlcChangeLog: loadDlcChangeLogFn })
}));

vi.mock('../../../../shared/utils', () => ({
    openExternalLink: (...args) => openExternalLinkFn(...args)
}));

// Stub VueShowdown since it's async and we don't need real markdown rendering
vi.mock('vue-showdown', () => ({
    VueShowdown: {
        props: ['markdown', 'flavor', 'options'],
        template: '<div class="changelog-markdown" data-testid="showdown">{{ markdown }}</div>'
    }
}));

import ChangelogDialog from '../ChangelogDialog.vue';

// ─── Helpers ─────────────────────────────────────────────────────────

function mountComponent() {
    return mount(ChangelogDialog, {
        global: {
            stubs: {
                Dialog: {
                    props: ['open'],
                    emits: ['update:open'],
                    template: '<div data-testid="dialog" v-if="open"><slot /></div>'
                },
                DialogContent: { template: '<div><slot /></div>' },
                DialogHeader: { template: '<div><slot /></div>' },
                DialogTitle: { template: '<h2><slot /></h2>' },
                DialogFooter: {
                    template: '<div data-testid="footer"><slot /></div>'
                },
                Button: {
                    emits: ['click'],
                    props: ['variant'],
                    template: '<button @click="$emit(\'click\')"><slot /></button>'
                }
            }
        }
    });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('ChangelogDialog.vue', () => {
    beforeEach(() => {
        changeLogDialog.value = {
            visible: true,
            buildName: 'VRCX 2025.1.0',
            changeLog: '## New Features\n- Feature A\n- Feature B'
        };
        isDlcBuild.value = false;
        currentVersion.value = 'VRCX DLC 2026.09.20-dlc.10';
        dlcChangeLogText.value = '';
        dlcChangeLogLoaded.value = false;
        vi.clearAllMocks();
    });

    describe('rendering', () => {
        test('renders dialog title', () => {
            const wrapper = mountComponent();
            expect(wrapper.text()).toContain('dialog.change_log.header');
        });

        test('renders build name', () => {
            const wrapper = mountComponent();
            expect(wrapper.text()).toContain('VRCX 2025.1.0');
        });

        test('renders GitHub button', () => {
            const wrapper = mountComponent();
            expect(wrapper.text()).toContain('dialog.change_log.github');
        });

        test('renders Close button', () => {
            const wrapper = mountComponent();
            expect(wrapper.text()).toContain('dialog.change_log.close');
        });

        test('does not render when visible is false', () => {
            changeLogDialog.value.visible = false;
            const wrapper = mountComponent();
            expect(wrapper.find('[data-testid="dialog"]').exists()).toBe(false);
        });
    });

    describe('interactions', () => {
        test('clicking Close button sets visible to false', async () => {
            const wrapper = mountComponent();
            const buttons = wrapper.findAll('button');
            const closeBtn = buttons.find((b) => b.text().includes('dialog.change_log.close'));
            expect(closeBtn).toBeTruthy();

            await closeBtn.trigger('click');
            expect(changeLogDialog.value.visible).toBe(false);
        });

        test('clicking GitHub button opens external link', async () => {
            const wrapper = mountComponent();
            const buttons = wrapper.findAll('button');
            const githubBtn = buttons.find((b) => b.text().includes('dialog.change_log.github'));
            expect(githubBtn).toBeTruthy();

            await githubBtn.trigger('click');
            expect(openExternalLinkFn).toHaveBeenCalledWith('https://github.com/vrcx-team/VRCX/releases');
        });
    });

    describe('DLC build', () => {
        beforeEach(() => {
            isDlcBuild.value = true;
            // 模拟 store 的 loadDlcChangeLog 实现: 读取本地 changelog.txt, 失败静默
            loadDlcChangeLogFn.mockImplementation(async () => {
                try {
                    const response = await fetch(`changelog.txt?t=${Date.now()}`);
                    if (!response.ok) {
                        return;
                    }
                    const text = await response.text();
                    if (!text.trim() || /<!doctype html|<html[\s>]/i.test(text)) {
                        return;
                    }
                    dlcChangeLogText.value = text;
                    dlcChangeLogLoaded.value = true;
                } catch {
                    // store 静默失败: text 保持 '', loaded 保持 false
                }
            });
        });

        afterEach(() => {
            vi.unstubAllGlobals();
        });

        test('loads local changelog on open and renders current version title', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                text: async () => '## DLC Fixes\n- fix A'
            });
            vi.stubGlobal('fetch', fetchMock);

            changeLogDialog.value.visible = false;
            const wrapper = mountComponent();
            expect(loadDlcChangeLogFn).not.toHaveBeenCalled();

            // 打开对话框触发按需加载
            changeLogDialog.value.visible = true;
            await flushPromises();
            await flushPromises();

            expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('changelog.txt?t='));
            expect(wrapper.text()).toContain('VRCX DLC 2026.09.20-dlc.10');
            expect(wrapper.text()).toContain('- fix A');
            expect(wrapper.text()).not.toContain('dialog.change_log.load_failed');
            // DLC 构建 footer 不显示 GitHub releases 按钮
            expect(wrapper.text()).not.toContain('dialog.change_log.github');
        });

        test('shows load_failed text when fetch fails', async () => {
            vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

            changeLogDialog.value.visible = false;
            const wrapper = mountComponent();
            changeLogDialog.value.visible = true;
            await flushPromises();
            await flushPromises();

            expect(dlcChangeLogText.value).toBe('');
            expect(dlcChangeLogLoaded.value).toBe(false);
            expect(wrapper.text()).toContain('dialog.change_log.load_failed');
        });
    });
});

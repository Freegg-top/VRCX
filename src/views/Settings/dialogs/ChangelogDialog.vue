<template>
    <Dialog v-model:open="changeLogDialog.visible" class="p-4!">
        <DialogContent class="sm:max-w-4xl">
            <DialogHeader>
                <DialogTitle>{{ t('dialog.change_log.header') }}</DialogTitle>
            </DialogHeader>
            <div class="changelog-dialog">
                <template v-if="isDlcBuild">
                    <!-- 拓展版: 当前运行版本的更新日志 (本地 changelog.txt) -->
                    <div style="height: 62vh; overflow-y: auto">
                        <h2>{{ currentVersion }}</h2>
                        <p v-if="!dlcChangeLogText && !dlcChangeLogLoaded" class="py-4 text-sm text-muted-foreground">
                            {{ t('dialog.change_log.load_failed') }}
                        </p>
                        <VueShowdown
                            v-else
                            class="changelog-markdown mt-2"
                            :markdown="dlcChangeLogText"
                            flavor="github"
                            :options="showdownOptions"
                            @click="handleLinkClick" />
                    </div>
                </template>
                <template v-else>
                    <h2 v-text="changeLogDialog.buildName"></h2>
                    <VueShowdown
                        class="changelog-markdown mt-2"
                        :markdown="changeLogDialog.changeLog"
                        flavor="github"
                        :options="showdownOptions"
                        @click="handleLinkClick"
                        style="height: 62vh; overflow-y: auto" />
                </template>
            </div>
            <DialogFooter>
                <Button
                    v-if="!isDlcBuild"
                    variant="ghost"
                    class="mr-2"
                    @click="openExternalLink('https://github.com/vrcx-team/VRCX/releases')">
                    {{ t('dialog.change_log.github') }}
                </Button>
                <Button @click="closeDialog">
                    {{ t('dialog.change_log.close') }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup>
    import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
    import { Button } from '@/components/ui/button';
    import { defineAsyncComponent, watch } from 'vue';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import { openExternalLink } from '../../../shared/utils';
    import { useVRCXUpdaterStore } from '../../../stores';

    const VueShowdown = defineAsyncComponent(() => import('vue-showdown').then((module) => module.VueShowdown));

    const VRCXUpdaterStore = useVRCXUpdaterStore();

    const { changeLogDialog, currentVersion, dlcChangeLogText, dlcChangeLogLoaded, isDlcBuild } =
        storeToRefs(VRCXUpdaterStore);
    const { loadDlcChangeLog } = VRCXUpdaterStore;

    const { t } = useI18n();

    const showdownOptions = {
        emoji: true,
        openLinksInNewWindow: false,
        simplifiedAutoLink: true,
        excludeTrailingPunctuationFromURLs: true,
        literalMidWordUnderscores: true,
        strikethrough: true,
        tables: true,
        tablesHeaderId: false,
        ghCodeBlocks: true,
        tasklists: true,
        simpleLineBreaks: true
    };

    // 打开对话框时按需读取本地更新日志 (成功后本次会话不再重复加载)
    watch(
        () => changeLogDialog.value.visible,
        (visible) => {
            if (visible && isDlcBuild.value && !dlcChangeLogLoaded.value) {
                loadDlcChangeLog();
            }
        }
    );

    function closeDialog() {
        changeLogDialog.value.visible = false;
    }

    /**
     * @param event
     */
    function handleLinkClick(event) {
        const target = event.target.closest('a');
        if (target && target.href) {
            event.preventDefault();
            event.stopPropagation();

            openExternalLink(target.href);
        }
    }
</script>

<style>
    .changelog-dialog img {
        width: 100%;
    }

    .changelog-markdown ul,
    .changelog-markdown ol {
        padding-left: 1.5rem;
        margin: 0.5rem 0 1rem;
        list-style-position: outside;
    }

    .changelog-markdown ul {
        list-style-type: disc;
    }

    .changelog-markdown ol {
        list-style-type: decimal;
    }

    .changelog-markdown li {
        margin: 0.25rem 0;
    }

    .changelog-markdown h1,
    .changelog-markdown h2,
    .changelog-markdown h3,
    .changelog-markdown h4,
    .changelog-markdown h5,
    .changelog-markdown h6 {
        font-weight: 600;
        line-height: 1.25;
        margin: 1.25rem 0 0.5rem;
    }

    .changelog-markdown h1 {
        font-size: 1.5rem;
    }

    .changelog-markdown h2 {
        font-size: 1.25rem;
    }

    .changelog-markdown h3 {
        font-size: 1.125rem;
    }

    .changelog-markdown h4 {
        font-size: 1rem;
    }

    .changelog-markdown h5 {
        font-size: 0.95rem;
    }

    .changelog-markdown h6 {
        font-size: 0.9rem;
    }
</style>

<template>
    <div class="flex h-full flex-col gap-4 overflow-y-auto p-4">
        <div>
            <h1 class="text-lg font-semibold">
                {{ t('view.oversee.header') }}
            </h1>
            <p class="text-muted-foreground text-sm">
                {{ t('view.oversee.description') }}
            </p>
        </div>

        <template v-if="licenseBlocked && !encountersAvailable">
            <div class="mx-auto mt-8 flex max-w-md flex-col items-center gap-3 rounded-lg border p-6 text-center">
                <ShieldAlert class="text-muted-foreground size-8" />
                <div class="text-sm font-medium">
                    {{ licenseBlockedTitle }}
                </div>
                <p class="text-muted-foreground text-sm">
                    {{ licenseBlockedDescription }}
                </p>
                <Badge :variant="licenseBadgeVariant">
                    {{ t(`view.settings.oversee.license.status_${licenseStatus}`) }}
                </Badge>
                <Button v-if="licenseKey" size="sm" variant="outline" :disabled="probing" @click="retryProbe">
                    {{ t('view.oversee.guide.retry_probe') }}
                </Button>
            </div>
        </template>

        <template v-else-if="tabs.length === 0">
            <div class="text-muted-foreground mx-auto mt-8 max-w-md text-center text-sm">
                {{ t('view.oversee.all_disabled') }}
            </div>
        </template>

        <template v-else>
            <div class="flex items-center gap-2">
                <Badge :variant="licenseBadgeVariant">
                    {{ t(`view.settings.oversee.license.status_${licenseStatus}`) }}
                </Badge>
                <span
                    class="inline-block size-2 shrink-0 rounded-full"
                    :class="sseDotClass"
                    :title="t(`view.oversee.push.sse_${sseConnState}`)"></span>
                <Button
                    v-if="licenseBlocked && licenseKey"
                    size="sm"
                    variant="outline"
                    :disabled="probing"
                    @click="retryProbe">
                    {{ t('view.oversee.guide.retry_probe') }}
                </Button>
            </div>

            <div v-if="licenseBlocked" class="rounded-lg border p-3 text-sm">
                <span class="font-medium">{{ licenseBlockedTitle }}</span>
                <span class="text-muted-foreground"> · {{ t('view.oversee.guide.local_only_hint') }}</span>
            </div>

            <TabsUnderline v-model="activeTab" :items="tabs" class="h-full min-h-0">
                <template #trace>
                    <TracePanel />
                </template>
                <template #encounters>
                    <EncountersPanel ref="encountersPanelRef" />
                </template>
                <template #room>
                    <RoomLookupPanel />
                </template>
                <template #network>
                    <NetworkPanel ref="networkPanelRef" />
                </template>
            </TabsUnderline>
        </template>
    </div>
</template>

<script setup>
    import { computed, onMounted, ref, watch } from 'vue';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import { ShieldAlert } from 'lucide-vue-next';

    import { Badge } from '../../components/ui/badge';
    import { Button } from '../../components/ui/button';
    import { TabsUnderline } from '../../components/ui/tabs';
    import { useOverseeSettingsStore } from '../../stores';
    import { probeLicense } from '../../services/overseeApi';
    import { sseConnState } from '../../services/overseeWatch';

    import TracePanel from './components/TracePanel.vue';
    import EncountersPanel from './components/EncountersPanel.vue';
    import RoomLookupPanel from './components/RoomLookupPanel.vue';
    import NetworkPanel from './components/NetworkPanel.vue';

    const { t } = useI18n();

    const overseeSettingsStore = useOverseeSettingsStore();
    const { licenseKey, licenseStatus, enableTrace, enableEncounters, enableRoomLookup, enableNetwork } =
        storeToRefs(overseeSettingsStore);

    const encountersPanelRef = ref(null);
    const networkPanelRef = ref(null);
    const probing = ref(false);

    // licenseBlocked 被 tabs(下方 immediate watch 会立即求值)引用, 必须先于 tabs 定义
    const licenseBlocked = computed(() => {
        if (!licenseKey.value) {
            return true;
        }
        return licenseStatus.value === 'invalid' || licenseStatus.value === 'expired';
    });

    const encountersAvailable = computed(() => enableEncounters.value);

    const tabs = computed(() => {
        /** @type {{ value: string; label: string }[]} */
        const list = [];
        if (enableTrace.value && !licenseBlocked.value) {
            list.push({ value: 'trace', label: t('view.oversee.tab_trace') });
        }
        if (enableEncounters.value) {
            // encounters 本地模式: 无 key/失效也渲染, 由面板显示 cloud_pending 提示
            list.push({ value: 'encounters', label: t('view.oversee.tab_encounters') });
        }
        if (enableRoomLookup.value && !licenseBlocked.value) {
            list.push({ value: 'room', label: t('view.oversee.tab_room') });
        }
        if (enableNetwork.value && !licenseBlocked.value) {
            list.push({ value: 'network', label: t('view.oversee.tab_network') });
        }
        return list;
    });

    const activeTab = ref('trace');

    // 当前激活 tab 被开关隐藏后回退到第一个可用 tab
    watch(
        tabs,
        (list) => {
            if (list.length && !list.some((tab) => tab.value === activeTab.value)) {
                activeTab.value = list[0].value;
            }
        },
        { immediate: true }
    );

    // encounters 首次激活时自动加载一次, 之后保持已加载内容
    const encountersLoadedOnce = ref(false);

    function tryLoadEncountersOnce() {
        if (activeTab.value === 'encounters' && !encountersLoadedOnce.value) {
            encountersLoadedOnce.value = true;
            encountersPanelRef.value?.load();
        }
    }

    watch(activeTab, tryLoadEncountersOnce);
    onMounted(tryLoadEncountersOnce);

    // offline 状态下可手动重跑 license 探测 (自动退避不做)
    async function retryProbe() {
        if (probing.value) {
            return;
        }
        probing.value = true;
        try {
            await probeLicense();
        } finally {
            probing.value = false;
        }
    }

    const licenseBlockedTitle = computed(() =>
        t(`view.oversee.guide.${licenseKey.value ? licenseStatus.value : 'notConfigured'}`)
    );

    const licenseBlockedDescription = computed(() =>
        t(`view.oversee.guide.${licenseKey.value ? licenseStatus.value : 'notConfigured'}_description`)
    );

    const licenseBadgeVariant = computed(() => {
        if (licenseStatus.value === 'ok') {
            return 'default';
        }
        if (licenseStatus.value === 'invalid' || licenseStatus.value === 'expired') {
            return 'destructive';
        }
        return 'secondary';
    });

    // SSE 连接状态小圆点: live=绿 / error 系=橙 / 其余=灰
    const sseDotClass = computed(() => {
        switch (sseConnState.value) {
            case 'live':
                return 'bg-green-500';
            case 'error':
            case 'expired':
            case 'invalid':
                return 'bg-orange-500';
            default:
                return 'bg-muted-foreground/40';
        }
    });

    // 已配置 key 但从未探测过时, 进页面静默探测一次更新徽标
    if (licenseKey.value && licenseStatus.value === 'unknown') {
        probeLicense();
    }
</script>

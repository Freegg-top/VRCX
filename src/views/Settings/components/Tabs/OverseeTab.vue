<template>
    <div class="flex flex-col gap-10 py-2">
        <SettingsGroup :title="t('view.settings.oversee.license.header')">
            <template #description>
                <p class="m-0">{{ t('view.settings.oversee.license.description') }}</p>
            </template>

            <SettingsItem
                :label="t('view.settings.oversee.license.key_label')"
                :description="t('view.settings.oversee.license.key_description')">
                <div class="flex items-center gap-2">
                    <Input
                        v-model="licenseKeyInput"
                        type="password"
                        class="w-52"
                        :placeholder="t('view.settings.oversee.license.key_placeholder')"
                        @keydown.enter="saveLicense" />
                    <Button size="sm" @click="saveLicense">{{ t('view.settings.oversee.license.save') }}</Button>
                    <Button size="sm" variant="outline" :disabled="probing" @click="testConnection">
                        {{ t('view.settings.oversee.license.test') }}
                    </Button>
                </div>
            </SettingsItem>

            <SettingsItem :label="t('view.settings.oversee.license.status_label')">
                <Badge :variant="licenseStatusBadgeVariant">
                    {{ t(`view.settings.oversee.license.status_${licenseStatus}`) }}
                </Badge>
            </SettingsItem>
        </SettingsGroup>

        <SettingsGroup :title="t('view.settings.oversee.endpoint.header')">
            <SettingsItem
                :label="t('view.settings.oversee.endpoint.base_label')"
                :description="t('view.settings.oversee.endpoint.base_description')">
                <div class="flex items-center gap-2">
                    <Input
                        v-model="apiBaseInput"
                        class="w-64"
                        :placeholder="OVERSEE_API_BASE"
                        @keydown.enter="saveApiBase" />
                    <Button size="sm" variant="outline" @click="saveApiBase">
                        {{ t('view.settings.oversee.endpoint.save') }}
                    </Button>
                </div>
            </SettingsItem>
        </SettingsGroup>

        <SettingsGroup :title="t('view.settings.oversee.watchlist.header')">
            <template #description>
                <p class="m-0">{{ t('view.settings.oversee.watchlist.description') }}</p>
            </template>

            <SettingsItem :label="t('view.settings.oversee.watchlist.add_label')">
                <div class="flex items-center gap-2">
                    <PlayerInput
                        ref="watchPlayerInputRef"
                        v-model="watchInput"
                        class="w-64"
                        :placeholder="t('view.settings.oversee.watchlist.add_placeholder')"
                        @select="addWatchCandidate" />
                    <Button size="sm" @click="addWatchEntry">{{ t('view.settings.oversee.watchlist.add') }}</Button>
                </div>
            </SettingsItem>

            <div class="flex min-h-8 flex-wrap items-center gap-2 px-2 py-2">
                <span v-if="!watchlist.length" class="text-sm text-muted-foreground">
                    {{ t('view.settings.oversee.watchlist.empty') }}
                </span>
                <Badge v-for="watchId in watchlist" :key="watchId" variant="secondary" class="gap-1.5 pl-2.5 pr-1">
                    <span class="font-mono text-xs">{{ watchId }}</span>
                    <Button
                        size="icon-sm"
                        variant="ghost"
                        class="size-5"
                        :aria-label="t('view.settings.oversee.watchlist.remove')"
                        @click="removeWatchEntry(watchId)">
                        <X class="size-3.5" />
                    </Button>
                </Badge>
            </div>
        </SettingsGroup>

        <SettingsGroup :title="t('view.settings.oversee.push.header')">
            <SettingsItem
                :label="t('view.settings.oversee.push.enable')"
                :description="t('view.settings.oversee.push.enable_description')"
                toggle>
                <Switch
                    :model-value="sseEnabled"
                    :ariaLabel="t('view.settings.oversee.push.enable')"
                    @update:modelValue="setSseEnabled" />
            </SettingsItem>
            <SettingsItem
                :label="t('view.settings.oversee.push.sync_watched')"
                :description="t('view.settings.oversee.push.sync_watched_description')"
                toggle>
                <Switch
                    :model-value="syncWatched"
                    :ariaLabel="t('view.settings.oversee.push.sync_watched')"
                    @update:modelValue="updateSyncWatched" />
            </SettingsItem>
        </SettingsGroup>

        <SettingsGroup :title="t('view.settings.oversee.ingest.header')">
            <SettingsItem
                :label="t('view.settings.oversee.ingest.enable')"
                :description="t('view.settings.oversee.ingest.enable_description')"
                toggle>
                <Switch
                    :model-value="ingestEnabled"
                    :ariaLabel="t('view.settings.oversee.ingest.enable')"
                    @update:modelValue="setIngestEnabled" />
            </SettingsItem>
        </SettingsGroup>

        <SettingsGroup :title="t('view.settings.oversee.features.header')">
            <SettingsItem
                :label="t('view.settings.oversee.features.trace')"
                :description="t('view.settings.oversee.features.trace_description')"
                toggle>
                <Switch
                    :model-value="enableTrace"
                    :ariaLabel="t('view.settings.oversee.features.trace')"
                    @update:modelValue="setEnableTrace" />
            </SettingsItem>

            <SettingsItem
                :label="t('view.settings.oversee.features.watch_push')"
                :description="t('view.settings.oversee.features.watch_push_description')"
                toggle>
                <Switch
                    :model-value="enableWatchPush"
                    :ariaLabel="t('view.settings.oversee.features.watch_push')"
                    @update:modelValue="setEnableWatchPush" />
            </SettingsItem>

            <SettingsItem
                :label="t('view.settings.oversee.features.block_alerts')"
                :description="t('view.settings.oversee.features.block_alerts_description')"
                toggle>
                <Switch
                    :model-value="enableBlockAlerts"
                    :ariaLabel="t('view.settings.oversee.features.block_alerts')"
                    @update:modelValue="setEnableBlockAlerts" />
            </SettingsItem>
        </SettingsGroup>
    </div>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import { X } from 'lucide-vue-next';
    import { storeToRefs } from 'pinia';
    import { toast } from 'vue-sonner';
    import { useI18n } from 'vue-i18n';

    import { Badge } from '@/components/ui/badge';
    import { Button } from '@/components/ui/button';
    import { Input } from '@/components/ui/input';
    import { Switch } from '@/components/ui/switch';
    import PlayerInput from '../PlayerInput.vue';
    import { useOverseeSettingsStore } from '@/stores';
    import { OVERSEE_API_BASE } from '@/shared/constants/oversee';
    import { probeLicense } from '@/services/overseeApi';
    import { reconcileWatchedSync } from '@/coordinators/overseeWatchedSync';

    import SettingsGroup from '../SettingsGroup.vue';
    import SettingsItem from '../SettingsItem.vue';

    const { t } = useI18n();

    const overseeSettingsStore = useOverseeSettingsStore();
    const {
        licenseKey,
        apiBase,
        watchlist,
        syncWatched,
        sseEnabled,
        enableTrace,
        enableWatchPush,
        enableBlockAlerts,
        ingestEnabled,
        licenseStatus
    } = storeToRefs(overseeSettingsStore);

    const {
        setLicenseKey,
        setApiBase,
        setSyncWatched,
        setSseEnabled,
        setEnableTrace,
        setEnableWatchPush,
        setEnableBlockAlerts,
        setIngestEnabled,
        addWatch,
        removeWatch
    } = overseeSettingsStore;

    const licenseKeyInput = ref('');
    const apiBaseInput = ref('');
    const watchInput = ref('');
    const watchPlayerInputRef = ref(null);
    const probing = ref(false);

    const USR_ID_REGEX = /^usr_[a-z0-9-]+$/i;

    // store 初始化 (读 configs) 可能晚于本组件挂载, 用 immediate watch 同步到输入框;
    // 保存后两侧值一致, watch 不会再触发
    watch(
        licenseKey,
        (value) => {
            licenseKeyInput.value = value;
        },
        { immediate: true }
    );
    watch(
        apiBase,
        (value) => {
            apiBaseInput.value = value;
        },
        { immediate: true }
    );

    const licenseStatusBadgeVariant = computed(() => {
        switch (licenseStatus.value) {
            case 'ok':
                return 'default';
            case 'invalid':
            case 'expired':
                return 'destructive';
            default:
                return 'secondary';
        }
    });

    /**
     * 探测当前已保存的 license 并按结果提示.
     *
     * @returns {Promise<void>}
     */
    async function runProbe() {
        if (probing.value) {
            return;
        }
        if (!licenseKey.value) {
            toast.error(t('view.settings.oversee.license.not_configured'));
            return;
        }
        probing.value = true;
        let result;
        try {
            result = await probeLicense();
        } finally {
            probing.value = false;
        }
        const message = t(`view.settings.oversee.license.result_${result}`);
        if (result === 'ok') {
            toast.success(message);
        } else if (result === 'invalid' || result === 'expired') {
            toast.error(message);
        } else {
            toast.message(message);
        }
    }

    async function saveLicense() {
        // 空 key 只提示一次 (not_configured), 不写存储也不弹保存成功
        if (!String(licenseKeyInput.value || '').trim()) {
            toast.error(t('view.settings.oversee.license.not_configured'));
            return;
        }
        setLicenseKey(licenseKeyInput.value);
        toast.success(t('view.settings.oversee.license.saved'));
        await runProbe();
    }

    async function testConnection() {
        await runProbe();
    }

    async function updateSyncWatched() {
        setSyncWatched();
        try {
            await reconcileWatchedSync();
        } catch (error) {
            console.error('[oversee] watched sync reconcile failed:', error);
        }
    }

    function saveApiBase() {
        const raw = String(apiBaseInput.value || '').trim();
        if (raw) {
            let url;
            try {
                url = new URL(raw);
            } catch {
                toast.error(t('view.settings.oversee.endpoint.invalid'));
                return;
            }
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                toast.error(t('view.settings.oversee.endpoint.invalid'));
                return;
            }
        }
        setApiBase(raw);
        apiBaseInput.value = apiBase.value;
        toast.success(t('view.settings.oversee.endpoint.saved'));
    }

    async function addWatchEntry() {
        await watchPlayerInputRef.value?.submit();
    }

    /**
     * @param {{ usrId: string }} candidate
     */
    function addWatchCandidate(candidate) {
        addWatchById(candidate.usrId);
    }

    /**
     * 保留原 usr_ 校验与重复提示作为最终写入兜底。
     *
     * @param {string} userId
     */
    function addWatchById(userId) {
        const raw = String(userId || '').trim();
        if (!raw) {
            return;
        }
        if (!USR_ID_REGEX.test(raw)) {
            toast.error(t('view.settings.oversee.watchlist.invalid_id'));
            return;
        }
        if (!addWatch(raw)) {
            toast.error(t('view.settings.oversee.watchlist.duplicate_id'));
            return;
        }
        watchInput.value = '';
    }

    function removeWatchEntry(watchId) {
        removeWatch(watchId);
    }
</script>

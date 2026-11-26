<template>
    <div class="flex flex-col gap-10 py-2">
        <SettingsGroup :title="t('view.settings.dlcx.onboarding.header')">
            <SettingsItem :label="t('view.settings.dlcx.onboarding.replay_label')">
                <Button variant="secondary" @click="replayOnboarding">
                    {{ t('view.settings.dlcx.onboarding.replay_button') }}
                </Button>
            </SettingsItem>
        </SettingsGroup>

        <SettingsGroup :title="t('view.settings.dlcx.license.header')">
            <template #description>
                <p class="m-0">{{ t('view.settings.dlcx.license.description') }}</p>
            </template>

            <SettingsItem
                :label="t('view.settings.dlcx.license.key_label')"
                :description="t('view.settings.dlcx.license.key_description')">
                <div class="flex items-center gap-2">
                    <Input
                        v-model="licenseKeyInput"
                        type="password"
                        class="w-52"
                        :placeholder="t('view.settings.dlcx.license.key_placeholder')"
                        @keydown.enter="saveLicense" />
                    <Button size="sm" @click="saveLicense">{{ t('view.settings.dlcx.license.save') }}</Button>
                    <Button size="sm" variant="outline" :disabled="probing" @click="testConnection">
                        {{ t('view.settings.dlcx.license.test') }}
                    </Button>
                </div>
            </SettingsItem>

            <SettingsItem :label="t('view.settings.dlcx.license.status_label')">
                <Badge :variant="licenseStatusBadgeVariant">
                    {{ t(`view.settings.dlcx.license.status_${licenseStatus}`) }}
                </Badge>
            </SettingsItem>
        </SettingsGroup>

        <SettingsGroup :title="t('view.settings.dlcx.endpoint.header')">
            <SettingsItem
                :label="t('view.settings.dlcx.endpoint.base_label')"
                :description="t('view.settings.dlcx.endpoint.base_description')">
                <div class="flex items-center gap-2">
                    <Input
                        v-model="apiBaseInput"
                        class="w-64"
                        :placeholder="DLCX_API_BASE"
                        @keydown.enter="saveApiBase" />
                    <Button size="sm" variant="outline" @click="saveApiBase">
                        {{ t('view.settings.dlcx.endpoint.save') }}
                    </Button>
                </div>
            </SettingsItem>
        </SettingsGroup>


        <SettingsGroup :title="t('view.settings.dlcx.ingest.header')">
            <SettingsItem
                :label="t('view.settings.dlcx.ingest.enable')"
                :description="t('view.settings.dlcx.ingest.enable_description')"
                toggle>
                <Switch
                    :model-value="ingestEnabled"
                    :ariaLabel="t('view.settings.dlcx.ingest.enable')"
                    @update:modelValue="setIngestEnabled" />
            </SettingsItem>
        </SettingsGroup>

        <SettingsGroup :title="t('view.settings.dlcx.features.header')">
            <SettingsItem
                :label="t('view.settings.dlcx.features.trace')"
                :description="t('view.settings.dlcx.features.trace_description')"
                toggle>
                <Switch
                    :model-value="enableTrace"
                    :ariaLabel="t('view.settings.dlcx.features.trace')"
                    @update:modelValue="setEnableTrace" />
            </SettingsItem>

            <SettingsItem
                :label="t('view.settings.dlcx.features.watch_push')"
                :description="t('view.settings.dlcx.features.watch_push_description')"
                toggle>
                <Switch
                    :model-value="enableWatchPush"
                    :ariaLabel="t('view.settings.dlcx.features.watch_push')"
                    @update:modelValue="setEnableWatchPush" />
            </SettingsItem>

            <SettingsItem
                :label="t('view.settings.dlcx.features.block_alerts')"
                :description="t('view.settings.dlcx.features.block_alerts_description')"
                toggle>
                <Switch
                    :model-value="enableBlockAlerts"
                    :ariaLabel="t('view.settings.dlcx.features.block_alerts')"
                    @update:modelValue="setEnableBlockAlerts" />
            </SettingsItem>
        </SettingsGroup>
    </div>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import { storeToRefs } from 'pinia';
    import { useRouter } from 'vue-router';
    import { toast } from 'vue-sonner';
    import { useI18n } from 'vue-i18n';

    import { Badge } from '@/components/ui/badge';
    import { Button } from '@/components/ui/button';
    import { Input } from '@/components/ui/input';
    import { Switch } from '@/components/ui/switch';
    import { useDLCXSettingsStore } from '@/stores';
    import { DLCX_API_BASE } from '@/shared/constants/dlcx';
    import { replayDlcxOnboarding } from '@/shared/constants/dlcxEvents';
    import { probeLicense } from '@/services/dlcxApi';

    import SettingsGroup from '../SettingsGroup.vue';
    import SettingsItem from '../SettingsItem.vue';

    const { t } = useI18n();
    const router = useRouter();

    const dlcxSettingsStore = useDLCXSettingsStore();
    const { licenseKey, apiBase, enableTrace, enableWatchPush, enableBlockAlerts, ingestEnabled, licenseStatus } =
        storeToRefs(dlcxSettingsStore);

    const { setLicenseKey, setApiBase, setEnableTrace, setEnableWatchPush, setEnableBlockAlerts, setIngestEnabled } =
        dlcxSettingsStore;

    const licenseKeyInput = ref('');
    const apiBaseInput = ref('');
    const probing = ref(false);

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
            toast.error(t('view.settings.dlcx.license.not_configured'));
            return;
        }
        probing.value = true;
        let result;
        try {
            result = await probeLicense();
        } finally {
            probing.value = false;
        }
        const message = t(`view.settings.dlcx.license.result_${result}`);
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
            toast.error(t('view.settings.dlcx.license.not_configured'));
            return;
        }
        setLicenseKey(licenseKeyInput.value);
        toast.success(t('view.settings.dlcx.license.saved'));
        await runProbe();
    }

    async function testConnection() {
        await runProbe();
    }

    function saveApiBase() {
        const raw = String(apiBaseInput.value || '').trim();
        if (raw) {
            let url;
            try {
                url = new URL(raw);
            } catch {
                toast.error(t('view.settings.dlcx.endpoint.invalid'));
                return;
            }
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                toast.error(t('view.settings.dlcx.endpoint.invalid'));
                return;
            }
        }
        setApiBase(raw);
        apiBaseInput.value = apiBase.value;
        toast.success(t('view.settings.dlcx.endpoint.saved'));
    }

    function replayOnboarding() {
        try {
            localStorage.removeItem('VRCX_dlcx_onboarded');
        } catch {
            // The dialog can still be replayed for this session.
        }
        replayDlcxOnboarding();
    }
</script>

<template>
    <div class="x-container flex w-full flex-col">
        <div class="mx-auto flex w-full max-w-2xl flex-col">
            <div class="shrink-0 p-1.5">
                <span class="text-lg font-semibold text-foreground">{{ t('view.settings.header') }}</span>
            </div>
            <TabsUnderline v-model="activeTab" :items="settingsTabs" :unmount-on-hide="false" fill>
                <template #system>
                    <SystemTab />
                </template>
                <template #interface>
                    <InterfaceTab />
                </template>
                <template #social>
                    <SocialTab />
                </template>
                <template #dlcx>
                    <DLCXTab />
                </template>
                <template #notifications>
                    <NotificationsTab />
                </template>
                <template #vr>
                    <VrTab />
                </template>
                <template #media>
                    <MediaTab />
                </template>
                <template #integrations>
                    <IntegrationsTab />
                </template>
                <template #advanced>
                    <AdvancedTab />
                </template>
            </TabsUnderline>
        </div>
    </div>
</template>

<script setup>
    import { computed, onBeforeMount } from 'vue';
    import { useRoute, useRouter } from 'vue-router';
    import { TabsUnderline } from '@/components/ui/tabs';
    import { useI18n } from 'vue-i18n';

    import AdvancedTab from './components/Tabs/AdvancedTab.vue';
    import InterfaceTab from './components/Tabs/InterfaceTab.vue';
    import IntegrationsTab from './components/Tabs/IntegrationsTab.vue';
    import MediaTab from './components/Tabs/MediaTab.vue';
    import NotificationsTab from './components/Tabs/NotificationsTab.vue';
    import DLCXTab from './components/Tabs/DLCXTab.vue';
    import SocialTab from './components/Tabs/SocialTab.vue';
    import SystemTab from './components/Tabs/SystemTab.vue';
    import VrTab from './components/Tabs/VrTab.vue';

    const { t } = useI18n();
    const route = useRoute();
    const router = useRouter();
    const settingsTabs = computed(() => [
        { value: 'system', label: t('view.settings.category.system') },
        { value: 'interface', label: t('view.settings.category.interface') },
        { value: 'social', label: t('view.settings.category.social') },
        { value: 'dlcx', label: t('view.settings.category.dlcx') },
        { value: 'notifications', label: t('view.settings.category.notifications') },
        { value: 'vr', label: t('view.settings.category.vr') },
        { value: 'media', label: t('view.settings.category.media') },
        { value: 'integrations', label: t('view.settings.category.integrations') },
        { value: 'advanced', label: t('view.settings.category.advanced') }
    ]);

    const activeTab = computed({
        get() {
            const requestedTab = typeof route.query.tab === 'string' ? route.query.tab : '';
            return settingsTabs.value.some((tab) => tab.value === requestedTab) ? requestedTab : 'system';
        },
        set(tab) {
            router.replace({ query: { ...route.query, tab } });
        }
    });

    onBeforeMount(() => {
        const menuItem = document.querySelector('li[role="menuitem"].is-active');

        if (menuItem) {
            menuItem.classList.remove('is-active');
        }
    });
</script>

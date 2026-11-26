<template>
    <Dialog :open="visible" @update:open="handleVisibilityChange">
        <DialogContent class="border-border bg-background/95 sm:max-w-xl" :show-close-button="false">
            <DialogHeader class="text-left">
                <div class="mb-3 flex items-center justify-between gap-4">
                    <div
                        class="flex items-center gap-1.5"
                        :aria-label="t('onboarding.dlcx.progress', { current: step + 1, total: steps.length })">
                        <span
                            v-for="index in steps.length"
                            :key="index"
                            class="h-1.5 rounded-full transition-all duration-200"
                            :class="index - 1 === step ? 'w-7 bg-primary' : 'w-3 bg-muted'"
                            :aria-current="index - 1 === step ? 'step' : undefined"></span>
                    </div>
                    <span class="text-xs tabular-nums text-muted-foreground">{{ step + 1 }} / {{ steps.length }}</span>
                </div>
                <DialogTitle class="text-xl">{{ t(steps[step].titleKey) }}</DialogTitle>
                <DialogDescription class="leading-relaxed">
                    {{ t(steps[step].descriptionKey) }}
                </DialogDescription>
            </DialogHeader>

            <div class="min-h-60 py-2">
                <div v-if="step === 0" class="flex h-full flex-col items-center justify-center py-5 text-center">
                    <img :src="vrcxLogo" alt="VRCX" class="mb-5 size-20 rounded-2xl shadow-md" />
                    <div
                        class="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-xs font-medium text-primary">
                        <Sparkles class="size-3.5" />
                        DLCX
                    </div>
                    <p class="mt-4 max-w-md text-sm leading-7 text-muted-foreground">
                        {{ t('onboarding.dlcx.welcome.detail') }}
                    </p>
                </div>

                <div v-else-if="step === 1" class="grid gap-3 sm:grid-cols-2">
                    <div
                        v-for="feature in features"
                        :key="feature.titleKey"
                        class="rounded-xl border border-border/70 bg-muted/35 p-4">
                        <div class="mb-3 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <component :is="feature.icon" class="size-4.5" />
                        </div>
                        <h3 class="mb-1.5 text-sm font-semibold">{{ t(feature.titleKey) }}</h3>
                        <p class="text-xs leading-5 text-muted-foreground">{{ t(feature.descriptionKey) }}</p>
                    </div>
                </div>

                <div v-else-if="step === 2" class="rounded-xl border border-border/70 bg-muted/35 p-5">
                    <ol class="space-y-4">
                        <li
                            v-for="(watchStep, index) in watchSteps"
                            :key="watchStep.titleKey"
                            class="flex items-start gap-3">
                            <span
                                class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                                {{ index + 1 }}
                            </span>
                            <div>
                                <h3 class="text-sm font-semibold">{{ t(watchStep.titleKey) }}</h3>
                                <p class="mt-1 text-xs leading-5 text-muted-foreground">
                                    {{ t(watchStep.descriptionKey) }}
                                </p>
                            </div>
                        </li>
                    </ol>
                </div>

                <div v-else-if="step === 3" class="space-y-3">
                    <div class="grid gap-3 sm:grid-cols-3">
                        <div
                            v-for="dlcFeature in dlcFeatures"
                            :key="dlcFeature.titleKey"
                            class="rounded-xl border border-border/70 bg-muted/35 p-4">
                            <div
                                class="mb-3 flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <component :is="dlcFeature.icon" class="size-4.5" />
                            </div>
                            <h3 class="mb-1.5 text-sm font-semibold">{{ t(dlcFeature.titleKey) }}</h3>
                            <p class="text-xs leading-5 text-muted-foreground">{{ t(dlcFeature.descriptionKey) }}</p>
                        </div>
                    </div>
                    <div class="flex items-start gap-2.5 rounded-lg bg-muted/35 p-3 text-xs text-muted-foreground">
                        <Info class="mt-0.5 size-4 shrink-0 text-primary" />
                        <span class="leading-5">{{ t('onboarding.dlcx.dlc.note') }}</span>
                    </div>
                </div>

                <div v-else-if="step === 4" class="rounded-xl border border-border/70 bg-muted/35 p-5">
                    <div class="mb-5 flex items-start gap-4">
                        <div
                            class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                            <ShieldCheck class="size-5" />
                        </div>
                        <div>
                            <h3 class="font-semibold">{{ t('onboarding.dlcx.sharing.off_title') }}</h3>
                            <p class="mt-1 text-sm leading-6 text-muted-foreground">
                                {{ t('onboarding.dlcx.sharing.off_description') }}
                            </p>
                        </div>
                    </div>
                    <ul class="space-y-3 text-sm">
                        <li v-for="point in sharingPoints" :key="point" class="flex items-start gap-2.5">
                            <Check class="mt-0.5 size-4 shrink-0 text-primary" />
                            <span class="leading-5 text-muted-foreground">{{ t(point) }}</span>
                        </li>
                    </ul>
                </div>

                <div v-else class="space-y-4">
                    <div class="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
                        <div class="mb-4 flex items-start gap-4">
                            <div
                                class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                                <AlertTriangle class="size-5" />
                            </div>
                            <div>
                                <h3 class="font-semibold">{{ t('onboarding.dlcx.background.warning_title') }}</h3>
                                <p class="mt-1 text-sm leading-6 text-muted-foreground">
                                    {{ t('onboarding.dlcx.background.warning_description') }}
                                </p>
                            </div>
                        </div>
                        <ul class="space-y-3 text-sm">
                            <li v-for="point in backgroundPoints" :key="point.key" class="flex items-start gap-2.5">
                                <component :is="point.icon" class="mt-0.5 size-4 shrink-0" :class="point.iconClass" />
                                <span class="leading-5 text-muted-foreground">{{ t(point.key) }}</span>
                            </li>
                        </ul>
                    </div>
                    <div class="flex flex-col items-center justify-center py-2 text-center">
                        <div
                            class="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <Check class="size-6" />
                        </div>
                        <h3 class="text-base font-semibold">{{ t('onboarding.dlcx.done.ready') }}</h3>
                        <p class="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                            {{ t('onboarding.dlcx.done.detail') }}
                        </p>
                    </div>
                </div>
            </div>

            <DialogFooter class="flex-row items-center justify-between gap-3 sm:justify-between">
                <Button v-if="step < steps.length - 1" variant="ghost" @click="completeOnboarding">
                    {{ t('onboarding.dlcx.actions.skip') }}
                </Button>
                <span v-else></span>
                <div class="flex items-center gap-2">
                    <Button v-if="step > 0 && step < steps.length - 1" variant="outline" @click="step--">
                        <ArrowLeft class="size-4" />
                        {{ t('onboarding.dlcx.actions.back') }}
                    </Button>
                    <Button @click="handleNext">
                        {{
                            t(
                                step === steps.length - 1
                                    ? 'onboarding.dlcx.actions.finish'
                                    : 'onboarding.dlcx.actions.next'
                            )
                        }}
                        <ArrowRight v-if="step < steps.length - 1" class="size-4" />
                        <Check v-else class="size-4" />
                    </Button>
                </div>
            </DialogFooter>
        </DialogContent>
    </Dialog>
</template>

<script setup>
    import { ref } from 'vue';
    import { useEventListener } from '@vueuse/core';
    import {
        Activity,
        AlertTriangle,
        ArrowLeft,
        ArrowRight,
        Check,
        Cloud,
        Globe,
        Info,
        RefreshCw,
        ShieldCheck,
        Sparkles,
        Users,
        UsersRound
    } from 'lucide-vue-next';
    import { useI18n } from 'vue-i18n';

    import { Button } from '@/components/ui/button';
    import {
        Dialog,
        DialogContent,
        DialogDescription,
        DialogFooter,
        DialogHeader,
        DialogTitle
    } from '@/components/ui/dialog';
    import vrcxLogo from '../../../images/VRCX.png';
    import { DLCX_REPLAY_ONBOARDING_EVENT } from '../../shared/constants/dlcxEvents';

    const ONBOARDED_KEY = 'VRCX_dlcx_onboarded';
    const { t } = useI18n();
    const step = ref(0);
    const visible = ref(shouldShowOnboarding());

    useEventListener(window, DLCX_REPLAY_ONBOARDING_EVENT, () => {
        step.value = 0;
        visible.value = true;
    });

    const steps = [
        {
            titleKey: 'onboarding.dlcx.welcome.title',
            descriptionKey: 'onboarding.dlcx.welcome.description'
        },
        {
            titleKey: 'onboarding.dlcx.features.title',
            descriptionKey: 'onboarding.dlcx.features.description'
        },
        {
            titleKey: 'onboarding.dlcx.watch.title',
            descriptionKey: 'onboarding.dlcx.watch.description'
        },
        {
            titleKey: 'onboarding.dlcx.dlc.title',
            descriptionKey: 'onboarding.dlcx.dlc.description'
        },
        {
            titleKey: 'onboarding.dlcx.sharing.title',
            descriptionKey: 'onboarding.dlcx.sharing.description'
        },
        {
            titleKey: 'onboarding.dlcx.background.title',
            descriptionKey: 'onboarding.dlcx.background.description'
        }
    ];
    const features = [
        {
            icon: Globe,
            titleKey: 'onboarding.dlcx.features.worlds_title',
            descriptionKey: 'onboarding.dlcx.features.worlds_description'
        },
        {
            icon: Users,
            titleKey: 'onboarding.dlcx.features.mutual_title',
            descriptionKey: 'onboarding.dlcx.features.mutual_description'
        },
        {
            icon: Activity,
            titleKey: 'onboarding.dlcx.features.groups_title',
            descriptionKey: 'onboarding.dlcx.features.groups_description'
        },
        {
            icon: Cloud,
            titleKey: 'onboarding.dlcx.features.sharing_title',
            descriptionKey: 'onboarding.dlcx.features.sharing_description'
        }
    ];
    const watchSteps = [
        {
            titleKey: 'onboarding.dlcx.watch.step_open_title',
            descriptionKey: 'onboarding.dlcx.watch.step_open_description'
        },
        {
            titleKey: 'onboarding.dlcx.watch.step_add_title',
            descriptionKey: 'onboarding.dlcx.watch.step_add_description'
        },
        {
            titleKey: 'onboarding.dlcx.watch.step_alert_title',
            descriptionKey: 'onboarding.dlcx.watch.step_alert_description'
        }
    ];
    const dlcFeatures = [
        {
            icon: UsersRound,
            titleKey: 'onboarding.dlcx.dlc.friend_network_title',
            descriptionKey: 'onboarding.dlcx.dlc.friend_network_description'
        },
        {
            icon: Activity,
            titleKey: 'onboarding.dlcx.dlc.observed_title',
            descriptionKey: 'onboarding.dlcx.dlc.observed_description'
        },
        {
            icon: RefreshCw,
            titleKey: 'onboarding.dlcx.dlc.groups_title',
            descriptionKey: 'onboarding.dlcx.dlc.groups_description'
        }
    ];
    const sharingPoints = [
        'onboarding.dlcx.sharing.point_default',
        'onboarding.dlcx.sharing.point_public',
        'onboarding.dlcx.sharing.point_settings'
    ];
    const backgroundPoints = [
        {
            key: 'onboarding.dlcx.background.point_local',
            icon: AlertTriangle,
            iconClass: 'text-amber-500'
        },
        {
            key: 'onboarding.dlcx.background.point_missed',
            icon: AlertTriangle,
            iconClass: 'text-amber-500'
        },
        {
            key: 'onboarding.dlcx.background.point_cloud',
            icon: Cloud,
            iconClass: 'text-primary'
        }
    ];

    function shouldShowOnboarding() {
        try {
            return !localStorage.getItem(ONBOARDED_KEY);
        } catch {
            return true;
        }
    }

    function completeOnboarding() {
        try {
            localStorage.setItem(ONBOARDED_KEY, 'true');
        } catch {
            // Do not block the application when persistent storage is unavailable.
        }
        visible.value = false;
    }

    function handleVisibilityChange(open) {
        if (!open) {
            completeOnboarding();
        }
    }

    function handleNext() {
        if (step.value === steps.length - 1) {
            completeOnboarding();
            return;
        }
        step.value++;
    }
</script>

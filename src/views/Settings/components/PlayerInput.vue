<template>
    <div v-bind="$attrs">
        <Popover :open="isOpen && candidates.length > 0" @update:open="handleOpenChange">
            <PopoverTrigger as-child>
                <Input
                    :model-value="modelValue"
                    class="w-full"
                    :placeholder="placeholder"
                    :disabled="disabled"
                    role="combobox"
                    autocomplete="off"
                    :aria-expanded="isOpen && candidates.length > 0"
                    :aria-controls="listboxId"
                    :aria-activedescendant="activeDescendant"
                    :aria-busy="resolving"
                    @update:model-value="updateInput"
                    @keydown="handleKeydown" />
            </PopoverTrigger>
            <PopoverContent
                class="w-(--reka-popover-trigger-width) min-w-72 overflow-hidden p-1"
                align="start"
                :side-offset="4"
                @open-auto-focus.prevent
                @close-auto-focus.prevent>
                <div v-if="resolving" class="text-muted-foreground flex items-center gap-2 border-b px-2 py-2 text-xs">
                    <Spinner class="size-3.5" />
                    {{ t('view.oversee.player_input.searching') }}
                </div>
                <div :id="listboxId" role="listbox" class="max-h-80 overflow-y-auto">
                    <button
                        v-for="(candidate, index) in candidates"
                        :id="optionId(index)"
                        :key="candidate.usrId"
                        type="button"
                        role="option"
                        :aria-selected="activeIndex === index"
                        class="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-left outline-none"
                        :class="activeIndex === index ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'"
                        @mousedown.prevent
                        @mouseenter="activeIndex = index"
                        @click="selectCandidate(candidate)">
                        <Avatar class="size-9 flex-none">
                            <AvatarImage v-if="candidate.avatar" :src="candidate.avatar" loading="lazy" />
                            <AvatarFallback>
                                <User class="text-muted-foreground size-4" />
                            </AvatarFallback>
                        </Avatar>
                        <span class="min-w-0 flex-1">
                            <span class="flex min-w-0 items-center gap-2">
                                <span class="truncate text-sm font-medium">{{ candidate.displayName }}</span>
                                <Badge
                                    :variant="sourceBadgeVariant(candidate.source)"
                                    class="flex-none px-1.5 text-[10px]">
                                    {{ t(`view.oversee.player_input.source_${candidate.source}`) }}
                                </Badge>
                            </span>
                            <span class="text-muted-foreground block truncate font-mono text-xs">
                                {{ shortenUserId(candidate.usrId) }}
                            </span>
                        </span>
                    </button>
                </div>
            </PopoverContent>
        </Popover>
    </div>
</template>

<script setup>
    import { computed, onUnmounted, ref, useId, watch } from 'vue';
    import { useI18n } from 'vue-i18n';

    import { User } from 'lucide-vue-next';
    import { toast } from 'vue-sonner';

    import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
    import { Badge } from '@/components/ui/badge';
    import { Input } from '@/components/ui/input';
    import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
    import { Spinner } from '@/components/ui/spinner';
    import { classifyPlayerInput, resolveLocalCandidates, resolvePlayerInput } from '@/services/overseeResolve';

    defineOptions({ inheritAttrs: false });

    const props = defineProps({
        modelValue: { type: String, default: '' },
        placeholder: { type: String, default: '' },
        disabled: { type: Boolean, default: false }
    });
    const emit = defineEmits(['update:modelValue', 'select']);

    const { t } = useI18n();
    const listboxId = `oversee-player-listbox-${useId()}`;
    const candidates = ref([]);
    const isOpen = ref(false);
    const activeIndex = ref(-1);
    const resolving = ref(false);
    let debounceTimer;
    let localRequestId = 0;
    let submitRequestId = 0;

    const activeDescendant = computed(() =>
        isOpen.value && activeIndex.value >= 0 ? optionId(activeIndex.value) : undefined
    );

    watch(
        () => props.disabled,
        (disabled) => {
            if (disabled) {
                closeCandidates();
            }
        }
    );

    /**
     * @param {string | number} value
     */
    function updateInput(value) {
        const text = String(value ?? '');
        emit('update:modelValue', text);
        submitRequestId++;
        resolving.value = false;
        scheduleLocalCandidates(text);
    }

    /**
     * @param {string} text
     */
    function scheduleLocalCandidates(text) {
        clearTimeout(debounceTimer);
        const requestId = ++localRequestId;
        const input = classifyPlayerInput(text);
        if (input.type !== 'name' || input.value.length < 2 || props.disabled) {
            closeCandidates();
            return;
        }
        debounceTimer = setTimeout(async () => {
            let nextCandidates = [];
            try {
                nextCandidates = await resolveLocalCandidates(input.value);
            } catch {
                // 本地联想失败不打断显式提交时的 VRChat 降级搜索。
            }
            if (requestId !== localRequestId || props.modelValue.trim() !== input.value) {
                return;
            }
            candidates.value = nextCandidates;
            activeIndex.value = -1;
            isOpen.value = nextCandidates.length > 0;
        }, 300);
    }

    /**
     * @param {KeyboardEvent} event
     */
    function handleKeydown(event) {
        if (props.disabled) {
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            if (!candidates.value.length) {
                return;
            }
            event.preventDefault();
            isOpen.value = true;
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            if (activeIndex.value < 0) {
                activeIndex.value = direction > 0 ? 0 : candidates.value.length - 1;
            } else {
                activeIndex.value = (activeIndex.value + direction + candidates.value.length) % candidates.value.length;
            }
            document.getElementById(optionId(activeIndex.value))?.scrollIntoView({ block: 'nearest' });
            return;
        }
        if (event.key === 'Escape' && isOpen.value) {
            event.preventDefault();
            event.stopPropagation();
            closeCandidates();
            return;
        }
        if (event.key !== 'Enter' || event.isComposing) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (isOpen.value && activeIndex.value >= 0 && candidates.value[activeIndex.value]) {
            selectCandidate(candidates.value[activeIndex.value]);
            return;
        }
        void submit();
    }

    /**
     * 显式提交（Enter / 外部查询按钮）。官方搜索只在这条路径中触发一次。
     *
     * @returns {Promise<void>}
     */
    async function submit() {
        if (props.disabled || resolving.value) {
            return;
        }
        clearTimeout(debounceTimer);
        localRequestId++;
        const text = props.modelValue.trim();
        if (!text) {
            toast.error(t('view.oversee.error.invalidId'));
            return;
        }
        const input = classifyPlayerInput(text);
        if (input.type !== 'name') {
            selectCandidate({ usrId: input.value, displayName: input.value, source: 'local' });
            return;
        }
        const requestId = ++submitRequestId;
        resolving.value = true;
        try {
            const result = await resolvePlayerInput(text);
            if (requestId !== submitRequestId) {
                return;
            }
            if (result.vrcUnavailable) {
                toast.warning(
                    t(
                        result.status === 'notFound'
                            ? 'view.oversee.player_input.not_found_vrc_unavailable'
                            : 'view.oversee.player_input.vrc_unavailable'
                    )
                );
            }
            if (result.status === 'selected' && result.candidate) {
                selectCandidate(result.candidate);
            } else if (result.status === 'multiple') {
                candidates.value = result.candidates;
                activeIndex.value = 0;
                isOpen.value = true;
            } else if (result.status === 'notFound') {
                closeCandidates();
                if (!result.vrcUnavailable) {
                    toast.error(t('view.oversee.player_input.not_found', { name: input.value }));
                }
            }
        } finally {
            if (requestId === submitRequestId) {
                resolving.value = false;
            }
        }
    }

    /**
     * @param {import('@/services/overseeResolve').PlayerCandidate} candidate
     */
    function selectCandidate(candidate) {
        submitRequestId++;
        localRequestId++;
        resolving.value = false;
        closeCandidates();
        emit('update:modelValue', candidate.usrId);
        emit('select', candidate);
    }

    function closeCandidates() {
        isOpen.value = false;
        activeIndex.value = -1;
    }

    /**
     * @param {boolean} open
     */
    function handleOpenChange(open) {
        isOpen.value = open && candidates.value.length > 0;
        if (!isOpen.value) {
            activeIndex.value = -1;
        }
    }

    /**
     * @param {number} index
     * @returns {string}
     */
    function optionId(index) {
        return `${listboxId}-${index}`;
    }

    /**
     * @param {string} usrId
     * @returns {string}
     */
    function shortenUserId(usrId) {
        return usrId.length > 20 ? `${usrId.slice(0, 12)}…${usrId.slice(-4)}` : usrId;
    }

    /**
     * @param {'local' | 'friend' | 'vrc'} source
     * @returns {'secondary' | 'default' | 'outline'}
     */
    function sourceBadgeVariant(source) {
        if (source === 'friend') {
            return 'default';
        }
        return source === 'vrc' ? 'outline' : 'secondary';
    }

    onUnmounted(() => {
        clearTimeout(debounceTimer);
        localRequestId++;
        submitRequestId++;
    });

    defineExpose({ submit });
</script>

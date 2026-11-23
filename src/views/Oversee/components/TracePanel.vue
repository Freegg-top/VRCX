<template>
    <div class="flex min-h-0 flex-col gap-3">
        <div v-if="!userId" class="flex flex-wrap items-center gap-2">
            <PlayerInput
                ref="playerInputRef"
                v-model="queryInput"
                class="w-80"
                :disabled="loading"
                :placeholder="t('view.oversee.trace.input_placeholder')"
                @select="handlePlayerSelect" />
            <Button :disabled="loading" @click="query">
                <Spinner v-if="loading" class="size-4" />
                {{ t('view.oversee.query') }}
            </Button>
        </div>

        <div v-if="errorKind" class="text-destructive text-sm">
            {{ t(`view.oversee.error.${errorKind}`) }}
        </div>

        <template v-if="loaded">
            <div v-if="profile" class="flex items-center gap-3 rounded-lg border p-3">
                <div class="size-12 flex-none overflow-hidden rounded-full">
                    <img
                        v-if="profile.avatar_url"
                        class="size-full object-cover"
                        :src="profile.avatar_url"
                        loading="lazy" />
                    <div v-else class="bg-muted flex size-full items-center justify-center">
                        <User class="text-muted-foreground size-6" />
                    </div>
                </div>
                <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium">
                        {{ displayName }}
                    </div>
                    <div class="text-muted-foreground truncate font-mono text-xs">
                        {{ targetUserId }}
                    </div>
                    <div class="text-muted-foreground mt-1 flex flex-wrap gap-x-3 text-xs">
                        <span>
                            {{ t('view.oversee.trace.first_seen') }}
                            {{ formatDate(profile.first_seen) }}
                        </span>
                        <span>
                            {{ t('view.oversee.trace.last_seen') }}
                            {{ formatDate(profile.last_seen) }}
                        </span>
                    </div>
                </div>
                <Button size="sm" :variant="watched ? 'destructive' : 'outline'" @click="toggleWatch">
                    {{ watched ? t('view.oversee.watch_remove') : t('view.oversee.watch_add') }}
                </Button>
            </div>

            <div v-if="groups.length === 0" class="text-muted-foreground py-6 text-center text-sm">
                {{ t('view.oversee.trace.empty') }}
            </div>

            <div v-else class="flex flex-col gap-3">
                <div v-for="group in visibleGroups" :key="group.worldId" class="rounded-lg border p-3">
                    <div
                        class="hover:bg-accent -m-1 mb-1 flex cursor-pointer items-center gap-3 rounded-md p-1"
                        @click="openWorld(group.worldId)">
                        <img
                            v-if="worldThumbnail(group.worldId)"
                            class="size-12 flex-none rounded-md object-cover"
                            :src="worldThumbnail(group.worldId)"
                            loading="lazy" />
                        <div v-else class="bg-muted flex size-12 flex-none items-center justify-center rounded-md">
                            <Globe class="text-muted-foreground size-5" />
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5">
                                <span class="truncate text-sm font-medium">
                                    {{ worldDisplayName(group.worldId) }}
                                </span>
                                <Badge variant="secondary" class="text-xs">
                                    {{ t('view.oversee.trace.visits', { count: group.count }) }}
                                </Badge>
                            </div>
                            <div class="text-muted-foreground mt-1 text-xs">
                                {{ formatDate(group.firstAt) }} ~ {{ formatDate(group.lastAt) }}
                            </div>
                        </div>
                    </div>
                    <div class="mt-2 flex flex-col gap-1">
                        <div
                            v-for="(entry, index) in group.entries"
                            :key="`${entry.at}-${entry.instance_id}-${index}`"
                            class="text-muted-foreground flex items-center gap-2 text-xs">
                            <span class="bg-muted inline-block size-1.5 flex-none rounded-full" />
                            <span class="flex-none">
                                {{ formatDateTime(entry.at) }}
                            </span>
                            <span class="truncate font-mono">
                                {{ shortenInstanceId(entry.instance_id || entry.location) }}
                            </span>
                        </div>
                    </div>
                </div>

                <div v-if="groups.length > visibleCount" class="py-2 text-center">
                    <Button variant="outline" size="sm" @click="visibleCount += 30">
                        {{ t('view.oversee.trace.show_more') }}
                    </Button>
                </div>
            </div>
        </template>

        <div v-else-if="!userId" class="text-muted-foreground py-6 text-center text-sm">
            {{ t('view.oversee.trace.hint') }}
        </div>
    </div>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import { useI18n } from 'vue-i18n';

    import dayjs from 'dayjs';
    import { Globe, User } from 'lucide-vue-next';

    import { Badge } from '@/components/ui/badge';
    import { Button } from '@/components/ui/button';
    import { Spinner } from '@/components/ui/spinner';
    import { useOverseeSettingsStore } from '@/stores';
    import { showWorldDialog } from '@/coordinators/worldCoordinator';
    import { getUserHistory, OverseeApiError } from '@/services/overseeApi';
    import { LatestRequestGate } from '@/services/overseeRequestGate';
    import { groupHistoryByWorld, shortenInstanceId, shortenWorldId } from '@/services/database/overseeMerge';
    import { showOverseeError } from '../overseeUi';
    import { ensureWorldMeta, preloadWorldNames, resolveWorldEntry, resolveWorldName } from '../worldDisplay';
    import PlayerInput from './PlayerInput.vue';

    const props = defineProps({
        // 传入时 (UserDialog) 隐藏搜索框, 由 load() 驱动查询
        userId: {
            type: String,
            default: ''
        }
    });

    const { t } = useI18n();

    const overseeSettingsStore = useOverseeSettingsStore();

    const queryInput = ref('');
    const playerInputRef = ref(null);
    const loading = ref(false);
    const loaded = ref(false);
    const errorKind = ref('');
    /** @type {import('vue').Ref<object | null>} */
    const profile = ref(null);
    /** @type {import('vue').Ref<object[]>} */
    const history = ref([]);
    const targetUserId = ref('');
    const lastLoadedUserId = ref('');
    // loading 期间 UserDialog 切换用户时记录的待加载目标, 当前请求完成后补载
    const pendingUserId = ref('');
    // "只接受最新请求"门控: 旧响应不得覆盖新目标的界面状态
    const requestGate = new LatestRequestGate();

    // 世界分组"加载更多": 每页 30 个世界, 新查询重置
    const visibleCount = ref(30);

    const watched = computed(() => (targetUserId.value ? overseeSettingsStore.isWatched(targetUserId.value) : false));

    const displayName = computed(() => {
        const name = String(profile.value?.display_name || '').trim();
        return name || targetUserId.value;
    });

    const groups = computed(() => groupHistoryByWorld(history.value));

    const visibleGroups = computed(() => groups.value.slice(0, visibleCount.value));

    // 只预热当前可见分组；“显示更多”改变 visibleGroups 时再处理新增分组。
    watch(
        visibleGroups,
        (currentGroups) => {
            const worldIds = currentGroups.map((group) => group.worldId);
            void preloadWorldNames(worldIds);
            for (const worldId of worldIds) {
                void ensureWorldMeta(worldId);
            }
        },
        { immediate: true }
    );

    // 世界名/缩略图: 缓存命中同步返回, 未命中显示截短 id, 后台预热后响应式回填
    function worldDisplayName(worldId) {
        return resolveWorldName(worldId) || shortenWorldId(worldId);
    }

    function worldThumbnail(worldId) {
        return resolveWorldEntry(worldId).thumbnail;
    }

    function openWorld(worldId) {
        showWorldDialog(worldId);
    }

    /**
     * 查询轨迹. UserDialog 场景同 userId 重复激活时跳过 (含失败态), 用户切换才重新拉取;
     * loading 期间切人时记录待加载目标, 当前请求完成后补载.
     *
     * @param {string} [forceUserId] 外部指定的目标用户 (UserDialog)
     * @returns {Promise<void>}
     */
    async function load(forceUserId = '') {
        if (props.userId) {
            const id = forceUserId || props.userId;
            if (!id || id === lastLoadedUserId.value) {
                return;
            }
            if (loading.value) {
                pendingUserId.value = id;
                return;
            }
            await runQuery(id);
            return;
        }
        query();
    }

    async function query() {
        if (loading.value) {
            return;
        }
        await playerInputRef.value?.submit();
    }

    /**
     * 选中候选（含直接输入的 usr_id/URL）后立即执行原轨迹查询。
     *
     * @param {{ usrId: string }} candidate
     */
    function handlePlayerSelect(candidate) {
        if (loading.value) {
            return;
        }
        queryInput.value = candidate.usrId;
        void runQuery(candidate.usrId);
    }

    async function runQuery(id) {
        const token = requestGate.begin();
        loading.value = true;
        errorKind.value = '';
        loaded.value = false;
        profile.value = null;
        history.value = [];
        try {
            const data = await getUserHistory(id);
            // 已切到新目标: 旧响应直接丢弃, 不回写任何状态
            if (!requestGate.isCurrent(token)) {
                return;
            }
            targetUserId.value = id;
            lastLoadedUserId.value = id;
            profile.value = data?.user || null;
            history.value = Array.isArray(data?.history) ? data.history : [];
            visibleCount.value = 30;
            loaded.value = true;
        } catch (error) {
            if (!requestGate.isCurrent(token)) {
                return;
            }
            // 失败路径也记录目标, 阻止重复请求与重复 toast
            lastLoadedUserId.value = id;
            if (error instanceof OverseeApiError && error.kind === 'notFound') {
                targetUserId.value = id;
                errorKind.value = 'notFound';
                loaded.value = true;
            } else {
                errorKind.value = String(error?.kind || 'server');
                showOverseeError(error, t);
            }
        } finally {
            if (requestGate.isCurrent(token)) {
                loading.value = false;
                const next = pendingUserId.value;
                pendingUserId.value = '';
                if (next) {
                    void runQuery(next);
                }
            }
        }
    }

    function toggleWatch() {
        if (!targetUserId.value) {
            return;
        }
        if (watched.value) {
            overseeSettingsStore.removeWatch(targetUserId.value);
        } else {
            overseeSettingsStore.addWatch(targetUserId.value);
        }
    }

    /**
     * @param date
     */
    function formatDate(date) {
        return date ? dayjs(date).format('YYYY-MM-DD') : '-';
    }

    /**
     * @param date
     */
    function formatDateTime(date) {
        return date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-';
    }

    defineExpose({ load });

    // UserDialog 模式: 目标用户变化时自动重查
    if (props.userId) {
        watch(
            () => props.userId,
            (id) => {
                lastLoadedUserId.value = '';
                if (id) {
                    load(id);
                }
            }
        );
    }
</script>

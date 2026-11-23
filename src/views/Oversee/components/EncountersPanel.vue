<template>
    <div class="flex min-h-0 flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
            <Button :disabled="loading || !selfId" @click="load()">
                <Spinner v-if="loading" class="size-4" />
                {{ t('view.oversee.query') }}
            </Button>
            <Button
                variant="ghost"
                size="icon-sm"
                :disabled="loading || !selfId"
                :aria-label="t('view.oversee.encounters.refresh')"
                :title="t('view.oversee.encounters.refresh')"
                @click="load(true)">
                <RefreshCw class="size-4" />
            </Button>
            <span v-if="cloudPending" class="text-muted-foreground text-xs">
                {{ t('view.oversee.encounters.cloud_pending') }}
            </span>
        </div>

        <div v-if="!selfId" class="text-muted-foreground py-6 text-center text-sm">
            {{ t('view.oversee.not_logged_in') }}
        </div>

        <template v-else-if="loaded">
            <div v-if="rows.length === 0" class="text-muted-foreground py-6 text-center text-sm">
                {{ t('view.oversee.encounters.empty') }}
            </div>

            <div v-else class="flex flex-col">
                <Item
                    v-for="row in visibleRows"
                    :key="row.userId"
                    class="rounded-none"
                    :class="row.hasUserId ? 'cursor-pointer hover:bg-muted' : 'cursor-default'"
                    @click="onRowClick(row)">
                    <ItemMedia class="relative size-10">
                        <Avatar class="size-full">
                            <AvatarImage v-if="row.avatarUrl" :src="row.avatarUrl" loading="lazy" />
                            <AvatarFallback>
                                <User class="text-muted-foreground size-5" />
                            </AvatarFallback>
                        </Avatar>
                    </ItemMedia>
                    <ItemContent class="min-w-0">
                        <ItemTitle class="flex max-w-full items-center gap-1.5">
                            <span class="truncate">
                                {{ row.displayName }}
                            </span>
                            <Badge :variant="sourceBadgeVariant(row.source)" class="text-xs">
                                {{ t(`view.oversee.encounters.source_${row.source}`) }}
                            </Badge>
                        </ItemTitle>
                        <ItemDescription class="line-clamp-1 text-xs!">
                            {{
                                t('view.oversee.encounters.co_seen', {
                                    count: row.count
                                })
                            }}
                            ·
                            {{ t('view.oversee.encounters.last_seen') }}
                            {{ formatDateTime(row.lastSeen) }}
                        </ItemDescription>
                    </ItemContent>
                </Item>
            </div>

            <div v-if="rows.length > visibleCount" class="py-2 text-center">
                <Button variant="outline" size="sm" @click="visibleCount += 100">
                    {{ t('view.oversee.encounters.show_more') }}
                </Button>
            </div>
        </template>

        <div v-else class="text-muted-foreground py-6 text-center text-sm">
            {{ t('view.oversee.encounters.hint') }}
        </div>
    </div>
</template>

<script>
    const ENCOUNTER_CACHE_TTL_MS = 10 * 60 * 1000;
    const encounterRowsCache = new Map();

    export function clearOverseeEncountersCache() {
        encounterRowsCache.clear();
    }
</script>

<script setup>
    import { computed, ref } from 'vue';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import dayjs from 'dayjs';
    import { RefreshCw, User } from 'lucide-vue-next';

    import { Badge } from '@/components/ui/badge';
    import { Button } from '@/components/ui/button';
    import { Spinner } from '@/components/ui/spinner';
    import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
    import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
    import { useUserStore } from '@/stores';
    import { showUserDialog } from '@/coordinators/userCoordinator';
    import { database } from '@/services/database';
    import { getUserConnections, OverseeApiError } from '@/services/overseeApi';
    import { computeLocalCoSeen, mergeEncounterEntries } from '@/services/database/overseeMerge';
    import { showOverseeError } from '../overseeUi';

    const { t } = useI18n();

    const { currentUser } = storeToRefs(useUserStore());

    const loading = ref(false);
    const loaded = ref(false);
    /** @type {import('vue').Ref<object[]>} */
    const rows = ref([]);
    const cloudPending = ref(false);
    const visibleCount = ref(100);
    const visibleRows = computed(() => rows.value.slice(0, visibleCount.value));

    const selfId = computed(() => {
        const id = String(currentUser.value?.id || '');
        return id.startsWith('usr_') ? id : '';
    });

    /**
     * @param source
     */
    function sourceBadgeVariant(source) {
        if (source === 'both') {
            return 'default';
        }
        if (source === 'cloud') {
            return 'secondary';
        }
        return 'outline';
    }

    /**
     * @param {boolean} [force=false] Bypass the TTL cache for a manual refresh. Default is `false`
     */
    async function load(force = false) {
        if (loading.value || !selfId.value) {
            return;
        }
        const userId = selfId.value;
        if (!force) {
            const cached = encounterRowsCache.get(userId);
            if (cached && cached.expiresAt > Date.now()) {
                rows.value = cached.rows;
                visibleCount.value = 100;
                cloudPending.value = false;
                loaded.value = true;
                return;
            }
            encounterRowsCache.delete(userId);
        }
        loading.value = true;
        cloudPending.value = false;
        let localMap = new Map();
        try {
            const localRows = await database.getLocalCoSeenRows(userId);
            localMap = computeLocalCoSeen(localRows, userId);
        } catch (error) {
            console.error('[oversee] local co-seen query failed:', error);
        }
        /** @type {object[]} */
        let cloudResults = [];
        try {
            const data = await getUserConnections(userId);
            cloudResults = Array.isArray(data?.results) ? data.results : [];
        } catch (error) {
            // notFound = 云端无我的记录, 视为待同步而非错误; 其余弹提示后降级为本地数据
            cloudPending.value = true;
            if (!(error instanceof OverseeApiError && error.kind === 'notFound')) {
                showOverseeError(error, t);
            }
        }
        try {
            const mergedRows = mergeEncounterEntries(localMap, cloudResults);
            encounterRowsCache.set(userId, {
                expiresAt: Date.now() + ENCOUNTER_CACHE_TTL_MS,
                rows: mergedRows
            });
            rows.value = mergedRows;
            visibleCount.value = 100;
            loaded.value = true;
        } finally {
            loading.value = false;
        }
    }

    /**
     * 无合法 usr_ id 的行 (日志仅有显示名) 不可点击.
     *
     * @param row
     */
    function onRowClick(row) {
        if (row.hasUserId) {
            openUserDialog(row.userId);
        }
    }

    /**
     * @param userId
     */
    function openUserDialog(userId) {
        showUserDialog(userId);
    }

    /**
     * @param date
     */
    function formatDateTime(date) {
        return date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-';
    }

    defineExpose({ load });
</script>

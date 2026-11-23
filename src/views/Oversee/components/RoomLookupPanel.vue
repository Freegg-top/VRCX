<template>
    <div class="flex min-h-0 flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
            <Input
                v-model="locationInput"
                class="w-96 font-mono"
                :placeholder="t('view.oversee.room.input_placeholder')"
                @keydown.enter="query" />
            <Button variant="outline" size="sm" :disabled="!currentLocation" @click="fillCurrentLocation">
                {{ t('view.oversee.room.fill_current') }}
            </Button>
            <Button :disabled="loading" @click="query">
                <Spinner v-if="loading" class="size-4" />
                {{ t('view.oversee.query') }}
            </Button>
        </div>

        <div v-if="errorKind" class="text-destructive text-sm">
            {{ t(`view.oversee.error.${errorKind}`) }}
        </div>

        <template v-if="loaded">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span class="truncate font-medium">
                    {{ roomWorldName }}
                </span>
                <span class="text-muted-foreground truncate font-mono text-xs">
                    {{ queriedLocation }}
                </span>
                <Badge variant="secondary" class="text-xs">
                    {{ t('view.oversee.room.roster_count', { count: rows.length }) }}
                </Badge>
            </div>

            <div v-if="rows.length === 0" class="text-muted-foreground py-6 text-center text-sm">
                {{ t('view.oversee.room.empty') }}
            </div>

            <template v-else>
                <div class="flex flex-col">
                    <Item
                        v-for="row in pagedResult"
                        :key="`${row.user_id}-${row.at}-${row.location}`"
                        class="cursor-pointer rounded-none hover:bg-muted"
                        @click="openUserDialog(row.user_id)">
                        <ItemMedia class="size-10">
                            <Avatar class="size-full">
                                <AvatarImage v-if="row.avatar_url" :src="row.avatar_url" loading="lazy" />
                                <AvatarFallback>
                                    <User class="text-muted-foreground size-5" />
                                </AvatarFallback>
                            </Avatar>
                        </ItemMedia>
                        <ItemContent class="min-w-0">
                            <ItemTitle class="max-w-full truncate">
                                {{ row.display_name || row.user_id }}
                            </ItemTitle>
                            <ItemDescription class="text-xs!">
                                {{ formatDateTime(row.at) }}
                            </ItemDescription>
                        </ItemContent>
                    </Item>
                </div>

                <div v-if="totalPage > 1" class="mt-1 flex w-full items-center justify-end">
                    <Pagination
                        v-model:page="pageNum"
                        :total="rows.length"
                        :items-per-page="pageSize"
                        :sibling-count="1"
                        show-edges
                        class="flex-none">
                        <PaginationContent v-slot="{ items }">
                            <PaginationPrevious />
                            <template
                                v-for="(item, index) in items"
                                :key="item.type === 'page' ? `page-${item.value}` : `ellipsis-${index}`">
                                <PaginationItem
                                    v-if="item.type === 'page'"
                                    :value="item.value"
                                    :is-active="item.value === pageNum">
                                    {{ item.value }}
                                </PaginationItem>
                                <PaginationEllipsis v-else />
                            </template>
                            <PaginationNext />
                        </PaginationContent>
                    </Pagination>
                </div>
            </template>
        </template>

        <div v-else class="text-muted-foreground py-6 text-center text-sm">
            {{ t('view.oversee.room.hint') }}
        </div>
    </div>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import dayjs from 'dayjs';
    import { toast } from 'vue-sonner';
    import { User } from 'lucide-vue-next';

    import { Badge } from '@/components/ui/badge';
    import { Button } from '@/components/ui/button';
    import { Input } from '@/components/ui/input';
    import { Spinner } from '@/components/ui/spinner';
    import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
    import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
    import {
        Pagination,
        PaginationContent,
        PaginationEllipsis,
        PaginationItem,
        PaginationNext,
        PaginationPrevious
    } from '@/components/ui/pagination';
    import { useLocationStore } from '@/stores';
    import { showUserDialog } from '@/coordinators/userCoordinator';
    import { getInstanceRoster, OverseeApiError } from '@/services/overseeApi';
    import { extractLocationFromText, shortenWorldId } from '@/services/database/overseeMerge';
    import { ensureWorldMeta, resolveWorldName } from '../worldDisplay';
    import { showOverseeError } from '../overseeUi';

    const { t } = useI18n();

    const { lastLocation } = storeToRefs(useLocationStore());
    const currentLocation = computed(() => String(lastLocation.value?.location || '').trim());

    const locationInput = ref('');
    const loading = ref(false);
    const loaded = ref(false);
    const errorKind = ref('');
    const queriedLocation = ref('');
    /** @type {import('vue').Ref<object[]>} */
    const rows = ref([]);

    const pageNum = ref(1);
    const pageSize = ref(50);

    // location 前缀即 world_id, 用于头部显示世界名 (缓存/本地日志异步回填)
    const queriedWorldId = computed(() => queriedLocation.value.split(':')[0] || '');
    const roomWorldName = computed(
        () => resolveWorldName(queriedWorldId.value) || shortenWorldId(queriedWorldId.value)
    );

    const totalPage = computed(() => Math.max(1, Math.ceil(rows.value.length / pageSize.value)));

    const pagedResult = computed(() => {
        const start = (pageNum.value - 1) * pageSize.value;
        return rows.value.slice(start, start + pageSize.value);
    });

    watch(totalPage, (value) => {
        if (pageNum.value > value) {
            pageNum.value = value;
        }
    });

    function fillCurrentLocation() {
        const location = String(lastLocation.value?.location || '').trim();
        if (!location) {
            return;
        }
        locationInput.value = location;
    }

    async function query() {
        if (loading.value) {
            return;
        }
        // 从粘贴文本/URL 中提取 location 片段; 提取不到才报错
        const location = extractLocationFromText(locationInput.value);
        if (!location) {
            toast.error(t('view.oversee.room.invalid_location'));
            return;
        }
        locationInput.value = location;
        loading.value = true;
        errorKind.value = '';
        loaded.value = false;
        rows.value = [];
        pageNum.value = 1;
        queriedLocation.value = location;
        try {
            const data = await getInstanceRoster(location);
            const results = Array.isArray(data?.results) ? data.results : [];
            rows.value = results.filter((row) => row?.user_id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
            loaded.value = true;
            // 预热世界名/元数据缓存 (异步回填, 无需等待)
            void ensureWorldMeta(location.split(':')[0] || '');
        } catch (error) {
            if (error instanceof OverseeApiError && error.kind === 'notFound') {
                errorKind.value = 'notFound';
                loaded.value = true;
            } else {
                errorKind.value = String(error?.kind || 'server');
                showOverseeError(error, t);
            }
        } finally {
            loading.value = false;
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
</script>

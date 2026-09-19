<template>
    <div class="flex h-full flex-col gap-4 overflow-y-auto p-4">
        <div>
            <h1 class="text-lg font-semibold">
                {{ t('view.friend_network.header') }}
            </h1>
            <p class="text-muted-foreground text-sm">
                {{ t('view.friend_network.description') }}
            </p>
        </div>

        <div class="flex flex-col gap-3 rounded-lg border p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0">
                    <h2 class="text-sm font-semibold">
                        {{ t('view.friend_network.met_header') }}
                    </h2>
                    <p class="text-muted-foreground text-xs">
                        {{ t('view.friend_network.met_description') }}
                    </p>
                </div>
                <Button :disabled="metLoading" @click="loadMetUsers">
                    {{
                        metLoading
                            ? t('view.friend_network.querying')
                            : t('view.friend_network.met_load')
                    }}
                </Button>
            </div>
            <template v-if="metLoaded">
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span class="text-sm">
                        {{
                            t('view.friend_network.met_pool_count', {
                                count: metList.length
                            })
                        }}
                    </span>
                    <span
                        v-if="metAnalysis.total > 0"
                        class="text-muted-foreground text-xs">
                        {{
                            t('view.friend_network.met_analyzed', {
                                done: metAnalysis.done,
                                total: metAnalysis.total
                            })
                        }}
                    </span>
                </div>
                <div
                    v-if="metList.length === 0"
                    class="text-muted-foreground text-sm">
                    {{ t('view.friend_network.met_empty') }}
                </div>
            </template>
        </div>

        <div class="flex flex-col gap-3 rounded-lg border p-4">
            <VirtualCombobox
                v-model="selectedFriendId"
                :groups="friendPickerGroups"
                :placeholder="t('view.friend_network.search_friend')"
                :search-placeholder="t('view.friend_network.search_friend')"
                :clearable="true"
                :close-on-select="true"
                :deselect-on-reselect="true">
                <template #item="{ item, selected }">
                    <div class="flex w-full items-center p-1.5 text-[13px]">
                        <div
                            class="relative mr-2.5 inline-block size-9 flex-none"
                            :class="userStatusClass(item.user)">
                            <img
                                v-if="item.iconUrl"
                                class="size-full rounded-full object-cover"
                                :src="item.iconUrl"
                                loading="lazy" />
                            <div
                                v-else
                                class="bg-muted flex size-full items-center justify-center rounded-full text-xs">
                                {{ item.label?.charAt(0) }}
                            </div>
                        </div>
                        <div class="flex-1 overflow-hidden">
                            <span
                                class="block truncate font-medium leading-[18px]"
                                v-text="item.label"></span>
                        </div>
                        <CheckIcon
                            :class="[
                                'ml-auto size-4',
                                selected ? 'opacity-100' : 'opacity-0'
                            ]" />
                    </div>
                </template>
                <template #empty>
                    {{ t('view.friend_network.no_matches') }}
                </template>
            </VirtualCombobox>

            <span
                v-if="!metLoaded"
                class="text-muted-foreground text-sm">
                {{ t('view.friend_network.met_need_pool') }}
            </span>
            <template v-else-if="selectedFriendId">
                <span class="text-sm">
                    {{
                        t('view.friend_network.metfof_summary', {
                            name: selectedFriendName,
                            total: queryResult.length
                        })
                    }}
                </span>
                <div
                    v-if="pagedResult.length === 0"
                    class="text-muted-foreground py-2 text-center text-sm">
                    {{ t('view.friend_network.metfof_empty') }}
                </div>
                <div v-else class="flex flex-col">
                    <Item
                        v-for="item in pagedResult"
                        :key="item.row.userId"
                        class="x-hover-list cursor-pointer rounded-none hover:bg-muted"
                        @click="openUserDialog(item.row.userId)">
                        <ItemMedia class="relative size-10">
                            <Avatar class="size-full">
                                <AvatarImage
                                    :src="userImage(item.display, true)"
                                    loading="lazy" />
                                <AvatarFallback>
                                    <User class="text-muted-foreground size-5" />
                                </AvatarFallback>
                            </Avatar>
                            <IconFrame :icon-frame="item.display.iconFrame" />
                        </ItemMedia>
                        <ItemContent class="min-w-0">
                            <ItemTitle class="flex max-w-full items-center gap-1.5">
                                <span class="truncate">
                                    {{ item.display.displayName }}
                                </span>
                                <span
                                    v-if="randomUserColours"
                                    class="shrink-0 text-xs font-normal"
                                    :class="item.display.$trustClass">
                                    {{ item.display.$trustLevel }}
                                </span>
                                <span
                                    v-else
                                    class="shrink-0 text-xs font-normal"
                                    :style="{ color: item.display.$userColour }">
                                    {{ item.display.$trustLevel }}
                                </span>
                                <span
                                    v-for="language in item.display.$languages"
                                    :key="language.key"
                                    class="flags shrink-0"
                                    :class="languageClass(language.key)"
                                    :title="language.value" />
                            </ItemTitle>
                            <ItemDescription class="line-clamp-1 text-xs!">
                                {{ metSubLabel(item.row) }}
                            </ItemDescription>
                        </ItemContent>
                    </Item>
                </div>
                <div
                    v-if="queryResult.length > 0"
                    class="mt-1 flex w-full items-center gap-3">
                    <div
                        class="inline-flex flex-1 items-center justify-end gap-2">
                        <span
                            class="text-muted-foreground truncate text-xs">
                            {{ t('table.pagination.rows_per_page') }}
                        </span>
                        <Select v-model="pageSizeModel">
                            <SelectTrigger size="sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem
                                    v-for="size in pageSizes"
                                    :key="String(size)"
                                    :value="String(size)">
                                    {{ size }}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <Pagination
                        v-model:page="pageNum"
                        :total="queryResult.length"
                        :items-per-page="pageSize"
                        :sibling-count="1"
                        show-edges
                        class="flex-none">
                        <PaginationContent v-slot="{ items }">
                            <PaginationPrevious />
                            <template
                                v-for="(item, index) in items"
                                :key="
                                    item.type === 'page'
                                        ? `page-${item.value}`
                                        : `ellipsis-${index}`
                                ">
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
            <div v-else class="text-muted-foreground text-sm">
                {{ t('view.friend_network.select_hint') }}
            </div>
        </div>
    </div>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import dayjs from 'dayjs';
    import { CheckIcon, User } from 'lucide-vue-next';

    import IconFrame from '../../components/IconFrame.vue';
    import {
        Avatar,
        AvatarFallback,
        AvatarImage
    } from '../../components/ui/avatar';
    import { Button } from '../../components/ui/button';
    import {
        Item,
        ItemContent,
        ItemDescription,
        ItemMedia,
        ItemTitle
    } from '../../components/ui/item';
    import {
        Pagination,
        PaginationContent,
        PaginationEllipsis,
        PaginationItem,
        PaginationNext,
        PaginationPrevious
    } from '../../components/ui/pagination';
    import {
        Select,
        SelectContent,
        SelectItem,
        SelectTrigger,
        SelectValue
    } from '../../components/ui/select';
    import { VirtualCombobox } from '../../components/ui/virtual-combobox';
    import { useAppearanceSettingsStore, useFriendStore, useUserStore } from '../../stores';
    import { showUserDialog } from '../../coordinators/userCoordinator';
    import {
        getMetUsers,
        getOwnerCandidates,
        getPersistedAnalysis,
        metAnalysis,
        startMetAnalysis,
        STALE_MS
    } from '../../coordinators/friendNetworkCoordinator';
    import { userRequest } from '../../api';
    import { createRateLimiter } from '../../shared/utils/throttle';
    import { useUserDisplay } from '../../composables/useUserDisplay';
    import { languageClass } from '../../shared/utils';

    const { t } = useI18n();

    const { friends } = storeToRefs(useFriendStore());
    const appearanceSettingsStore = useAppearanceSettingsStore();
    const userStore = useUserStore();
    const { randomUserColours } = storeToRefs(appearanceSettingsStore);
    const { userImage, userStatusClass } = useUserDisplay();

    const selectedFriendId = ref(null);

    const metLoaded = ref(false);
    const metLoading = ref(false);
    const metList = ref([]);

    const pageNum = ref(1);
    const pageSize = ref(50);
    const pageSizes = computed(
        () => appearanceSettingsStore.tablePageSizes || [20, 50, 100, 200]
    );

    const allFriends = computed(() => {
        const list = [];
        for (const ctx of friends.value.values()) {
            const friendRef = ctx?.ref;
            if (friendRef?.id && friendRef?.displayName) {
                list.push(friendRef);
            }
        }
        list.sort((a, b) =>
            String(a.displayName).localeCompare(String(b.displayName))
        );
        return list;
    });

    const friendPickerGroups = computed(() => [
        {
            key: 'friends',
            items: allFriends.value.map((friend) => ({
                value: friend.id,
                label: friend.displayName,
                search: friend.displayName,
                user: friend,
                iconUrl: userImage(friend)
            }))
        }
    ]);

    const selectedFriendName = computed(() => {
        const friend = allFriends.value.find(
            (friend) => friend.id === selectedFriendId.value
        );
        return friend?.displayName || '';
    });

    const queryResult = computed(() => {
        if (!metLoaded.value || !selectedFriendId.value) {
            return [];
        }
        const friendId = selectedFriendId.value;
        const result = [];
        for (const user of metList.value) {
            const entry = metAnalysis.results.get(user.userId);
            if (entry?.state === 'some' && entry.friendIds.has(friendId)) {
                result.push(user);
            }
        }
        return result;
    });

    const totalPage = computed(() =>
        Math.max(1, Math.ceil(queryResult.value.length / pageSize.value))
    );

    const pagedResult = computed(() => {
        const start = (pageNum.value - 1) * pageSize.value;
        return queryResult.value
            .slice(start, start + pageSize.value)
            .map((row) => ({
                row,
                // prefer the cached user ref so avatar/trust info shows when
                // we already know the player (e.g. they were in our instance)
                display: userStore.cachedUsers.get(row.userId) || row
            }));
    });

    const pageSizeModel = computed({
        get: () => String(pageSize.value),
        set: (value) => {
            pageSize.value = Number(value) || 50;
            pageNum.value = 1;
        }
    });

    watch(totalPage, (value) => {
        if (pageNum.value > value) {
            pageNum.value = value;
        }
    });

    // prefetch profiles for the visible result page so avatars/trust info
    // show without having to open each user dialog first
    const avatarRateLimiter = createRateLimiter({
        limitPerInterval: 2,
        intervalMs: 1000
    });
    const avatarFetchRequested = new Set();

    watch(
        pagedResult,
        (items) => {
            for (const { row } of items) {
                if (
                    userStore.cachedUsers.has(row.userId) ||
                    avatarFetchRequested.has(row.userId)
                ) {
                    continue;
                }
                avatarFetchRequested.add(row.userId);
                (async () => {
                    await avatarRateLimiter.wait();
                    try {
                        await userRequest.getUser({ userId: row.userId });
                    } catch (err) {
                        // unavailable profile: the row keeps log-only data
                        console.error(
                            '[friend-network] failed to prefetch user:',
                            row.userId,
                            err?.status
                        );
                    }
                })();
            }
        },
        { immediate: true }
    );

    /**
     *
     * @param user
     */
    function metSubLabel(user) {
        const parts = [];
        if (user.isOwner) {
            parts.push(t('view.friend_network.owner_signal'));
        }
        if (user.lastSeen) {
            parts.push(
                t('view.friend_network.last_met', {
                    time: dayjs(user.lastSeen).format('YYYY-MM-DD HH:mm')
                })
            );
        }
        parts.push(
            t('view.friend_network.met_instances', {
                count: user.joinCount || 0
            })
        );
        return parts.join(' · ');
    }

    async function loadMetUsers() {
        if (metLoading.value) {
            return;
        }
        metLoading.value = true;
        try {
            const logRows = await getMetUsers();
            const friendIds = new Set();
            for (const ctx of friends.value.values()) {
                if (ctx?.id) {
                    friendIds.add(ctx.id);
                }
            }
            // 实例房主信号: 未在本地日志出现过的好友的好友候选
            const ownerRows = (await getOwnerCandidates()).map((row) => ({
                userId: row.userId,
                displayName: row.displayName || row.userId,
                joinCount: 0,
                lastSeen: '',
                isOwner: true
            }));
            const merged = new Map();
            for (const row of ownerRows) {
                merged.set(row.userId, row);
            }
            for (const row of logRows) {
                const existing = merged.get(row.userId);
                if (existing) {
                    existing.isOwner = true;
                    existing.joinCount = row.joinCount;
                    existing.lastSeen = row.lastSeen;
                } else {
                    merged.set(row.userId, row);
                }
            }
            metList.value = [...merged.values()]
                .filter((row) => !friendIds.has(row.userId))
                .sort((a, b) =>
                    String(b.lastSeen || '').localeCompare(
                        String(a.lastSeen || '')
                    )
                );
            await seedPersistedAnalysis();
            metLoaded.value = true;
            startMetAnalysis(metList.value.map((user) => user.userId));
        } catch (err) {
            console.error('[friend-network] failed to load met users:', err);
        } finally {
            metLoading.value = false;
        }
    }

    async function seedPersistedAnalysis() {
        let persisted;
        try {
            persisted = await getPersistedAnalysis();
        } catch (err) {
            console.error(
                '[friend-network] failed to load saved analysis:',
                err
            );
            return;
        }
        if (!persisted.size) {
            return;
        }
        const now = Date.now();
        for (const user of metList.value) {
            if (metAnalysis.results.has(user.userId)) {
                continue;
            }
            const entry = persisted.get(user.userId);
            if (!entry) {
                continue;
            }
            const age = now - Date.parse(entry.lastFetchedAt || '');
            if (!Number.isFinite(age) || age >= STALE_MS) {
                // stale entry: leave it unseeded so it gets re-analyzed
                continue;
            }
            metAnalysis.results.set(
                user.userId,
                entry.optedOut || !entry.friendIds.length
                    ? { state: 'none', friendIds: new Set() }
                    : {
                          state: 'some',
                          friendIds: new Set(entry.friendIds)
                      }
            );
        }
    }

    /**
     *
     * @param userId
     */
    function openUserDialog(userId) {
        showUserDialog(userId);
    }
</script>

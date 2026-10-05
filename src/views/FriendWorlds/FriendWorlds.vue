<template>
    <div class="flex h-full flex-col gap-4 overflow-y-auto p-4">
        <div>
            <h1 class="text-lg font-semibold">
                {{ t('view.friend_worlds.header') }}
            </h1>
            <p class="text-muted-foreground text-sm">
                {{ t('view.friend_worlds.description') }}
            </p>
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <VirtualCombobox
                class="w-72"
                v-model="selectedFriendId"
                :groups="friendPickerGroups"
                :placeholder="t('view.friend_worlds.select_friend')"
                :search-placeholder="t('view.friend_worlds.select_friend')"
                :clearable="true"
                :close-on-select="true"
                :deselect-on-reselect="true">
                <template #item="{ item, selected }">
                    <div class="flex w-full items-center p-1.5 text-[13px]">
                        <div class="mr-2.5 inline-block size-9 flex-none">
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
                    {{ t('view.friend_worlds.no_matches') }}
                </template>
            </VirtualCombobox>
            <ToggleGroup
                v-model="sortBy"
                type="single"
                class="ml-auto"
                @update:model-value="loadWorlds">
                <ToggleGroupItem value="time">
                    {{ t('view.friend_worlds.sort_time') }}
                </ToggleGroupItem>
                <ToggleGroupItem value="count">
                    {{ t('view.friend_worlds.sort_count') }}
                </ToggleGroupItem>
            </ToggleGroup>
            <Button
                variant="outline"
                size="sm"
                :disabled="loading || !selectedFriendId"
                @click="loadWorlds">
                <RefreshCw class="size-4" />
            </Button>
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span v-if="selectedFriendName">
                {{
                    t('view.friend_worlds.summary', {
                        name: selectedFriendName,
                        total: worldStats.length,
                        time: formatWorldTime(totalTimeMs)
                    })
                }}
            </span>
        </div>

        <div
            v-if="!selectedFriendId"
            class="text-muted-foreground py-6 text-center text-sm">
            {{ t('view.friend_worlds.select_hint') }}
        </div>
        <div
            v-else-if="worldStats.length === 0"
            class="text-muted-foreground py-6 text-center text-sm">
            {{
                loading
                    ? t('view.friend_worlds.loading')
                    : t('view.friend_worlds.empty')
            }}
        </div>
        <div v-else class="flex flex-col gap-2">
            <div
                v-for="item in visibleWorlds"
                :key="item.worldId"
                class="hover:bg-accent cursor-pointer rounded-lg border p-2"
                @click="openWorld(item.worldId)">
                <div class="flex items-center gap-3">
                    <img
                        v-if="getWorldThumbnail(item.worldId)"
                        class="size-14 flex-none rounded-md object-cover"
                        :src="getWorldThumbnail(item.worldId)"
                        loading="lazy" />
                    <div
                        v-else
                        class="bg-muted flex size-14 flex-none items-center justify-center rounded-md">
                        <Globe class="text-muted-foreground size-6" />
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                            <span class="truncate text-sm font-medium">
                                {{ item.worldName }}
                            </span>
                            <Badge
                                v-if="item.isCurrent"
                                variant="default"
                                class="text-xs">
                                {{ t('view.friend_worlds.current_badge') }}
                            </Badge>
                        </div>
                        <div class="text-muted-foreground mt-1 text-xs">
                            {{
                                t('view.friend_worlds.visits', {
                                    count: item.count
                                })
                            }}
                            ·
                            {{ t('view.friend_worlds.col_last') }}
                            {{ formatDate(item.lastSeen) }}
                        </div>
                    </div>
                    <div class="flex-none text-sm font-medium">
                        {{ formatWorldTime(item.totalTime) }}
                    </div>
                </div>
            </div>
        </div>
        <div
            v-if="worldStats.length > visibleCount"
            class="py-2 text-center">
            <Button variant="outline" size="sm" @click="visibleCount += 60">
                {{ t('view.friend_worlds.show_more') }}
            </Button>
        </div>
    </div>
</template>

<script setup>
    import { computed, ref, watch } from 'vue';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import dayjs from 'dayjs';
    import { CheckIcon, Globe, RefreshCw } from 'lucide-vue-next';

    import { Badge } from '../../components/ui/badge';
    import { Button } from '../../components/ui/button';
    import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
    import { VirtualCombobox } from '../../components/ui/virtual-combobox';
    import { useFriendStore } from '../../stores';
    import { database } from '../../services/database';
    import { parseLocation, timeToText } from '../../shared/utils';
    import { showWorldDialog } from '../../coordinators/worldCoordinator';
    import { worldRequest } from '../../api';
    import { useWorldStore } from '../../stores/world';
    import { useUserDisplay } from '../../composables/useUserDisplay';

    const { t } = useI18n();

    // 单段时长封顶 8 小时 (与 activityEngine mergeSessions 上限一致):
    // VRCX 未运行期间观测不到, 不封顶会把离线空洞算进上一段游玩时长
    const MAX_SEGMENT_MS = 8 * 3600 * 1000;

    const friendStore = useFriendStore();
    const { friends } = storeToRefs(friendStore);
    const worldStore = useWorldStore();
    const { userImage } = useUserDisplay();

    const loading = ref(false);
    const selectedFriendId = ref(null);
    const sortBy = ref('time');
    const worldStats = ref([]);
    const visibleCount = ref(60);
    const pendingWorldThumbnailFetches = new Set();

    watch(selectedFriendId, () => {
        visibleCount.value = 60;
        loadWorlds();
    });

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

    const currentWorldId = computed(() => {
        if (!selectedFriendId.value) {
            return '';
        }
        const ref = friendStore.friends.get(selectedFriendId.value)?.ref;
        return parseLocation(ref?.location || '').worldId || '';
    });

    const totalTimeMs = computed(() =>
        worldStats.value.reduce((sum, item) => sum + item.totalTime, 0)
    );

    const sortedWorlds = computed(() => {
        const list = worldStats.value.map((item) => ({
            ...item,
            isCurrent: item.worldId === currentWorldId.value
        }));
        list.sort((a, b) => {
            if (a.isCurrent !== b.isCurrent) {
                return a.isCurrent ? -1 : 1;
            }
            if (sortBy.value === 'count') {
                return b.count - a.count;
            }
            return b.totalTime - a.totalTime;
        });
        return list;
    });

    const visibleWorlds = computed(() =>
        sortedWorlds.value.slice(0, visibleCount.value)
    );

    async function loadWorlds() {
        if (loading.value || !selectedFriendId.value) {
            return;
        }
        loading.value = true;
        try {
            const rows = await database.getFriendWorldTrajectory(
                selectedFriendId.value
            );
            worldStats.value = aggregateWorlds(rows);
            fetchMissingWorldThumbnails(visibleWorlds.value);
        } catch (err) {
            console.error('[friend-worlds] load failed:', err);
        } finally {
            loading.value = false;
        }
    }

    // 逐条 diff 聚合 (与 FriendActivity 的时长算法一致):
    // GPS/Online 记录的时长 = 下一条记录时间 - 本条时间 (封顶 8h);
    // Offline 记录结束当前游玩 (离线时间不计入任何世界);
    // 同世界连续记录合并为一次游玩, 次数 = 世界切换次数
    function aggregateWorlds(rows) {
        const byWorld = new Map();
        let currentWorldId = null;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const next = rows[i + 1];
            const nextAt = next ? Date.parse(next.created_at) : 0;
            if (row.type === 'Offline') {
                currentWorldId = null;
                continue;
            }
            const L = parseLocation(row.location);
            if (L.isOffline || L.isTraveling || !L.isRealInstance || !L.worldId) {
                continue;
            }
            const durationMs =
                nextAt > 0
                    ? Math.max(0, Math.min(nextAt - Date.parse(row.created_at), MAX_SEGMENT_MS))
                    : 0;
            let entry = byWorld.get(L.worldId);
            if (!entry) {
                entry = {
                    worldId: L.worldId,
                    worldName: row.worldName || L.worldId,
                    count: 0,
                    totalTime: 0,
                    firstSeen: row.created_at,
                    lastSeen: row.created_at
                };
                byWorld.set(L.worldId, entry);
            }
            if (currentWorldId !== L.worldId) {
                entry.count++;
            }
            if (row.worldName) {
                entry.worldName = row.worldName;
            }
            entry.totalTime += durationMs;
            if (row.created_at > entry.lastSeen) {
                entry.lastSeen = row.created_at;
            }
            currentWorldId = L.worldId;
        }
        return Array.from(byWorld.values());
    }

    // 世界缩略图: 本地缓存 -> 缺失时后台补拉 (仅可见行, worldRequest 会写回缓存)
    function getWorldThumbnail(worldId) {
        const cached = worldStore.cachedWorlds.get(worldId);
        if (!cached?.thumbnailImageUrl) {
            return null;
        }
        return cached.thumbnailImageUrl.replace('256', '128');
    }

    async function fetchMissingWorldThumbnails(worlds) {
        const missingWorldIds = worlds
            .map((world) => world.worldId)
            .filter((worldId) => {
                if (!worldId || pendingWorldThumbnailFetches.has(worldId)) {
                    return false;
                }
                return !worldStore.cachedWorlds.get(worldId)?.thumbnailImageUrl;
            });

        if (missingWorldIds.length === 0) {
            return;
        }

        const fetches = missingWorldIds.map(async (worldId) => {
            pendingWorldThumbnailFetches.add(worldId);
            try {
                await worldRequest.getWorld({ worldId });
            } finally {
                pendingWorldThumbnailFetches.delete(worldId);
            }
        });

        await Promise.allSettled(fetches);
        worldStats.value = [...worldStats.value];
    }

    function openWorld(worldId) {
        showWorldDialog(worldId);
    }

    function formatWorldTime(ms) {
        if (!ms || ms <= 0) {
            return '0m';
        }
        return timeToText(ms);
    }

    /**
     *
     * @param date
     */
    function formatDate(date) {
        return date ? dayjs(date).format('YYYY-MM-DD') : '-';
    }
</script>

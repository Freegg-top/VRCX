<template>
    <div class="flex h-full flex-col gap-4 overflow-y-auto p-4">
        <div>
            <h1 class="text-lg font-semibold">
                {{ t('view.friend_groups.header') }}
            </h1>
            <p class="text-muted-foreground text-sm">
                {{ t('view.friend_groups.description') }}
            </p>
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label class="flex items-center gap-2 text-sm">
                <Switch v-model="includeFof" />
                {{ t('view.friend_groups.include_fof') }}
            </label>
            <span
                v-if="fofFetchTotal > 0"
                class="text-muted-foreground text-xs">
                {{
                    t('view.friend_groups.fof_progress', {
                        done: fofFetchDone,
                        total: fofFetchTotal
                    })
                }}
            </span>
            <Input
                v-model="search"
                class="ml-auto max-w-56"
                :placeholder="t('view.friend_groups.search')" />
        </div>

        <div
            v-if="filteredGroups.length === 0"
            class="text-muted-foreground py-6 text-center text-sm">
            {{ loading ? t('view.friend_groups.loading') : t('view.friend_groups.empty') }}
        </div>
        <div v-else class="flex flex-col">
            <div
                v-for="group in visibleGroups"
                :key="group.id"
                class="rounded-md">
                <div
                    class="hover:bg-accent flex cursor-pointer items-center gap-3 px-2 py-2"
                    @click="toggleExpand(group.id)">
                    <ChevronRight
                        class="text-muted-foreground size-4 shrink-0 transition-transform"
                        :class="{ 'rotate-90': expanded.has(group.id) }" />
                    <span
                        class="min-w-0 flex-1 cursor-pointer truncate text-sm font-medium"
                        :class="{ 'hover:underline': group.id }"
                        @click.stop="openGroup(group.id)">
                        {{ group.name }}
                    </span>
                    <span
                        v-if="memberCounts.get(group.id)"
                        class="text-muted-foreground flex-none text-xs">
                        {{
                            t('view.friend_groups.members_total', {
                                count: memberCounts.get(group.id)
                            })
                        }}
                    </span>
                    <Badge variant="secondary" class="flex-none">
                        {{
                            t('view.friend_groups.friends_count', {
                                count: group.friends.length
                            })
                        }}
                    </Badge>
                    <Badge
                        v-if="group.fof.length"
                        variant="outline"
                        class="flex-none">
                        {{
                            t('view.friend_groups.fof_count', {
                                count: group.fof.length
                            })
                        }}
                    </Badge>
                </div>
                <div v-if="expanded.has(group.id)" class="mb-2 ml-8 flex flex-col gap-1">
                    <div
                        v-for="player in group.friends"
                        :key="player.userId"
                        class="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm"
                        @click="openUser(player.userId)">
                        <span class="truncate">{{ player.displayName }}</span>
                        <span class="text-muted-foreground flex-none text-xs">
                            {{ t('view.friend_groups.friend_tag') }}
                        </span>
                    </div>
                    <template v-if="includeFof">
                        <div
                            v-for="player in group.fof"
                            :key="player.userId"
                            class="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm"
                            @click="openUser(player.userId)">
                            <span class="truncate">{{ player.displayName }}</span>
                            <span class="text-muted-foreground flex-none text-xs">
                                {{ t('view.friend_groups.fof_tag') }}
                            </span>
                        </div>
                    </template>
                    <div
                        v-if="group.friends.length + group.fof.length === 0"
                        class="text-muted-foreground px-2 py-1 text-xs">
                        {{ t('view.friend_groups.no_players') }}
                    </div>
                </div>
            </div>
            <div
                v-if="filteredGroups.length > visibleCount"
                class="py-2 text-center">
                <Button variant="outline" size="sm" @click="visibleCount += 100">
                    {{ t('view.friend_groups.show_more') }}
                </Button>
            </div>
        </div>
    </div>
</template>

<script setup>
    import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import { ChevronRight } from 'lucide-vue-next';

    import { Badge } from '../../components/ui/badge';
    import { Button } from '../../components/ui/button';
    import { Input } from '../../components/ui/input';
    import { Switch } from '../../components/ui/switch';
    import { database } from '../../services/database';
    import { watchState } from '../../services/watchState';
    import { groupRequest, userRequest } from '../../api';
    import { useFriendStore, useUserStore } from '../../stores';
    import { showUserDialog } from '../../coordinators/userCoordinator';
    import { showGroupDialog } from '../../coordinators/groupCoordinator';
    import {
        getPersistedAnalysis,
        metAnalysis
    } from '../../coordinators/friendNetworkCoordinator';
    import { fetchGroupsForUser } from '../../coordinators/groupChangeCoordinator';

    const { t } = useI18n();

    const friendStore = useFriendStore();
    const { friends } = storeToRefs(friendStore);

    const loading = ref(true);
    const search = ref('');
    watch(search, () => {
        visibleCount.value = 100;
    });
    const includeFof = ref(false);
    const fofFetchDone = ref(0);
    const fofFetchTotal = ref(0);
    const visibleCount = ref(100);
    const expanded = reactive(new Set());
    const memberCounts = reactive(new Map());

    // groupId -> { id, name, friends: [{userId, displayName}], fof: [...] }
    const groupsById = reactive(new Map());

    onMounted(load);

    // 好友列表同步完成后重跑 (刚启动就打开本页时快照成员才能对上名字)
    watch(
        () => watchState.isFriendsLoaded,
        (loaded) => {
            if (loaded) {
                load();
            }
        }
    );

    onUnmounted(() => {
        fofFetchCancelled = true;
    });

    async function load() {
        loading.value = true;
        try {
            const friendNames = new Map();
            for (const ctx of friends.value.values()) {
                if (ctx?.id) {
                    friendNames.set(ctx.id, ctx.ref?.displayName || ctx.id);
                }
            }
            const snapshots = await database.getFriendGroupSnapshots();
            for (const [userId, snapshot] of snapshots) {
                const displayName = friendNames.get(userId);
                if (!displayName) {
                    continue;
                }
                for (const group of snapshot.groups) {
                    let entry = groupsById.get(group.id);
                    if (!entry) {
                        entry = {
                            id: group.id,
                            name: group.name || group.id,
                            friends: [],
                            fof: []
                        };
                        groupsById.set(group.id, entry);
                    }
                    if (!entry.name && group.name) {
                        entry.name = group.name;
                    }
                    entry.friends.push({ userId, displayName });
                }
            }
        } catch (err) {
            console.error('[friend-groups] load failed:', err);
        } finally {
            loading.value = false;
        }
    }

    // 好友的好友 = 分析结果中非 optedOut 且存在好友关联的用户
    const fofUserIds = computed(() => {
        const ids = [];
        for (const [userId, entry] of metAnalysis.results) {
            if (entry?.state === 'some' && entry.friendIds.size > 0) {
                ids.push(userId);
            }
        }
        return ids;
    });

    let fofFetchRunning = false;
    // 注意: 必须用 let 声明。ESM 严格模式下给未声明变量赋值/读取会抛 ReferenceError,
    // 之前漏声明导致 fetchFofGroups 在第一次自增后读取它时中断, 进度永久卡在 1/N
    let fofFetchCancelled = false;

    async function fetchFofGroups() {
        if (fofFetchRunning) {
            return;
        }
        fofFetchRunning = true;
        const targets = fofUserIds.value;
        fofFetchTotal.value = targets.length;
        fofFetchDone.value = 0;
        const userStore = useUserStore();
        for (const userId of targets) {
            try {
                // 群组列表 + 缺失的玩家名字, 每人间隔 1 秒避免触发限流
                const groups = await fetchGroupsForUser(userId);
                let displayName =
                    userStore.cachedUsers.get(userId)?.displayName || '';
                if (!displayName) {
                    try {
                        const { json } = await userRequest.getUser({
                            userId
                        });
                        displayName = json?.displayName || userId;
                    } catch (err) {
                        displayName = userId;
                    }
                }
                for (const group of groups) {
                    let entry = groupsById.get(group.id);
                    if (!entry) {
                        entry = {
                            id: group.id,
                            name: group.name || group.id,
                            friends: [],
                            fof: []
                        };
                        groupsById.set(group.id, entry);
                    }
                    if (
                        entry.friends.some((p) => p.userId === userId) ||
                        entry.fof.some((p) => p.userId === userId)
                    ) {
                        continue;
                    }
                    entry.fof.push({ userId, displayName });
                }
            } catch (err) {
                console.error(
                    '[friend-groups] fof groups fetch failed:',
                    userId,
                    err?.status
                );
            }
            fofFetchDone.value++;
            if (fofFetchCancelled) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        fofFetchRunning = false;
    }

    // 好友的好友用户名: 展示时懒取
    watch(includeFof, async (value) => {
        if (!value) {
            return;
        }
        // G1: 先把持久化分析灌入 metAnalysis.results (独立打开本页时结果为空)
        try {
            const persisted = await getPersistedAnalysis();
            const now = Date.now();
            for (const [userId, entry] of persisted) {
                if (metAnalysis.results.has(userId)) {
                    continue;
                }
                const age = now - Date.parse(entry.lastFetchedAt || '');
                if (Number.isFinite(age) && age < 14 * 24 * 60 * 60 * 1000) {
                    metAnalysis.results.set(
                        userId,
                        entry.optedOut || !entry.friendIds.length
                            ? { state: 'none', friendIds: new Set() }
                            : {
                                  state: 'some',
                                  friendIds: new Set(entry.friendIds)
                              }
                    );
                }
            }
        } catch (err) {
            console.error('[friend-groups] seed failed:', err);
        }
        if (fofFetchTotal.value === 0 || fofFetchDone.value < fofFetchTotal.value) {
            await fetchFofGroups();
        }
    });

    const sortedGroups = computed(() => {
        const list = [...groupsById.values()];
        if (!includeFof.value) {
            return list.filter((group) => group.friends.length > 0);
        }
        return list;
    });

    const filteredGroups = computed(() => {
        const query = search.value.trim().toLowerCase();
        const list = sortedGroups.value
            .slice()
            .sort(
                (a, b) =>
                    b.friends.length - a.friends.length ||
                    b.fof.length - a.fof.length
            );
        if (!query) {
            return list;
        }
        return list.filter((group) =>
            String(group.name).toLowerCase().includes(query)
        );
    });

    const visibleGroups = computed(() =>
        filteredGroups.value.slice(0, visibleCount.value)
    );

    function toggleExpand(groupId) {
        if (expanded.has(groupId)) {
            expanded.delete(groupId);
            return;
        }
        expanded.add(groupId);
        // 展开时懒取群组总成员数
        if (!memberCounts.has(groupId)) {
            groupRequest
                .getGroup({ groupId })
                .then(({ json }) => {
                    if (json?.memberCount) {
                        memberCounts.set(groupId, json.memberCount);
                    }
                })
                .catch(() => {});
        }
    }

    /**
     *
     * @param groupId
     */
    function openGroup(groupId) {
        showGroupDialog(groupId);
    }

    /**
     *
     * @param userId
     */
    function openUser(userId) {
        showUserDialog(userId);
    }
</script>

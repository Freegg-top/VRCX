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
            <div class="flex items-center gap-2">
                <Button
                    size="sm"
                    :disabled="loading"
                    @click="handleLoad">
                    {{ t('view.friend_groups.load') }}
                </Button>
                <Button
                    size="sm"
                    variant="outline"
                    :disabled="refreshing"
                    @click="handleRefresh">
                    {{ refreshing ? t('view.friend_groups.refreshing') : t('view.friend_groups.refresh') }}
                </Button>
            </div>
            <Select v-model="sortByModel">
                <SelectTrigger size="sm" class="w-44">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="friends">
                        {{ t('view.friend_groups.sort_friends') }}
                    </SelectItem>
                    <SelectItem value="total">
                        {{ t('view.friend_groups.sort_total') }}
                    </SelectItem>
                </SelectContent>
            </Select>
            <span
                v-if="friendGroups.fofFetchTotal > 0"
                class="text-muted-foreground text-xs">
                {{
                    t('view.friend_groups.fof_progress', {
                        done: friendGroups.fofFetchDone,
                        total: friendGroups.fofFetchTotal
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
                        v-if="friendGroups.memberCounts.get(group.id)"
                        class="text-muted-foreground flex-none text-xs">
                        {{
                            t('view.friend_groups.members_total', {
                                count: friendGroups.memberCounts.get(group.id)
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
                        v-for="player in pagedMembers(group)"
                        :key="player.userId"
                        class="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm"
                        @click="openUser(player.userId)">
                        <span class="truncate">{{ player.displayName }}</span>
                        <span class="text-muted-foreground flex-none text-xs">
                            {{
                                player.tag === 'friend'
                                    ? t('view.friend_groups.friend_tag')
                                    : t('view.friend_groups.fof_tag')
                            }}
                        </span>
                    </div>
                    <div
                        v-if="memberTotalPages(group) > 1"
                        class="flex items-center justify-center gap-1 py-1">
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            :disabled="memberPageOf(group.id) <= 1"
                            @click="setMemberPage(group.id, memberPageOf(group.id) - 1)">
                            <ChevronLeft class="size-4" />
                        </Button>
                        <span class="text-muted-foreground text-xs">
                            {{
                                t('view.friend_groups.page_info', {
                                    page: memberPageOf(group.id),
                                    total: memberTotalPages(group)
                                })
                            }}
                        </span>
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            :disabled="memberPageOf(group.id) >= memberTotalPages(group)"
                            @click="setMemberPage(group.id, memberPageOf(group.id) + 1)">
                            <ChevronRight class="size-4" />
                        </Button>
                    </div>
                    <div
                        v-if="group.friends.length + group.fof.length === 0"
                        class="text-muted-foreground px-2 py-1 text-xs">
                        {{ t('view.friend_groups.no_players') }}
                    </div>
                </div>
            </div>
            <div class="mt-1 flex w-full items-center gap-3">
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
                    :total="filteredGroups.length"
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
        </div>
    </div>
</template>

<script setup>
    import { computed, onMounted, reactive, ref, watch } from 'vue';
    import { useI18n } from 'vue-i18n';

    import { ChevronLeft, ChevronRight } from 'lucide-vue-next';

    import { Badge } from '../../components/ui/badge';
    import { Button } from '../../components/ui/button';
    import { Input } from '../../components/ui/input';
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
    import { watchState } from '../../services/watchState';
    import { useAppearanceSettingsStore } from '../../stores';
    import { useModalStore } from '../../stores/modal';
    import { showUserDialog } from '../../coordinators/userCoordinator';
    import { showGroupDialog } from '../../coordinators/groupCoordinator';
    import {
        enableFofGroups,
        ensureMemberCounts,
        friendGroups,
        getFofEstimate,
        loadFriendGroups,
        refreshFriendGroups
    } from '../../coordinators/friendGroupsCoordinator';

    const { t } = useI18n();

    const appearanceSettingsStore = useAppearanceSettingsStore();

    const loading = ref(false);
    const refreshing = ref(false);
    const search = ref('');
    const sortBy = ref('friends');
    const sortByModel = computed({
        get: () => String(sortBy.value),
        set: (value) => {
            sortBy.value = value === 'total' ? 'total' : 'friends';
        }
    });
    // 群组列表分页 (页大小取外观设置, 初始 100 与旧的"显示更多"容量一致)
    const pageNum = ref(1);
    const pageSize = ref(100);
    const pageSizes = computed(
        () => appearanceSettingsStore.tablePageSizes || [20, 50, 100, 200]
    );
    const pageSizeModel = computed({
        get: () => String(pageSize.value),
        set: (value) => {
            pageSize.value = Number(value) || 100;
            pageNum.value = 1;
        }
    });
    watch(search, () => {
        pageNum.value = 1;
        memberPages.clear();
    });
    watch(sortBy, () => {
        pageNum.value = 1;
    });
    // 成员列表默认折叠, 点击群组行展开
    const expanded = reactive(new Set());
    // 展开群组的成员分页: groupId -> 页码(1 起), 固定每页 50,
    // 仅渲染当前页切片, 避免大群组一次铺开上千行 DOM
    const MEMBER_PAGE_SIZE = 50;
    const memberPages = reactive(new Map());

    // 数据在模块级单例中跨页面保留: 仅首次打开(或显式刷新)才加载,
    // 避免每次进页面都重新走一遍加载流程
    onMounted(() => {
        if (friendGroups.groupsById.size === 0) {
            handleLoad();
        } else {
            enableFofGroups();
        }
    });

    // 好友列表同步完成后重载 (刚启动就打开本页时快照成员才能对上名字)
    watch(
        () => watchState.isFriendsLoaded,
        (loaded) => {
            if (loaded) {
                handleLoad();
            }
        }
    );

    async function handleLoad() {
        if (loading.value) {
            return;
        }
        loading.value = true;
        try {
            await loadFriendGroups();
            enableFofGroups();
        } finally {
            loading.value = false;
        }
    }

    async function handleRefresh() {
        if (refreshing.value) {
            return;
        }
        // 数据量大时刷新耗时可观, 先确认并给出预计耗时
        const fofCount = await getFofEstimate();
        const minutes = Math.max(1, Math.ceil(fofCount / 60));
        const modalStore = useModalStore();
        try {
            const { ok } = await modalStore.confirm({
                title: t('confirm.title'),
                description: t('view.friend_groups.refresh_confirm', {
                    count: fofCount,
                    minutes
                })
            });
            if (!ok) {
                return;
            }
        } catch {
            return;
        }
        refreshing.value = true;
        try {
            await refreshFriendGroups();
        } finally {
            refreshing.value = false;
        }
    }

    const sortedGroups = computed(() => [
        ...friendGroups.groupsById.values()
    ]);

    const filteredGroups = computed(() => {
        const query = search.value.trim().toLowerCase();
        const list = sortedGroups.value.slice().sort((a, b) => {
            if (sortBy.value === 'total') {
                return (
                    b.friends.length + b.fof.length - (a.friends.length + a.fof.length) ||
                    b.friends.length - a.friends.length
                );
            }
            return (
                b.friends.length - a.friends.length || b.fof.length - a.fof.length
            );
        });
        if (!query) {
            return list;
        }
        return list.filter((group) =>
            String(group.name).toLowerCase().includes(query)
        );
    });

    const totalPage = computed(() =>
        Math.max(1, Math.ceil(filteredGroups.value.length / pageSize.value))
    );

    const visibleGroups = computed(() => {
        const start = (pageNum.value - 1) * pageSize.value;
        return filteredGroups.value.slice(start, start + pageSize.value);
    });

    // 搜索或数据变化后结果变少时, 把页码压回范围内
    watch(totalPage, (value) => {
        if (pageNum.value > value) {
            pageNum.value = value;
        }
    });

    // 群组总人数后台加载 (单例队列, 已取过的群组不重复请求)
    watch(
        visibleGroups,
        (groups) => {
            ensureMemberCounts(groups);
        },
        { immediate: true }
    );

    /**
     * 合并好友与好友的好友为平铺成员列表
     * @param group
     */
    function mergedMembers(group) {
        return [
            ...group.friends.map((player) => ({
                userId: player.userId,
                displayName: player.displayName,
                tag: 'friend'
            })),
            ...group.fof.map((player) => ({
                userId: player.userId,
                displayName: player.displayName,
                tag: 'fof'
            }))
        ];
    }

    /**
     *
     * @param groupId
     */
    function memberPageOf(groupId) {
        return memberPages.get(groupId) || 1;
    }

    /**
     *
     * @param group
     */
    function memberTotalPages(group) {
        return Math.max(
            1,
            Math.ceil(
                (group.friends.length + group.fof.length) / MEMBER_PAGE_SIZE
            )
        );
    }

    /**
     * 当前页的成员切片
     * @param group
     */
    function pagedMembers(group) {
        const start = (memberPageOf(group.id) - 1) * MEMBER_PAGE_SIZE;
        return mergedMembers(group).slice(start, start + MEMBER_PAGE_SIZE);
    }

    /**
     *
     * @param groupId
     * @param page
     */
    function setMemberPage(groupId, page) {
        memberPages.set(groupId, page);
    }

    // reload 后成员数可能变小, 把展开群组的页码压回总页数内
    watch(
        () => {
            let sig = '';
            for (const groupId of memberPages.keys()) {
                const group = friendGroups.groupsById.get(groupId);
                sig += `${groupId}:${group?.friends.length ?? 0},${group?.fof.length ?? 0};`;
            }
            return sig;
        },
        () => {
            for (const groupId of [...memberPages.keys()]) {
                const group = friendGroups.groupsById.get(groupId);
                if (!group) {
                    memberPages.delete(groupId);
                    continue;
                }
                const total = memberTotalPages(group);
                if (memberPages.get(groupId) > total) {
                    memberPages.set(groupId, total);
                }
            }
        }
    );

    /**
     *
     * @param groupId
     */
    function toggleExpand(groupId) {
        if (expanded.has(groupId)) {
            expanded.delete(groupId);
            memberPages.delete(groupId);
            return;
        }
        expanded.add(groupId);
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

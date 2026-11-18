<template>
    <div class="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-(--profile-card) p-2">
        <div class="shrink-0" style="display: flex; align-items: center; justify-content: space-between">
            <div style="display: flex; align-items: center">
                <Button
                    class="rounded-full"
                    variant="ghost"
                    size="icon-sm"
                    :disabled="userDialog.isMutualFriendsLoading"
                    @click="getUserMutualFriends(userDialog.id)">
                    <Spinner v-if="userDialog.isMutualFriendsLoading" />
                    <RefreshCw v-else />
                </Button>
                <span class="inline-flex items-center gap-1 ml-1.5 text-sm">
                    <Users class="size-3.5 text-muted-foreground" />
                    {{ t('dialog.user.groups.total_count', { count: displayedCount }) }}
                </span>
            </div>
            <div style="display: flex; align-items: center">
                <Input
                    v-model="searchQuery"
                    class="h-8 w-40 mr-2"
                    :placeholder="t('dialog.user.mutual_friends.search_placeholder')"
                    @click.stop />
                <span style="margin-right: 6px">{{ t('dialog.user.groups.sort_by') }}</span>
                <Select
                    :model-value="userDialogMutualFriendSortingKey"
                    :disabled="userDialog.isMutualFriendsLoading"
                    @update:modelValue="setUserDialogMutualFriendSortingByKey">
                    <SelectTrigger size="sm" @click.stop>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem
                            v-for="(item, key) in userDialogMutualFriendSortingOptions"
                            :key="String(key)"
                            :value="String(key)">
                            {{ t(item.name) }}
                        </SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
        <div class="min-h-0 flex-1 overflow-auto">
            <template v-if="isTargetOptedOut">
                <div class="mt-2 text-sm text-muted-foreground" style="padding: 4px 6px">
                    <div>{{ t('dialog.user.mutual_friends.opted_out_notice') }}</div>
                    <div v-if="retrospectiveMutuals.length" class="mt-1">
                        {{
                            t('dialog.user.mutual_friends.opted_out_snapshot_hint', {
                                date: formatDateFilter(retrospectiveSnapshotDate, 'short'),
                                count: retrospectiveMutuals.length
                            })
                        }}
                    </div>
                    <div v-if="optedOutDetectedAt" class="mt-0.5 text-xs opacity-70">
                        {{
                            t('dialog.user.mutual_friends.opted_out_detected_hint', {
                                date: formatDateFilter(optedOutDetectedAt, 'short')
                            })
                        }}
                    </div>
                </div>
                <ul class="flex flex-wrap items-start" style="margin-top: 8px; min-width: 130px">
                    <li
                        v-for="user in filteredRetrospectiveMutuals"
                        :key="user.id"
                        class="box-border flex items-center p-1.5 text-[13px] cursor-pointer w-[167px] hover:rounded-[25px_5px_5px_25px]"
                        @click="showUserDialog(user.id)">
                        <div class="relative inline-block flex-none size-9 mr-2.5">
                            <Avatar class="size-9">
                                <AvatarImage :src="userImage(user)" class="object-cover" />
                                <AvatarFallback>
                                    <User class="size-4 text-muted-foreground" />
                                </AvatarFallback>
                            </Avatar>
                            <IconFrame :icon-frame="user.iconFrame" />
                        </div>
                        <div class="flex-1 overflow-hidden">
                            <span
                                class="block truncate font-medium leading-[18px]"
                                :style="{ color: user.$userColour }"
                                v-text="user.displayName"></span>
                        </div>
                    </li>
                </ul>
            </template>
            <template v-else>
                <ul class="flex flex-wrap items-start" style="margin-top: 8px; min-width: 130px">
                    <li
                        v-for="user in filteredMutualFriends"
                        :key="user.id"
                        class="box-border flex items-center p-1.5 text-[13px] cursor-pointer w-[167px] hover:rounded-[25px_5px_5px_25px]"
                        @click="showUserDialog(user.id)">
                        <div class="relative inline-block flex-none size-9 mr-2.5">
                            <Avatar class="size-9">
                                <AvatarImage :src="userImage(user)" class="object-cover" />
                                <AvatarFallback>
                                    <User class="size-4 text-muted-foreground" />
                                </AvatarFallback>
                            </Avatar>
                            <IconFrame :icon-frame="user.iconFrame" />
                        </div>
                        <div class="flex-1 overflow-hidden">
                            <span
                                class="block truncate font-medium leading-[18px]"
                                :style="{ color: user.$userColour }"
                                v-text="user.displayName"></span>
                        </div>
                    </li>
                </ul>
                <template v-if="hiddenMutuals.length">
                    <div class="mt-3 mb-1 text-sm text-muted-foreground" style="padding: 4px 6px">
                        {{
                            t('dialog.user.mutual_friends.hidden_mutuals_hint', {
                                date: formatDateFilter(hiddenMutualsSnapshotDate, 'short')
                            })
                        }}
                    </div>
                    <ul class="flex flex-wrap items-start" style="min-width: 130px">
                        <li
                            v-for="user in filteredHiddenMutuals"
                            :key="user.id"
                            class="box-border flex items-center p-1.5 text-[13px] cursor-pointer w-[167px] opacity-60 hover:rounded-[25px_5px_5px_25px]"
                            @click="showUserDialog(user.id)">
                            <div class="relative inline-block flex-none size-9 mr-2.5">
                                <Avatar class="size-9">
                                    <AvatarImage :src="userImage(user)" class="object-cover" />
                                    <AvatarFallback>
                                        <User class="size-4 text-muted-foreground" />
                                    </AvatarFallback>
                                </Avatar>
                                <IconFrame :icon-frame="user.iconFrame" />
                            </div>
                            <div class="flex-1 overflow-hidden">
                                <span
                                    class="block truncate font-medium leading-[18px]"
                                    :style="{ color: user.$userColour }"
                                    v-text="user.displayName"></span>
                            </div>
                        </li>
                    </ul>
                </template>
            </template>
        </div>
    </div>
</template>

<script setup>
    import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
    import IconFrame from '@/components/IconFrame.vue';
    import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
    import { Button } from '@/components/ui/button';
    import { RefreshCw, User, Users } from 'lucide-vue-next';
    import { Spinner } from '@/components/ui/spinner';
    import { Input } from '@/components/ui/input';
    import { computed, ref, watch } from 'vue';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import {
        compareByDisplayName,
        compareByFriendOrder,
        compareByLastActiveRef,
        formatDateFilter
    } from '../../../shared/utils';
    import { useUserDisplay } from '../../../composables/useUserDisplay';
    import { database } from '../../../services/database';
    import { processBulk } from '../../../services/request';
    import { useOptionKeySelect } from '../../../composables/useOptionKeySelect';
    import { useFriendStore, useUserStore } from '../../../stores';
    import { userDialogMutualFriendSortingOptions } from '../../../shared/constants';
    import { userRequest } from '../../../api';
    import { showUserDialog } from '../../../coordinators/userCoordinator';

    const { t } = useI18n();
    const { userImage } = useUserDisplay();

    const userStore = useUserStore();
    const friendStore = useFriendStore();
    const { userDialog, currentUser } = storeToRefs(userStore);
    const { cachedUsers } = userStore;

    const { selectedKey: userDialogMutualFriendSortingKey, selectByKey: setUserDialogMutualFriendSortingByKey } =
        useOptionKeySelect(
            userDialogMutualFriendSortingOptions,
            () => userDialog.value.mutualFriendSorting,
            setUserDialogMutualFriendSorting
        );

    const searchQuery = ref('');
    const filteredMutualFriends = computed(() => {
        const friends = userDialog.value.mutualFriends;
        const query = searchQuery.value.trim().toLowerCase();
        if (!query) return friends;
        return friends.filter((u) => (u.displayName || '').toLowerCase().includes(query));
    });

    // ── 共同好友回溯 (Hidden Mutual) ────────────────────────────────────
    // 旧边被 DB 特意保留: 对方关闭共同好友显示后, 官方 UI 的 mutual 列表里
    // 这些人会消失 (显示为 "Hidden Mutual"), 这里用关闭前的快照回溯展示。

    // 目标用户(对话框正在查看的 X)自己是否 opted-out
    const isTargetOptedOut = ref(false);
    // X 的 opt_out_detected_at (检测到关闭的时间, 仅作补充提示)
    const optedOutDetectedAt = ref('');
    // X 关闭前的共同好友回溯名单 (user ref 列表)
    const retrospectiveMutuals = ref([]);
    // X 关闭前最后一次快照时间 (取 meta.lastFetchedAt, 即"快照日期")
    const retrospectiveSnapshotDate = ref('');
    // X 正常时: 旧快照中存在、新抓取中消失且自身 optedOut 的成员 (Hidden Mutual)
    const hiddenMutuals = ref([]);
    // hidden mutuals 推断所依据的快照时间 (取 X 自己的 lastFetchedAt)
    const hiddenMutualsSnapshotDate = ref('');

    // 标题计数与当前实际渲染的数据源保持一致
    const displayedCount = computed(() =>
        isTargetOptedOut.value ? retrospectiveMutuals.value.length : userDialog.value.mutualFriends.length
    );

    const filteredRetrospectiveMutuals = computed(() => {
        const query = searchQuery.value.trim().toLowerCase();
        if (!query) return retrospectiveMutuals.value;
        return retrospectiveMutuals.value.filter((u) => (u.displayName || '').toLowerCase().includes(query));
    });

    const filteredHiddenMutuals = computed(() => {
        const query = searchQuery.value.trim().toLowerCase();
        if (!query) return hiddenMutuals.value;
        return hiddenMutuals.value.filter((u) => (u.displayName || '').toLowerCase().includes(query));
    });

    /**
     * mutual id 列表 -> user ref 列表 (优先 cachedUsers, 无缓存时构造最小 ref)
     * @param {string[]} ids
     * @returns {object[]}
     */
    function resolveMutualRefs(ids) {
        const users = [];
        for (const id of ids) {
            if (!id) {
                continue;
            }
            const ref = cachedUsers.get(id);
            users.push(ref ?? { id, displayName: id });
        }
        users.sort(compareByDisplayName);
        return users;
    }

    /**
     * 刷新回溯/hidden 分区数据
     * @param {string} userId
     * @param {boolean} fetchSucceeded 本次 API 抓取是否成功 (false 可能为 403)
     * @param {string[]|null} oldMutualIds 写库前读到的旧快照 (P1-2: 避免先覆盖后读取)
     * @param {Array} fetchedMutuals 本次抓取到的 mutual 列表 (P1-3: 不再从共享 userDialog 读)
     */
    async function loadRetrospectiveData(userId, fetchSucceeded, oldMutualIds, fetchedMutuals) {
        isTargetOptedOut.value = false;
        optedOutDetectedAt.value = '';
        retrospectiveMutuals.value = [];
        retrospectiveSnapshotDate.value = '';
        hiddenMutuals.value = [];
        hiddenMutualsSnapshotDate.value = '';
        if (!userId || currentUser.value.hasSharedConnectionsOptOut) {
            return;
        }
        const metaMap = await database.getMutualGraphMeta();
        const meta = metaMap?.get?.(userId);
        const sessionOptedOut = Boolean(
            userDialog.value.ref?.$mutualOptedOut || cachedUsers.get(userId)?.$mutualOptedOut
        );
        if (meta?.optedOut || (!fetchSucceeded && sessionOptedOut)) {
            // X 自己关闭了共同好友显示: 回溯其关闭前的共同好友名单
            isTargetOptedOut.value = true;
            // P2-13: 快照日期取 lastFetchedAt (最后一次成功抓取时间),
            // optOutDetectedAt 单独作补充提示
            retrospectiveSnapshotDate.value = meta?.lastFetchedAt || meta?.optOutDetectedAt || '';
            optedOutDetectedAt.value = meta?.optOutDetectedAt || '';
            retrospectiveMutuals.value = oldMutualIds?.length ? resolveMutualRefs(oldMutualIds) : [];
            return;
        }
        if (!fetchSucceeded || !oldMutualIds?.length) {
            return;
        }
        // X 正常: 旧边中消失且自身 optedOut 的成员 -> Hidden Mutual (推测)
        const currentIds = new Set((fetchedMutuals || []).map((u) => u.id));
        const hiddenIds = [];
        for (const id of oldMutualIds) {
            if (!id || currentIds.has(id) || id === userId) {
                continue;
            }
            const m = metaMap?.get?.(id);
            if (!m?.optedOut) {
                continue;
            }
            hiddenIds.push(id);
        }
        hiddenMutuals.value = resolveMutualRefs(hiddenIds);
        // P2-13: 快照日期取 X 自己最后一次成功抓取的时间
        hiddenMutualsSnapshotDate.value = meta?.lastFetchedAt || '';
    }

    watch(
        () => userDialog.value.id,
        () => {
            searchQuery.value = '';
        }
    );

    /**
     * @param sortOrder
     */
    async function setUserDialogMutualFriendSorting(sortOrder) {
        const D = userDialog.value;
        D.mutualFriendSorting = sortOrder;
        switch (sortOrder.value) {
            case 'alphabetical':
                D.mutualFriends.sort(compareByDisplayName);
                break;
            case 'lastActive':
                D.mutualFriends.sort(compareByLastActiveRef);
                break;
            case 'friendOrder':
                D.mutualFriends.sort(compareByFriendOrder);
                break;
        }
    }

    // P1-3: 请求序号令牌, 快速切换用户时丢弃迟到的旧回调
    let mutualReqSeq = 0;

    /**
     * @param userId
     */
    async function getUserMutualFriends(userId) {
        const seq = ++mutualReqSeq;
        userDialog.value.mutualFriends = [];
        isTargetOptedOut.value = false;
        retrospectiveMutuals.value = [];
        hiddenMutuals.value = [];
        if (currentUser.value.hasSharedConnectionsOptOut) {
            return;
        }
        userDialog.value.isMutualFriendsLoading = true;
        const params = {
            userId,
            n: 100,
            offset: 0
        };
        // P1-2: 写库前先读旧快照, 避免 updateMutualsForFriend 的 DELETE+INSERT 覆盖
        const oldMutualIds = await database.getMutualsForFriend(userId);
        processBulk({
            fn: userRequest.getMutualFriends,
            N: -1,
            params,
            handle: (args) => {
                if (seq !== mutualReqSeq || userDialog.value.id !== userId) {
                    return;
                }
                for (const json of args.json) {
                    if (userDialog.value.mutualFriends.some((u) => u.id === json.id)) {
                        continue;
                    }
                    const ref = cachedUsers.get(json.id);
                    if (typeof ref !== 'undefined') {
                        userDialog.value.mutualFriends.push(ref);
                    } else {
                        userDialog.value.mutualFriends.push(json);
                    }
                }
                setUserDialogMutualFriendSorting(userDialog.value.mutualFriendSorting);
            },
            done: (success) => {
                if (seq !== mutualReqSeq || userDialog.value.id !== userId) {
                    return;
                }
                userDialog.value.isMutualFriendsLoading = false;
                if (success && friendStore.friends.has(userId)) {
                    // 只对当前好友落库: 陌生人的 mutual 图写进 DB 会让关系网图中
                    // 其他好友的 DB 计数虚高(每个被看过的 stranger 多出一条 link)
                    const mutualIds = userDialog.value.mutualFriends.map((u) => u.id);
                    database.updateMutualsForFriend(userId, mutualIds);
                }
                // P2-14: 403 (opted-out) 时把 meta 落库, 供下次直接识别;
                // $mutualOptedOut 是 403 的可靠信号, 普通网络错误不会置位
                if (!success) {
                    const optedOut = Boolean(
                        userDialog.value.ref?.$mutualOptedOut || cachedUsers.get(userId)?.$mutualOptedOut
                    );
                    if (optedOut) {
                        database.upsertMutualGraphMeta(userId, {
                            optedOut: true,
                            optOutDetectedAt: new Date().toISOString()
                        });
                    }
                }
                // 回溯数据依赖抓取结果做 diff; 旧快照与本次抓取列表都作为参数传入
                loadRetrospectiveData(userId, success, oldMutualIds, userDialog.value.mutualFriends);
            }
        });
    }

    defineExpose({ getUserMutualFriends });
</script>

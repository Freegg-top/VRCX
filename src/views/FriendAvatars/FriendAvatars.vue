<template>
    <div class="flex h-full flex-col gap-4 overflow-y-auto p-4">
        <div>
            <h1 class="text-lg font-semibold">
                {{ t('view.friend_avatars.header') }}
            </h1>
            <p class="text-muted-foreground text-sm">
                {{ t('view.friend_avatars.description') }}
            </p>
        </div>

        <div
            v-if="!remoteDatabaseEnabled"
            class="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            {{ t('view.friend_avatars.remote_db_off_hint') }}
        </div>

        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <VirtualCombobox
                class="w-72"
                v-model="selectedFriendId"
                :groups="friendPickerGroups"
                :placeholder="t('view.friend_avatars.select_friend')"
                :search-placeholder="t('view.friend_avatars.select_friend')"
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
                    {{ t('view.friend_avatars.no_matches') }}
                </template>
            </VirtualCombobox>
            <Input
                v-model="search"
                class="ml-auto max-w-56"
                :placeholder="t('view.friend_avatars.search_avatar')" />
        </div>

        <div class="flex flex-wrap items-center gap-4 text-sm">
            <span v-if="selectedFriendName">
                {{
                    t('view.friend_avatars.summary', {
                        name: selectedFriendName,
                        total: friendAvatars.length
                    })
                }}
            </span>
            <Badge v-if="publicCount" variant="outline" class="text-xs">
                {{
                    t('view.friend_avatars.public_count', {
                        count: publicCount
                    })
                }}
            </Badge>
            <Badge v-if="privateCount" variant="secondary" class="text-xs">
                {{
                    t('view.friend_avatars.private_count', {
                        count: privateCount
                    })
                }}
            </Badge>
        </div>

        <div
            v-if="!selectedFriendId"
            class="text-muted-foreground py-6 text-center text-sm">
            {{ t('view.friend_avatars.select_hint') }}
        </div>
        <div
            v-else-if="friendAvatars.length === 0"
            class="text-muted-foreground py-6 text-center text-sm">
            {{
                loading
                    ? t('view.friend_avatars.loading')
                    : t('view.friend_avatars.empty')
            }}
        </div>
        <div
            v-else
            class="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
            <div
                v-for="item in visibleAvatars"
                :key="item.userId + item.avatarName + item.ownerId"
                class="hover:bg-accent cursor-pointer rounded-lg border p-2"
                @click="openAvatar(item)">
                <div class="flex items-center gap-3">
                    <img
                        v-if="item.thumbnail"
                        class="size-14 flex-none rounded-md object-cover"
                        :src="item.thumbnail"
                        loading="lazy" />
                    <div
                        v-else
                        class="bg-muted flex size-14 flex-none items-center justify-center rounded-md">
                        <Package class="text-muted-foreground size-6" />
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                            <span class="truncate text-sm font-medium">
                                {{ item.avatarName }}
                            </span>
                            <Lock
                                v-if="item.visibility === 'private'"
                                class="text-muted-foreground size-3.5 flex-none" />
                        </div>
                        <div class="mt-1 flex flex-wrap items-center gap-1">
                            <Badge
                                v-if="item.isCurrent"
                                variant="default"
                                class="text-xs">
                                {{ t('view.friend_avatars.current_badge') }}
                            </Badge>
                            <Badge
                                :variant="
                                    item.visibility === 'public'
                                        ? 'outline'
                                        : 'secondary'
                                "
                                class="text-xs">
                                {{
                                    item.visibility === 'public'
                                        ? t('view.friend_avatars.public_badge')
                                        : t('view.friend_avatars.private_badge')
                                }}
                            </Badge>
                            <Badge
                                v-if="item.count > 1"
                                variant="secondary"
                                class="text-xs">
                                ×{{ item.count }}
                            </Badge>
                        </div>
                    </div>
                </div>
                <div class="text-muted-foreground mt-2 text-xs">
                    {{
                        t('view.friend_avatars.seen_range', {
                            first: formatDate(item.firstSeen),
                            last: formatDate(item.lastSeen)
                        })
                    }}
                </div>
            </div>
        </div>
        <div
            v-if="friendAvatars.length > visibleCount"
            class="py-2 text-center">
            <Button variant="outline" size="sm" @click="visibleCount += 60">
                {{ t('view.friend_avatars.show_more') }}
            </Button>
        </div>
    </div>
</template>

<script setup>
    import { computed, onMounted, ref, watch } from 'vue';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';
    import { toast } from 'vue-sonner';

    import dayjs from 'dayjs';
    import { CheckIcon, Lock, Package } from 'lucide-vue-next';

    import { Badge } from '../../components/ui/badge';
    import { Button } from '../../components/ui/button';
    import { Input } from '../../components/ui/input';
    import { VirtualCombobox } from '../../components/ui/virtual-combobox';
    import { useAdvancedSettingsStore } from '../../stores/settings/advanced';
    import { useFriendStore, useUserStore } from '../../stores';
    import { database } from '../../services/database';
    import { extractFileId } from '../../shared/utils';
    import {
        checkAvatarCache,
        lookupAvatarByImageFileId,
        showAvatarAuthorDialog
    } from '../../coordinators/avatarCoordinator';
    import { createRateLimiter } from '../../shared/utils/throttle';
    import { useUserDisplay } from '../../composables/useUserDisplay';

    const { t } = useI18n();

    const friendStore = useFriendStore();
    const { friends } = storeToRefs(friendStore);
    const userStore = useUserStore();
    const advancedSettingsStore = useAdvancedSettingsStore();
    const remoteDatabaseEnabled = computed(
        () => advancedSettingsStore.avatarRemoteDatabase
    );
    const { userImage } = useUserDisplay();

    const loading = ref(false);
    const loaded = ref(false);
    const avatarHistory = ref([]);
    const selectedFriendId = ref(null);
    const search = ref('');
    watch(search, () => {
        visibleCount.value = 60;
    });
    const visibleCount = ref(60);

    // fileId -> 'public' | 'private' 解析结果缓存 (模块级, 跨页面复用)
    const avatarVisibilityCache = new Map();
    const resolveQueued = new Set();
    const resolveRateLimiter = createRateLimiter({
        limitPerInterval: 1,
        intervalMs: 1000
    });

    onMounted(load);

    async function load() {
        if (loading.value) {
            return;
        }
        loading.value = true;
        try {
            const rows = await database.getFriendAvatarHistory();
            const resolveCache = avatarVisibilityCache;
            avatarHistory.value = rows.map((row) => {
                const fileId = extractFileId(row.thumbnail) || '';
                let visibility = 'private';
                if (row.ownerId !== row.userId) {
                    // 穿着别人的模型: 别人的私模穿不了, 必然公开
                    visibility = 'public';
                } else if (resolveCache.has(fileId)) {
                    visibility = resolveCache.get(fileId);
                }
                return { ...row, fileId, visibility };
            });
            loaded.value = true;
        } catch (err) {
            console.error('[friend-avatars] load failed:', err);
        } finally {
            loading.value = false;
        }
    }

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

    // 好友当前模型的 fileId, 匹配的条目标记"当前"
    const currentAvatarFileId = computed(() => {
        if (!selectedFriendId.value) {
            return '';
        }
        const ref = friendStore.friends.get(selectedFriendId.value)?.ref;
        const url =
            ref?.currentAvatarImageUrl || ref?.iconUrl || '';
        return extractFileId(url) || '';
    });

    const friendAvatars = computed(() => {
        if (!selectedFriendId.value) {
            return [];
        }
        const userId = selectedFriendId.value;
        const list = avatarHistory.value
            .filter((row) => row.userId === userId)
            .map((row) => ({
                ...row,
                isCurrent:
                    Boolean(currentAvatarFileId.value) &&
                    row.fileId === currentAvatarFileId.value
            }));
        list.sort((a, b) => {
            if (a.isCurrent !== b.isCurrent) {
                return a.isCurrent ? -1 : 1;
            }
            return String(b.lastSeen).localeCompare(String(a.lastSeen));
        });
        return list;
    });

    const publicCount = computed(
        () => friendAvatars.value.filter((item) => item.visibility === 'public')
            .length
    );
    const privateCount = computed(
        () =>
            friendAvatars.value.filter((item) => item.visibility === 'private')
                .length
    );

    const visibleAvatars = computed(() =>
        friendAvatars.value.slice(0, visibleCount.value)
    );

    // 后台解析好友自己的模型 (1/s): 本地缓存 -> 公共模型库, 命中即公开模
    watch(
        friendAvatars,
        (items) => {
            for (const item of items) {
                if (item.ownerId !== item.userId) {
                    continue;
                }
                if (
                    !item.fileId ||
                    avatarVisibilityCache.has(item.fileId) ||
                    resolveQueued.has(item.fileId)
                ) {
                    continue;
                }
                resolveQueued.add(item.fileId);
                resolveAvatarVisibility(item);
            }
        },
        { immediate: true }
    );

    async function resolveAvatarVisibility(item) {
        await resolveRateLimiter.wait();
        let found = false;
        try {
            let avatarId = checkAvatarCache(item.fileId);
            if (!avatarId && remoteDatabaseEnabled.value) {
                avatarId = await lookupAvatarByImageFileId(
                    item.ownerId,
                    item.fileId
                );
            }
            found = Boolean(avatarId);
        } catch {
            found = false;
        }
        const visibility = found ? 'public' : 'private';
        avatarVisibilityCache.set(item.fileId, visibility);
        for (const row of avatarHistory.value) {
            if (row.fileId === item.fileId && row.ownerId === row.userId) {
                row.visibility = visibility;
            }
        }
    }

    function openAvatar(item) {
        if (item.visibility === 'private') {
            // 与既有行为一致的提示: 私模不可解析
            toast.warning(t('message.avatar_lookup.private_or_not_found'));
            return;
        }
        showAvatarAuthorDialog(item.userId, item.ownerId, item.thumbnail);
    }

    /**
     *
     * @param date
     */
    function formatDate(date) {
        return date ? dayjs(date).format('YYYY-MM-DD') : '-';
    }
</script>

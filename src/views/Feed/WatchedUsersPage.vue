<template>
    <div class="flex h-full min-w-0 flex-col gap-4 overflow-y-auto p-4">
        <div class="min-w-0">
            <h1 class="text-lg font-semibold">
                {{ t('view.feed.watched.header') }}
            </h1>
            <p class="text-muted-foreground text-sm">
                {{ t('view.feed.watched.description') }}
            </p>
        </div>

        <div
            v-if="!dlcxAvailable"
            class="flex flex-col items-center gap-4 rounded-lg border border-dashed p-6 text-center md:p-10">
            <div class="bg-muted flex size-12 items-center justify-center rounded-full">
                <KeyRound class="text-muted-foreground size-6" />
            </div>
            <div class="flex flex-col gap-1">
                <h2 class="text-sm font-semibold">
                    {{ t('view.feed.watched.license_required_title') }}
                </h2>
                <p class="text-muted-foreground max-w-md text-sm">
                    {{ t('view.feed.watched.license_required_description') }}
                </p>
            </div>
            <Button variant="outline" @click="openDLCXSettings">
                {{ t('view.feed.watched.configure_license') }}
            </Button>
        </div>

        <template v-else>
            <div class="flex flex-col gap-3 rounded-lg border p-4">
                <Label for="watched-users-add" class="text-sm">
                    {{ t('view.feed.watched.add_label') }}
                </Label>
                <div class="flex flex-wrap items-center gap-2">
                    <Input
                        id="watched-users-add"
                        v-model="watchInput"
                        class="min-w-0 flex-1 font-mono sm:max-w-md"
                        :placeholder="t('view.feed.watched.add_placeholder')"
                        autocomplete="off"
                        spellcheck="false"
                        @keydown.enter.prevent="addEntry" />
                    <Button :disabled="!watchInput.trim()" @click="addEntry">
                        {{ t('view.feed.watched.add') }}
                    </Button>
                </div>
                <p class="text-muted-foreground text-xs">
                    {{ t('view.feed.watched.add_hint') }}
                </p>
            </div>

            <div
                v-if="watchedList.length === 0"
                class="flex flex-col items-center gap-4 rounded-lg border border-dashed p-6 text-center md:p-10">
                <div class="bg-muted flex size-12 items-center justify-center rounded-full">
                    <Eye class="text-muted-foreground size-6" />
                </div>
                <div class="flex flex-col gap-1">
                    <h2 class="text-sm font-semibold">
                        {{ t('view.feed.watched.empty_title') }}
                    </h2>
                    <p class="text-muted-foreground max-w-md text-sm">
                        {{ t('view.feed.watched.empty_description') }}
                    </p>
                </div>
                <div class="flex w-full max-w-md flex-col gap-2">
                    <h3 class="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                        {{ t('view.feed.watched.guide_title') }}
                    </h3>
                    <ol class="flex flex-col gap-2 text-left">
                        <li v-for="(step, index) in guideSteps" :key="step" class="flex items-start gap-2 text-sm">
                            <span
                                class="bg-muted text-muted-foreground mt-0.5 flex size-5 flex-none items-center justify-center rounded-full text-xs font-medium">
                                {{ index + 1 }}
                            </span>
                            <span class="min-w-0">{{ t(step) }}</span>
                        </li>
                    </ol>
                </div>
            </div>

            <template v-else>
                <div class="text-muted-foreground text-xs">
                    {{ t('view.feed.watched.count', { count: watchedList.length }) }}
                </div>
                <div class="flex flex-col gap-2">
                    <Item
                        v-for="user in paginatedWatchedList"
                        :key="user.userId"
                        variant="outline"
                        size="sm"
                        class="min-w-0 flex-col items-stretch gap-0 overflow-hidden p-0">
                        <div
                            class="x-hover-list hover:bg-muted flex min-w-0 cursor-pointer items-start gap-3 rounded-md px-3 py-3"
                            role="button"
                            tabindex="0"
                            :aria-expanded="expandedUserId === user.userId"
                            :aria-controls="`watched-history-${user.userId}`"
                            :aria-label="
                                t(
                                    expandedUserId === user.userId
                                        ? 'view.feed.watched.collapse_history'
                                        : 'view.feed.watched.expand_history',
                                    { name: displayName(user) }
                                )
                            "
                            :data-testid="`watched-user-toggle-${user.userId}`"
                            @click="toggleHistory(user.userId)"
                            @keydown.enter.prevent="toggleHistory(user.userId)"
                            @keydown.space.prevent="toggleHistory(user.userId)">
                            <ItemMedia class="relative size-10 flex-none">
                                <Avatar class="size-full">
                                    <AvatarImage
                                        v-if="avatarUrl(user.userId)"
                                        :src="avatarUrl(user.userId)"
                                        loading="lazy" />
                                    <AvatarFallback>
                                        <User class="text-muted-foreground size-5" />
                                    </AvatarFallback>
                                </Avatar>
                                <IconFrame :icon-frame="displayUser(user).iconFrame" />
                            </ItemMedia>
                            <ItemContent class="min-w-0 flex-1 gap-1">
                                <ItemTitle class="flex max-w-full items-center gap-1.5">
                                    <button
                                        type="button"
                                        class="min-w-0 truncate text-left font-medium hover:underline"
                                        @click.stop="openUserDialog(user.userId)">
                                        {{ displayName(user) }}
                                    </button>
                                    <template v-if="displayUser(user).$trustLevel">
                                        <span
                                            v-if="randomUserColours"
                                            class="shrink-0 text-xs font-normal"
                                            :class="displayUser(user).$trustClass">
                                            {{ displayUser(user).$trustLevel }}
                                        </span>
                                        <span
                                            v-else
                                            class="shrink-0 text-xs font-normal"
                                            :style="{ color: displayUser(user).$userColour }">
                                            {{ displayUser(user).$trustLevel }}
                                        </span>
                                    </template>
                                    <span
                                        v-for="language in displayUser(user).$languages || []"
                                        :key="language.key"
                                        class="flags shrink-0"
                                        :class="languageClass(language.key)"
                                        :title="language.value" />
                                </ItemTitle>
                                <ItemDescription class="truncate font-mono text-xs!">
                                    {{ user.userId }}
                                </ItemDescription>
                                <div class="text-muted-foreground mt-1 flex min-w-0 flex-col gap-1 text-xs">
                                    <div class="flex min-w-0 items-center gap-1.5">
                                        <Cloud class="size-3.5 shrink-0" />
                                        <span class="shrink-0">{{ t('view.feed.watched.cloud_observation') }}</span>
                                        <LoaderCircle
                                            v-if="observationFor(user.userId).status === 'loading'"
                                            class="size-3.5 animate-spin" />
                                        <span
                                            v-else-if="observationFor(user.userId).summary?.lastSeen"
                                            class="truncate">
                                            {{
                                                t('view.feed.watched.last_seen', {
                                                    time: formatObservationTime(
                                                        observationFor(user.userId).summary.lastSeen
                                                    )
                                                })
                                            }}
                                        </span>
                                        <span v-else-if="observationFor(user.userId).status === 'loaded'">
                                            {{ t('view.feed.watched.no_observation') }}
                                        </span>
                                    </div>
                                    <Location
                                        v-if="observationLocation(user.userId)"
                                        :location="observationLocation(user.userId)"
                                        :link="false"
                                        class="min-w-0 cursor-default text-xs" />
                                </div>
                            </ItemContent>
                            <ItemActions class="flex-none gap-1 self-center">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    :aria-label="t('view.feed.watched.remove')"
                                    @click.stop="unwatch(user)">
                                    <UserMinus class="size-4" />
                                    <span class="hidden sm:inline">
                                        {{ t('view.feed.watched.remove') }}
                                    </span>
                                </Button>
                                <ChevronDown
                                    class="text-muted-foreground size-4 shrink-0 transition-transform duration-200"
                                    :class="{ 'rotate-180': expandedUserId === user.userId }" />
                            </ItemActions>
                        </div>

                        <Transition name="watched-history">
                            <div v-if="expandedUserId === user.userId" class="grid grid-rows-[1fr]">
                                <div class="min-h-0 overflow-hidden">
                                    <div
                                        :id="`watched-history-${user.userId}`"
                                        class="border-t bg-muted/20 mx-3 flex flex-col gap-3 border-x-0 border-b-0 px-3 py-3">
                                        <div class="flex items-center gap-2 text-xs font-medium">
                                            <History class="size-3.5" />
                                            {{ t('view.feed.watched.history_title') }}
                                        </div>
                                        <div
                                            v-if="historyFor(user.userId).status === 'loading'"
                                            class="text-muted-foreground flex items-center gap-2 py-2 text-xs">
                                            <LoaderCircle class="size-3.5 animate-spin" />
                                            {{ t('view.feed.watched.history_loading') }}
                                        </div>
                                        <div
                                            v-else-if="historyFor(user.userId).status === 'error'"
                                            class="flex flex-wrap items-center gap-2 text-xs">
                                            <span class="text-muted-foreground">
                                                {{ t('view.feed.watched.history_error') }}
                                            </span>
                                            <Button variant="outline" size="sm" @click="loadHistory(user.userId)">
                                                {{ t('view.feed.watched.retry') }}
                                            </Button>
                                        </div>
                                        <p
                                            v-else-if="historyFor(user.userId).entries.length === 0"
                                            class="text-muted-foreground py-2 text-xs">
                                            {{ t('view.feed.watched.history_empty') }}
                                        </p>
                                        <ol v-else class="max-h-80 flex flex-col gap-1 overflow-y-auto pr-1">
                                            <li
                                                v-for="entry in historyFor(user.userId).entries"
                                                :key="entry.key"
                                                class="relative flex min-w-0 flex-col gap-1 border-l pl-3 py-1.5 sm:flex-row sm:items-center sm:gap-3">
                                                <span
                                                    class="bg-muted-foreground absolute -left-1 top-3 size-2 rounded-full" />
                                                <time
                                                    class="text-muted-foreground shrink-0 font-mono text-xs tabular-nums"
                                                    :datetime="entry.at">
                                                    {{ formatObservationTime(entry.at) }}
                                                </time>
                                                <Location
                                                    v-if="entry.location || entry.worldId"
                                                    :location="entry.location || entry.worldId"
                                                    :link="Boolean(entry.location)"
                                                    class="min-w-0 flex-1 text-xs" />
                                                <span v-else class="text-muted-foreground text-xs">
                                                    {{ t('view.feed.watched.unknown_location') }}
                                                </span>
                                            </li>
                                        </ol>
                                    </div>
                                </div>
                            </div>
                        </Transition>
                    </Item>
                </div>
                <Pagination
                    v-if="watchedList.length > WATCHED_PAGE_SIZE"
                    v-model:page="watchedPage"
                    :total="watchedList.length"
                    :items-per-page="WATCHED_PAGE_SIZE"
                    :sibling-count="1"
                    show-edges
                    class="w-full">
                    <PaginationContent v-slot="{ items }">
                        <PaginationPrevious />
                        <template
                            v-for="(item, index) in items"
                            :key="item.type === 'page' ? `page-${item.value}` : `ellipsis-${index}`">
                            <PaginationItem
                                v-if="item.type === 'page'"
                                :value="item.value"
                                :is-active="item.value === watchedPage">
                                {{ item.value }}
                            </PaginationItem>
                            <PaginationEllipsis v-else />
                        </template>
                        <PaginationNext />
                    </PaginationContent>
                </Pagination>
            </template>
        </template>
    </div>
</template>

<script setup>
    import { computed, onActivated, ref, shallowReactive, watch } from 'vue';
    import { storeToRefs } from 'pinia';
    import { useRouter } from 'vue-router';
    import { useI18n } from 'vue-i18n';

    import dayjs from 'dayjs';
    import { ChevronDown, Cloud, Eye, History, KeyRound, LoaderCircle, User, UserMinus } from 'lucide-vue-next';
    import { toast } from 'vue-sonner';

    import { userRequest } from '../../api';
    import IconFrame from '../../components/IconFrame.vue';
    import Location from '../../components/Location.vue';
    import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
    import { Button } from '../../components/ui/button';
    import { Input } from '../../components/ui/input';
    import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '../../components/ui/item';
    import { Label } from '../../components/ui/label';
    import {
        Pagination,
        PaginationContent,
        PaginationEllipsis,
        PaginationItem,
        PaginationNext,
        PaginationPrevious
    } from '../../components/ui/pagination';
    import { useUserDisplay } from '../../composables/useUserDisplay';
    import { showUserDialog } from '../../coordinators/userCoordinator';
    import { getUserHistory } from '../../services/dlcxApi';
    import { getCloudObservationSummary, isDLCXLicenseAvailable } from '../../services/dlcxUserCardData';
    import { database } from '../../services/database';
    import { languageClass } from '../../shared/utils';
    import { executeWithBackoff } from '../../shared/utils/retry';
    import { createRateLimiter } from '../../shared/utils/throttle';
    import { createDefaultUserRef } from '../../shared/utils/userTransforms';
    import { useAppearanceSettingsStore, useDLCXSettingsStore, useUserStore } from '../../stores';

    const USR_ID_REGEX = /^usr_[a-z0-9-]+$/;
    const USER_REFRESH_RATE_PER_SECOND = 1;
    const USER_FETCH_MAX_RETRY = 3;
    const USER_FETCH_RETRY_BASE_DELAY = 1000;
    const USER_CACHE_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
    const OBSERVATION_REFRESH_RATE_PER_SECOND = 2;
    const CLOUD_HISTORY_LIMIT = 50;
    const WATCHED_PAGE_SIZE = 20;

    const guideSteps = [
        'view.feed.watched.guide_add',
        'view.feed.watched.guide_load',
        'view.feed.watched.guide_alerts'
    ];

    const { t } = useI18n();
    const router = useRouter();
    const userStore = useUserStore();
    const dlcxSettingsStore = useDLCXSettingsStore();
    const { watchlist, licenseKey, licenseStatus } = storeToRefs(dlcxSettingsStore);
    const { addWatch, removeWatch } = dlcxSettingsStore;
    const appearanceSettingsStore = useAppearanceSettingsStore();
    const { randomUserColours } = storeToRefs(appearanceSettingsStore);
    const { userImage } = useUserDisplay();

    const watchInput = ref('');
    const watchedPage = ref(1);
    const expandedUserId = ref('');
    const cloudObservations = shallowReactive(new Map());
    const cloudHistories = shallowReactive(new Map());
    const historyRequestVersions = new Map();
    const dlcxAvailable = computed(() =>
        isDLCXLicenseAvailable({
            licenseKey: licenseKey.value,
            licenseStatus: licenseStatus.value
        })
    );
    const watchedList = computed(() => watchlist.value.map((userId) => ({ userId })));
    const watchedTotalPages = computed(() => Math.max(1, Math.ceil(watchedList.value.length / WATCHED_PAGE_SIZE)));
    const paginatedWatchedList = computed(() => {
        const start = (watchedPage.value - 1) * WATCHED_PAGE_SIZE;
        return watchedList.value.slice(start, start + WATCHED_PAGE_SIZE);
    });

    watch(watchedTotalPages, (totalPages) => {
        if (watchedPage.value > totalPages) {
            watchedPage.value = totalPages;
        }
    });

    const requestedUserIds = new Set();
    const staleUserIds = new Set();
    const persistedUsers = new Map();
    const userFetchRateLimiter = createRateLimiter({
        limitPerInterval: USER_REFRESH_RATE_PER_SECOND,
        intervalMs: 1000
    });
    let usersFetchPromise = null;

    async function loadPersistedUsers() {
        let rows;
        try {
            rows = await database.getWatchedUserCache();
        } catch (error) {
            console.error('Failed to load watched user cache:', error);
            return;
        }

        const watchedIds = new Set(watchlist.value);
        persistedUsers.clear();
        for (const row of rows) {
            if (!row.userId) {
                continue;
            }
            persistedUsers.set(row.userId, row);
            if (!watchedIds.has(row.userId) || cachedUser(row.userId)) {
                continue;
            }
            const ref = createDefaultUserRef({
                id: row.userId,
                displayName: row.displayName,
                iconUrl: row.avatarUrl,
                tags: row.trust ? [row.trust] : [],
                $languages: row.languageTags
            });
            appearanceSettingsStore.applyUserTrustLevel(ref);
            userStore.setCachedUser(ref);
        }
    }

    function isPersistedUserStale(userId) {
        const updatedAt = Date.parse(persistedUsers.get(userId)?.updatedAt || '');
        return !Number.isFinite(updatedAt) || Date.now() - updatedAt >= USER_CACHE_STALE_AFTER_MS;
    }

    function takeNextUserRequest() {
        for (const [queue, isStaleRefresh] of [
            [requestedUserIds, false],
            [staleUserIds, true]
        ]) {
            for (const userId of queue) {
                queue.delete(userId);
                if (isStaleRefresh) {
                    requestedUserIds.delete(userId);
                } else {
                    staleUserIds.delete(userId);
                }
                if (watchlist.value.includes(userId)) {
                    return { userId, isStaleRefresh };
                }
            }
        }
        return null;
    }

    async function persistFetchedUser(userId, apiResult) {
        const ref = apiResult?.ref || cachedUser(userId);
        if (!ref) {
            return;
        }
        const tags = Array.isArray(ref.tags) ? ref.tags : [];
        const updatedAt = new Date().toJSON();
        const profile = {
            id: userId,
            displayName: ref.displayName || '',
            avatarUrl:
                userImage(ref, true) ||
                ref.iconUrl ||
                ref.currentAvatarThumbnailImageUrl ||
                ref.currentAvatarImageUrl ||
                '',
            languageTags: Array.isArray(ref.$languages) ? ref.$languages : [],
            trust: tags.find((tag) => tag.startsWith('system_trust_')) || '',
            updatedAt
        };
        try {
            await database.setWatchedUserCache(profile);
            persistedUsers.set(userId, {
                userId,
                displayName: profile.displayName,
                avatarUrl: profile.avatarUrl,
                languageTags: profile.languageTags,
                trust: profile.trust,
                updatedAt
            });
        } catch (error) {
            console.error('Failed to persist watched user cache:', userId, error);
        }
    }

    /**
     * VRChat has no get-users-by-ID endpoint. Reuse getUser so applyUser fills
     * cachedUsers. Missing profiles run first; stale persistent profiles reuse
     * the same sequential, throttled queue for a silent background refresh.
     */
    async function fetchMissingUsers() {
        if (!dlcxAvailable.value) {
            return;
        }
        await loadPersistedUsers();
        if (!dlcxAvailable.value) {
            return;
        }
        for (const userId of watchlist.value) {
            if (requestedUserIds.has(userId) || staleUserIds.has(userId)) {
                continue;
            }
            if (!cachedUser(userId) && !persistedUsers.has(userId)) {
                requestedUserIds.add(userId);
            } else if (persistedUsers.has(userId) && isPersistedUserStale(userId)) {
                staleUserIds.add(userId);
            }
        }
        if (usersFetchPromise || (requestedUserIds.size === 0 && staleUserIds.size === 0)) {
            return usersFetchPromise;
        }

        usersFetchPromise = (async () => {
            while ((requestedUserIds.size > 0 || staleUserIds.size > 0) && dlcxAvailable.value) {
                const request = takeNextUserRequest();
                if (!request) {
                    break;
                }
                const { userId, isStaleRefresh } = request;
                if ((!isStaleRefresh && cachedUser(userId)) || (isStaleRefresh && !isPersistedUserStale(userId))) {
                    continue;
                }
                await userFetchRateLimiter.wait();
                if (
                    !dlcxAvailable.value ||
                    !watchlist.value.includes(userId) ||
                    (!isStaleRefresh && cachedUser(userId)) ||
                    (isStaleRefresh && !isPersistedUserStale(userId))
                ) {
                    continue;
                }
                try {
                    const result = await executeWithBackoff(() => userRequest.getUser({ userId }), {
                        maxRetries: USER_FETCH_MAX_RETRY,
                        baseDelay: USER_FETCH_RETRY_BASE_DELAY,
                        shouldRetry: (err) => err?.status === 429 || (err?.message || '').includes('429')
                    });
                    await persistFetchedUser(userId, result);
                } catch (error) {
                    console.error('Failed to fetch cloud watchlist user:', userId, error);
                }
            }
        })().finally(() => {
            usersFetchPromise = null;
            if (!dlcxAvailable.value) {
                requestedUserIds.clear();
                staleUserIds.clear();
            } else if (requestedUserIds.size > 0 || staleUserIds.size > 0) {
                void fetchMissingUsers();
            }
        });
        return usersFetchPromise;
    }

    const requestedObservationIds = new Set();
    const observationFetchRateLimiter = createRateLimiter({
        limitPerInterval: OBSERVATION_REFRESH_RATE_PER_SECOND,
        intervalMs: 1000
    });
    let observationsFetchPromise = null;

    function fetchCloudObservations() {
        if (!dlcxAvailable.value) {
            return Promise.resolve();
        }
        for (const userId of watchlist.value) {
            if (!cloudObservations.has(userId) && !requestedObservationIds.has(userId)) {
                requestedObservationIds.add(userId);
            }
        }
        if (observationsFetchPromise || requestedObservationIds.size === 0) {
            return observationsFetchPromise || Promise.resolve();
        }

        observationsFetchPromise = (async () => {
            while (requestedObservationIds.size > 0 && dlcxAvailable.value) {
                const batch = Array.from(requestedObservationIds);
                for (const userId of batch) {
                    if (!watchlist.value.includes(userId) || cloudObservations.has(userId)) {
                        requestedObservationIds.delete(userId);
                        continue;
                    }
                    cloudObservations.set(userId, { status: 'loading', summary: null });
                    await observationFetchRateLimiter.wait();
                    try {
                        const summary = await getCloudObservationSummary(userId);
                        cloudObservations.set(userId, { status: 'loaded', summary });
                    } finally {
                        requestedObservationIds.delete(userId);
                    }
                }
            }
        })().finally(() => {
            observationsFetchPromise = null;
            if (!dlcxAvailable.value) {
                requestedObservationIds.clear();
            }
        });
        return observationsFetchPromise;
    }

    watch([watchlist, dlcxAvailable], () => void fetchMissingUsers(), { immediate: true });
    watch([watchlist, dlcxAvailable], () => void fetchCloudObservations(), { immediate: true });
    watch(dlcxAvailable, (available) => {
        if (!available) {
            expandedUserId.value = '';
            cloudObservations.clear();
            cloudHistories.clear();
        }
    });
    onActivated(() => {
        void fetchMissingUsers();
        void fetchCloudObservations();
    });

    /**
     * @param {string} userId
     */
    function cachedUser(userId) {
        return userStore.cachedUsers?.get(userId);
    }

    /**
     * @param {{ userId: string }} user
     */
    function displayUser(user) {
        return cachedUser(user.userId) || user;
    }

    /**
     * @param {{ userId: string }} user
     */
    function displayName(user) {
        return displayUser(user).displayName || user.userId;
    }

    /**
     * @param {string} userId
     */
    function avatarUrl(userId) {
        const user = cachedUser(userId);
        return user ? userImage(user, true) : '';
    }

    function observationFor(userId) {
        return cloudObservations.get(userId) || { status: 'idle', summary: null };
    }

    function observationLocation(userId) {
        const summary = observationFor(userId).summary;
        return summary?.lastLocation || summary?.lastWorldId || '';
    }

    function historyFor(userId) {
        return cloudHistories.get(userId) || { status: 'idle', entries: [] };
    }

    function formatObservationTime(value) {
        const parsed = dayjs(value);
        return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : String(value || '');
    }

    function toggleHistory(userId) {
        if (expandedUserId.value === userId) {
            expandedUserId.value = '';
            return;
        }
        expandedUserId.value = userId;
        if (historyFor(userId).status === 'idle') {
            void loadHistory(userId);
        }
    }

    async function loadHistory(userId) {
        if (historyFor(userId).status === 'loading') {
            return;
        }
        const version = (historyRequestVersions.get(userId) || 0) + 1;
        historyRequestVersions.set(userId, version);
        cloudHistories.set(userId, { status: 'loading', entries: [] });
        try {
            const payload = await getUserHistory(userId, CLOUD_HISTORY_LIMIT);
            if (historyRequestVersions.get(userId) !== version) {
                return;
            }
            const entries = (payload?.history || [])
                .filter((entry) => entry?.at)
                .map((entry, index) => ({
                    key: `${entry.at}-${entry.location || entry.world_id || ''}-${index}`,
                    at: String(entry.at),
                    location: String(entry.location || ''),
                    worldId: String(entry.world_id || '')
                }))
                .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
            cloudHistories.set(userId, { status: 'loaded', entries });
        } catch (error) {
            if (historyRequestVersions.get(userId) === version) {
                cloudHistories.set(userId, { status: 'error', entries: [] });
            }
            console.error('Failed to fetch watched user cloud history:', userId, error);
        }
    }

    /**
     * @param {string} userId
     */
    function openUserDialog(userId) {
        showUserDialog(userId);
    }

    function openDLCXSettings() {
        router.push({ name: 'settings', query: { tab: 'dlcx' } });
    }

    function addEntry() {
        const raw = String(watchInput.value || '')
            .trim()
            .toLowerCase();
        if (!raw) {
            return;
        }
        if (!USR_ID_REGEX.test(raw)) {
            toast.error(t('view.feed.watched.invalid_id'));
            return;
        }

        const name = cachedUser(raw)?.displayName || raw;
        if (!addWatch(raw)) {
            toast.error(t('view.feed.watched.duplicate_id'));
            return;
        }
        watchInput.value = '';
        toast.success(t('view.feed.watched.added', { name }));
    }

    /**
     * @param {{ userId: string }} user
     */
    function unwatch(user) {
        const name = displayName(user);
        if (expandedUserId.value === user.userId) {
            expandedUserId.value = '';
        }
        if (removeWatch(user.userId)) {
            toast.success(t('view.feed.watched.removed', { name }));
        }
    }
</script>

<style scoped>
    .watched-history-enter-active,
    .watched-history-leave-active {
        transition:
            grid-template-rows 200ms ease,
            opacity 200ms ease;
    }

    .watched-history-enter-from,
    .watched-history-leave-to {
        grid-template-rows: 0fr;
        opacity: 0;
    }
</style>

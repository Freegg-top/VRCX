import { computed, reactive, watch } from 'vue';
import { defineStore } from 'pinia';
import { toast } from 'vue-sonner';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { createRateLimiter, executeWithBackoff } from '../shared/utils';
import { database } from '../services/database';
import { mutualSyncState } from '../services/mutualSyncState';
import { useFriendStore } from './friend';
import { useUserStore } from './user';
import { userRequest } from '../api';

function createDefaultFetchState() {
    return {
        processedFriends: 0
    };
}

const EMPTY_USER_ID = 'usr_00000000-0000-0000-0000-000000000000';

function normalizeIdentifier(value) {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return '';
    return String(value);
}

function isValidMutualIdentifier(value) {
    const identifier = normalizeIdentifier(value);
    return Boolean(identifier && identifier !== EMPTY_USER_ID);
}

export const useChartsStore = defineStore('Charts', () => {
    const friendStore = useFriendStore();
    const userStore = useUserStore();

    const { t } = useI18n();

    const router = useRouter();

    const mutualGraphFetchState = reactive(createDefaultFetchState());
    const mutualGraphStatus = reactive({
        isFetching: false,
        hasFetched: false,
        completionNotified: false,
        friendSignature: 0,
        needsRefetch: false,
        cancelRequested: false
    });

    const friendCount = computed(() => friendStore.friends.size || 0);
    const currentUser = computed(() => userStore.currentUser);
    const isOptOut = computed(() => Boolean(currentUser.value?.hasSharedConnectionsOptOut));

    function showInfoMessage(message, type) {
        const toastFn = toast[type] ?? toast;
        toastFn(message, { duration: 4000 });
    }

    watch(
        () => mutualGraphStatus.isFetching,
        (isFetching) => {
            if (!isFetching) return;
            showInfoMessage(t('view.charts.mutual_friend.notifications.start_fetching'), 'info');
            mutualGraphStatus.completionNotified = false;
        }
    );

    watch(
        () => [mutualGraphStatus.hasFetched, mutualGraphStatus.isFetching],
        ([hasFetched, isFetching]) => {
            if (!hasFetched || isFetching || mutualGraphStatus.completionNotified) return;
            mutualGraphStatus.completionNotified = true;
            toast.success(t('view.charts.mutual_friend.notifications.mutual_friend_graph_ready_title'), {
                description: t('view.charts.mutual_friend.notifications.mutual_friend_graph_ready_message'),
                action: {
                    label: t('common.actions.open'),
                    onClick: () => router.push({ name: 'charts-mutual' })
                }
            });
        }
    );

    watch(friendCount, (count) => {
        if (
            !mutualGraphStatus.hasFetched ||
            mutualGraphStatus.isFetching ||
            !mutualGraphStatus.friendSignature ||
            mutualGraphStatus.needsRefetch
        ) {
            return;
        }
        if (count !== mutualGraphStatus.friendSignature) {
            mutualGraphStatus.needsRefetch = true;
            showInfoMessage(t('view.charts.mutual_friend.notifications.friend_list_changed_fetch_again'), 'warning');
        }
    });

    function resetMutualGraphState() {
        Object.assign(mutualGraphFetchState, createDefaultFetchState());
        mutualGraphStatus.isFetching = false;
        mutualGraphStatus.hasFetched = false;
        mutualGraphStatus.completionNotified = false;
        mutualGraphStatus.friendSignature = 0;
        mutualGraphStatus.needsRefetch = false;
        mutualGraphStatus.cancelRequested = false;
    }

    function markMutualGraphLoaded({ notify = true } = {}) {
        mutualGraphStatus.completionNotified = notify ? false : true;
        mutualGraphStatus.hasFetched = true;
    }

    function requestMutualGraphCancel() {
        if (mutualGraphStatus.isFetching) mutualGraphStatus.cancelRequested = true;
    }

    /**
     * Shared helper: fetch mutual friends for a single userId.
     *
     * @param {string} userId
     * @param {object} [options]
     * @param {{ wait(): Promise<void> }} [options.rateLimiter]
     * @param {() => boolean} [options.isCancelled]
     * @returns {Promise<Array|null>} 完整抓取返回条目数组;
     *   被取消时返回 null (半截数据不落库, 调用方按抓取失败/取消处理)
     */
    async function fetchMutualFriendsForUser(userId, options = {}) {
        const { rateLimiter, isCancelled = () => false } = options;
        const collected = [];
        let cancelled = false;
        let offset = 0;

        while (true) {
            if (isCancelled()) {
                cancelled = true;
                break;
            }
            if (rateLimiter) await rateLimiter.wait();
            if (isCancelled()) {
                cancelled = true;
                break;
            }

            const args = await executeWithBackoff(
                () => {
                    if (isCancelled()) throw new Error('cancelled');
                    return userRequest.getMutualFriends({
                        userId,
                        offset,
                        n: 100
                    });
                },
                {
                    maxRetries: 4,
                    baseDelay: 500,
                    shouldRetry: (err) => err?.status === 429 || (err?.message || '').includes('429')
                }
            ).catch((err) => {
                if ((err?.message || '') === 'cancelled') return null;
                throw err;
            });

            if (!args || isCancelled()) {
                cancelled = true;
                break;
            }

            collected.push(...args.json.filter((entry) => isValidMutualIdentifier(entry?.id)));

            if (args.json.length < 100) break;
            offset += args.json.length;
        }

        return cancelled ? null : collected;
    }

    /**
     * Fetch mutual friends for a single friend, independent of the full graph fetch.
     *
     * @param {string} friendId
     * @returns {Promise<{ success: boolean; mutuals: Array; optedOut: boolean }>}
     */
    async function fetchSingleFriendMutuals(friendId) {
        if (!friendId || isOptOut.value) {
            return { success: false, mutuals: [], optedOut: false };
        }

        // 与另外两条路径互斥: 后台共同好友同步/手动全图抓取进行中时
        // 不并发写边表 (与 fetchMutualGraph / runMutualSyncBatch 一致)
        if (mutualSyncState.isRunning || mutualGraphStatus.isFetching) {
            showInfoMessage(t('view.charts.mutual_friend.status.sync_running'), 'warning');
            return { success: false, mutuals: [], optedOut: false };
        }

        try {
            const mutuals = await fetchMutualFriendsForUser(friendId);

            const mutualIds = mutuals.map((entry) => normalizeIdentifier(entry?.id)).filter(isValidMutualIdentifier);
            await database.updateMutualsForFriend(friendId, mutualIds);
            await database.upsertMutualGraphMeta(friendId, {
                lastFetchedAt: new Date().toISOString(),
                optedOut: false
            });

            return { success: true, mutuals, optedOut: false };
        } catch (err) {
            const status = err?.status;
            if (status === 403 || status === 404) {
                // 失败路径不传 lastFetchedAt (DB 层保留旧值);
                // 记录检测时间供 opt-out 重试窗口使用
                await database.upsertMutualGraphMeta(friendId, {
                    optedOut: true,
                    optOutDetectedAt: new Date().toISOString()
                });
                return { success: false, mutuals: [], optedOut: true };
            }
            console.error('[MutualNetworkGraph] Single fetch error', friendId, err);
            return { success: false, mutuals: [], optedOut: false };
        }
    }

    async function fetchMutualGraph() {
        if (mutualGraphStatus.isFetching || isOptOut.value) return null;

        if (mutualSyncState.isRunning) {
            // 后台共同好友同步进行中, 与全图抓取互斥, 稍后再试
            showInfoMessage(t('view.charts.mutual_friend.status.sync_running'), 'warning');
            return null;
        }

        if (!friendCount.value) {
            showInfoMessage(t('view.charts.mutual_friend.status.no_friends_to_process'), 'info');
            return null;
        }

        const rateLimiter = createRateLimiter({
            limitPerInterval: 5,
            intervalMs: 1000
        });

        const isCancelled = () => mutualGraphStatus.cancelRequested === true;

        mutualGraphStatus.isFetching = true;
        mutualGraphStatus.completionNotified = false;
        mutualGraphStatus.needsRefetch = false;
        mutualGraphStatus.cancelRequested = false;
        mutualGraphStatus.hasFetched = false;
        Object.assign(mutualGraphFetchState, { processedFriends: 0 });

        const friendSnapshot = Array.from(friendStore.friends.values());
        const mutualMap = new Map();
        const metaEntries = new Map();

        let cancelled = false;

        try {
            for (let index = 0; index < friendSnapshot.length; index += 1) {
                const friend = friendSnapshot[index];
                if (!friend?.id) continue;

                if (isCancelled()) {
                    cancelled = true;
                    break;
                }

                try {
                    const mutuals = await fetchMutualFriendsForUser(friend.id, {
                        rateLimiter,
                        isCancelled
                    });
                    if (mutuals === null) {
                        // 被取消导致半截数据: 该好友按抓取失败处理, 不落库
                        if (isCancelled()) {
                            cancelled = true;
                            break;
                        }
                        continue;
                    }
                    if (isCancelled()) {
                        cancelled = true;
                        break;
                    }
                    mutualMap.set(friend.id, { friend, mutuals });
                    // 记录真实抓取完成时刻, 结束时带各自时间写 meta,
                    // 避免 freshness 误判为整个全图抓取的结束时间
                    metaEntries.set(friend.id, {
                        optedOut: false,
                        lastFetchedAt: new Date().toISOString()
                    });
                } catch (err) {
                    if ((err?.message || '') === 'cancelled' || isCancelled()) {
                        cancelled = true;
                        break;
                    }
                    const status = err?.status;
                    if (status === 403 || status === 404) {
                        metaEntries.set(friend.id, { optedOut: true });
                    }
                    console.warn('[MutualNetworkGraph] Skipping friend due to fetch error', friend.id, err);
                    continue;
                }

                mutualGraphFetchState.processedFriends = index + 1;
                if (mutualGraphStatus.cancelRequested) {
                    cancelled = true;
                    break;
                }
            }

            if (cancelled) {
                mutualGraphStatus.hasFetched = false;
                showInfoMessage(t('view.charts.mutual_friend.messages.fetch_cancelled_graph_not_updated'), 'warning');
                return null;
            }

            mutualGraphStatus.friendSignature = friendCount.value;
            mutualGraphStatus.needsRefetch = false;

            // Write meta first so saveMutualGraphSnapshot's DELETE
            // uses up-to-date opted_out flags to decide what to preserve.
            // If this fails, we must NOT proceed with snapshot save because
            // the DELETE would use stale meta and corrupt data.
            if (metaEntries.size > 0) {
                await database.bulkUpsertMutualGraphMeta(metaEntries);
            }

            try {
                const entries = new Map();
                mutualMap.forEach((value, friendId) => {
                    if (!friendId) return;
                    const normalizedFriendId = String(friendId);
                    const collection = Array.isArray(value?.mutuals) ? value.mutuals : [];
                    const ids = [];

                    for (const entry of collection) {
                        const identifier = normalizeIdentifier(entry?.id);
                        if (isValidMutualIdentifier(identifier)) ids.push(identifier);
                    }

                    entries.set(normalizedFriendId, ids);
                });
                await database.saveMutualGraphSnapshot(entries);
            } catch (persistErr) {
                console.error('[MutualNetworkGraph] Failed to cache data', persistErr);
            }

            markMutualGraphLoaded({ notify: true });
            return mutualMap;
        } catch (err) {
            console.error('[MutualNetworkGraph] fetch aborted', err);
            return null;
        } finally {
            mutualGraphStatus.isFetching = false;
            mutualGraphStatus.cancelRequested = false;
        }
    }

    return {
        mutualGraphFetchState,
        mutualGraphStatus,
        resetMutualGraphState,
        markMutualGraphLoaded,
        requestMutualGraphCancel,
        fetchMutualGraph,
        fetchSingleFriendMutuals,
        fetchMutualFriendsForUser
    };
});

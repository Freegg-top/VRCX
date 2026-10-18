import { userRequest } from '../api';
import { createRateLimiter } from '../shared/utils/throttle';
import { useAppearanceSettingsStore } from '../stores/settings/appearance';
import { useFriendStore } from '../stores';
import { useInstanceStore } from '../stores/instance';
import { useUserStore } from '../stores/user';
import { syncFriendNetworkForMutualCounts } from './friendNetworkCoordinator';

const MUTUAL_CACHE_TTL = 15 * 60 * 1000;
const MUTUAL_RATE_PER_SECOND = 5;
// transient failure retry cooldown: short enough that the next player-list
// refresh retries soon, long enough to not hammer a struggling endpoint
const MUTUAL_FAILURE_RETRY_TTL = 30 * 1000;

// userId -> { friends, groups, optedOut, fetchedAt }
const mutualCountsCache = new Map();
const pendingMutualRequests = new Set();
// userId -> timestamp of last transient (non 403/404) failure. No counts are
// cached for these users, so once the TTL expires the next round retries
// naturally. -1 responses land here too: they are either the
// failedGetRequests bail-out after a previous 403/404 (that user is already
// $mutualOptedOut and keeps returning -1 harmlessly), or a network-layer
// blip from request.js, which must be treated as transient.
const recentlyFailed = new Map();
// 模块级共享限速器: 防止并发调用各自持 limiter 叠加超 5/s
const mutualRateLimiter = createRateLimiter({
    limitPerInterval: MUTUAL_RATE_PER_SECOND,
    intervalMs: 1000
});

/**
 * Fetches mutual friend/group counts for players in the current instance
 * and stamps $mutualCount/$mutualGroupCount on their cached user refs.
 * @param {Array<{ref: object}>} users Rows from the instance player list.
 * @returns {Promise<void>}
 */
export async function fetchMutualCountsForPlayers(users) {
    const appearanceSettingsStore = useAppearanceSettingsStore();
    const userStore = useUserStore();
    const friendStore = useFriendStore();
    const instanceStore = useInstanceStore();

    const now = Date.now();
    const userIdsToFetch = [];
    let updated = false;
    for (const user of users) {
        const ref = user.ref;
        if (!ref?.id || ref.id === userStore.currentUser.id) {
            continue;
        }
        // NOTE: $mutualCount defaults to 0 on every user ref, so use the
        // explicit $mutualFetched marker to know if counts were fetched.
        // The marker is TTL'd ($mutualFetchedAt) so counts revalidate after
        // MUTUAL_CACHE_TTL instead of being masked forever; $mutualOptedOut
        // remains permanent for the session (user hides shared connections).
        if (
            ref.$mutualOptedOut ||
            (ref.$mutualFetched &&
                now - (ref.$mutualFetchedAt ?? 0) < MUTUAL_CACHE_TTL)
        ) {
            continue;
        }
        // skip users whose last fetch failed transiently less than
        // MUTUAL_FAILURE_RETRY_TTL ago; they are NOT stamped, so a later
        // round retries them once the cooldown expires
        const failedAt = recentlyFailed.get(ref.id);
        if (
            typeof failedAt !== 'undefined' &&
            now - failedAt < MUTUAL_FAILURE_RETRY_TTL
        ) {
            continue;
        }
        const cached = mutualCountsCache.get(ref.id);
        if (typeof cached !== 'undefined') {
            if (cached.optedOut) {
                ref.$mutualOptedOut = true;
            } else if (now - cached.fetchedAt < MUTUAL_CACHE_TTL) {
                // cache-hit stamping must respect the same badge toggle as
                // the fetch path below; when the toggle is off we leave the
                // ref unstamped (and un-updated) so no badge data leaks
                if (appearanceSettingsStore.showMutualFriendsBadge) {
                    ref.$mutualCount = cached.friends;
                    ref.$mutualGroupCount = cached.groups;
                    ref.$mutualFetched = true;
                    ref.$mutualFetchedAt = Date.now();
                    updated = true;
                }
            } else {
                userIdsToFetch.push(ref.id);
            }
            continue;
        }
        if (!pendingMutualRequests.has(ref.id)) {
            userIdsToFetch.push(ref.id);
        }
    }
    if (userIdsToFetch.length === 0) {
        // cache-hit stamping above still needs a resort even when nothing
        // is left to fetch (the early return would otherwise skip the
        // unconditional refresh in the finally block below)
        if (updated) {
            instanceStore.getCurrentInstanceUserList();
        }
        return;
    }
    userIdsToFetch.forEach((id) => pendingMutualRequests.add(id));

    try {
        for (const userId of userIdsToFetch) {
            await mutualRateLimiter.wait();
            try {
                const { json } = await userRequest.getMutualCounts({ userId });
                mutualCountsCache.set(userId, {
                    friends: json?.friends ?? 0,
                    groups: json?.groups ?? 0,
                    optedOut: false,
                    fetchedAt: Date.now()
                });
                // feed the friend network page: persist the result while we
                // are already here (empty counts are final, positive counts
                // get queued for the friend-list lookup)
                syncFriendNetworkForMutualCounts(
                    userId,
                    json?.friends ?? 0,
                    friendStore.friends.has(userId)
                );
                if (appearanceSettingsStore.showMutualFriendsBadge) {
                    const ref = userStore.cachedUsers.get(userId);
                    if (typeof ref !== 'undefined') {
                        ref.$mutualCount = json?.friends ?? 0;
                        ref.$mutualGroupCount = json?.groups ?? 0;
                        ref.$mutualFetched = true;
                        ref.$mutualFetchedAt = Date.now();
                        updated = true;
                    }
                }
            } catch (err) {
                if (err?.status === 403 || err?.status === 404) {
                    // target user hides their shared connections
                    mutualCountsCache.set(userId, {
                        friends: 0,
                        groups: 0,
                        optedOut: true,
                        fetchedAt: Date.now()
                    });
                    const ref = userStore.cachedUsers.get(userId);
                    if (typeof ref !== 'undefined') {
                        ref.$mutualOptedOut = true;
                    }
                } else {
                    // transient failure (429/5xx/offline): do NOT stamp the
                    // ref, do NOT set $mutualFetched and do NOT write a
                    // zero-count negative cache entry — just remember the
                    // failure briefly so this round does not hammer the API.
                    // err?.status === -1 also lands here on purpose: it is
                    // either the failedGetRequests bail-out after a previous
                    // 403/404 (that user is already $mutualOptedOut and keeps
                    // returning -1 harmlessly), or a network-layer blip from
                    // request.js, which must be treated as transient too.
                    recentlyFailed.set(userId, Date.now());
                    console.warn(
                        '[mutual] counts fetch failed:',
                        userId,
                        err?.status
                    );
                }
            } finally {
                pendingMutualRequests.delete(userId);
            }
        }
    } finally {
        // unconditional: getCurrentInstanceUserList is internally debounced
        // (150ms) so the extra no-op calls are cheap, and async cache-hit
        // stamping must trigger a resort even when no fetch happened
        instanceStore.getCurrentInstanceUserList();
    }
}

/**
 * Clears all mutual-count module state (counts cache, in-flight dedupe set
 * and transient-failure map). Called from the logout flow alongside the
 * other per-session state resets.
 * @returns {void}
 */
export function resetMutualCoordinator() {
    mutualCountsCache.clear();
    pendingMutualRequests.clear();
    recentlyFailed.clear();
}

/**
 * Invalidates cached mutual counts. Without a userId the whole counts cache
 * is dropped; with one only that user's entry is removed. Matching cached
 * user refs get their $mutualFetched/$mutualFetchedAt markers cleared so the
 * next fetchMutualCountsForPlayers round re-fetches them; $mutualOptedOut is
 * left untouched (the opt-out is a property of the target user, not of our
 * cache freshness) and in-flight requests are not disturbed.
 * @param {string} [userId] Optional user to invalidate; omit to clear all.
 * @returns {void}
 */
export function invalidateMutualCounts(userId) {
    const { cachedUsers } = useUserStore();
    const clearRefMarkers = (ref) => {
        if (typeof ref === 'undefined') {
            return;
        }
        ref.$mutualFetched = false;
        ref.$mutualFetchedAt = 0;
    };
    if (typeof userId === 'undefined') {
        mutualCountsCache.clear();
        cachedUsers.forEach(clearRefMarkers);
    } else {
        mutualCountsCache.delete(userId);
        clearRefMarkers(cachedUsers.get(userId));
    }
}

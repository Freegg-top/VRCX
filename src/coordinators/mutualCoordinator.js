import { userRequest } from '../api';
import { createRateLimiter } from '../shared/utils/throttle';
import { useAppearanceSettingsStore } from '../stores/settings/appearance';
import { useFriendStore } from '../stores';
import { useInstanceStore } from '../stores/instance';
import { useUserStore } from '../stores/user';
import { syncFriendNetworkForMutualCounts } from './friendNetworkCoordinator';

const MUTUAL_CACHE_TTL = 15 * 60 * 1000;
const MUTUAL_RATE_PER_SECOND = 5;

// userId -> { friends, groups, optedOut, fetchedAt }
const mutualCountsCache = new Map();
const pendingMutualRequests = new Set();

/**
 * Fetches mutual friend/group counts for players in the current instance
 * and stamps $mutualCount/$mutualGroupCount on their cached user refs.
 * @param {Array<{ref: object}>} users Rows from the instance player list.
 * @returns {Promise<void>}
 */
export async function fetchMutualCountsForPlayers(users) {
    const appearanceSettingsStore = useAppearanceSettingsStore();
    if (!appearanceSettingsStore.showMutualFriendsBadge) {
        return;
    }
    const userStore = useUserStore();
    const friendStore = useFriendStore();

    const now = Date.now();
    const userIdsToFetch = [];
    for (const user of users) {
        const ref = user.ref;
        if (!ref?.id || ref.id === userStore.currentUser.id) {
            continue;
        }
        // NOTE: $mutualCount defaults to 0 on every user ref, so use the
        // explicit $mutualFetched marker to know if counts were fetched
        if (ref.$mutualFetched || ref.$mutualOptedOut) {
            continue;
        }
        const cached = mutualCountsCache.get(ref.id);
        if (typeof cached !== 'undefined') {
            if (cached.optedOut) {
                ref.$mutualOptedOut = true;
            } else if (now - cached.fetchedAt < MUTUAL_CACHE_TTL) {
                ref.$mutualCount = cached.friends;
                ref.$mutualGroupCount = cached.groups;
                ref.$mutualFetched = true;
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
        return;
    }
    console.log(
        '[mutual] fetching counts for',
        userIdsToFetch.length,
        'players'
    );
    userIdsToFetch.forEach((id) => pendingMutualRequests.add(id));

    const rateLimiter = createRateLimiter({
        limitPerInterval: MUTUAL_RATE_PER_SECOND,
        intervalMs: 1000
    });
    let updated = false;
    try {
        for (const userId of userIdsToFetch) {
            await rateLimiter.wait();
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
                const ref = userStore.cachedUsers.get(userId);
                if (typeof ref !== 'undefined') {
                    ref.$mutualCount = json?.friends ?? 0;
                    ref.$mutualGroupCount = json?.groups ?? 0;
                    ref.$mutualFetched = true;
                    updated = true;
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
                    console.error(
                        '[mutual] failed to fetch counts:',
                        userId,
                        err
                    );
                }
            } finally {
                pendingMutualRequests.delete(userId);
            }
        }
    } finally {
        if (updated) {
            useInstanceStore().getCurrentInstanceUserList();
        }
    }
}

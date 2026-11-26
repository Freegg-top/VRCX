import { userRequest } from '../api';
import { executeWithBackoff } from '../shared/utils/retry';
import { createRateLimiter } from '../shared/utils/throttle';
import { database } from '../services/database';
import { watchState } from '../services/watchState';
import { useWatchedStore } from '../stores/watched';
import { useFriendStore } from '../stores/friend';

const REFRESH_RATE_PER_SECOND = 1;
const MAX_RETRY = 3;
const RETRY_BASE_DELAY = 1000;

let refreshInFlight = false;

/**
 * Loads the watched user list from the database into the store.
 *
 * @returns {Promise<void>}
 */
export async function initWatchedUsers() {
    const watchedStore = useWatchedStore();
    const rows = await database.getWatchedUsers();
    watchedStore.watchedUsers.clear();
    rows.forEach((row) => watchedStore.setWatchedUser(row));
}

/**
 * Watches a non-friend user so their avatar/status/bio changes appear in the feed.
 *
 * @param {string} userId
 * @param {string} displayName
 * @returns {Promise<void>}
 */
export async function addWatchedUser(userId, displayName) {
    const watchedStore = useWatchedStore();
    const user = {
        userId,
        displayName,
        created_at: new Date().toJSON()
    };
    try {
        // P2-2: service 已改 async, 这里 await 后 try/catch 才真正捕获得到失败
        await database.addWatchedUser(userId, displayName);
    } catch (err) {
        console.error('Failed to persist watched user:', userId, err);
    }
    watchedStore.setWatchedUser(user);
    // fetch immediately so the next change is diffed against fresh data
    try {
        await userRequest.getUser({ userId });
    } catch (err) {
        console.error('Failed to fetch watched user:', userId, err);
    }
}

/**
 * Stops watching a non-friend user.
 *
 * @param {string} userId
 */
export async function removeWatchedUser(userId) {
    const watchedStore = useWatchedStore();
    try {
        // P2-2: await 异步删除, 失败不再被静默吞掉
        await database.removeWatchedUser(userId);
    } catch (err) {
        console.error('Failed to remove watched user:', userId, err);
    }
    watchedStore.removeWatchedUser(userId);
}

/**
 * Polls every watched user; responses flow through applyUser/applyPublicProfile
 * and generate feed entries (incl. bio via the profile snapshot diff) for
 * watched non-friends.
 *
 * @returns {Promise<void>}
 */
export async function refreshWatchedUsers() {
    if (!watchState.isLoggedIn || refreshInFlight) {
        return;
    }
    const watchedStore = useWatchedStore();
    const friendStore = useFriendStore();
    if (watchedStore.watchedUsers.size === 0) {
        return;
    }
    refreshInFlight = true;
    try {
        const rateLimiter = createRateLimiter({
            limitPerInterval: REFRESH_RATE_PER_SECOND,
            intervalMs: 1000
        });
        const userIds = Array.from(watchedStore.watchedUsers.keys()).filter(
            (userId) => !friendStore.friends.has(userId)
        );
        for (const userId of userIds) {
            await rateLimiter.wait();
            if (!watchState.isLoggedIn) {
                break;
            }
            try {
                await executeWithBackoff(
                    // bio now lives in the public profile payload; the plain
                    // user endpoint no longer reports it
                    () => userRequest.getUser({ userId }).then(() => userRequest.getPublicProfile({ userId })),
                    {
                        maxRetries: MAX_RETRY,
                        baseDelay: RETRY_BASE_DELAY,
                        shouldRetry: (err) => err?.status === 429 || (err?.message || '').includes('429')
                    }
                );
            } catch (err) {
                console.error('Failed to refresh watched user:', userId, err);
            }
        }
    } finally {
        refreshInFlight = false;
    }
}

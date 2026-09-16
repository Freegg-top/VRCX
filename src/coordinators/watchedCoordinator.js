import { userRequest } from '../api';
import { executeWithBackoff } from '../shared/utils/retry';
import { createRateLimiter } from '../shared/utils/throttle';
import { database } from '../services/database';
import { watchState } from '../services/watchState';
import { useWatchedStore } from '../stores/watched';

const REFRESH_RATE_PER_SECOND = 1;
const MAX_RETRY = 3;
const RETRY_BASE_DELAY = 1000;

let refreshInFlight = false;

/**
 * Loads the watched user list from the database into the store.
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
    database.addWatchedUser(userId, displayName);
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
 * @param {string} userId
 */
export function removeWatchedUser(userId) {
    const watchedStore = useWatchedStore();
    database.removeWatchedUser(userId);
    watchedStore.removeWatchedUser(userId);
}

/**
 * Polls every watched user via GET users/{userId}; each response flows
 * through applyUser and generates feed entries for watched non-friends.
 * @returns {Promise<void>}
 */
export async function refreshWatchedUsers() {
    if (!watchState.isLoggedIn || refreshInFlight) {
        return;
    }
    const watchedStore = useWatchedStore();
    if (watchedStore.watchedUsers.size === 0) {
        return;
    }
    refreshInFlight = true;
    try {
        const rateLimiter = createRateLimiter({
            limitPerInterval: REFRESH_RATE_PER_SECOND,
            intervalMs: 1000
        });
        const userIds = Array.from(watchedStore.watchedUsers.keys());
        for (const userId of userIds) {
            await rateLimiter.wait();
            try {
                await executeWithBackoff(
                    () => userRequest.getUser({ userId }),
                    {
                        maxRetries: MAX_RETRY,
                        baseDelay: RETRY_BASE_DELAY,
                        shouldRetry: (err) =>
                            err?.status === 429 ||
                            (err?.message || '').includes('429')
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

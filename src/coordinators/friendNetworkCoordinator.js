import { reactive } from 'vue';

import { parseLocation } from '../shared/utils';
import { useFriendStore } from '../stores/friend';
import { useUserStore } from '../stores/user';
import { userRequest } from '../api';
import { createRateLimiter } from '../shared/utils/throttle';
import { buildRequestInit } from '../services/request';
import webApiService from '../services/webapi';
import { database } from '../services/database';

const PAGE_SIZE = 100;
const MUTUAL_LIST_TTL = 30 * 60 * 1000;
const LOOKUP_DELAY_MS = 1000;
export const STALE_MS = 14 * 24 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Requests a user list endpoint straight through the web API binding,
 * keeping the real status code and body available on errors
 * (request() collapses message-less API errors into opaque throws).
 * @param {string} path API path, e.g. `users/{id}/mutuals/friends`
 * @returns {Promise<{status: number, body: any}>}
 */
async function fetchPage(path) {
    const init = buildRequestInit(path, {
        method: 'GET',
        params: { n: PAGE_SIZE, offset: 0 }
    });
    const { status, data } = await webApiService.execute(init);
    let body = null;
    if (data) {
        try {
            body = JSON.parse(data);
        } catch {
            body = null;
        }
    }
    return { status, body };
}

// userId -> { list: Array, fetchedAt: number }
const mutualFriendsCache = new Map();
// userId -> Promise, dedupes concurrent reverse lookups
const mutualFriendsPending = new Map();

/**
 * Reverse lookup: which of our friends are also friends with the given user.
 * @param {string} userId met user id
 * @returns {Promise<Array>} raw user objects of our friends
 */
async function fetchMutualFriendsForUser(userId) {
    const cached = mutualFriendsCache.get(userId);
    if (cached && Date.now() - cached.fetchedAt < MUTUAL_LIST_TTL) {
        return cached.list;
    }
    let pending = mutualFriendsPending.get(userId);
    if (typeof pending === 'undefined') {
        pending = (async () => {
            const { status, body } = await fetchPage(
                `users/${userId}/mutuals/friends`
            );
            if (status !== 200) {
                if (status === 403 || status === 404) {
                    // target hides their shared connections; remember so we
                    // don't ask again on every load
                    database
                        .saveAnalyzedUser(userId, [], true)
                        .catch(() => {});
                }
                const err = new Error(
                    `mutuals/friends failed with ${status}`
                );
                Object.assign(err, { status });
                throw err;
            }
            const list = Array.isArray(body) ? body : [];
            mutualFriendsCache.set(userId, {
                list,
                fetchedAt: Date.now()
            });
            database
                .saveAnalyzedUser(
                    userId,
                    list.map((u) => u.id),
                    false
                )
                .catch((e) =>
                    console.error('[friend-network] failed to save:', e)
                );
            return list;
        })();
        mutualFriendsPending.set(userId, pending);
        pending.finally(() => mutualFriendsPending.delete(userId));
    }
    return pending;
}

/**
 * Loads previously analyzed reverse-lookup results from the database.
 * @returns {Promise<Map<string, {friendIds: Array, lastFetchedAt: string, optedOut: boolean}>>}
 */
export function getOwnerCandidates() {
    return database.getOwnerCandidates();
}

export function getPersistedAnalysis() {
    return database.getAnalyzedUsers();
}

// analysis engine (module singleton; survives page navigation) ------------

export const metAnalysis = reactive({
    running: false,
    done: 0,
    total: 0,
    // userId -> { state: 'some' | 'none' | 'error', friendIds: Set<string> }
    results: new Map()
});

const analysisQueue = [];

function pushAnalysisTarget(userId) {
    if (metAnalysis.results.has(userId) || mutualFriendsCache.has(userId)) {
        return false;
    }
    if (analysisQueue.includes(userId)) {
        return false;
    }
    analysisQueue.push(userId);
    metAnalysis.total = metAnalysis.done + analysisQueue.length;
    return true;
}

async function runAnalysisLoop() {
    metAnalysis.running = true;
    while (analysisQueue.length) {
        const userId = analysisQueue.shift();
        try {
            const list = await fetchMutualFriendsForUser(userId);
            metAnalysis.results.set(userId, {
                state: list.length ? 'some' : 'none',
                friendIds: new Set(list.map((u) => u.id))
            });
        } catch (err) {
            if (err?.status === 403 || err?.status === 404) {
                // user hides their shared connections; treat as final
                metAnalysis.results.set(userId, {
                    state: 'none',
                    friendIds: new Set()
                });
            } else {
                // transient failure: leave unanalyzed so a later run retries
                console.error(
                    '[friend-network] analysis failed:',
                    userId,
                    err?.status
                );
            }
        }
        metAnalysis.done++;
        await sleep(LOOKUP_DELAY_MS);
    }
    metAnalysis.running = false;
}

/**
 * Enqueues met players for reverse lookup and keeps the background loop
 * running until the whole pool is processed (1 request per second, results
 * saved to the database one by one).
 * @param {Array<string>} userIds met player ids, most recently met first
 */
export async function startMetAnalysis(userIds) {
    await ensurePersistedLoaded();
    for (const userId of userIds) {
        if (persistedFreshIds.has(userId)) {
            continue;
        }
        pushAnalysisTarget(userId);
    }
    if (analysisQueue.length && !metAnalysis.running) {
        runAnalysisLoop();
    }
}

// 实例房主信号: 好友所在 friends/friends+ 实例的房主, 经 mutuals 反查验证后
// 计入好友的好友 (房间成员列表接口不可用, 房主是唯一可稳定获取的新信号)

let ownerRefreshRunning = false;

export async function refreshOwnerCandidates() {
    if (ownerRefreshRunning) {
        return;
    }
    ownerRefreshRunning = true;
    try {
        const friendStore = useFriendStore();
        const userStore = useUserStore();
        const me = userStore.currentUser.id;
        const rateLimiter = createRateLimiter({
            limitPerInterval: 1,
            intervalMs: 1000
        });
        const candidates = new Set();
        for (const ctx of friendStore.friends.values()) {
            const ref = ctx?.ref;
            if (!ref?.location || !ctx.id) {
                continue;
            }
            const L = parseLocation(ref.location);
            if (
                (L.accessType !== 'friends' && L.accessType !== 'friends+') ||
                !L.userId
            ) {
                continue;
            }
            const owner = L.userId;
            if (
                owner === me ||
                owner === ctx.id ||
                friendStore.friends.has(owner)
            ) {
                continue;
            }
            candidates.add(owner);
        }
        for (const owner of candidates) {
            await rateLimiter.wait();
            // 名称解析失败不影响入队分析
            let displayName = '';
            try {
                const ref = userStore.cachedUsers.get(owner);
                if (!ref) {
                    const { json } = await userRequest.getUser({ userId: owner });
                    displayName = json?.displayName || '';
                } else {
                    displayName = ref.displayName || '';
                }
            } catch (err) {
                console.error(
                    '[friend-network] owner fetch failed:',
                    owner,
                    err?.status
                );
            }
            await database.saveOwnerCandidate(owner, displayName);
            // 反查验证: 至少有一位好友认识该房主才算好友的好友 (结果为空即淘汰)
            await queueFriendNetworkLookup(owner);
        }
    } finally {
        ownerRefreshRunning = false;
    }
}

// persisted fresh-id cache for the live sync path ------------------------

let persistedFreshIds = new Set();
let persistedLoadPromise = null;

async function ensurePersistedLoaded() {
    if (!persistedLoadPromise) {
        persistedLoadPromise = database
            .getAnalyzedUsers()
            .then((persisted) => {
                const now = Date.now();
                const fresh = new Set();
                persisted.forEach((entry, userId) => {
                    const age = now - Date.parse(entry.lastFetchedAt || '');
                    if (Number.isFinite(age) && age < STALE_MS) {
                        fresh.add(userId);
                    }
                });
                persistedFreshIds = fresh;
            })
            .catch((e) =>
                console.error(
                    '[friend-network] failed to load persisted analysis:',
                    e
                )
            );
    }
    await persistedLoadPromise;
}

/**
 * Enqueues a reverse lookup for a met player, persisted on completion.
 * Used by the live sync path (mutual badge counts) so the friend network
 * keeps growing while the game is running.
 * @param {string} userId met player id
 */
export async function queueFriendNetworkLookup(userId) {
    if (!userId) {
        return;
    }
    await ensurePersistedLoaded();
    if (persistedFreshIds.has(userId)) {
        return;
    }
    if (pushAnalysisTarget(userId) && !metAnalysis.running) {
        runAnalysisLoop();
    }
}

/**
 * Persists the friend-network data for a player based on the mutual badge
 * counts that are fetched for instance players anyway: zero mutual friends
 * is a final answer stored right away, positive counts need the friend list.
 * @param {string} userId player id
 * @param {number} friendsCount mutual friend count vs the current user
 * @param {boolean} isFriend whether the player is already our friend
 */
export function syncFriendNetworkForMutualCounts(
    userId,
    friendsCount,
    isFriend
) {
    if (!userId || isFriend) {
        return;
    }
    if (friendsCount > 0) {
        queueFriendNetworkLookup(userId);
    } else {
        database.saveAnalyzedUser(userId, [], false).catch(() => {});
    }
}

/**
 * Aggregates every player we have ever been in an instance with (per the
 * game log), excluding ourselves. Friends should be filtered out by the
 * caller.
 * @returns {Promise<Array<{userId: string, displayName: string, joinCount: number, lastSeen: string}>>}
 */
export async function getMetUsers() {
    const rows = await database.getMetUsers();
    // the log groups by (user_id, display_name); merge renames by userId
    const byUserId = new Map();
    for (const row of rows) {
        const existing = byUserId.get(row.userId);
        if (typeof existing === 'undefined') {
            byUserId.set(row.userId, { ...row });
        } else {
            existing.joinCount += row.joinCount;
            if (row.lastSeen > existing.lastSeen) {
                existing.lastSeen = row.lastSeen;
                existing.displayName = row.displayName;
            }
        }
    }
    return [...byUserId.values()];
}

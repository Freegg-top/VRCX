import { getUserConnections } from '@/services/dlcxApi';
import { useUserStore } from '@/stores';

const CLOUD_CONNECTIONS_LIMIT = 200;
const CLOUD_CONNECTIONS_TTL_MS = 10 * 60 * 1000;
const CACHED_ERROR_KINDS = new Set(['notConfigured', 'unauthorized', 'forbidden']);

/**
 * @typedef {{
 *     count: number;
 *     lastSeen: string;
 *     displayName: string;
 *     avatarUrl: string;
 * }} CloudConnection
 */

/**
 * @type {{
 *     userId: string;
 *     connections: Map<string, CloudConnection> | null;
 *     fetchedAt: number;
 * } | null}
 */
let cache = null;
/** @type {Map<string, Promise<Map<string, CloudConnection> | null>>} */
const pendingByUserId = new Map();
let cacheGeneration = 0;

/**
 * Converts the DLCX response into the user-id keyed shape shared by views.
 *
 * @param {{ results?: object[] } | null | undefined} payload
 * @returns {Map<string, CloudConnection>}
 */
export function buildCloudConnectionMap(payload) {
    /** @type {Map<string, CloudConnection>} */
    const connections = new Map();
    for (const row of payload?.results || []) {
        const userId = String(row?.other_id || '');
        if (!userId) {
            continue;
        }
        const count = Number(row.co_seen_count);
        connections.set(userId, {
            count: Number.isFinite(count) ? Math.max(0, count) : 0,
            lastSeen: String(row.last_seen || ''),
            displayName: String(row.display_name || userId),
            avatarUrl: String(row.avatar_url || '')
        });
    }
    return connections;
}

/**
 * @param {string} userId
 * @param {number} generation
 * @returns {Promise<Map<string, CloudConnection> | null>}
 */
async function fetchMyCloudConnections(userId, generation) {
    try {
        const payload = await getUserConnections(userId, CLOUD_CONNECTIONS_LIMIT);
        const connections = buildCloudConnectionMap(payload);
        if (generation === cacheGeneration && useUserStore().currentUser.id === userId) {
            cache = { userId, connections, fetchedAt: Date.now() };
        }
        return connections;
    } catch (error) {
        if (
            CACHED_ERROR_KINDS.has(error?.kind) &&
            generation === cacheGeneration &&
            useUserStore().currentUser.id === userId
        ) {
            // Configuration/authorization failures are stable for the TTL;
            // transient network/server failures deliberately remain retryable.
            cache = { userId, connections: null, fetchedAt: Date.now() };
        }
        return null;
    }
}

/**
 * Loads the current user's cloud co-seen connections. Null means the cloud
 * dimension is unavailable and callers should retain their local-only UI.
 *
 * @returns {Promise<Map<string, CloudConnection> | null>}
 */
export function getMyCloudConnections() {
    const userId = String(useUserStore().currentUser.id || '');
    if (!userId) {
        return Promise.resolve(null);
    }
    if (cache?.userId === userId && Date.now() - cache.fetchedAt < CLOUD_CONNECTIONS_TTL_MS) {
        return Promise.resolve(cache.connections);
    }
    const pending = pendingByUserId.get(userId);
    if (pending) {
        return pending;
    }
    const request = fetchMyCloudConnections(userId, cacheGeneration);
    pendingByUserId.set(userId, request);
    request.finally(() => {
        if (pendingByUserId.get(userId) === request) {
            pendingByUserId.delete(userId);
        }
    });
    return request;
}

/**
 * Drops cached and in-flight results so an explicit refresh performs a new
 * request. A superseded request may still resolve to its original caller, but
 * can no longer populate the shared cache.
 */
export function invalidateMyCloudConnections() {
    cacheGeneration++;
    cache = null;
    pendingByUserId.clear();
}

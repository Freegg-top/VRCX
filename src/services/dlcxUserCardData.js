import { getUserHistory } from './dlcxApi';

const CLOUD_OBSERVATION_TTL_MS = 5 * 60 * 1000;
const CLOUD_OBSERVATION_CACHE_LIMIT = 50;
const AVAILABLE_LICENSE_STATUSES = new Set(['ok', 'unknown', 'checking']);

/** @type {Map<string, { summary: CloudObservationSummary | null; fetchedAt: number }>} */
const observationCache = new Map();
/** @type {Map<string, Promise<CloudObservationSummary | null>>} */
const pendingObservations = new Map();

/**
 * @typedef {{ firstSeen: string; lastSeen: string; lastLocation?: string; lastWorldId?: string }} CloudObservationSummary
 */

/**
 * Unknown/checking licenses are allowed to attempt a request. Empty keys and
 * known unusable/offline states keep every cloud-only UI element hidden.
 *
 * @param {{ licenseKey?: string; licenseStatus?: string }} settings
 * @returns {boolean}
 */
export function isDLCXLicenseAvailable(settings) {
    return (
        Boolean(String(settings?.licenseKey || '').trim()) && AVAILABLE_LICENSE_STATUSES.has(settings?.licenseStatus)
    );
}

/**
 * The historical snapshot has no staleness policy. Cloud is therefore the
 * third and final fallback, used only when both earlier sources are empty.
 *
 * @param {{
 *     officialSucceeded: boolean;
 *     historicalCount: number;
 *     licenseKey?: string;
 *     licenseStatus?: string;
 * }} options
 * @returns {boolean}
 */
export function shouldLoadCloudMutualFallback(options) {
    return !options.officialSucceeded && options.historicalCount === 0 && isDLCXLicenseAvailable(options);
}

/**
 * API contract: user.first_seen/last_seen are full-table aggregates and are
 * independent of the history limit. History timestamps are only fallbacks.
 *
 * @param {{ user?: object | null; history?: object[] } | null | undefined} payload
 * @returns {CloudObservationSummary | null}
 */
export function buildCloudObservationSummary(payload) {
    const history = (payload?.history || [])
        .filter((entry) => Number.isFinite(Date.parse(String(entry?.at || ''))))
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const historyTimes = history.map((entry) => String(entry.at));
    const latestHistory = history[history.length - 1];
    const firstSeen = String(payload?.user?.first_seen || historyTimes[0] || '');
    const lastSeen = String(payload?.user?.last_seen || historyTimes[historyTimes.length - 1] || '');
    if (!firstSeen && !lastSeen) {
        return null;
    }
    const lastLocation = String(latestHistory?.location || '');
    const lastWorldId = String(latestHistory?.world_id || '');
    return {
        firstSeen,
        lastSeen,
        ...(lastLocation ? { lastLocation } : {}),
        ...(lastWorldId ? { lastWorldId } : {})
    };
}

/**
 * @param {{ isFriend?: boolean; ref?: { id?: string } }} player
 * @param {Map<string, { count?: number; lastSeen?: string }> | null | undefined} connections
 * @returns {{ count: number; lastSeen: string } | null}
 */
export function getCloudConnectionBadge(player, connections) {
    if (!connections || player?.isFriend) {
        return null;
    }
    const userId = String(player?.ref?.id || '');
    const connection = userId ? connections.get(userId) : null;
    if (!connection?.lastSeen) {
        return null;
    }
    const count = Number(connection.count);
    return {
        count: Number.isFinite(count) ? Math.max(0, count) : 0,
        lastSeen: String(connection.lastSeen)
    };
}

/**
 * Stamps cloud co-seen metadata on in-memory player refs. Passing null clears
 * old stamps so an unavailable cloud response cannot leave phantom badges.
 *
 * @param {{ isFriend?: boolean; ref?: object }[]} players
 * @param {Map<string, { count?: number; lastSeen?: string }> | null} connections
 * @returns {boolean} Whether any rendered row changed
 */
export function stampCloudConnectionsOnPlayers(players, connections) {
    let changed = false;
    for (const player of players) {
        const ref = player?.ref;
        if (!ref) {
            continue;
        }
        const badge = getCloudConnectionBadge(player, connections);
        const lastSeen = badge?.lastSeen || '';
        const count = badge?.count || 0;
        if (ref.$cloudLastSeen !== lastSeen || ref.$cloudCoSeenCount !== count) {
            ref.$cloudLastSeen = lastSeen;
            ref.$cloudCoSeenCount = count;
            changed = true;
        }
    }
    return changed;
}

/**
 * @param {string} userId
 * @param {CloudObservationSummary | null} summary
 */
function cacheObservation(userId, summary) {
    observationCache.delete(userId);
    observationCache.set(userId, { summary, fetchedAt: Date.now() });
    while (observationCache.size > CLOUD_OBSERVATION_CACHE_LIMIT) {
        const oldestKey = observationCache.keys().next().value;
        observationCache.delete(oldestKey);
    }
}

/**
 * Fetches one history entry and converts it to the compact user-card summary.
 * Successful empty responses are cached too; request failures are silent and
 * remain retryable on the next tab activation.
 *
 * @param {string} userId
 * @returns {Promise<CloudObservationSummary | null>}
 */
export function getCloudObservationSummary(userId) {
    const id = String(userId || '');
    if (!id) {
        return Promise.resolve(null);
    }
    const cached = observationCache.get(id);
    if (cached && Date.now() - cached.fetchedAt < CLOUD_OBSERVATION_TTL_MS) {
        observationCache.delete(id);
        observationCache.set(id, cached);
        return Promise.resolve(cached.summary);
    }
    observationCache.delete(id);
    const pending = pendingObservations.get(id);
    if (pending) {
        return pending;
    }
    const request = getUserHistory(id, 1)
        .then((payload) => {
            const summary = buildCloudObservationSummary(payload);
            cacheObservation(id, summary);
            return summary;
        })
        .catch(() => null);
    pendingObservations.set(id, request);
    request.finally(() => {
        if (pendingObservations.get(id) === request) {
            pendingObservations.delete(id);
        }
    });
    return request;
}

/** Clears module state between explicit test scenarios. */
export function clearCloudObservationCache() {
    observationCache.clear();
    pendingObservations.clear();
}

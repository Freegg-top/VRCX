import { groupRequest } from '../api';
import { createRateLimiter } from '../shared/utils/throttle';
import { database } from '../services/database';
import { useFriendStore } from '../stores/friend';
import { useWatchedStore } from '../stores/watched';
import { useFeedStore } from '../stores/feed';

let pollRunning = false;

/**
 * Polls the groups of friends + watched users, diffs them against the
 * stored snapshot and emits GroupChange feed entries for joins/leaves.
 * The first pass only records a snapshot; the paced loop (1 user/s) keeps
 * going until everyone is covered, then the update loop schedules the
 * next cycle.
 */
/**
 * Normalizes the users/{id}/groups membership objects into {id, name}.
 * (真正的群组 id 在 groupId 字段, id 是 gmem_ 成员关系 id)
 * @param {Array} groups raw API array
 * @returns {Array<{id: string, name: string}>}
 */
export function normalizeGroups(groups) {
    return (Array.isArray(groups) ? groups : [])
        .map((group) => ({
            id: group.groupId || group.id,
            name: group.name
        }))
        .filter((group) => group.id);
}

/**
 * Fetches a user's groups as {id, name} entries.
 * @param {string} userId
 * @returns {Promise<Array<{id: string, name: string}>>}
 */
export async function fetchGroupsForUser(userId) {
    const { json } = await groupRequest.getGroups({ userId });
    return normalizeGroups(json);
}

export async function runGroupChangePoll() {
    if (pollRunning) {
        return;
    }
    pollRunning = true;
    try {
        const friendStore = useFriendStore();
        const watchedStore = useWatchedStore();
        const feedStore = useFeedStore();

        const targets = new Map();
        for (const ctx of friendStore.friends.values()) {
            if (ctx?.id) {
                targets.set(ctx.id, ctx.ref?.displayName || '');
            }
        }
        for (const ctx of watchedStore.watchedUsers.values()) {
            if (ctx?.userId && !targets.has(ctx.userId)) {
                targets.set(ctx.userId, ctx.displayName || '');
            }
        }
        if (targets.size === 0) {
            return;
        }

        const snapshots = await database.getFriendGroupSnapshots();
        const rateLimiter = createRateLimiter({
            limitPerInterval: 1,
            intervalMs: 1000
        });

        for (const [userId, displayName] of targets) {
            await rateLimiter.wait();
            let groups;
            try {
                const { json } = await groupRequest.getGroups({ userId });
                if (!Array.isArray(json)) {
                    continue;
                }
                groups = json;
            } catch (err) {
                // user hides their groups or a transient error: keep the
                // previous snapshot untouched
                continue;
            }
            const current = normalizeGroups(groups).sort((a, b) => (a.id < b.id ? -1 : 1));
            const previous = snapshots.get(userId);
            // 空响应保护: 合法空数组(临时隐藏/服务端部分失败)不应触发全员退群误报
            if (!current.length && previous && previous.groups.length) {
                continue;
            }
            await database.saveFriendGroupSnapshot(userId, current);
            if (!previous) {
                // first sighting: record only, no entries
                continue;
            }
            const previousIds = new Set(previous.groups.map((g) => g.id));
            const currentIds = new Set(current.map((group) => group.id));
            const createdAt = new Date().toJSON();
            for (const group of current) {
                if (!previousIds.has(group.id)) {
                    emitGroupChange(
                        feedStore,
                        createdAt,
                        userId,
                        displayName,
                        group,
                        'joined'
                    );
                }
            }
            for (const group of previous.groups) {
                if (!currentIds.has(group.id)) {
                    emitGroupChange(
                        feedStore,
                        createdAt,
                        userId,
                        displayName,
                        group,
                        'left'
                    );
                }
            }
        }
    } finally {
        pollRunning = false;
    }
}

/**
 * @param {object} feedStore
 * @param {string} createdAt
 * @param {string} userId
 * @param {string} displayName
 * @param {{id: string, name: string}} group
 * @param {'joined' | 'left'} change
 */
function emitGroupChange(feedStore, createdAt, userId, displayName, group, change) {
    const feed = {
        created_at: createdAt,
        type: 'GroupChange',
        userId,
        displayName,
        groupId: group.id,
        groupName: group.name,
        location: change
    };
    database.addGroupChangeToDatabase(feed);
    feedStore.addFeedEntry(feed);
}

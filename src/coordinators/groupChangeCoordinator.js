import { createRateLimiter } from '../shared/utils/throttle';
import { database } from '../services/database';
import { useFriendStore } from '../stores/friend';
import { useWatchedStore } from '../stores/watched';
import { useFeedStore } from '../stores/feed';
import { watchState } from '../services/watchState';
import { buildRequestInit } from '../services/request';
import webApiService from '../services/webapi';

// users/{id}/groups 403/404 常见 (隐藏群组/已删号), request() 层会 toast 且
// 写入 15 分钟 bail 名单——这里改走 webApi 直连, 错误交由调用方静默处理
async function fetchGroupsRaw(userId) {
    const init = buildRequestInit(`users/${userId}/groups`, {
        method: 'GET'
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
    if (status !== 200) {
        const err = new Error(`users/${userId}/groups failed with ${status}`);
        err.status = status;
        throw err;
    }
    return Array.isArray(body) ? body : [];
}

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
    const json = await fetchGroupsRaw(userId);
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
            if (!watchState.isLoggedIn) {
                // 登出: 中止本轮, 避免继续打 API
                break;
            }
            try {
                const groups = await fetchGroupsRaw(userId);
                const current = normalizeGroups(groups).sort(
                    (a, b) => (a.id < b.id ? -1 : 1)
                );
                const previous = snapshots.get(userId);
                // 空响应保护: 合法空数组(临时隐藏/服务端部分失败)不应触发全员退群误报
                if (!current.length && previous && previous.groups.length) {
                    continue;
                }
                if (!previous) {
                    // first sighting: 先记录快照, 不发动态
                    await database.saveFriendGroupSnapshot(userId, current);
                    continue;
                }
                const previousIds = new Set(previous.groups.map((g) => g.id));
                const currentIds = new Set(current.map((group) => group.id));
                const createdAt = new Date().toJSON();
                // 先写动态落库, 再更新快照 (防崩溃窗口丢报)
                for (const group of current) {
                    if (!previousIds.has(group.id)) {
                        await emitGroupChange(
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
                        await emitGroupChange(
                            feedStore,
                            createdAt,
                            userId,
                            displayName,
                            group,
                            'left'
                        );
                    }
                }
                await database.saveFriendGroupSnapshot(userId, current);
            } catch (err) {
                // 单个用户失败(隐藏群组/瞬态错误/DB 忙): 保留旧快照, 不中断整轮
                console.error(
                    '[group-change] poll target failed:',
                    userId,
                    err?.status || err?.message
                );
            }
        }
    } catch (err) {
        console.error('[group-change] poll failed:', err);
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
let groupChangeSeq = 0;

async function emitGroupChange(
    feedStore,
    createdAt,
    userId,
    displayName,
    group,
    change
) {
    // 防重复护栏: 24 小时内同一(用户, 群组, 变更)只发一次。
    // 若快照保存异常导致轮询反复发现同一变更, 此检查阻止重复刷屏
    try {
        const recent = await database.hasRecentGroupChange(
            userId,
            group.id,
            change
        );
        if (recent) {
            return;
        }
    } catch {
        // 检查失败不阻塞正常发射
    }
    const feed = {
        uid: `gc-${Date.now()}-${groupChangeSeq++}`,
        created_at: createdAt,
        type: 'GroupChange',
        userId,
        displayName,
        groupId: group.id,
        groupName: group.name,
        location: change
    };
    await database
        .addGroupChangeToDatabase(feed)
        .catch((e) => console.error('[group-change] failed to save:', e));
    feedStore.addFeedEntry(feed);
}

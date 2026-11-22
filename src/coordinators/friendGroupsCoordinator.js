import { reactive } from 'vue';

import { useFriendStore } from '../stores/friend';
import { useUserStore } from '../stores/user';
import { groupRequest, userRequest } from '../api';
import { database } from '../services/database';
import { createRateLimiter } from '../shared/utils/throttle';
import {
    fetchGroupsForUser,
    runGroupChangePoll
} from './groupChangeCoordinator';
import { isGroupApiCoolingDown, markGroupApi429, markGroupApiSuccess } from './groupApiBreaker';
import {
    getPersistedAnalysis,
    metAnalysis,
    STALE_MS
} from './friendNetworkCoordinator';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 模块级单例: 页面往返不丢数据, fof 取数进度跨访问保留
// (好友的好友群组拉取为 1人/秒, 全量重跑非常昂贵, 不随组件销毁重置)
export const friendGroups = reactive({
    // groupId -> { id, name, friends: [{userId, displayName}], fof: [{userId, displayName}] }
    groupsById: new Map(),
    // groupId -> 群组总成员数 (后台逐个拉取, 跨页面保留)
    memberCounts: new Map(),
    fofFetchRunning: false,
    fofFetchCancelled: false,
    fofFetchDone: 0,
    fofFetchTotal: 0
});

const memberCountRateLimiter = createRateLimiter({
    limitPerInterval: 1,
    intervalMs: 1000
});
const memberCountQueued = new Set();

function isGroupApi429(err) {
    return err?.status === 429 || (err?.message || '').includes('429');
}

/**
 * 后台补齐群组总人数 (1群/秒), 已有/已排队的跳过。
 * @param {Array<{id: string}>} groups
 */
export function ensureMemberCounts(groups) {
    for (const group of groups) {
        if (friendGroups.memberCounts.has(group.id) || memberCountQueued.has(group.id) || isGroupApiCoolingDown()) {
            continue;
        }
        memberCountQueued.add(group.id);
        (async () => {
            await memberCountRateLimiter.wait();
            try {
                if (isGroupApiCoolingDown()) {
                    memberCountQueued.delete(group.id);
                    return;
                }
                const { json } = await groupRequest.getGroup({
                    groupId: group.id
                });
                if (json?.memberCount) {
                    friendGroups.memberCounts.set(group.id, json.memberCount);
                }
                markGroupApiSuccess();
            } catch (err) {
                // 隐藏群组等取不到人数, 静默跳过; 429 时暂停全部群组后台任务
                if (isGroupApi429(err)) {
                    markGroupApi429();
                }
            } finally {
                memberCountQueued.delete(group.id);
            }
        })();
    }
}

function ensureGroup(group) {
    let entry = friendGroups.groupsById.get(group.id);
    if (!entry) {
        entry = {
            id: group.id,
            name: group.name || group.id,
            friends: [],
            fof: []
        };
        friendGroups.groupsById.set(group.id, entry);
    }
    if (!entry.name && group.name) {
        entry.name = group.name;
    }
    return entry;
}

/**
 * 从群组快照重建好友群组的 friends 部分 (保留已取得的 fof 数据)。
 * @returns {Promise<void>}
 */
export async function loadFriendGroups() {
    const friendStore = useFriendStore();
    const friendNames = new Map();
    for (const ctx of friendStore.friends.values()) {
        if (ctx?.id) {
            friendNames.set(ctx.id, ctx.ref?.displayName || ctx.id);
        }
    }
    const snapshots = await database.getFriendGroupSnapshots();
    // 旧 friends 列表按最新快照重建, fof 列表保留
    for (const entry of friendGroups.groupsById.values()) {
        entry.friends = [];
    }
    for (const [userId, snapshot] of snapshots) {
        const displayName = friendNames.get(userId);
        if (!displayName) {
            continue;
        }
        for (const group of snapshot.groups) {
            const entry = ensureGroup(group);
            if (entry.friends.some((p) => p.userId === userId)) {
                continue;
            }
            entry.friends.push({ userId, displayName });
        }
    }
    // 好友的好友的群组: 从数据库持久化恢复 (已是好友的用户跳过)
    let fofSnapshots;
    try {
        fofSnapshots = await database.getFofGroupSnapshots();
    } catch (err) {
        console.error('[friend-groups] fof snapshot load failed:', err);
        return;
    }
    for (const [userId, fofSnapshot] of fofSnapshots) {
        if (friendNames.has(userId)) {
            continue;
        }
        // 已持久化的 fof 用户记入"已拉取"集合, 重启后不重取
        fofFetchedIds.add(userId);
        const displayName = fofSnapshot.displayName || userId;
        for (const group of fofSnapshot.groups) {
            const entry = ensureGroup(group);
            if (
                entry.friends.some((p) => p.userId === userId) ||
                entry.fof.some((p) => p.userId === userId)
            ) {
                continue;
            }
            entry.fof.push({ userId, displayName });
        }
    }
}

// 好友的好友 = 分析结果中非 optedOut 且存在好友关联的用户
function fofUserIds() {
    const ids = [];
    for (const [userId, entry] of metAnalysis.results) {
        if (entry?.state === 'some' && entry.friendIds.size > 0) {
            ids.push(userId);
        }
    }
    return ids;
}

// 已成功拉取过群组的 fof 用户 (启动时从数据库持久化恢复, 重启不重取)
const fofFetchedIds = new Set();

// 把持久化的分析结果灌入 metAnalysis.results (独立打开本页时结果为空)
async function seedAnalysis() {
    try {
        const persisted = await getPersistedAnalysis();
        const now = Date.now();
        for (const [userId, entry] of persisted) {
            if (metAnalysis.results.has(userId)) {
                continue;
            }
            const age = now - Date.parse(entry.lastFetchedAt || '');
            if (Number.isFinite(age) && age < STALE_MS) {
                metAnalysis.results.set(
                    userId,
                    entry.optedOut || !entry.friendIds.length
                        ? { state: 'none', friendIds: new Set() }
                        : {
                              state: 'some',
                              friendIds: new Set(entry.friendIds)
                          }
                );
            }
        }
    } catch (err) {
        console.error('[friend-groups] seed failed:', err);
    }
}

/**
 * 开启"好友的好友"群组取数: 先灌入持久化分析结果, 再续传未完成的拉取
 * (从 fofFetchDone 处继续, 1人/秒)。
 * @returns {Promise<void>}
 */
export async function enableFofGroups() {
    await seedAnalysis();
    if (friendGroups.fofFetchRunning) {
        return;
    }
    await fetchFofGroups();
}

async function fetchFofGroups() {
    if (friendGroups.fofFetchRunning) {
        return;
    }
    friendGroups.fofFetchRunning = true;
    friendGroups.fofFetchCancelled = false;
    try {
        const targets = fofUserIds();
        // 已持久化过的用户跳过 (重启后不重取), 只拉新增的
        const pending = targets.filter((id) => !fofFetchedIds.has(id));
        friendGroups.fofFetchTotal = targets.length;
        friendGroups.fofFetchDone = targets.length - pending.length;
        const userStore = useUserStore();
        for (const userId of pending) {
            if (friendGroups.fofFetchCancelled) {
                break;
            }
            // 429 熔断期间保持当前进度, 冷却结束后继续同一用户
            while (isGroupApiCoolingDown() && !friendGroups.fofFetchCancelled) {
                await sleep(1000);
            }
            if (friendGroups.fofFetchCancelled) {
                break;
            }
            try {
                // 群组列表 + 缺失的玩家名字, 每人间隔 1 秒避免触发限流
                const groups = await fetchGroupsForUser(userId);
                markGroupApiSuccess();
                let displayName =
                    userStore.cachedUsers.get(userId)?.displayName || '';
                if (!displayName) {
                    try {
                        const { json } = await userRequest.getUser({
                            userId
                        });
                        displayName = json?.displayName || userId;
                    } catch {
                        displayName = userId;
                    }
                }
                for (const group of groups) {
                    const entry = ensureGroup(group);
                    if (
                        entry.friends.some((p) => p.userId === userId) ||
                        entry.fof.some((p) => p.userId === userId)
                    ) {
                        continue;
                    }
                    entry.fof.push({ userId, displayName });
                }
                // 每拉完一个用户即落库, 跨应用重启保留, 无需重取
                fofFetchedIds.add(userId);
                friendGroups.fofFetchDone++;
                database
                    .saveFofGroupSnapshot(userId, displayName, groups)
                    .catch((e) =>
                        console.error('[friend-groups] fof save failed:', e)
                    );
            } catch (err) {
                if (isGroupApi429(err)) {
                    markGroupApi429();
                }
                console.error(
                    '[friend-groups] fof groups fetch failed:',
                    userId,
                    err?.status
                );
            }
            await sleep(1000);
        }
    } finally {
        friendGroups.fofFetchRunning = false;
    }
}

/**
 * 估算好友的好友数量 (先灌入持久化分析结果, 供刷新确认弹窗给出耗时预估)
 * @returns {Promise<number>}
 */
export async function getFofEstimate() {
    await seedAnalysis();
    return fofUserIds().length;
}

/**
 * 刷新: 取消进行中的 fof 取数 → 清空缓存 → 重新加载快照 + 强制重拉 fof,
 * 并在后台触发一轮好友群组快照轮询 (完成后自动重载好友部分)。
 * @returns {Promise<void>}
 */
export async function refreshFriendGroups() {
    if (friendGroups.fofFetchRunning) {
        friendGroups.fofFetchCancelled = true;
        // 等当前循环退出 (每用户间隔 1s, 最多等 ~3s)
        for (let i = 0; i < 10 && friendGroups.fofFetchRunning; i++) {
            await sleep(300);
        }
    }
    friendGroups.groupsById.clear();
    // 刷新 = 强制全量重拉 fof (清空"已拉取"集合)
    fofFetchedIds.clear();
    friendGroups.fofFetchDone = 0;
    friendGroups.fofFetchTotal = 0;
    // 后台重新拉取好友群组快照 (1人/秒), 完成后自动重载好友部分
    runGroupChangePoll()
        .then(() => loadFriendGroups())
        .catch((e) => console.error('[friend-groups] refresh poll failed:', e));
    await loadFriendGroups();
    await enableFofGroups();
}

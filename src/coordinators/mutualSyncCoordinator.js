// 共同好友变化检测协调器
//
// 周期性(默认 30 分钟, 见 mutualSyncIntervalMinutes 设置)按 last_fetched_at
// 最旧优先取一批我的好友, 重抓其 mutual 列表, 与 DB 中的旧边做 diff:
// - 双方数据确认的解除好友 -> FriendshipEnd
// - 新建立的好友关系 -> FriendshipStart
// - 抓取 403/404 (对方关闭共同好友展示) -> MutualOptOut
// 事件入库 (_mutual_event_history) 并推 sharedFeed 动态。
//
// diff 规则本体在 src/shared/utils/mutualEvents.js (纯函数, 便于测试),
// 批次选择规则在 src/shared/utils/mutualSyncBatch.js (纯函数)。
//
// 互斥: 与 charts store 的手动全图抓取互斥 (共享 mutualSyncState),
// 防止双方并发写边表互相覆盖。

import { database, dbVars } from '../services/database';
import { computeMutualEvents } from '../shared/utils/mutualEvents';
import { selectMutualSyncBatch } from '../shared/utils/mutualSyncBatch';
import { createRateLimiter } from '../shared/utils/throttle';
import { useChartsStore } from '../stores/charts';
import { useFriendStore } from '../stores/friend';
import { useSharedFeedStore } from '../stores/sharedFeed';
import { useUserStore } from '../stores/user';
import { watchState } from '../services/watchState';
import { mutualSyncState } from '../services/mutualSyncState';

import configRepository from '../services/config';
import { DEFAULT_MUTUAL_SYNC_INTERVAL_MINUTES } from '../shared/constants/settings';

const BATCH_SIZE = 8;
const EMPTY_USER_ID = 'usr_00000000-0000-0000-000000000000';
const EVENT_RETENTION_DAYS = 180;
const EVENT_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// DB 事件类型 -> 动态流 type (UI 层后续识别)
const FEED_TYPE_MAP = {
    FriendshipEnd: 'MutualFriendshipEnd',
    FriendshipStart: 'MutualFriendshipStart',
    MutualOptOut: 'MutualOptOut'
};

// 事件表保留清理: 每天最多一次 (模块级时间戳)
let lastEventCleanupAt = 0;

/**
 * 后台共同好友同步是否进行中 (供 charts 手动全图抓取互斥检查)
 * @returns {boolean}
 */
export function isMutualSyncRunning() {
    return mutualSyncState.isRunning;
}

/**
 * 当前同步间隔(分钟), 0 = 关闭
 * @returns {Promise<number>}
 */
export async function getMutualSyncIntervalMinutes() {
    return configRepository.getInt(
        'mutualSyncIntervalMinutes',
        DEFAULT_MUTUAL_SYNC_INTERVAL_MINUTES
    );
}

/**
 * 事件入库 + 推动态 (当日同键去重, 不做 noty)
 * @param {string} eventType
 * @param {string} friendIdA
 * @param {string} friendIdB
 */
async function recordMutualEvent(eventType, friendIdA, friendIdB) {
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    if (await database.hasMutualEvent({ eventType, friendIdA, friendIdB, sinceDate: startOfDay })) {
        return;
    }
    const createdAt = new Date().toISOString();
    await database.addMutualEvent({ eventType, friendIdA, friendIdB, createdAt });
    const sharedFeedStore = useSharedFeedStore();
    const userStore = useUserStore();
    const refB = userStore.cachedUsers.get(friendIdB);
    sharedFeedStore.addEntry({
        created_at: createdAt,
        type: FEED_TYPE_MAP[eventType] || eventType,
        userId: friendIdA,
        displayName: refB?.displayName || friendIdB,
        friendIdA,
        friendIdB
    });
}

/**
 * 清理超过保留期(默认 180 天)的事件, 每天最多执行一次
 */
async function cleanupOldMutualEvents() {
    const nowMs = Date.now();
    if (nowMs - lastEventCleanupAt < EVENT_CLEANUP_INTERVAL_MS) {
        return;
    }
    lastEventCleanupAt = nowMs;
    const cutoffDate = new Date(nowMs - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    try {
        await database.deleteMutualEventsBefore(cutoffDate);
    } catch (err) {
        // 失败后重置时间戳, 下批重试
        lastEventCleanupAt = 0;
        console.warn('[MutualSync] Event cleanup failed:', err);
    }
}

/**
 * 把抓取结果规范化为 id 列表
 * @param {Array} mutuals
 * @returns {string[]}
 */
function normalizeMutualIds(mutuals) {
    return (mutuals || [])
        .map((entry) => String(entry?.id || ''))
        .filter((id) => id && id !== EMPTY_USER_ID);
}

/**
 * 单个好友 403/404 处理: 视为 opted-out 跳变
 * @param {string} friendId
 * @param {Map} metaMap 本批内存中的 meta 快照
 */
async function markOptedOut(friendId, metaMap) {
    const prevMeta = metaMap.get(friendId);
    if (!prevMeta?.optedOut) {
        await recordMutualEvent('MutualOptOut', friendId, friendId);
    }
    const detectedAt = new Date().toISOString();
    await database.upsertMutualGraphMeta(friendId, {
        optedOut: true,
        optOutDetectedAt: detectedAt
    });
    metaMap.set(friendId, {
        lastFetchedAt: prevMeta?.lastFetchedAt || null,
        optedOut: true,
        optOutDetectedAt: detectedAt
    });
}

/**
 * 执行一批共同好友同步 (每批最多 8 个好友, 批内 5 req/s)
 */
export async function runMutualSyncBatch() {
    if (mutualSyncState.isRunning) {
        return;
    }
    const friendStore = useFriendStore();
    const userStore = useUserStore();
    const chartsStore = useChartsStore();
    // 手动全图抓取进行中: 本周期跳过, 静默下周期再试
    if (chartsStore.mutualGraphStatus.isFetching) {
        return;
    }
    mutualSyncState.isRunning = true;
    try {
        if (!watchState.isLoggedIn || !watchState.isFriendsLoaded) {
            return;
        }
        if (userStore.currentUser?.hasSharedConnectionsOptOut) {
            return;
        }
        const intervalMinutes = await getMutualSyncIntervalMinutes();
        if (intervalMinutes <= 0) {
            return;
        }
        // B 数据新鲜窗口: 2 个同步周期
        const freshnessMs = 2 * intervalMinutes * 60 * 1000;

        const metaMap = await database.getMutualGraphMeta();
        const batch = selectMutualSyncBatch({
            friendIds: friendStore.friends.keys(),
            metaMap,
            batchSize: BATCH_SIZE
        });
        if (batch.length === 0) {
            return;
        }

        const rateLimiter = createRateLimiter({ limitPerInterval: 5, intervalMs: 1000 });
        // 取消判定: 登出或当前用户变化(切换账号)时中止,
        // 防止半截数据写入新账号的表
        const batchUserId = dbVars.userId;
        const isAborted = () => !watchState.isLoggedIn || (batchUserId && dbVars.userId !== batchUserId);
        const isCancelled = () => isAborted();
        const startOfDay = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
        let recentEvents = await database.getRecentMutualEvents({ sinceDate: startOfDay });

        for (const { friendId: friendIdA } of batch) {
            if (isAborted()) {
                break;
            }
            const prevMeta = metaMap.get(friendIdA);
            const oldLinks = await database.getMutualsForFriend(friendIdA);
            if (isAborted()) {
                break;
            }
            let mutuals;
            try {
                mutuals = await chartsStore.fetchMutualFriendsForUser(friendIdA, {
                    rateLimiter,
                    isCancelled
                });
            } catch (err) {
                if (err?.status === 403 || err?.status === 404) {
                    // opted-out 跳变: 不覆盖旧边 (Hidden Mutual 回溯需要旧数据)
                    await markOptedOut(friendIdA, metaMap);
                } else {
                    console.warn('[MutualSync] Friend fetch failed, skip this batch:', friendIdA, err);
                }
                continue;
            }
            if (mutuals === null) {
                // 取消/登出: 半截数据不落库不 diff
                break;
            }
            if (isAborted()) {
                break;
            }
            const newLinks = normalizeMutualIds(mutuals);
            const now = new Date().toISOString();
            const wasOptedOut = Boolean(prevMeta?.optedOut);
            if (oldLinks === null) {
                // 首抓无旧基线: 只落库建立基线, 不 diff 不产生事件,
                // 否则全部 mutual 会被误判为新增好友
                await database.updateMutualsForFriend(friendIdA, newLinks);
                await database.upsertMutualGraphMeta(friendIdA, {
                    lastFetchedAt: now,
                    optedOut: false
                });
                metaMap.set(friendIdA, {
                    lastFetchedAt: now,
                    optedOut: false,
                    optOutDetectedAt: prevMeta?.optOutDetectedAt || null
                });
                continue;
            }
            if (wasOptedOut) {
                // 从 opted-out 恢复: 只更新 meta 并清空检测时间。
                // 本批不覆盖旧边 (保留冻结期前数据), 下一批正常 diff
                // 才能正确判定冻结期间的变化
                await database.upsertMutualGraphMeta(friendIdA, {
                    lastFetchedAt: now,
                    optedOut: false,
                    optOutDetectedAt: null,
                    clearOptOutDetectedAt: true
                });
                metaMap.set(friendIdA, {
                    lastFetchedAt: now,
                    optedOut: false,
                    optOutDetectedAt: null
                });
                console.log('[MutualSync] Friend recovered from opt-out:', friendIdA);
                continue;
            }
            await database.updateMutualsForFriend(friendIdA, newLinks);
            await database.upsertMutualGraphMeta(friendIdA, {
                lastFetchedAt: now,
                optedOut: false
            });
            metaMap.set(friendIdA, {
                lastFetchedAt: now,
                optedOut: false,
                optOutDetectedAt: prevMeta?.optOutDetectedAt || null
            });

            const newSet = new Set(newLinks);
            const isFriend = (id) => friendStore.friendLog.has(id);

            // 消失边涉及的 B 需要其自身 links 才能判定 (仅我的好友 & 未冻结)
            const linksByUser = new Map();
            for (const id of oldLinks) {
                if (newSet.has(id) || id === friendIdA || !isFriend(id)) {
                    continue;
                }
                if (metaMap.get(id)?.optedOut) {
                    continue;
                }
                linksByUser.set(id, await database.getMutualsForFriend(id));
                if (isAborted()) {
                    break;
                }
            }
            if (isAborted()) {
                break;
            }
            const getLinks = (id) => (linksByUser.has(id) ? linksByUser.get(id) : undefined);

            const diffArgs = {
                ownerId: friendIdA,
                oldFriendIds: oldLinks,
                newFriendIds: newLinks,
                isFriend,
                getMeta: (id) => metaMap.get(id),
                getLinks,
                recentEvents,
                freshnessMs
            };
            let result = computeMutualEvents(diffArgs);

            // 数据过旧的 B: 本批立即补抓一次再重判 (简单实现, 只补一轮)
            if (result.refetchIds.length > 0) {
                for (const friendIdB of result.refetchIds) {
                    if (isAborted()) {
                        break;
                    }
                    try {
                        const bMutuals = await chartsStore.fetchMutualFriendsForUser(friendIdB, {
                            rateLimiter,
                            isCancelled
                        });
                        if (bMutuals === null) {
                            // 取消/登出: 半截数据不落库
                            break;
                        }
                        const bIds = normalizeMutualIds(bMutuals);
                        linksByUser.set(friendIdB, bIds);
                        const bNow = new Date().toISOString();
                        await database.updateMutualsForFriend(friendIdB, bIds);
                        await database.upsertMutualGraphMeta(friendIdB, {
                            lastFetchedAt: bNow,
                            optedOut: false
                        });
                        metaMap.set(friendIdB, {
                            lastFetchedAt: bNow,
                            optedOut: false,
                            optOutDetectedAt: metaMap.get(friendIdB)?.optOutDetectedAt || null
                        });
                    } catch (err) {
                        if (err?.status === 403 || err?.status === 404) {
                            await markOptedOut(friendIdB, metaMap);
                            // 冻结数据: diff 时按 optedOut 规则忽略
                            linksByUser.set(friendIdB, []);
                        } else {
                            console.warn(
                                '[MutualSync] Refetch failed, leave for next batch:',
                                friendIdB,
                                err
                            );
                            linksByUser.delete(friendIdB);
                        }
                    }
                }
                if (isAborted()) {
                    break;
                }
                result = computeMutualEvents(diffArgs);
            }

            for (const event of result.events) {
                if (isAborted()) {
                    break;
                }
                await recordMutualEvent(event.eventType, event.friendIdA, event.friendIdB);
            }
            recentEvents = recentEvents.concat(result.events);
        }
    } catch (err) {
        console.error('[MutualSync] Batch failed:', err);
    } finally {
        mutualSyncState.isRunning = false;
        // 事件表保留清理 (每天最多一次), 不影响主流程
        cleanupOldMutualEvents().catch(() => {});
    }
}

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
//
// 事件顺序约定: 每个好友「读旧边 -> diff(拿 pending 事件) -> 落库 ->
// 写事件」, 事件必须基于落库前读的旧边; 补抓的 B 同样先读旧边再落库,
// 并对 B 自身执行一次 diff (B 作为 owner), B 产生的补抓不再递归。

import { database, dbVars } from '../services/database';
import { computeMutualEvents } from '../shared/utils/mutualEvents';
import { selectMutualSyncBatch } from '../shared/utils/mutualSyncBatch';
import { MUTUAL_FEED_TYPE_MAP } from '../shared/utils/mutualFeedRows';
import { createRateLimiter } from '../shared/utils/throttle';
import { useChartsStore } from '../stores/charts';
import { useFriendStore } from '../stores/friend';
import { useSharedFeedStore } from '../stores/sharedFeed';
import { useNotificationStore } from '../stores/notification';
import { useUserStore } from '../stores/user';
import { i18n } from '../plugins/i18n';
import { watchState } from '../services/watchState';
import { mutualSyncState } from '../services/mutualSyncState';

import configRepository from '../services/config';
import { DEFAULT_MUTUAL_SYNC_INTERVAL_MINUTES } from '../shared/constants/settings';

const BATCH_SIZE = 8;
const EMPTY_USER_ID = 'usr_00000000-0000-0000-0000-000000000000';
const EVENT_RETENTION_DAYS = 180;
const EVENT_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// 事件表保留清理: 每天最多一次 (模块级时间戳)
let lastEventCleanupAt = 0;

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
 * 事件入库 + 推动态 + noty (当日同键去重)
 * @param {string} eventType
 * @param {string} friendIdA
 * @param {string} friendIdB
 * @param {string} [sinceDate] 批开始固定的当日零点, 避免跨午夜窗口漂移
 */
async function recordMutualEvent(eventType, friendIdA, friendIdB, sinceDate) {
    const dedupSince = sinceDate || new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    if (await database.hasMutualEvent({ eventType, friendIdA, friendIdB, sinceDate: dedupSince })) {
        return;
    }
    const createdAt = new Date().toISOString();
    await database.addMutualEvent({ eventType, friendIdA, friendIdB, createdAt });
    const feedType = MUTUAL_FEED_TYPE_MAP[eventType] || eventType;
    const sharedFeedStore = useSharedFeedStore();
    const userStore = useUserStore();
    const refA = userStore.cachedUsers.get(friendIdA);
    const nameA = refA?.displayName || friendIdA;
    const refB = userStore.cachedUsers.get(friendIdB);
    const nameB = refB?.displayName || friendIdB;
    sharedFeedStore.addEntry({
        created_at: createdAt,
        type: feedType,
        userId: friendIdA,
        displayName: nameB,
        friendIdA,
        friendIdB
    });
    // noty 过滤器里 mutual 三项默认 On, 桌面通知/TTS 走 queueFriendLogNoty
    const { t } = i18n.global;
    let message;
    if (eventType === 'FriendshipEnd') {
        message = `${nameA}${t('view.friend_log.mutual_and')}${nameB}${t('view.friend_log.mutual_friendship_end_predicate')}`;
    } else if (eventType === 'FriendshipStart') {
        message = `${nameA}${t('view.friend_log.mutual_and')}${nameB}${t('view.friend_log.mutual_friendship_start_predicate')}`;
    } else {
        message = `${nameA}${t('view.friend_log.mutual_opt_out_suffix')}`;
    }
    useNotificationStore().queueFriendLogNoty({
        created_at: createdAt,
        type: feedType,
        userId: friendIdA,
        displayName: nameA,
        message,
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
 * @param {string[]|null} oldLinks 落库前读到的旧边 (null = 无基线)
 * @param {string} sinceDate 批开始固定的当日零点
 */
async function markOptedOut(friendId, metaMap, oldLinks, sinceDate) {
    const prevMeta = metaMap.get(friendId);
    // 首抓即 403 (无旧基线) 不发事件: 从未见过非 opt-out 状态,
    // 不构成状态变化; 有基线且状态变化才发 MutualOptOut
    if (oldLinks !== null && !prevMeta?.optedOut) {
        await recordMutualEvent('MutualOptOut', friendId, friendId, sinceDate);
    }
    const detectedAt = new Date().toISOString();
    // 失败路径不推进 last_fetched_at: 保留真实最后成功抓取时间;
    // 传 null 时 DB 层新行写 NULL、冲突保留旧值
    await database.upsertMutualGraphMeta(friendId, {
        lastFetchedAt: prevMeta?.lastFetchedAt || null,
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
        // B 数据新鲜窗口: 按实际轮转周期 (全部好友轮一遍的耗时),
        // 下限 2 个同步周期 —— 窗口小于轮转周期会把轮到的 B 误判为过旧
        const intervalMs = intervalMinutes * 60 * 1000;
        const rotationMs = intervalMs * Math.ceil(friendStore.friends.size / BATCH_SIZE);
        const freshnessMs = Math.max(2 * intervalMs, rotationMs);

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
        // 批开始固定当日零点: 整批事件去重共用一个窗口, 不因跨午夜各自漂移
        const startOfDay = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
        let recentEvents = await database.getRecentMutualEvents({ sinceDate: startOfDay });

        for (const { friendId: friendIdA } of batch) {
            if (isAborted()) {
                break;
            }
            // 批次选中后好友可能已被删除: 删除竞态下跳过,
            // 否则以已清空的图数据误判出一批解除事件
            if (!friendStore.friends.has(friendIdA)) {
                continue;
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
                    await markOptedOut(friendIdA, metaMap, oldLinks, startOfDay);
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
                // 从 opted-out 恢复: 只清 opted_out 与检测时间。
                // 边没更新, 不推进 last_fetched_at (保留真实最后成功
                // 抓取时间); 本批不覆盖旧边 (保留冻结期前数据),
                // 下一批正常 diff 才能正确判定冻结期间的变化
                await database.upsertMutualGraphMeta(
                    friendIdA,
                    { optedOut: false },
                    { clearOptOutDetectedAt: true }
                );
                metaMap.set(friendIdA, {
                    lastFetchedAt: prevMeta?.lastFetchedAt || null,
                    optedOut: false,
                    optOutDetectedAt: null
                });
                console.log('[MutualSync] Friend recovered from opt-out:', friendIdA);
                continue;
            }
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

            // 数据过旧的 B: 本批立即补抓一次再重判。
            // 补抓数量截断到 BATCH_SIZE, 超出的 B 留到下批
            // (下批按 freshness 最旧优先自然覆盖)。
            // 补抓后同时对 B 自身 diff (B 作为 owner, 基于 B 落库前
            // 读到的旧边), 否则 B 自己的变化会随基线推进而丢失;
            // B 的 diff 产生的 refetchIds 不再递归补抓, 留到下批
            if (result.refetchIds.length > 0) {
                const refetchList = result.refetchIds.slice(0, BATCH_SIZE);
                for (const friendIdB of refetchList) {
                    if (isAborted()) {
                        break;
                    }
                    // B 旧边: 落库前读到的快照 (消失边判定阶段已读,
                    // 或现读一次), B 自身 diff 必须基于它
                    const bOldLinks = linksByUser.has(friendIdB)
                        ? linksByUser.get(friendIdB)
                        : await database.getMutualsForFriend(friendIdB);
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
                        // B 的消失边涉及的 C: 读 C 的 DB 快照判定
                        // (C 为 A 时用 A 本批的新边, DB 里还是旧值)
                        const bNewSet = new Set(bIds);
                        const cLinks = new Map();
                        for (const idC of bOldLinks || []) {
                            if (bNewSet.has(idC) || idC === friendIdB || !isFriend(idC)) {
                                continue;
                            }
                            if (metaMap.get(idC)?.optedOut) {
                                continue;
                            }
                            cLinks.set(
                                idC,
                                idC === friendIdA ? newLinks : await database.getMutualsForFriend(idC)
                            );
                            if (isAborted()) {
                                break;
                            }
                        }
                        if (isAborted()) {
                            break;
                        }
                        const bDiff = computeMutualEvents({
                            ownerId: friendIdB,
                            oldFriendIds: bOldLinks,
                            newFriendIds: bIds,
                            isFriend,
                            getMeta: (id) => metaMap.get(id),
                            getLinks: (id) => cLinks.get(id),
                            recentEvents,
                            freshnessMs
                        });
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
                        for (const event of bDiff.events) {
                            if (isAborted()) {
                                break;
                            }
                            await recordMutualEvent(event.eventType, event.friendIdA, event.friendIdB, startOfDay);
                        }
                        recentEvents = recentEvents.concat(bDiff.events);
                    } catch (err) {
                        if (err?.status === 403 || err?.status === 404) {
                            await markOptedOut(friendIdB, metaMap, bOldLinks, startOfDay);
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
            }

            // A 落库 (diff 先于落库): 补抓完成后才推进基线,
            // 中途取消/失败时下批仍能按旧基线重判
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

            // 重判: 用补抓后的 B 新边与本批最新已录事件
            diffArgs.recentEvents = recentEvents;
            result = computeMutualEvents(diffArgs);
            for (const event of result.events) {
                if (isAborted()) {
                    break;
                }
                await recordMutualEvent(event.eventType, event.friendIdA, event.friendIdB, startOfDay);
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

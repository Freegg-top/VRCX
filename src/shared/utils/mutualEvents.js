// 共同好友变化检测: 纯 diff 逻辑, 供 mutualSyncCoordinator 调用并便于单测
//
// 输入 A(列表所有者, 必须是我的好友)的旧/新 mutual 边集合, 以及 involved
// B 的元数据/边数据, 输出事件列表与本批需要立即补抓的 B 列表。
//
// 规则(仅当 B 也是我的好友时才产生事件, 否则 UI 无处展示):
// - 消失的边:
//   1. B 不是我的好友 -> 忽略
//   2. B 的 meta.optedOut=1 (数据冻结) -> 无法确认对方视角, 不发事件
//   3. A 仍在 B.links 且 B 数据新鲜 -> 数据矛盾, 不发事件(控制台留痕)
//   4. A 不在 B.links 且 B 数据新鲜 -> FriendshipEnd (双方确认解除)
//   5. B 数据过旧 -> 本批不发, B 排入补抓队列
// - 新增的边 -> FriendshipStart; 例外: B 曾 opted-out 后恢复(边重现可能
//   只是对方重新开放显示), 不发事件仅留痕
// - 同 (eventType, friendIdA, friendIdB) 当日已有事件 -> 去重跳过

/**
 * @param {object} args
 * @param {string} args.ownerId 列表所有者 A (我的好友)
 * @param {string[]|Set<string>} args.oldFriendIds A 的旧 mutual 边
 * @param {string[]|Set<string>} args.newFriendIds A 的新 mutual 边(本批抓取成功)
 * @param {(id: string) => boolean} args.isFriend B 是否是我的好友(friendLog)
 * @param {(id: string) => { optedOut: boolean, lastFetchedAt: string|null, optOutDetectedAt?: string|null }|undefined} args.getMeta
 * @param {(id: string) => string[]|null|undefined} args.getLinks B 自己的 mutual 边(无数据时返回 null/undefined)
 * @param {Array<{eventType: string, friendIdA: string, friendIdB: string, createdAt: string}>} [args.recentEvents] 当日已有事件(去重)
 * @param {string|Date} [args.now] 当前时间
 * @param {number} [args.freshnessMs] B 数据视为新鲜的窗口(通常 2 个同步周期)
 * @returns {{ events: Array<{eventType: string, friendIdA: string, friendIdB: string, createdAt: string}>, refetchIds: string[] }}
 */
function computeMutualEvents({
    ownerId,
    oldFriendIds,
    newFriendIds,
    isFriend,
    getMeta,
    getLinks,
    recentEvents = [],
    now = new Date(),
    freshnessMs = 60 * 60 * 1000
}) {
    const events = [];
    const refetchIds = [];
    if (oldFriendIds == null) {
        // 无旧基线(首抓): 新边无法判定为「新增」, 不产生任何事件。
        // null 语义由调用方处理 (首抓只建立基线), 此处兜底防御。
        return { events, refetchIds };
    }
    const oldSet = oldFriendIds instanceof Set ? oldFriendIds : new Set(oldFriendIds || []);
    const newSet = newFriendIds instanceof Set ? newFriendIds : new Set(newFriendIds || []);
    const nowTime = now instanceof Date ? now.getTime() : Date.parse(now);
    const todayKey = new Date(nowTime).toDateString();

    const isDuplicate = (eventType, friendIdA, friendIdB) => {
        for (const event of recentEvents) {
            if (
                event.eventType === eventType &&
                event.friendIdA === friendIdA &&
                event.friendIdB === friendIdB &&
                new Date(event.createdAt).toDateString() === todayKey
            ) {
                return true;
            }
        }
        return false;
    };

    const pushEvent = (eventType, friendIdA, friendIdB) => {
        if (isDuplicate(eventType, friendIdA, friendIdB)) {
            return;
        }
        events.push({
            eventType,
            friendIdA,
            friendIdB,
            createdAt: new Date(nowTime).toISOString()
        });
    };

    const isFresh = (meta) => {
        if (!meta?.lastFetchedAt) {
            return false;
        }
        const time = Date.parse(meta.lastFetchedAt);
        return Number.isFinite(time) && nowTime - time <= freshnessMs;
    };

    // 消失的边
    for (const friendIdB of oldSet) {
        if (newSet.has(friendIdB) || friendIdB === ownerId) {
            continue;
        }
        if (!isFriend(friendIdB)) {
            // 规则 1: 不是我的好友, 变化无处展示
            continue;
        }
        const meta = getMeta(friendIdB);
        if (meta?.optedOut) {
            // 规则 2: B 数据冻结, 无法确认对方视角
            continue;
        }
        const bLinks = getLinks(friendIdB);
        if (!bLinks) {
            // 规则 5: B 无本地数据, 补抓一次再重判
            refetchIds.push(friendIdB);
            continue;
        }
        if (isFresh(meta)) {
            if (bLinks.includes(ownerId)) {
                // 规则 3: 双方数据矛盾, 保守不发
                console.log(
                    `[MutualSync] Conflicting data for ${ownerId}/${friendIdB}, skipping FriendshipEnd`
                );
            } else {
                // 规则 4: 双方数据都新鲜且都不含对方边 -> 确认解除
                pushEvent('FriendshipEnd', ownerId, friendIdB);
            }
        } else {
            // 规则 5: B 数据过旧, 补抓
            refetchIds.push(friendIdB);
        }
    }

    // 新增的边
    for (const friendIdB of newSet) {
        if (oldSet.has(friendIdB) || friendIdB === ownerId) {
            continue;
        }
        if (!isFriend(friendIdB)) {
            continue;
        }
        const meta = getMeta(friendIdB);
        if (meta?.optOutDetectedAt || meta?.optedOut) {
            // 曾 opted-out 后恢复: 边重现可能只是重新开放显示
            console.log(
                `[MutualSync] ${friendIdB} recovered from opt-out, skip FriendshipStart for ${ownerId}`
            );
            continue;
        }
        pushEvent('FriendshipStart', ownerId, friendIdB);
    }

    return { events, refetchIds };
}

export { computeMutualEvents };

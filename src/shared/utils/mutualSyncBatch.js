// 共同好友后台同步: 批次选择纯函数, 从协调器抽出便于单测。
//
// 候选分两类:
// - 常规好友: 未 opted-out, 按 last_fetched_at 最旧优先
// - opted-out 好友: 常规抓取必 403, 但距首次检测(optOutDetectedAt)
//   超过重试窗口时纳入低频重试 (每批最多 1 个, 避免浪费配额),
//   以便对方重新开放展示后自动恢复。

const DEFAULT_BATCH_SIZE = 8;
const DEFAULT_OPT_OUT_RETRY_MS = 24 * 60 * 60 * 1000;

/**
 * 排序比较器: 无 lastFetchedAt 的排最前; 两者都无时保持稳定 (返回 0)
 */
function compareByLastFetched(a, b) {
    if (a === b) {
        return 0;
    }
    if (!a.lastFetchedAt && !b.lastFetchedAt) {
        return 0;
    }
    if (!a.lastFetchedAt) {
        return -1;
    }
    if (!b.lastFetchedAt) {
        return 1;
    }
    return Date.parse(a.lastFetchedAt) - Date.parse(b.lastFetchedAt);
}

/**
 * @param {object} args
 * @param {Iterable<string>} args.friendIds 当前好友 id 集合
 * @param {Map<string, { lastFetchedAt: string|null, optedOut: boolean, optOutDetectedAt?: string|null }>} args.metaMap
 * @param {number} [args.now] 当前时间戳, 默认 Date.now()
 * @param {number} [args.batchSize]
 * @param {number} [args.optOutRetryMs] opted-out 重试窗口, 默认 24h
 * @returns {Array<{ friendId: string, lastFetchedAt: string|null, isOptOutRetry?: boolean }>}
 */
function selectMutualSyncBatch({
    friendIds,
    metaMap,
    now = Date.now(),
    batchSize = DEFAULT_BATCH_SIZE,
    optOutRetryMs = DEFAULT_OPT_OUT_RETRY_MS
}) {
    const candidates = [];
    const optOutRetry = [];
    for (const friendId of friendIds) {
        const meta = metaMap.get(friendId);
        if (!meta?.optedOut) {
            candidates.push({ friendId, lastFetchedAt: meta?.lastFetchedAt || null });
            continue;
        }
        const since = Date.parse(meta.optOutDetectedAt || meta.lastFetchedAt || 0);
        // 检测时间缺失(NaN)或超出重试窗口 -> 纳入低频重试
        if (!Number.isFinite(since) || now - since >= optOutRetryMs) {
            optOutRetry.push({ friendId, lastFetchedAt: meta?.lastFetchedAt || null, isOptOutRetry: true });
        }
    }
    candidates.sort(compareByLastFetched);
    optOutRetry.sort(compareByLastFetched);
    // 重试预留槽位: 正常候选满批时 opted-out 重试仍占 1 席,
    // 不被最旧优先的正常候选饿死 (否则对方重新开放展示后永远无法恢复)
    const retry = batchSize > 0 && optOutRetry.length > 0 ? [optOutRetry[0]] : [];
    const regular = candidates.slice(0, Math.max(0, batchSize - retry.length));
    return regular.concat(retry);
}

export { selectMutualSyncBatch, compareByLastFetched, DEFAULT_OPT_OUT_RETRY_MS };

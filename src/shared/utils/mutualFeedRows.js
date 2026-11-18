// 共同好友变化事件 -> 动态流行 (好友动态 / Feed 页共用)
//
// DB 事件类型 (FriendshipEnd/FriendshipStart/MutualOptOut) 到动态流 type
// (MutualFriendshipEnd/MutualFriendshipStart/MutualOptOut) 的映射与
// mutualSyncCoordinator 实时推送的 FEED_TYPE_MAP 保持一致。
// 显示名不在事件表中, 由渲染层按 userId/friendIdB 从 cachedUsers 解析。

const MUTUAL_FEED_TYPE_MAP = {
    FriendshipEnd: 'MutualFriendshipEnd',
    FriendshipStart: 'MutualFriendshipStart',
    MutualOptOut: 'MutualOptOut'
};

// 动态流中展示的三种 mutual 事件 type
const MUTUAL_FEED_TYPES = [
    'MutualFriendshipEnd',
    'MutualFriendshipStart',
    'MutualOptOut'
];

/**
 * @param {{id?: number, createdAt: string, eventType: string, friendIdA: string, friendIdB: string}} event
 * @param {(userId: string) => string} [resolveDisplayName]
 * @returns {{rowId?: number, created_at: string, type: string, userId: string, friendIdA: string, friendIdB: string, displayNameA?: string, displayName?: string}}
 */
function mutualEventToFeedRow(event, resolveDisplayName) {
    const row = {
        created_at: event.createdAt,
        type: MUTUAL_FEED_TYPE_MAP[event.eventType] || event.eventType,
        userId: event.friendIdA,
        friendIdA: event.friendIdA,
        friendIdB: event.friendIdB
    };
    if (typeof resolveDisplayName === 'function') {
        row.displayNameA = resolveDisplayName(event.friendIdA);
        row.displayName = resolveDisplayName(event.friendIdB);
    }
    if (typeof event.id === 'number') {
        row.rowId = event.id;
    }
    return row;
}

export { MUTUAL_FEED_TYPE_MAP, MUTUAL_FEED_TYPES, mutualEventToFeedRow };

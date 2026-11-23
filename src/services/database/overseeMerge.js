// Oversee 本地/云端数据合并的纯函数集 (无 Vue/Pinia 依赖, 便于单测).
// 本地共现数据来自 gameLog.getLocalCoSeenRows (gamelog_join_leave 的 join/leave 行).

const USR_ID_REGEX = /usr_[0-9a-f-]{36}/i;
const INSTANCE_GUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// 未关闭区间的兜底口径: 区间开始后最多按 4 小时参与共现统计 (见 computeLocalCoSeen 注释)
const OPEN_INTERVAL_CAP_MS = 4 * 60 * 60 * 1000;
// RoomLookup 输入提取: 从粘贴文本/URL 中提取 wrld_xxx[:instance号]
const LOCATION_TOKEN_REGEX = /wrld_[0-9a-zA-Z-]+(?::\d+)?/;

/**
 * 从任意文本 (usr_id / VRChat URL / 分享文本) 提取 usr_id.
 *
 * @param {string} text
 * @returns {string} 未命中返回空串
 */
function extractUsrId(text) {
    const match = String(text ?? '').match(USR_ID_REGEX);
    return match ? match[0] : '';
}

/**
 * World_id 截短显示: 保留前 10 个字符 + 省略号.
 *
 * @param {string} worldId
 * @returns {string}
 */
function shortenWorldId(worldId) {
    const id = String(worldId ?? '');
    if (id.length <= 10) {
        return id;
    }
    return `${id.slice(0, 10)}…`;
}

/**
 * 从 location (wrld_xxx:00000~region(eu)...) 提取 world_id.
 *
 * @param {string} location
 * @returns {string}
 */
function extractWorldIdFromLocation(location) {
    const match = String(location ?? '').match(/^wrld_[0-9a-f-]{8,}/i);
    return match ? match[0] : '';
}

/**
 * 实例 id 截短显示: 去掉冗长 GUID 尾巴, 形如 `:12345~region(eu)` 保留实例号即可读.
 *
 * @param {string} instanceId
 * @returns {string}
 */
function shortenInstanceId(instanceId) {
    const id = String(instanceId ?? '');
    const guid = id.match(INSTANCE_GUID_REGEX);
    return guid ? id.replace(guid[0], `${guid[0].slice(0, 8)}…`) : id;
}

/**
 * Build presence intervals and the sorted event index in one pass over the rows.
 *
 * @param {{ userId: string; displayName: string; location: string; createdAt: string; type: string }[]} rows
 * @returns {{
 *     intervals: {
 *         entityKey: string;
 *         userId: string;
 *         displayName: string;
 *         location: string;
 *         start: string;
 *         end: string | null;
 *     }[];
 *     eventsByEntityLocation: Map<string, string[]>;
 * }}
 */
function buildPresenceData(rows) {
    const intervals = [];
    /** @type {Map<string, object>} */
    const openByEntityLocation = new Map();
    const eventsByEntityLocation = new Map();
    for (const row of rows) {
        if (!row?.location || !row?.createdAt) {
            continue;
        }
        const entityKey = row.userId || row.displayName;
        if (!entityKey) {
            continue;
        }
        const openKey = `${entityKey}\n${row.location}`;
        const list = eventsByEntityLocation.get(openKey) || [];
        list.push(row.createdAt);
        eventsByEntityLocation.set(openKey, list);
        if (row.type === 'OnPlayerJoined') {
            const interval = {
                entityKey,
                userId: row.userId,
                displayName: row.displayName,
                location: row.location,
                start: row.createdAt,
                end: null
            };
            intervals.push(interval);
            openByEntityLocation.set(openKey, interval);
        } else if (row.type === 'OnPlayerLeft') {
            const open = openByEntityLocation.get(openKey);
            if (open) {
                open.end = row.createdAt;
                openByEntityLocation.delete(openKey);
            }
        }
    }
    for (const list of eventsByEntityLocation.values()) {
        list.sort();
    }
    return { intervals, eventsByEntityLocation };
}

/**
 * 把 gamelog_join_leave 行流折叠成在场区间.
 * 行序须按 id ASC. join 开区间, leave 关闭同 entity 同 location 最近的未关闭区间;
 * 未关闭区间以 null 结尾 (视为持续到当前).
 *
 * @param {{ userId: string; displayName: string; location: string; createdAt: string; type: string }[]} rows
 * @returns {{
 *     entityKey: string;
 *     userId: string;
 *     displayName: string;
 *     location: string;
 *     start: string;
 *     end: string | null;
 * }[]}
 */
function buildPresenceIntervals(rows) {
    return buildPresenceData(rows).intervals;
}

/**
 * 取该实体在同 location 上, 晚于 start 的第一条事件时间 (任意类型).
 *
 * @param {Map<string, string[]>} eventsByEntityLocation
 * @param {string} entityKey
 * @param {string} location
 * @param {string} start
 * @returns {string | undefined}
 */
function nextEventAfter(eventsByEntityLocation, entityKey, location, start) {
    const list = eventsByEntityLocation.get(`${entityKey}\n${location}`);
    if (!list) {
        return undefined;
    }
    let low = 0;
    let high = list.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (list[mid] > start) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }
    return list[low];
}

/**
 * 判断时刻是否落在区间内. end 为 null 表示持续到当前.
 *
 * @param {string | null} start
 * @param {string | null} end
 * @param {string} at
 * @returns {boolean}
 */
function isWithinInterval(start, end, at) {
    return at >= start && (end === null || at <= end);
}

/**
 * 从粘贴文本 / URL 中提取 location 片段 (wrld_xxx 或 wrld_xxx:12345).
 * 提取不到返回空串.
 *
 * @param {string} text
 * @returns {string}
 */
function extractLocationFromText(text) {
    const match = String(text ?? '').match(LOCATION_TOKEN_REGEX);
    return match ? match[0] : '';
}

/**
 * 未关闭区间的有效终点口径 (共现统计防虚高):
 * 1. 该实体在同 location 的下一条事件时间 (含他人 join/leave);
 * 2. self 在该 location 的离开时间 (实体为 self 时);
 * 3. 兜底: 区间开始 + 4 小时.
 * 取可得者中最小者; 已闭合区间原样返回 end.
 *
 * @param {{ entityKey: string; start: string; end: string | null }} interval
 * @param {string | undefined} nextEventAt 该实体同 location 的下一条事件时间
 * @param {string | undefined} selfLeaveAt Self 在该 location 的离开时间
 * @returns {string}
 */
function resolveOpenIntervalEnd(interval, nextEventAt, selfLeaveAt) {
    if (interval.end !== null) {
        return interval.end;
    }
    let cap = '';
    for (const candidate of [nextEventAt, selfLeaveAt]) {
        if (candidate && candidate > interval.start && (!cap || candidate < cap)) {
            cap = candidate;
        }
    }
    const fallbackCap = new Date(Date.parse(interval.start) + OPEN_INTERVAL_CAP_MS).toJSON();
    if (!cap || fallbackCap < cap) {
        cap = fallbackCap;
    }
    return cap;
}

/**
 * 计算本地共现: self 的区间与其余玩家区间按 location 相交, join 时刻落在 self 区间内即计一次.
 * 输出 otherId/displayName 兜底 entityKey, count 与最近共现时间 lastSeen.
 * 未关闭区间 (join 后无 leave) 不按"持续至今"参与统计, 而是按 resolveOpenIntervalEnd 的口径截断,
 * 避免玩家掉线/退出游戏后区间被无限拉长导致共现虚高.
 *
 * @param {{ userId: string; displayName: string; location: string; createdAt: string; type: string }[]} rows
 * @param {string} selfId
 * @returns {Map<string, { userId: string; displayName: string; count: number; lastSeen: string }>}
 */
function computeLocalCoSeen(rows, selfId) {
    const { intervals, eventsByEntityLocation } = buildPresenceData(rows);
    const selfIntervals = intervals.filter((interval) => interval.entityKey === selfId);
    /** @type {Map<string, { userId: string; displayName: string; count: number; lastSeen: string }>} */
    const result = new Map();
    if (!selfIntervals.length) {
        return result;
    }
    // 实体+location → 全部事件时间 (升序), 已在单遍构建中完成, 用于截断未关闭区间
    // self 在某 location 的离开时间 (取最早一条 leave / 已闭合 self 区间终点)
    const selfLeaveByLocation = new Map();
    for (const interval of selfIntervals) {
        if (interval.end === null) {
            continue;
        }
        const existing = selfLeaveByLocation.get(interval.location);
        if (!existing || interval.end < existing) {
            selfLeaveByLocation.set(interval.location, interval.end);
        }
    }
    const byLocation = new Map();
    for (const interval of selfIntervals) {
        const list = byLocation.get(interval.location) || [];
        list.push(interval);
        byLocation.set(interval.location, list);
    }
    for (const interval of intervals) {
        if (interval.entityKey === selfId) {
            continue;
        }
        // buildPresenceIntervals 只对 join 新建区间, 这里遍历到的均为进入事件
        const candidates = byLocation.get(interval.location);
        if (!candidates) {
            continue;
        }
        for (const selfInterval of candidates) {
            // 未关闭区间按口径截断后再判定相交
            const otherEnd = resolveOpenIntervalEnd(
                interval,
                nextEventAfter(eventsByEntityLocation, interval.entityKey, interval.location, interval.start),
                selfLeaveByLocation.get(interval.location)
            );
            const selfEnd = resolveOpenIntervalEnd(
                selfInterval,
                nextEventAfter(
                    eventsByEntityLocation,
                    selfInterval.entityKey,
                    selfInterval.location,
                    selfInterval.start
                ),
                selfLeaveByLocation.get(selfInterval.location)
            );
            const otherWithinSelf =
                interval.start >= selfInterval.start && interval.start <= selfEnd && interval.start <= otherEnd;
            const selfWithinOther = selfInterval.start >= interval.start && selfInterval.start <= otherEnd;
            if (otherWithinSelf || selfWithinOther) {
                const key = interval.entityKey;
                let entry = result.get(key);
                if (!entry) {
                    entry = {
                        userId: interval.userId,
                        displayName: interval.displayName,
                        count: 0,
                        lastSeen: ''
                    };
                    result.set(key, entry);
                }
                entry.count++;
                if (interval.start > entry.lastSeen) {
                    entry.lastSeen = interval.start;
                }
                break;
            }
        }
    }
    return result;
}

/**
 * 合并本地共现 Map 与云端 connections results.
 * 数据来源标记: local / cloud / both. 计数优先取云端 (云端是全站累计口径),
 * lastSeen 取两侧较新者. 输出按 count 倒序, 次数相同按 lastSeen 倒序.
 *
 * @param {Map<string, { userId: string; displayName: string; count: number; lastSeen: string }>} localMap
 * @param {{
 *     other_id: string;
 *     display_name: string;
 *     avatar_url: string;
 *     instance_id: string;
 *     co_seen_count: number;
 *     first_seen: string;
 *     last_seen: string;
 * }[]} cloudResults
 * @returns {{
 *     userId: string;
 *     displayName: string;
 *     avatarUrl: string;
 *     count: number;
 *     lastSeen: string;
 *     source: 'local' | 'cloud' | 'both';
 * }[]}
 */
function mergeEncounterEntries(localMap, cloudResults) {
    /** @type {Map<string, object>} */
    const merged = new Map();
    for (const [key, local] of localMap || []) {
        const userId = local.userId || key;
        merged.set(key, {
            userId,
            // 日志行可能只有显示名 (无 user_id), 点击打开用户对话框前须校验
            hasUserId: USR_ID_REGEX.test(String(userId)),
            displayName: local.displayName || local.userId || key,
            avatarUrl: '',
            count: local.count,
            lastSeen: local.lastSeen,
            source: 'local'
        });
    }
    for (const row of cloudResults || []) {
        const userId = row?.other_id;
        if (!userId) {
            continue;
        }
        const existing = merged.get(userId);
        if (existing) {
            existing.source = 'both';
            existing.count = Number(row.co_seen_count) || existing.count;
            existing.displayName = row.display_name || existing.displayName;
            if (row.avatar_url) {
                existing.avatarUrl = row.avatar_url;
            }
            if (row.last_seen > existing.lastSeen) {
                existing.lastSeen = row.last_seen;
            }
        } else {
            merged.set(userId, {
                userId,
                hasUserId: USR_ID_REGEX.test(String(userId)),
                displayName: row.display_name || userId,
                avatarUrl: row.avatar_url || '',
                count: Number(row.co_seen_count) || 0,
                lastSeen: row.last_seen || '',
                source: 'cloud'
            });
        }
    }
    return [...merged.values()].sort((a, b) => {
        if (b.count !== a.count) {
            return b.count - a.count;
        }
        return String(b.lastSeen).localeCompare(String(a.lastSeen));
    });
}

/**
 * 按世界分组观测历史, 保持输入 (最近优先) 的分组出现顺序.
 *
 * @param {{ at: string; location: string; world_id: string; instance_id: string }[]} history
 * @returns {{ worldId: string; count: number; lastAt: string; firstAt: string; entries: object[] }[]}
 */
function groupHistoryByWorld(history) {
    /** @type {Map<string, object>} */
    const groups = new Map();
    for (const entry of history || []) {
        const worldId = entry?.world_id || '';
        if (!worldId) {
            continue;
        }
        let group = groups.get(worldId);
        if (!group) {
            group = {
                worldId,
                count: 0,
                lastAt: entry.at,
                firstAt: entry.at,
                entries: []
            };
            groups.set(worldId, group);
        }
        group.count++;
        group.entries.push(entry);
        if (entry.at < group.firstAt) {
            group.firstAt = entry.at;
        }
        if (entry.at > group.lastAt) {
            group.lastAt = entry.at;
        }
    }
    return [...groups.values()];
}

export {
    buildPresenceIntervals,
    computeLocalCoSeen,
    extractLocationFromText,
    extractUsrId,
    extractWorldIdFromLocation,
    groupHistoryByWorld,
    isWithinInterval,
    mergeEncounterEntries,
    resolveOpenIntervalEnd,
    shortenInstanceId,
    shortenWorldId
};

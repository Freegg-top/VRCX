// Oversee 输入解析/截短显示/世界分组的纯函数集 (无 Vue/Pinia 依赖, 便于单测).

const USR_ID_REGEX = /usr_[0-9a-f-]{36}/i;
const INSTANCE_GUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// RoomLookup 输入提取: 从粘贴文本/URL 中提取完整 wrld_xxx[:instance号][~限定符...]
// 云端实例索引按完整 location 字符串精确匹配, 尾部 ~段绝不能截断
const LOCATION_TOKEN_REGEX = /wrld_[0-9a-zA-Z-]+(?::\d+)?(?:~[^\s~]+(?:\([^\s)]*\))?)*/;

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
 * 从粘贴文本 / URL 中提取完整 location 片段, 包括 instance 号及所有 ~限定符.
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
    extractLocationFromText,
    extractUsrId,
    extractWorldIdFromLocation,
    groupHistoryByWorld,
    shortenInstanceId,
    shortenWorldId
};

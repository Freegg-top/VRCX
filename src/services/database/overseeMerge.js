// Oversee 输入解析与世界标识显示的纯函数集 (无 Vue/Pinia 依赖, 便于单测).

const USR_ID_REGEX = /usr_[0-9a-f-]{36}/i;

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

export { extractUsrId, extractWorldIdFromLocation, shortenWorldId };

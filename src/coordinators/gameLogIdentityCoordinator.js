import { confirmFileAccount } from '../services/database/gameLogAccount';
import { database } from '../services/database';

import configRepository from '../services/config';

/**
 * 把日志里的本机显示名换成 usr_ 账号 id。
 * 只认 VRCX 本地已知的账号(当前登录用户 + 已保存的登录项), 认不出就留 unknown,
 * 不做按昵称的在线搜索: 同名玩家很多, 猜错比留空更糟。
 *
 * @param {string} displayName
 * @returns {Promise<string>}
 */
async function resolveAccountIdByDisplayName(displayName) {
    if (!displayName) {
        return '';
    }
    const currentUserId = await configRepository.getString('lastUserLoggedIn', '');
    let savedCredentials = {};
    try {
        savedCredentials = JSON.parse(await configRepository.getString('savedCredentials', '{}'));
    } catch (e) {
        console.error('[gameLogIdentity] failed to read saved credentials:', e);
        return '';
    }
    for (const [userId, saved] of Object.entries(savedCredentials)) {
        if (saved?.user?.displayName === displayName) {
            return userId;
        }
    }
    if (currentUserId && savedCredentials[currentUserId]?.user?.displayName === displayName) {
        return currentUserId;
    }
    return '';
}

/**
 * @param {string} fileName 日志文件名, 一个文件对应一次客户端启动
 * @param {string} dt 该条 local-identity 事件的时间
 * @param {string} displayName 日志里报告的本机玩家名
 * @returns {Promise<string>} 解析出的账号 id, 认不出时为空串
 */
export async function handleLocalIdentity(fileName, dt, displayName) {
    const accountId = await resolveAccountIdByDisplayName(displayName);
    if (!accountId) {
        return '';
    }
    const window = confirmFileAccount(fileName, accountId);
    if (window) {
        await database.backfillGameLogAccount(window.firstAt, window.lastAt, accountId);
    }
    return accountId;
}

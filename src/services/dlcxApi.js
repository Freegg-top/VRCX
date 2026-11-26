// DLCX 云端 API 客户端.
// 所有请求走 webApiService.execute (C# 侧代理出网, 天然无 CORS 问题),
// 先例参考 src/coordinators/avatarCoordinator.js 的 lookupAvatars (AVTRDB 调用).

import webApiService from './webapi';
import { useDLCXSettingsStore } from '../stores/settings/dlcx';
import { DLCX_API_BASE } from '../shared/constants/dlcx';

/**
 * DLCX API 统一错误. kind 供上层分支处理:
 * notConfigured 引导去设置面板填 key, unauthorized/forbidden 提示授权问题,
 * notFound 目标不存在, network 出网失败, server 其余服务端异常.
 */
class DLCXApiError extends Error {
    /**
     * @param {number} status HTTP 状态码, 网络层错误/未配置时为 0
     * @param {'unauthorized' | 'forbidden' | 'notFound' | 'server' | 'network' | 'notConfigured'} kind
     * @param {string} message
     * @param {ErrorOptions} [options]
     */
    constructor(status, kind, message, options) {
        super(message, options);
        this.name = 'DLCXApiError';
        this.status = status;
        this.kind = kind;
    }
}

/**
 * 当前配置的云端 API 根地址, 留空回退内置默认值.
 *
 * @returns {string}
 */
function getApiBase() {
    const dlcxSettingsStore = useDLCXSettingsStore();
    const base = String(dlcxSettingsStore.apiBase || '').trim();
    return (base || DLCX_API_BASE).replace(/\/+$/, '');
}

/**
 * 组装请求 URL. query 值经 URLSearchParams 编码 (location 中的冒号会转为 %3A).
 *
 * @param {string} path 以 / 开头的接口路径, path 参数须已 encodeURIComponent
 * @param {Record<string, string | number>} [query]
 * @returns {string}
 */
function buildUrl(path, query = {}) {
    const url = new URL(getApiBase() + path);
    Object.entries(query).forEach(([key, value]) => {
        url.searchParams.set(key, String(value));
    });
    return url.toString();
}

/**
 * 发送带 Bearer license 的 GET 请求并统一映射状态码.
 * 401/403 时同步回写全局 license 状态, 200 视为 license 有效.
 *
 * @param {string} path
 * @param {Record<string, string | number>} [query]
 * @returns {Promise<any>} 解析后的 JSON 响应体
 * @throws {DLCXApiError}
 */
async function request(path, query = {}) {
    const dlcxSettingsStore = useDLCXSettingsStore();
    const license = String(dlcxSettingsStore.licenseKey || '').trim();
    if (!license) {
        throw new DLCXApiError(0, 'notConfigured', 'DLCX license key is not configured');
    }
    /** @type {string} */
    let url;
    try {
        url = buildUrl(path, query);
    } catch (error) {
        // 非法 apiBase (如手滑填入非 URL 文本) → 统一映射为 notConfigured, 不抛裸 TypeError
        throw new DLCXApiError(0, 'notConfigured', 'DLCX apiBase is not a valid URL', { cause: error });
    }
    /** @type {{ status: number; data?: string }} */
    let response;
    try {
        response = await webApiService.execute({
            url,
            method: 'GET',
            headers: {
                Authorization: `Bearer ${license}`
            }
        });
    } catch (error) {
        // execute 在 Item1 === -1 时 throw (网络层错误), 不携带 HTTP 状态码
        throw new DLCXApiError(0, 'network', `DLCX request failed: ${url}`, { cause: error });
    }
    if (response.status === 401) {
        dlcxSettingsStore.setLicenseStatus('invalid');
        throw new DLCXApiError(401, 'unauthorized', 'DLCX license key is invalid');
    }
    if (response.status === 403) {
        dlcxSettingsStore.setLicenseStatus('expired');
        throw new DLCXApiError(403, 'forbidden', 'DLCX license key is revoked or expired');
    }
    if (response.status === 404) {
        throw new DLCXApiError(404, 'notFound', `DLCX target not found: ${path}`);
    }
    if (response.status !== 200) {
        throw new DLCXApiError(response.status, 'server', `DLCX server returned status ${response.status}`);
    }
    dlcxSettingsStore.setLicenseStatus('ok');
    try {
        return JSON.parse(String(response.data));
    } catch (error) {
        throw new DLCXApiError(response.status, 'server', 'DLCX returned invalid JSON', { cause: error });
    }
}

/**
 * 查询单个玩家的全站观测历史.
 *
 * @param {string} userId Usr_ 开头的用户 ID
 * @param {number} [limit]
 * @returns {Promise<{
 *     user: object;
 *     history: { at: string; location: string; world_id: string; instance_id: string }[];
 * }>}
 * @throws {DLCXApiError} User 不存在时 kind 为 notFound (HTTP 404)
 */
export async function getUserHistory(userId, limit = 200) {
    return request(`/v1/user/${encodeURIComponent(userId)}/history`, { limit });
}

/**
 * 查询单个玩家的同处 (co-seen) 关系列表.
 *
 * @param {string} userId Usr_ 开头的用户 ID
 * @param {number} [limit]
 * @returns {Promise<{
 *     results: {
 *         other_id: string;
 *         display_name: string;
 *         avatar_url: string;
 *         instance_id: string;
 *         co_seen_count: number;
 *         first_seen: string;
 *         last_seen: string;
 *     }[];
 * }>}
 * @throws {DLCXApiError}
 */
export async function getUserConnections(userId, limit = 50) {
    return request(`/v1/connections/${encodeURIComponent(userId)}`, { limit });
}

/**
 * 查询某实例内的观测名单. loc 为完整 location (如 wrld_xxx:12345), 冒号自动 URL 编码;
 * 不存在的 loc 返回 200 + 空 results. display_name 可能为空串 (UI 须兜底显示 user_id).
 *
 * @param {string} loc 完整 location
 * @param {number} [limit]
 * @returns {Promise<{
 *     results: { user_id: string; display_name: string; at: string; location: string; world_id: string }[];
 * }>}
 * @throws {DLCXApiError}
 */
export async function getInstanceRoster(loc, limit = 200) {
    return request(`/v1/instance/${encodeURIComponent(loc)}`, { limit });
}

/**
 * 探测响应状态码 → license 状态映射.
 *
 * @param {number} status
 * @returns {'ok' | 'invalid' | 'expired' | 'offline'}
 */
function mapProbeStatus(status) {
    if (status === 200) {
        return 'ok';
    }
    if (status === 401) {
        return 'invalid';
    }
    if (status === 403) {
        return 'expired';
    }
    return 'offline';
}

/**
 * License 认证探测: 借一个不存在的观测 world (契约保证 200 + 空名单) 发轻量请求,
 * 按状态码映射 license 状态并写回 store, 不抛错.
 * 未配置 license 时不发请求, 直接记为 invalid.
 *
 * @returns {Promise<'invalid' | 'ok' | 'expired' | 'offline'>} 探测后的 license 状态
 */
export async function probeLicense() {
    const dlcxSettingsStore = useDLCXSettingsStore();
    const license = String(dlcxSettingsStore.licenseKey || '').trim();
    if (!license) {
        dlcxSettingsStore.setLicenseStatus('invalid');
        return 'invalid';
    }
    dlcxSettingsStore.setLicenseStatus('checking');
    /** @type {'invalid' | 'ok' | 'expired' | 'offline'} */
    let result;
    try {
        const response = await webApiService.execute({
            url: buildUrl(`/v1/instance/${encodeURIComponent('wrld_dlcx-probe:0')}`, { limit: 1 }),
            method: 'GET',
            headers: {
                Authorization: `Bearer ${license}`
            }
        });
        result = mapProbeStatus(response.status);
    } catch {
        result = 'offline';
    }
    dlcxSettingsStore.setLicenseStatus(result);
    return result;
}

export { DLCXApiError };

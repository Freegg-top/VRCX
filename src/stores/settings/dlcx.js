import { ref } from 'vue';
import { defineStore } from 'pinia';

import { DLCX_API_BASE, DLCX_CONFIG_KEYS, DLCX_LICENSE_STATUSES } from '../../shared/constants/dlcx';

import configRepository from '../../services/config';

/**
 * 校验并规范化关注用户 ID: trim + 转小写 + usr_ 前缀.
 *
 * @param {unknown} id
 * @returns {string} 合法返回规范化 ID, 否则返回空串
 */
function normalizeWatchId(id) {
    const userId = String(id ?? '')
        .trim()
        .toLowerCase();
    return /^usr_[a-z0-9-]+$/.test(userId) ? userId : '';
}

/**
 * 解析 watchlist 存储值: 非法 JSON / 非数组回退空列表, 逐项校验去重.
 *
 * @param {string} raw
 * @returns {string[]}
 */
function parseWatchlist(raw) {
    let parsed = null;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) {
        return [];
    }
    return Array.from(new Set(parsed.map((id) => normalizeWatchId(id)).filter((id) => id)));
}

function invalidateCloudUserDataCaches() {
    // Dynamic imports keep the one-way store -> service dependency explicit and
    // avoid the services barrel re-entering this store during module setup.
    void Promise.all([import('../../services/dlcxUserData'), import('../../services/dlcxUserCardData')])
        .then(([userData, userCardData]) => {
            userData.invalidateMyCloudConnections();
            userCardData.clearCloudObservationCache();
        })
        .catch((error) => {
            console.error('[dlcx] failed to invalidate cloud user data caches:', error);
        });
}

export const useDLCXSettingsStore = defineStore('DLCXSettings', () => {
    const licenseKey = ref('');
    const apiBase = ref(DLCX_API_BASE);
    const watchlist = ref([]);
    // 功能开关 D1~D6
    const enableTrace = ref(true);
    const enableWatchPush = ref(true);
    const enableBlockAlerts = ref(true);
    // 房间名单上传涉及隐私, 仅用户显式开启后工作.
    const ingestEnabled = ref(false);
    // 非持久化: license 校验状态, 由 dlcxApi 探测/回写
    const licenseStatus = ref('unknown');

    async function initDLCXSettings() {
        const [
            licenseKeyConfig,
            apiBaseConfig,
            watchlistConfig,
            enableTraceConfig,
            enableWatchPushConfig,
            enableBlockAlertsConfig,
            ingestEnabledConfig
        ] = await Promise.all([
            configRepository.getString(DLCX_CONFIG_KEYS.licenseKey, ''),
            configRepository.getString(DLCX_CONFIG_KEYS.apiBase, DLCX_API_BASE),
            configRepository.getString(DLCX_CONFIG_KEYS.watchlist, '[]'),
            configRepository.getBool(DLCX_CONFIG_KEYS.enableTrace, true),
            configRepository.getBool(DLCX_CONFIG_KEYS.enableWatchPush, true),
            configRepository.getBool(DLCX_CONFIG_KEYS.enableBlockAlerts, true),
            configRepository.getBool(DLCX_CONFIG_KEYS.ingestEnabled, false)
        ]);

        licenseKey.value = licenseKeyConfig || '';
        apiBase.value = String(apiBaseConfig || '').trim() || DLCX_API_BASE;
        watchlist.value = parseWatchlist(watchlistConfig);
        enableTrace.value = enableTraceConfig;
        enableWatchPush.value = enableWatchPushConfig;
        enableBlockAlerts.value = enableBlockAlertsConfig;
        ingestEnabled.value = ingestEnabledConfig;
    }

    const readyPromise = initDLCXSettings();

    /**
     * 等待异步配置加载完成, 供依赖已持久化开关/名单的协调器使用.
     *
     * @returns {Promise<void>}
     */
    function ensureDLCXSettingsReady() {
        return readyPromise;
    }

    /**
     * @param {string} status
     */
    function setLicenseStatus(status) {
        if (!DLCX_LICENSE_STATUSES.includes(status)) {
            return;
        }
        licenseStatus.value = status;
    }

    /**
     * 保存 license key (trim 后持久化). 调用方负责随后触发 probeLicense.
     *
     * @param {string} value
     */
    function setLicenseKey(value) {
        licenseKey.value = String(value ?? '').trim();
        configRepository.setString(DLCX_CONFIG_KEYS.licenseKey, licenseKey.value);
        invalidateCloudUserDataCaches();
    }

    /**
     * 保存云端 API 根地址, 留空恢复内置默认值.
     *
     * @param {string} value
     */
    function setApiBase(value) {
        const base = String(value ?? '')
            .trim()
            .replace(/\/+$/, '');
        apiBase.value = base || DLCX_API_BASE;
        configRepository.setString(DLCX_CONFIG_KEYS.apiBase, apiBase.value);
        invalidateCloudUserDataCaches();
    }

    function setEnableTrace() {
        enableTrace.value = !enableTrace.value;
        configRepository.setBool(DLCX_CONFIG_KEYS.enableTrace, enableTrace.value);
    }

    function setEnableWatchPush() {
        enableWatchPush.value = !enableWatchPush.value;
        configRepository.setBool(DLCX_CONFIG_KEYS.enableWatchPush, enableWatchPush.value);
    }

    function setEnableBlockAlerts() {
        enableBlockAlerts.value = !enableBlockAlerts.value;
        configRepository.setBool(DLCX_CONFIG_KEYS.enableBlockAlerts, enableBlockAlerts.value);
    }

    function setIngestEnabled() {
        ingestEnabled.value = !ingestEnabled.value;
        configRepository.setBool(DLCX_CONFIG_KEYS.ingestEnabled, ingestEnabled.value);
    }

    /**
     * 加入关注名单: 校验 usr_ 前缀、转小写、去重并持久化.
     *
     * @param {string} id
     * @returns {boolean} 是否新增成功 (非法 ID 或已存在返回 false)
     */
    function addWatch(id) {
        const userId = normalizeWatchId(id);
        if (!userId || watchlist.value.includes(userId)) {
            return false;
        }
        watchlist.value = [...watchlist.value, userId];
        configRepository.setString(DLCX_CONFIG_KEYS.watchlist, JSON.stringify(watchlist.value));
        return true;
    }

    /**
     * @param {string} id
     * @returns {boolean} 是否移除了条目
     */
    function removeWatch(id) {
        const userId = String(id ?? '')
            .trim()
            .toLowerCase();
        if (!watchlist.value.includes(userId)) {
            return false;
        }
        watchlist.value = watchlist.value.filter((watchId) => watchId !== userId);
        configRepository.setString(DLCX_CONFIG_KEYS.watchlist, JSON.stringify(watchlist.value));
        return true;
    }

    return {
        licenseKey,
        apiBase,
        watchlist,
        enableTrace,
        enableWatchPush,
        enableBlockAlerts,
        ingestEnabled,
        licenseStatus,

        initDLCXSettings,
        ensureDLCXSettingsReady,
        setLicenseStatus,
        setLicenseKey,
        setApiBase,
        setEnableTrace,
        setEnableWatchPush,
        setEnableBlockAlerts,
        setIngestEnabled,
        addWatch,
        removeWatch
    };
});

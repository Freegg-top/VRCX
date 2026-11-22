import { ref } from 'vue';
import { defineStore } from 'pinia';

import { OVERSEE_API_BASE, OVERSEE_CONFIG_KEYS, OVERSEE_LICENSE_STATUSES } from '../../shared/constants/oversee';

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

export const useOverseeSettingsStore = defineStore('OverseeSettings', () => {
    const licenseKey = ref('');
    const apiBase = ref(OVERSEE_API_BASE);
    const watchlist = ref([]);
    const sseEnabled = ref(true);
    // 功能开关 D1~D6
    const enableTrace = ref(true);
    const enableEncounters = ref(true);
    const enableWatchPush = ref(true);
    const enableRoomLookup = ref(true);
    const enableNetwork = ref(true);
    const enableBlockAlerts = ref(true);
    // 非持久化: license 校验状态, 由 overseeApi 探测/回写
    const licenseStatus = ref('unknown');

    async function initOverseeSettings() {
        const [
            licenseKeyConfig,
            apiBaseConfig,
            watchlistConfig,
            sseEnabledConfig,
            enableTraceConfig,
            enableEncountersConfig,
            enableWatchPushConfig,
            enableRoomLookupConfig,
            enableNetworkConfig,
            enableBlockAlertsConfig
        ] = await Promise.all([
            configRepository.getString(OVERSEE_CONFIG_KEYS.licenseKey, ''),
            configRepository.getString(OVERSEE_CONFIG_KEYS.apiBase, OVERSEE_API_BASE),
            configRepository.getString(OVERSEE_CONFIG_KEYS.watchlist, '[]'),
            configRepository.getBool(OVERSEE_CONFIG_KEYS.sseEnabled, true),
            configRepository.getBool(OVERSEE_CONFIG_KEYS.enableTrace, true),
            configRepository.getBool(OVERSEE_CONFIG_KEYS.enableEncounters, true),
            configRepository.getBool(OVERSEE_CONFIG_KEYS.enableWatchPush, true),
            configRepository.getBool(OVERSEE_CONFIG_KEYS.enableRoomLookup, true),
            configRepository.getBool(OVERSEE_CONFIG_KEYS.enableNetwork, true),
            configRepository.getBool(OVERSEE_CONFIG_KEYS.enableBlockAlerts, true)
        ]);

        licenseKey.value = licenseKeyConfig || '';
        apiBase.value = String(apiBaseConfig || '').trim() || OVERSEE_API_BASE;
        watchlist.value = parseWatchlist(watchlistConfig);
        sseEnabled.value = sseEnabledConfig;
        enableTrace.value = enableTraceConfig;
        enableEncounters.value = enableEncountersConfig;
        enableWatchPush.value = enableWatchPushConfig;
        enableRoomLookup.value = enableRoomLookupConfig;
        enableNetwork.value = enableNetworkConfig;
        enableBlockAlerts.value = enableBlockAlertsConfig;
    }

    initOverseeSettings();

    /**
     * @param {string} status
     */
    function setLicenseStatus(status) {
        if (!OVERSEE_LICENSE_STATUSES.includes(status)) {
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
        configRepository.setString(OVERSEE_CONFIG_KEYS.licenseKey, licenseKey.value);
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
        apiBase.value = base || OVERSEE_API_BASE;
        configRepository.setString(OVERSEE_CONFIG_KEYS.apiBase, apiBase.value);
    }

    function setSseEnabled() {
        sseEnabled.value = !sseEnabled.value;
        configRepository.setBool(OVERSEE_CONFIG_KEYS.sseEnabled, sseEnabled.value);
    }

    function setEnableTrace() {
        enableTrace.value = !enableTrace.value;
        configRepository.setBool(OVERSEE_CONFIG_KEYS.enableTrace, enableTrace.value);
    }

    function setEnableEncounters() {
        enableEncounters.value = !enableEncounters.value;
        configRepository.setBool(OVERSEE_CONFIG_KEYS.enableEncounters, enableEncounters.value);
    }

    function setEnableWatchPush() {
        enableWatchPush.value = !enableWatchPush.value;
        configRepository.setBool(OVERSEE_CONFIG_KEYS.enableWatchPush, enableWatchPush.value);
    }

    function setEnableRoomLookup() {
        enableRoomLookup.value = !enableRoomLookup.value;
        configRepository.setBool(OVERSEE_CONFIG_KEYS.enableRoomLookup, enableRoomLookup.value);
    }

    function setEnableNetwork() {
        enableNetwork.value = !enableNetwork.value;
        configRepository.setBool(OVERSEE_CONFIG_KEYS.enableNetwork, enableNetwork.value);
    }

    function setEnableBlockAlerts() {
        enableBlockAlerts.value = !enableBlockAlerts.value;
        configRepository.setBool(OVERSEE_CONFIG_KEYS.enableBlockAlerts, enableBlockAlerts.value);
    }

    /**
     * 加入关注名单: 校验 usr_ 前缀、转小写、去重.
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
        configRepository.setString(OVERSEE_CONFIG_KEYS.watchlist, JSON.stringify(watchlist.value));
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
        configRepository.setString(OVERSEE_CONFIG_KEYS.watchlist, JSON.stringify(watchlist.value));
        return true;
    }

    /**
     * @param {string} id
     * @returns {boolean}
     */
    function isWatched(id) {
        const userId = String(id ?? '')
            .trim()
            .toLowerCase();
        return watchlist.value.includes(userId);
    }

    return {
        licenseKey,
        apiBase,
        watchlist,
        sseEnabled,
        enableTrace,
        enableEncounters,
        enableWatchPush,
        enableRoomLookup,
        enableNetwork,
        enableBlockAlerts,
        licenseStatus,

        initOverseeSettings,
        setLicenseStatus,
        setLicenseKey,
        setApiBase,
        setSseEnabled,
        setEnableTrace,
        setEnableEncounters,
        setEnableWatchPush,
        setEnableRoomLookup,
        setEnableNetwork,
        setEnableBlockAlerts,
        addWatch,
        removeWatch,
        isWatched
    };
});

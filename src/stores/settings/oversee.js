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

function invalidateCloudUserDataCaches() {
    // Dynamic imports keep the one-way store -> service dependency explicit and
    // avoid the services barrel re-entering this store during module setup.
    void Promise.all([import('../../services/overseeUserData'), import('../../services/overseeUserCardData')])
        .then(([userData, userCardData]) => {
            userData.invalidateMyCloudConnections();
            userCardData.clearCloudObservationCache();
        })
        .catch((error) => {
            console.error('[oversee] failed to invalidate cloud user data caches:', error);
        });
}

export const useOverseeSettingsStore = defineStore('OverseeSettings', () => {
    const licenseKey = ref('');
    const apiBase = ref(OVERSEE_API_BASE);
    const watchlist = ref([]);
    const syncWatched = ref(true);
    const sseEnabled = ref(true);
    // 功能开关 D1~D6
    const enableTrace = ref(true);
    const enableWatchPush = ref(true);
    const enableRoomLookup = ref(true);
    const enableBlockAlerts = ref(true);
    // 非持久化: license 校验状态, 由 overseeApi 探测/回写
    const licenseStatus = ref('unknown');

    async function initOverseeSettings() {
        const [
            licenseKeyConfig,
            apiBaseConfig,
            watchlistConfig,
            syncWatchedConfig,
            sseEnabledConfig,
            enableTraceConfig,
            enableWatchPushConfig,
            enableRoomLookupConfig,
            enableBlockAlertsConfig
        ] = await Promise.all([
            configRepository.getString(OVERSEE_CONFIG_KEYS.licenseKey, ''),
            configRepository.getString(OVERSEE_CONFIG_KEYS.apiBase, OVERSEE_API_BASE),
            configRepository.getString(OVERSEE_CONFIG_KEYS.watchlist, '[]'),
            configRepository.getBool(OVERSEE_CONFIG_KEYS.syncWatched, true),
            configRepository.getBool(OVERSEE_CONFIG_KEYS.sseEnabled, true),
            configRepository.getBool(OVERSEE_CONFIG_KEYS.enableTrace, true),
            configRepository.getBool(OVERSEE_CONFIG_KEYS.enableWatchPush, true),
            configRepository.getBool(OVERSEE_CONFIG_KEYS.enableRoomLookup, true),
            configRepository.getBool(OVERSEE_CONFIG_KEYS.enableBlockAlerts, true)
        ]);

        licenseKey.value = licenseKeyConfig || '';
        apiBase.value = String(apiBaseConfig || '').trim() || OVERSEE_API_BASE;
        watchlist.value = parseWatchlist(watchlistConfig);
        syncWatched.value = syncWatchedConfig;
        sseEnabled.value = sseEnabledConfig;
        enableTrace.value = enableTraceConfig;
        enableWatchPush.value = enableWatchPushConfig;
        enableRoomLookup.value = enableRoomLookupConfig;
        enableBlockAlerts.value = enableBlockAlertsConfig;
    }

    const readyPromise = initOverseeSettings();

    /**
     * 等待异步配置加载完成, 供依赖已持久化开关/名单的协调器使用.
     *
     * @returns {Promise<void>}
     */
    function ensureOverseeSettingsReady() {
        return readyPromise;
    }

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
        apiBase.value = base || OVERSEE_API_BASE;
        configRepository.setString(OVERSEE_CONFIG_KEYS.apiBase, apiBase.value);
        invalidateCloudUserDataCaches();
    }

    function setSyncWatched() {
        syncWatched.value = !syncWatched.value;
        configRepository.setBool(OVERSEE_CONFIG_KEYS.syncWatched, syncWatched.value);
    }

    function setSseEnabled() {
        sseEnabled.value = !sseEnabled.value;
        configRepository.setBool(OVERSEE_CONFIG_KEYS.sseEnabled, sseEnabled.value);
    }

    function setEnableTrace() {
        enableTrace.value = !enableTrace.value;
        configRepository.setBool(OVERSEE_CONFIG_KEYS.enableTrace, enableTrace.value);
    }

    function setEnableWatchPush() {
        enableWatchPush.value = !enableWatchPush.value;
        configRepository.setBool(OVERSEE_CONFIG_KEYS.enableWatchPush, enableWatchPush.value);
    }

    function setEnableRoomLookup() {
        enableRoomLookup.value = !enableRoomLookup.value;
        configRepository.setBool(OVERSEE_CONFIG_KEYS.enableRoomLookup, enableRoomLookup.value);
    }

    function setEnableBlockAlerts() {
        enableBlockAlerts.value = !enableBlockAlerts.value;
        configRepository.setBool(OVERSEE_CONFIG_KEYS.enableBlockAlerts, enableBlockAlerts.value);
    }

    /**
     * Await the full watchlist write and verify it by reading the value back.
     * A failed write or mismatched readback is retried once and then logged.
     *
     * @returns {Promise<boolean>}
     */
    async function persistWatchlist() {
        let lastError = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            const serialized = JSON.stringify(watchlist.value);
            try {
                await configRepository.setString(OVERSEE_CONFIG_KEYS.watchlist, serialized);
                const stored = await configRepository.getString(OVERSEE_CONFIG_KEYS.watchlist, '[]');
                if (stored === JSON.stringify(watchlist.value)) {
                    return true;
                }
                lastError = new Error('Oversee watchlist readback did not match the in-memory list');
            } catch (error) {
                lastError = error;
            }
        }
        console.error('[oversee] failed to persist watchlist:', lastError);
        return false;
    }

    /**
     * 加入关注名单: 校验 usr_ 前缀、转小写、去重.
     * 批量对账传 persist=false 抑制逐条写库, 末尾统一 persistWatchlist.
     *
     * @param {string} id
     * @param {boolean} [persist]
     * @returns {boolean} 是否新增成功 (非法 ID 或已存在返回 false)
     */
    function addWatch(id, persist = true) {
        const userId = normalizeWatchId(id);
        if (!userId || watchlist.value.includes(userId)) {
            return false;
        }
        watchlist.value = [...watchlist.value, userId];
        if (persist) {
            configRepository.setString(OVERSEE_CONFIG_KEYS.watchlist, JSON.stringify(watchlist.value));
        }
        return true;
    }

    /**
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async function addWatchPersisted(id) {
        return addWatch(id, false) ? persistWatchlist() : false;
    }

    /**
     * @param {string} id
     * @param {boolean} [persist]
     * @returns {boolean} 是否移除了条目
     */
    function removeWatch(id, persist = true) {
        const userId = String(id ?? '')
            .trim()
            .toLowerCase();
        if (!watchlist.value.includes(userId)) {
            return false;
        }
        watchlist.value = watchlist.value.filter((watchId) => watchId !== userId);
        if (persist) {
            configRepository.setString(OVERSEE_CONFIG_KEYS.watchlist, JSON.stringify(watchlist.value));
        }
        return true;
    }

    /**
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async function removeWatchPersisted(id) {
        return removeWatch(id, false) ? persistWatchlist() : false;
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
        syncWatched,
        sseEnabled,
        enableTrace,
        enableWatchPush,
        enableRoomLookup,
        enableBlockAlerts,
        licenseStatus,

        initOverseeSettings,
        ensureOverseeSettingsReady,
        setLicenseStatus,
        setLicenseKey,
        setApiBase,
        setSyncWatched,
        setSseEnabled,
        setEnableTrace,
        setEnableWatchPush,
        setEnableRoomLookup,
        setEnableBlockAlerts,
        persistWatchlist,
        addWatch,
        addWatchPersisted,
        removeWatch,
        removeWatchPersisted,
        isWatched
    };
});

// Oversee 云端监察功能常量: 云端 API 默认地址、configs 存储键名与各类状态枚举

// Oversee 云端 API 默认服务地址 (可在设置面板覆盖)
const OVERSEE_API_BASE = 'https://api.freegg.top';

// configs 表存储键名 (经 configRepository 持久化到 C# 侧)
const OVERSEE_CONFIG_KEYS = Object.freeze({
    licenseKey: 'VRCX_oversee_licenseKey',
    apiBase: 'VRCX_oversee_apiBase',
    watchlist: 'VRCX_oversee_watchlist',
    watchedSync: 'VRCX_oversee_watchedSync',
    watchedIgnore: 'VRCX_oversee_watched_ignore',
    syncWatched: 'VRCX_oversee_syncWatched',
    sseEnabled: 'VRCX_oversee_sseEnabled',
    enableTrace: 'VRCX_oversee_enableTrace',
    enableWatchPush: 'VRCX_oversee_enableWatchPush',
    enableRoomLookup: 'VRCX_oversee_enableRoomLookup',
    enableBlockAlerts: 'VRCX_oversee_enableBlockAlerts'
});

// license 校验状态机取值 (非持久化, 由 overseeApi 探测/回写)
const OVERSEE_LICENSE_STATUSES = Object.freeze(['unknown', 'checking', 'ok', 'invalid', 'expired', 'offline']);

export { OVERSEE_API_BASE, OVERSEE_CONFIG_KEYS, OVERSEE_LICENSE_STATUSES };

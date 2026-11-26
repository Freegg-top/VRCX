// DLCX 云端监察功能常量: 云端 API 默认地址、configs 存储键名与各类状态枚举

// DLCX 云端 API 默认服务地址 (可在设置面板覆盖)
const DLCX_API_BASE = 'https://api.freegg.top';

// configs 表存储键名 (经 configRepository 持久化到 C# 侧)
const DLCX_CONFIG_KEYS = Object.freeze({
    licenseKey: 'VRCX_oversee_licenseKey',
    apiBase: 'VRCX_oversee_apiBase',
    watchlist: 'VRCX_oversee_watchlist',
    enableTrace: 'VRCX_oversee_enableTrace',
    enableWatchPush: 'VRCX_oversee_enableWatchPush',
    enableBlockAlerts: 'VRCX_oversee_enableBlockAlerts',
    ingestEnabled: 'VRCX_oversee_ingestEnabled'
});

// license 校验状态机取值 (非持久化, 由 dlcxApi 探测/回写)
const DLCX_LICENSE_STATUSES = Object.freeze(['unknown', 'checking', 'ok', 'invalid', 'expired', 'offline']);

export { DLCX_API_BASE, DLCX_CONFIG_KEYS, DLCX_LICENSE_STATUSES };

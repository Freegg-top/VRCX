const VRChatScreenshotResolutions = [
    { name: '1280x720 (720p)', width: 1280, height: 720 },
    { name: '1920x1080 (1080p Default)', width: '', height: '' },
    { name: '2560x1440 (1440p)', width: 2560, height: 1440 },
    { name: '3840x2160 (4K)', width: 3840, height: 2160 }
];

const VRChatCameraResolutions = [
    { name: '1280x720 (720p)', width: 1280, height: 720 },
    { name: '1920x1080 (1080p Default)', width: '', height: '' },
    { name: '2560x1440 (1440p)', width: 2560, height: 1440 },
    { name: '3840x2160 (4K)', width: 3840, height: 2160 },
    { name: '7680x4320 (8K)', width: 7680, height: 4320 }
];

// 官方分支: 稳定版/测试版展示并安装官方 VRCX 版本（GitHub）
const OFFICIAL_RELEASES_URL = 'https://api.github.com/repos/rs189/VRCX/releases';
const OFFICIAL_LATEST_URL = 'https://api.github.com/repos/rs189/VRCX/releases/latest';
// 拓展版: freegg 自定义分发分支，更新始终手动确认（不静默下载）
const CUSTOM_UPDATE_BASE = 'https://s3.freegg.top/vrcx';
const branches = {
    Stable: {
        name: 'Stable',
        urlReleases: OFFICIAL_RELEASES_URL,
        urlLatest: OFFICIAL_LATEST_URL
    },
    Nightly: {
        name: 'Nightly',
        urlReleases: OFFICIAL_RELEASES_URL,
        urlLatest: OFFICIAL_LATEST_URL
    },
    Custom: {
        name: 'Custom',
        urlReleases: `${CUSTOM_UPDATE_BASE}/releases.json`,
        urlLatest: `${CUSTOM_UPDATE_BASE}/latest.json`
    }
};

const TABLE_MAX_SIZE_MIN = 100;
const TABLE_MAX_SIZE_MAX = 10000;

const SEARCH_LIMIT_MIN = 10000;
const SEARCH_LIMIT_MAX = 100000;

const DEFAULT_MAX_TABLE_SIZE = 500;
const DEFAULT_SEARCH_LIMIT = 50000;

export {
    VRChatScreenshotResolutions,
    VRChatCameraResolutions,
    branches,
    TABLE_MAX_SIZE_MIN,
    TABLE_MAX_SIZE_MAX,
    SEARCH_LIMIT_MIN,
    SEARCH_LIMIT_MAX,
    DEFAULT_MAX_TABLE_SIZE,
    DEFAULT_SEARCH_LIMIT
};

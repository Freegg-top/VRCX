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

// 自定义分发: 更新检查走自己的服务器 (改为你的服务器地址后生效)
// 服务器需提供 latest.json (GitHub releases/latest 同形状) 和更新包 zip
const CUSTOM_UPDATE_BASE = 'https://s3.freegg.top/vrcx';
const branches = {
    Stable: {
        name: 'Stable',
        urlReleases: `${CUSTOM_UPDATE_BASE}/releases.json`,
        urlLatest: `${CUSTOM_UPDATE_BASE}/latest.json`
    },
    Nightly: {
        name: 'Nightly',
        urlReleases: `${CUSTOM_UPDATE_BASE}/releases.json`,
        urlLatest: `${CUSTOM_UPDATE_BASE}/latest.json`
    },
    // 拓展版: freegg 自定义分发分支，更新始终手动确认（不静默下载）
    Custom: {
        name: 'Custom',
        urlReleases: `${CUSTOM_UPDATE_BASE}/releases.json`,
        urlLatest: `${CUSTOM_UPDATE_BASE}/latest.json`
    }
    // LinuxTest: {
    //     name: 'LinuxTest',
    //     urlReleases: 'https://api.github.com/repos/rs189/VRCX/releases',
    //     urlLatest:
    //         'https://api.github.com/repos/rs189/VRCX/releases/latest'
    // }
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

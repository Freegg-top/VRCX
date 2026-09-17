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

// 拓展版 (DLC) 更新源: 改为你网站的实际地址后生效
// 服务器需提供 releases.json (历史版本数组, GitHub releases 同形状)
// 与 latest.json (最新版本检查)
const DLC_UPDATE_BASE = 'https://s3.freegg.top/vrcx';

const branches = {
    Stable: {
        name: 'Stable',
        urlReleases: 'https://api0.vrcx.app/releases/stable',
        urlLatest: 'https://api0.vrcx.app/releases/stable/latest',
        dlc: false
    },
    Nightly: {
        name: 'Nightly',
        urlReleases: 'https://api0.vrcx.app/releases/nightly',
        urlLatest: 'https://api0.vrcx.app/releases/nightly/latest',
        dlc: false
    },
    DLC: {
        name: 'DLC',
        urlReleases: `${DLC_UPDATE_BASE}/releases.json`,
        urlLatest: `${DLC_UPDATE_BASE}/latest.json`,
        dlc: true
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

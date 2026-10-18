/**
 * VRChat 官方头像性能评级阈值。每个指标是 [Excellent, Good, Medium, Poor] 四档上限,
 * 落在哪一档由"值 <= 上限"决定, 超过 Poor 即 VeryPoor。
 * 2026-09-29 已逐行核对 creators.vrchat.com/avatars/avatar-performance-ranking-system
 */
const PERFORMANCE_RANKS = ['Excellent', 'Good', 'Medium', 'Poor', 'VeryPoor'];

// 包围盒上限是三轴分别比较, PC 与 Mobile 官方表里同一行, 所以不进各平台的标量表
const BOUNDS_METRIC = 'bounds';
const PERFORMANCE_BOUNDS_LIMITS = [
    [2.5, 2.5, 2.5],
    [4, 4, 4],
    [5, 6, 5],
    [5, 6, 5]
];

const PC_PERFORMANCE_LIMITS = {
    totalPolygons: [32000, 70000, 70000, 70000],
    totalTextureUsage: [40, 75, 110, 150],
    skinnedMeshCount: [1, 2, 8, 16],
    meshCount: [4, 8, 16, 24],
    materialSlotsUsed: [4, 8, 16, 32],
    physBoneComponentCount: [4, 8, 16, 32],
    physBoneTransformCount: [16, 64, 128, 256],
    physBoneColliderCount: [4, 8, 16, 32],
    physBoneCollisionCheckCount: [32, 128, 256, 512],
    contactCount: [8, 16, 24, 32],
    constraintCount: [100, 250, 300, 350],
    constraintDepth: [20, 50, 80, 100],
    animatorCount: [1, 4, 16, 32],
    boneCount: [75, 150, 256, 400],
    lightCount: [0, 0, 0, 1],
    particleSystemCount: [0, 4, 8, 16],
    totalMaxParticles: [0, 300, 1000, 2500],
    meshParticleMaxPolygons: [0, 1000, 2000, 5000],
    particleTrailsEnabled: [0, 0, 1, 1],
    particleCollisionEnabled: [0, 0, 1, 1],
    trailRendererCount: [1, 2, 4, 8],
    lineRendererCount: [1, 2, 4, 8],
    raycastCount: [1, 4, 8, 15],
    clothCount: [0, 1, 1, 1],
    totalClothVertices: [0, 50, 100, 200],
    physicsColliders: [0, 1, 8, 8],
    physicsRigidbodies: [0, 1, 8, 8],
    audioSourceCount: [1, 4, 8, 8]
};

const MOBILE_PERFORMANCE_LIMITS = {
    totalPolygons: [7500, 10000, 15000, 20000],
    totalTextureUsage: [10, 18, 25, 40],
    skinnedMeshCount: [1, 1, 2, 2],
    meshCount: [1, 1, 2, 2],
    materialSlotsUsed: [1, 1, 2, 4],
    animatorCount: [1, 1, 1, 2],
    boneCount: [75, 90, 150, 150],
    physBoneComponentCount: [0, 4, 6, 8],
    physBoneTransformCount: [0, 16, 32, 64],
    physBoneColliderCount: [0, 4, 8, 16],
    physBoneCollisionCheckCount: [0, 16, 32, 64],
    contactCount: [2, 4, 8, 16],
    constraintCount: [30, 60, 120, 150],
    constraintDepth: [5, 15, 35, 50],
    particleSystemCount: [0, 0, 0, 2],
    totalMaxParticles: [0, 0, 0, 200],
    meshParticleMaxPolygons: [0, 0, 0, 400],
    particleTrailsEnabled: [0, 0, 0, 1],
    particleCollisionEnabled: [0, 0, 0, 1],
    trailRendererCount: [0, 0, 0, 1],
    lineRendererCount: [0, 0, 0, 1]
};

// analysis 接口给的是字节, 官方阈值表写的是 "MB"。按 1048576 当作 MiB 处理,
// 与 1000000 的差别在 40 档上约 5%, 只影响恰好卡边界的极少数头像
const BYTES_PER_MIB = 1048576;
const TEXTURE_METRIC = 'totalTextureUsage';
const VERY_POOR_INDEX = PERFORMANCE_RANKS.length - 1;

/**
 * @param {string} platform VRChat 的 unityPackages.platform 取值
 * @returns {'pc' | 'mobile'}
 */
function platformFamily(platform) {
    return platform === 'standalonewindows' ? 'pc' : 'mobile';
}

/**
 * @param {string} key
 * @param {'pc' | 'mobile'} family
 * @returns {number[] | undefined} 该平台不考核这个指标时为 undefined
 */
function limitsFor(key, family) {
    const table = family === 'pc' ? PC_PERFORMANCE_LIMITS : MOBILE_PERFORMANCE_LIMITS;
    return table[key];
}

/**
 * @param {string} key
 * @param {'pc' | 'mobile'} family
 * @returns {boolean} 该指标在平台上限表里出现, 即参与评分
 */
function isScoredMetric(key, family) {
    if (key === BOUNDS_METRIC) {
        return true;
    }
    return limitsFor(key, family) !== undefined;
}

/**
 * 包围盒按三轴同时比较, 取第一个"三轴都装得下"的档位。
 *
 * @param {number[]} axes
 * @returns {{ rank: string; maximum: number[]; ratio: number } | null}
 */
function assessBounds(axes) {
    if (!Array.isArray(axes) || axes.length !== 3 || !axes.every((axis) => Number.isFinite(axis))) {
        return null;
    }
    let index = PERFORMANCE_BOUNDS_LIMITS.findIndex((limits) =>
        axes.every((axis, axisIndex) => axis <= limits[axisIndex])
    );
    if (index < 0) {
        index = VERY_POOR_INDEX;
    }
    const maximum = PERFORMANCE_BOUNDS_LIMITS[PERFORMANCE_BOUNDS_LIMITS.length - 1];
    const ratio = Math.max(...axes.map((axis, axisIndex) => axis / maximum[axisIndex]));
    return { rank: PERFORMANCE_RANKS[index], maximum, ratio };
}

/**
 * 上限为 0 的档位表示"不允许存在", 所以 value 为 0 时也算 Excellent。
 *
 * @param {number} value
 * @param {number[]} limits
 * @returns {{ rank: string; maximum: number; ratio: number } | null}
 */
function assessAgainstLimits(value, limits) {
    if (!Array.isArray(limits) || !Number.isFinite(value)) {
        return null;
    }
    let index = limits.findIndex((limit) => value <= limit);
    if (index < 0) {
        index = VERY_POOR_INDEX;
    }
    const maximum = limits[limits.length - 1];
    let ratio = 0;
    if (maximum > 0) {
        ratio = value / maximum;
    } else if (value > 0) {
        ratio = Infinity;
    }
    return { rank: PERFORMANCE_RANKS[index], maximum, ratio };
}

/**
 * @param {string} key AvatarStats 字段名
 * @param {unknown} value 接口返回值（包围盒指标为三轴数组）
 * @param {string} platform UnityPackages.platform
 * @returns {{
 *     rank: string | null;
 *     maximum: number | number[] | null;
 *     ratio: number | null;
 *     scored: boolean;
 *     value: unknown;
 * }}
 */
function assessStat(key, value, platform) {
    const family = platformFamily(platform);
    const scored = isScoredMetric(key, family);
    if (key === BOUNDS_METRIC) {
        const axes = Array.isArray(value) ? value : null;
        const assessed = axes ? assessBounds(axes) : null;
        if (!assessed) {
            return { rank: null, maximum: null, ratio: null, scored, value: null };
        }
        return { rank: assessed.rank, maximum: assessed.maximum, ratio: assessed.ratio, scored, value: value };
    }
    const numeric = typeof value === 'boolean' ? Number(value) : Number(value);
    if (!scored || !Number.isFinite(numeric)) {
        return { rank: null, maximum: null, ratio: null, scored, value: Number.isFinite(numeric) ? numeric : null };
    }
    const compared = key === TEXTURE_METRIC ? numeric / BYTES_PER_MIB : numeric;
    const assessed = assessAgainstLimits(compared, limitsFor(key, family));
    if (!assessed) {
        return { rank: null, maximum: null, ratio: null, scored, value: numeric };
    }
    return { rank: assessed.rank, maximum: assessed.maximum, ratio: assessed.ratio, scored, value: numeric };
}

const UNSCANNED_RATING = 'None';
const PASSED_SCAN = 'passed';

/**
 * 展示分组。没列进来的字段会落到 other 组, 这样 VRChat 新增字段时不会静默消失。
 */
const PERFORMANCE_STAT_GROUPS = [
    {
        key: 'geometry',
        metrics: [
            'totalPolygons',
            'totalVertices',
            'bounds',
            'skinnedMeshCount',
            'meshCount',
            'materialSlotsUsed',
            'materialCount',
            'boneCount',
            'blendShapeCount'
        ]
    },
    {
        key: 'memory',
        metrics: ['totalTextureUsage']
    },
    {
        key: 'dynamics',
        metrics: [
            'physBoneComponentCount',
            'physBoneTransformCount',
            'physBoneColliderCount',
            'physBoneCollisionCheckCount',
            'contactCount',
            'constraintCount',
            'constraintDepth'
        ]
    },
    {
        key: 'components',
        metrics: [
            'animatorCount',
            'particleSystemCount',
            'totalMaxParticles',
            'meshParticleMaxPolygons',
            'particleTrailsEnabled',
            'particleCollisionEnabled',
            'trailRendererCount',
            'lineRendererCount',
            'raycastCount',
            'clothCount',
            'totalClothVertices',
            'physicsColliders',
            'physicsRigidbodies',
            'lightCount',
            'audioSourceCount',
            'cameraCount',
            'writeDefaultsUsed'
        ]
    }
];
const OTHER_GROUP_KEY = 'other';

/**
 * 按分组摊平一个平台的 analysis 记录。
 *
 * @param {object | null} analysis
 * @param {string} platform
 * @returns {{ key: string; rows: object[] }[]}
 */
function groupStatEntries(analysis, platform) {
    const entries = collectStatEntries(analysis, platform);
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    const groups = PERFORMANCE_STAT_GROUPS.map((group) => ({
        key: group.key,
        rows: group.metrics.filter((metric) => byKey.has(metric)).map((metric) => byKey.get(metric))
    })).filter((group) => group.rows.length);
    const listed = new Set(PERFORMANCE_STAT_GROUPS.flatMap((group) => group.metrics));
    const rest = entries.filter((entry) => !listed.has(entry.key));
    if (rest.length) {
        groups.push({ key: OTHER_GROUP_KEY, rows: rest });
    }
    return groups;
}

/**
 * 真实响应里 avatarStats 常常没有 totalTextureUsage, 纹理内存要退回 textureStats.totalMippedBytes。
 *
 * @param {object | null} analysis 单个平台的 analysis 记录
 * @returns {number | null} 字节
 */
function pickTextureBytes(analysis) {
    if (!analysis) {
        return null;
    }
    const direct = analysis.avatarStats?.totalTextureUsage;
    if (Number.isFinite(direct)) {
        return direct;
    }
    const mipped = analysis.textureStats?.totalMippedBytes;
    return Number.isFinite(mipped) ? mipped : null;
}

/**
 * 未扫描的变体会把一堆指标填成 0, 照数值评级会同时给出假的 Excellent 和假的 VeryPoor。
 *
 * @param {object | null} analysis
 * @returns {boolean}
 */
function isAnalysisUsable(analysis) {
    if (!analysis) {
        return false;
    }
    if (analysis.scanStatus && analysis.scanStatus !== PASSED_SCAN) {
        return false;
    }
    return Boolean(analysis.performanceRating) && analysis.performanceRating !== UNSCANNED_RATING;
}

/**
 * 把一个平台的 analysis 记录摊平成可渲染的行。
 *
 * @param {object | null} analysis
 * @param {string} platform
 * @returns {{
 *     key: string;
 *     value: unknown;
 *     rank: string | null;
 *     maximum: number | number[] | null;
 *     ratio: number | null;
 *     scored: boolean;
 * }[]}
 */
function collectStatEntries(analysis, platform) {
    const stats = analysis?.avatarStats;
    if (!stats) {
        return [];
    }
    const usable = isAnalysisUsable(analysis);
    const merged = { ...stats };
    const textureBytes = pickTextureBytes(analysis);
    if (textureBytes !== null) {
        merged[TEXTURE_METRIC] = textureBytes;
    }
    return Object.entries(merged).map(([key, value]) => {
        const assessed = assessStat(key, value, platform);
        return {
            key,
            value,
            scored: assessed.scored,
            rank: usable ? assessed.rank : null,
            maximum: usable ? assessed.maximum : null,
            ratio: usable ? assessed.ratio : null
        };
    });
}

export {
    BYTES_PER_MIB,
    MOBILE_PERFORMANCE_LIMITS,
    PC_PERFORMANCE_LIMITS,
    PERFORMANCE_BOUNDS_LIMITS,
    PERFORMANCE_RANKS,
    assessAgainstLimits,
    assessBounds,
    assessStat,
    collectStatEntries,
    groupStatEntries,
    isAnalysisUsable,
    isScoredMetric,
    limitsFor,
    pickTextureBytes,
    PERFORMANCE_STAT_GROUPS,
    platformFamily
};

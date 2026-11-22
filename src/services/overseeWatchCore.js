// Oversee SSE 数据流核心纯函数: 无 Vue/Pinia/fetch 依赖, 全部可用 fake timers 单测.
// 被 overseeWatch.js (传输层) 与 overseeCoordinator.js (分发层) 复用.

/**
 * 单个 SSE 事件块解析: 注释行忽略, event:/data: 聚合, data 多行用 \n 连接.
 *
 * @param {string} block 不含尾部空行的完整事件块
 * @returns {{ event: string; data: string } | null} 无 data 字段时返回 null
 */
function parseEventBlock(block) {
    if (!block) {
        return null;
    }
    let event = 'message';
    const dataLines = [];
    for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) {
            continue;
        }
        if (line.startsWith('event:')) {
            event = line.slice(6).trimStart();
        } else if (line === 'data' || line.startsWith('data:')) {
            dataLines.push(line.startsWith('data:') ? line.slice(5).replace(/^ /, '') : '');
        }
    }
    if (!dataLines.length) {
        return null;
    }
    return { event, data: dataLines.join('\n') };
}

/**
 * 流式 SSE 解析: 输入累计 buffer, 返回已闭合事件与剩余半行/半块.
 * 跨 chunk 粘包 (一次多个事件) 与半行 (事件被截断) 均通过 rest 回传处理.
 * keepalive 注释行 (": keepalive") 无 data 字段, 天然被丢弃.
 *
 * @param {string} buffer
 * @returns {{ events: { event: string; data: string }[]; rest: string }}
 */
function parseSseChunk(buffer) {
    // \r\n 与孤立 \r 统一为 \n (SSE 规范允许三种换行)
    const text = String(buffer ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
    const events = [];
    let start = 0;
    let idx;
    while ((idx = text.indexOf('\n\n', start)) !== -1) {
        const parsed = parseEventBlock(text.slice(start, idx));
        if (parsed) {
            events.push(parsed);
        }
        start = idx + 2;
    }
    return { events, rest: text.slice(start) };
}

/**
 * 关注/黑名单第一道过滤: 未命中返回 null, 命中返回 'watch' | 'block' | 'both'.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {Set<string>} params.watchSet
 * @param {Set<string>} params.blockSet
 * @param {boolean} params.enableWatchPush
 * @param {boolean} params.enableBlockAlerts
 * @returns {'watch' | 'block' | 'both' | null}
 */
function classifyBeacon({ userId, watchSet, blockSet, enableWatchPush, enableBlockAlerts }) {
    const watched = Boolean(enableWatchPush) && watchSet.has(userId);
    const blocked = Boolean(enableBlockAlerts) && blockSet.has(userId);
    if (watched && blocked) {
        return 'both';
    }
    if (watched) {
        return 'watch';
    }
    if (blocked) {
        return 'block';
    }
    return null;
}

/**
 * 同 beacon id 去重 (重连后可能重放), 环形容量上限防止无限增长.
 */
class BeaconIdDeduper {
    /**
     * @param {number} [capacity]
     */
    constructor(capacity = 1024) {
        this.capacity = capacity;
        this.ids = new Set();
    }

    /**
     * @param {unknown} id
     * @returns {boolean} True = 放行
     */
    isNew(id) {
        const key = String(id ?? '');
        // 契约裁决: 正常 beacon 都有 id; 缺 id 时不参与去重直接放行 (宁可重复不可漏报)
        if (!key) {
            return true;
        }
        if (this.ids.has(key)) {
            return false;
        }
        this.ids.add(key);
        if (this.ids.size > this.capacity) {
            this.ids.delete(this.ids.values().next().value);
        }
        return true;
    }

    clear() {
        this.ids.clear();
    }
}

// 期望的 SSE 数据事件名: 服务端发 event: beacon; 兜底接受缺省 event 名 (message),
// 防服务端契约漂移时静默丢数据.
const SSE_DATA_EVENTS = new Set(['beacon', 'message']);

/**
 * 同一 user_id + location 的推送在 TTL 内去重防轰炸.
 */
class PresenceToastDeduper {
    /**
     * @param {number} [ttlMs]
     */
    constructor(ttlMs = 10 * 60 * 1000) {
        this.ttlMs = ttlMs;
        /** @type {Map<string, number>} key -> last toast timestamp */
        this.entries = new Map();
    }

    /**
     * @param {string} userId
     * @param {string} location
     * @param {number} [now]
     * @returns {boolean} True = 允许推送, false = TTL 内重复
     */
    shouldNotify(userId, location, now = Date.now()) {
        const key = `${userId}\n${location}`;
        const last = this.entries.get(key);
        if (typeof last === 'number' && now - last < this.ttlMs) {
            return false;
        }
        this.entries.set(key, now);
        // 顺带清理过期项, 防止长跑后 Map 无限增长
        for (const [k, ts] of this.entries) {
            if (now - ts >= this.ttlMs) {
                this.entries.delete(k);
            }
        }
        return true;
    }

    clear() {
        this.entries.clear();
    }
}

/**
 * D3 同房聚合: 命中事件进入 windowMs 窗口缓冲, 按 location 分组;
 * 窗口关闭时整组回调 onFlush(location, beacons).
 */
class BeaconWindowAggregator {
    /**
     * @param {object} options
     * @param {number} [options.windowMs]
     * @param {(location: string, beacons: object[]) => void} options.onFlush
     * @param {(fn: () => void, ms: number) => any} [options.schedule]
     * @param {(handle: any) => void} [options.cancel]
     */
    constructor({ windowMs = 2500, onFlush, schedule, cancel }) {
        this.windowMs = windowMs;
        this.onFlush = onFlush;
        this.schedule = schedule || ((fn, ms) => setTimeout(fn, ms));
        this.cancel = cancel || ((handle) => clearTimeout(handle));
        /** @type {Map<string, { beacons: object[]; handle: any }>} */
        this.groups = new Map();
    }

    /**
     * @param {object} beacon 需含 location 字段
     * @returns {boolean} 是否进入窗口 (无 location 直接丢弃)
     */
    add(beacon) {
        const location = String(beacon?.location || '');
        if (!location) {
            return false;
        }
        let group = this.groups.get(location);
        if (!group) {
            group = { beacons: [], handle: null };
            this.groups.set(location, group);
            group.handle = this.schedule(() => this.flush(location), this.windowMs);
        }
        group.beacons.push(beacon);
        return true;
    }

    /**
     * @param {string} location
     * @returns {object[]} 已取出的 beacon 列表 (用于测试与强制刷新)
     */
    flush(location) {
        const group = this.groups.get(location);
        if (!group) {
            return [];
        }
        if (group.handle !== null) {
            this.cancel(group.handle);
        }
        this.groups.delete(location);
        this.onFlush(location, group.beacons);
        return group.beacons;
    }

    /** 停止所有窗口, 丢弃未消费事件. */
    reset() {
        for (const group of this.groups.values()) {
            if (group.handle !== null) {
                this.cancel(group.handle);
            }
        }
        this.groups.clear();
    }
}

export {
    BeaconIdDeduper,
    BeaconWindowAggregator,
    PresenceToastDeduper,
    SSE_DATA_EVENTS,
    classifyBeacon,
    parseSseChunk
};

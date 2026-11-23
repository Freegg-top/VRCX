// Oversee 世界名/缩略图公共助手: 同步尽力而为返回 + 后台异步预热.
// 名字来源优先级: worldStore.cachedWorlds -> 本地 gamelog_location 批量查询.
// 本地查询结果放进模块级 reactive Map, 查询完成后组件自动重渲染.

import { reactive } from 'vue';

import { worldRequest } from '@/api';
import { database } from '@/services/database';
import { createRateLimiter } from '@/shared/utils/throttle';
import { useWorldStore } from '@/stores/world';

const WORLD_FETCH_FAILURE_TTL_MS = 10 * 60 * 1000;

// worldId → 本地世界名 ('' 表示本地无映射); reactive 以便异步回填后组件自动刷新
const localWorldNames = reactive(new Map());
const pendingNameLookups = new Set();
const pendingWorldFetches = new Set();
// 404 用 Infinity 永久记住；其他失败使用 10 分钟 TTL。
/** @type {Map<string, number>} */
const failedWorldFetches = new Map();
const worldRateLimiter = createRateLimiter({
    limitPerInterval: 5,
    intervalMs: 1000
});

/**
 * 批量补齐本地世界名，单次查询替代逐世界 N+1。
 *
 * @param {string[]} worldIds
 * @returns {Promise<void>}
 */
async function preloadWorldNames(worldIds) {
    const missingIds = [...new Set(worldIds)].filter((worldId) => {
        if (!worldId || localWorldNames.has(worldId) || pendingNameLookups.has(worldId)) {
            return false;
        }
        return !useWorldStore().cachedWorlds.get(worldId)?.name;
    });
    if (!missingIds.length) {
        return;
    }
    missingIds.forEach((worldId) => pendingNameLookups.add(worldId));
    try {
        const names = await database.getGameLogWorldNamesByWorldIds(missingIds);
        for (const worldId of missingIds) {
            localWorldNames.set(worldId, String(names.get(worldId) || '').trim());
        }
    } catch {
        for (const worldId of missingIds) {
            localWorldNames.set(worldId, '');
        }
    } finally {
        missingIds.forEach((worldId) => pendingNameLookups.delete(worldId));
    }
}

/**
 * 尽力而为同步解析世界名: 缓存有则直接返回; 本地未查过时触发后台查询并先返回 undefined,
 * 调用方用 `resolveWorldName(id) || shortenWorldId(id)` 兜底显示截短 id, 拿到后响应式更新.
 *
 * @param {string} worldId
 * @returns {string | undefined}
 */
function resolveWorldName(worldId) {
    if (!worldId) {
        return undefined;
    }
    const cached = useWorldStore().cachedWorlds.get(worldId);
    if (cached?.name) {
        return cached.name;
    }
    const local = localWorldNames.get(worldId);
    if (local) {
        return local;
    }
    if (local === undefined) {
        void preloadWorldNames([worldId]);
    }
    return undefined;
}

/**
 * @param {string} worldId
 * @returns {boolean}
 */
function isWorldFetchBlocked(worldId) {
    const failedAt = failedWorldFetches.get(worldId);
    if (failedAt === undefined) {
        return false;
    }
    if (failedAt === Infinity) {
        return true;
    }
    if (Date.now() - failedAt < WORLD_FETCH_FAILURE_TTL_MS) {
        return true;
    }
    failedWorldFetches.delete(worldId);
    return false;
}

/**
 * 异步补全世界元数据 (名字 + 缩略图): cachedWorlds 已齐全则直接用;
 * 否则以 5/s 限速调用 worldRequest.getWorld (applyWorld 自动写回 cachedWorlds).
 * pending Set 去重并发, 404 永久跳过, 其他失败 10 分钟后允许重试.
 *
 * @param {string} worldId
 * @returns {Promise<void>}
 */
async function ensureWorldMeta(worldId) {
    if (!worldId || !worldId.startsWith('wrld_')) {
        return;
    }
    resolveWorldName(worldId);
    const cached = useWorldStore().cachedWorlds.get(worldId);
    if (cached?.name && cached?.thumbnailImageUrl) {
        return;
    }
    if (pendingWorldFetches.has(worldId) || isWorldFetchBlocked(worldId)) {
        return;
    }
    pendingWorldFetches.add(worldId);
    try {
        await worldRateLimiter.wait();
        await worldRequest.getWorld({ worldId });
    } catch (error) {
        failedWorldFetches.set(worldId, error?.status === 404 ? Infinity : Date.now());
    } finally {
        pendingWorldFetches.delete(worldId);
    }
}

/**
 * 同步取世界展示条目: 名字 (同 resolveWorldName) + 缩略图 (cachedWorlds 的 256→128).
 *
 * @param {string} worldId
 * @returns {{ name: string | undefined; thumbnail: string }}
 */
function resolveWorldEntry(worldId) {
    const cached = worldId ? useWorldStore().cachedWorlds.get(worldId) : undefined;
    return {
        name: resolveWorldName(worldId),
        thumbnail: cached?.thumbnailImageUrl ? cached.thumbnailImageUrl.replace('256', '128') : ''
    };
}

/** Clears module state for isolated test scenarios. */
function clearWorldDisplayCache() {
    localWorldNames.clear();
    pendingNameLookups.clear();
    pendingWorldFetches.clear();
    failedWorldFetches.clear();
}

export { clearWorldDisplayCache, ensureWorldMeta, preloadWorldNames, resolveWorldEntry, resolveWorldName };

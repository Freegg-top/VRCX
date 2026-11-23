import { beforeEach, describe, expect, test, vi } from 'vitest';
import { nextTick, watchEffect } from 'vue';

const mocks = vi.hoisted(() => ({
    cachedWorlds: new Map(),
    getWorld: vi.fn(),
    getNames: vi.fn(),
    wait: vi.fn()
}));

vi.mock('@/api', () => ({
    worldRequest: {
        getWorld: mocks.getWorld
    }
}));
vi.mock('@/services/database', () => ({
    database: {
        getGameLogWorldNamesByWorldIds: mocks.getNames
    }
}));
vi.mock('@/stores/world', () => ({
    useWorldStore: () => ({ cachedWorlds: mocks.cachedWorlds })
}));
vi.mock('@/shared/utils/throttle', () => ({
    createRateLimiter: () => ({ wait: mocks.wait })
}));

import { clearWorldDisplayCache, ensureWorldMeta, preloadWorldNames, resolveWorldName } from '../worldDisplay';

describe('Oversee worldDisplay', () => {
    beforeEach(() => {
        vi.useRealTimers();
        clearWorldDisplayCache();
        mocks.cachedWorlds.clear();
        mocks.getWorld.mockReset().mockResolvedValue({});
        mocks.getNames.mockReset().mockResolvedValue(new Map());
        mocks.wait.mockReset().mockResolvedValue(undefined);
    });

    test('batch preloading fills the reactive name map and deduplicates pending lookups', async () => {
        mocks.getNames.mockResolvedValue(new Map([['wrld_a', 'World A']]));
        const first = preloadWorldNames(['wrld_a', 'wrld_b']);
        const second = preloadWorldNames(['wrld_a', 'wrld_b']);
        let resolved;
        const stop = watchEffect(() => {
            resolved = resolveWorldName('wrld_a');
        });
        await Promise.all([first, second]);
        await nextTick();
        stop();

        expect(mocks.getNames).toHaveBeenCalledTimes(1);
        expect(mocks.getNames).toHaveBeenCalledWith(['wrld_a', 'wrld_b']);
        expect(resolved).toBe('World A');
        expect(resolveWorldName('wrld_b')).toBeUndefined();
    });

    test('deduplicates in-flight remote metadata requests', async () => {
        let resolveRequest;
        mocks.getWorld.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveRequest = resolve;
                })
        );

        const first = ensureWorldMeta('wrld_a');
        const second = ensureWorldMeta('wrld_a');
        await vi.waitFor(() => expect(mocks.getWorld).toHaveBeenCalledTimes(1));
        resolveRequest({});
        await Promise.all([first, second]);
        expect(mocks.wait).toHaveBeenCalledTimes(1);
    });

    test('retries transient failures after ten minutes but keeps 404 blocked', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_800_000_000_000);
        mocks.getWorld.mockRejectedValue({ status: 429 });

        await ensureWorldMeta('wrld_transient');
        await ensureWorldMeta('wrld_transient');
        expect(mocks.getWorld).toHaveBeenCalledTimes(1);

        vi.setSystemTime(1_800_000_000_000 + 10 * 60 * 1000 + 1);
        mocks.getWorld.mockResolvedValue({});
        await ensureWorldMeta('wrld_transient');
        expect(mocks.getWorld).toHaveBeenCalledTimes(2);

        mocks.getWorld.mockRejectedValue({ status: 404 });
        await ensureWorldMeta('wrld_missing');
        await ensureWorldMeta('wrld_missing');
        vi.setSystemTime(1_800_000_000_000 + 24 * 60 * 60 * 1000);
        await ensureWorldMeta('wrld_missing');
        expect(mocks.getWorld).toHaveBeenCalledTimes(3);
    });
});

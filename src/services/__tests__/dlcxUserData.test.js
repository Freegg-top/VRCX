import { beforeEach, describe, expect, test, vi } from 'vitest';

import { buildCloudConnectionMap, getMyCloudConnections, invalidateMyCloudConnections } from '../dlcxUserData';

const mocks = vi.hoisted(() => ({
    currentUser: { id: 'usr_me' },
    getUserConnections: vi.fn()
}));

vi.mock('@/services/dlcxApi', () => ({
    getUserConnections: mocks.getUserConnections
}));

vi.mock('@/stores', () => ({
    useUserStore: () => ({ currentUser: mocks.currentUser })
}));

describe('dlcxUserData.buildCloudConnectionMap', () => {
    test('normalizes rows and skips entries without a user id', () => {
        const result = buildCloudConnectionMap({
            results: [
                {
                    other_id: 'usr_a',
                    display_name: 'Alice',
                    avatar_url: 'https://example.invalid/a.png',
                    co_seen_count: 3,
                    last_seen: '2026-11-23T01:00:00.000Z'
                },
                { other_id: '', display_name: 'missing' },
                { other_id: 'usr_b', co_seen_count: Number.NaN }
            ]
        });
        expect(result.get('usr_a')).toEqual({
            count: 3,
            lastSeen: '2026-11-23T01:00:00.000Z',
            displayName: 'Alice',
            avatarUrl: 'https://example.invalid/a.png'
        });
        expect(result.get('usr_b')).toEqual({
            count: 0,
            lastSeen: '',
            displayName: 'usr_b',
            avatarUrl: ''
        });
        expect(result.size).toBe(2);
    });
});

describe('dlcxUserData.getMyCloudConnections', () => {
    beforeEach(() => {
        vi.useRealTimers();
        invalidateMyCloudConnections();
        mocks.currentUser.id = 'usr_me';
        mocks.getUserConnections.mockReset();
    });

    test('requests the current user once and serves the map from the TTL cache', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_800_000_000_000);
        mocks.getUserConnections.mockResolvedValue({
            results: [{ other_id: 'usr_a', co_seen_count: 2 }]
        });

        await expect(getMyCloudConnections()).resolves.toBeInstanceOf(Map);
        await expect(getMyCloudConnections()).resolves.toBeInstanceOf(Map);
        expect(mocks.getUserConnections).toHaveBeenCalledTimes(1);
        expect(mocks.getUserConnections).toHaveBeenCalledWith('usr_me', 200);

        vi.setSystemTime(1_800_000_000_000 + 10 * 60 * 1000 + 1);
        await getMyCloudConnections();
        expect(mocks.getUserConnections).toHaveBeenCalledTimes(2);
    });

    test('shares an in-flight request between concurrent callers', async () => {
        let resolveRequest;
        mocks.getUserConnections.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveRequest = resolve;
                })
        );
        const first = getMyCloudConnections();
        const second = getMyCloudConnections();
        expect(first).toBe(second);
        resolveRequest({ results: [] });
        await expect(second).resolves.toEqual(new Map());
        expect(mocks.getUserConnections).toHaveBeenCalledTimes(1);
    });

    test.each(['notConfigured', 'unauthorized', 'forbidden'])(
        'degrades silently and caches stable %s failures',
        async (kind) => {
            mocks.getUserConnections.mockRejectedValue(Object.assign(new Error(kind), { kind }));
            await expect(getMyCloudConnections()).resolves.toBeNull();
            await expect(getMyCloudConnections()).resolves.toBeNull();
            expect(mocks.getUserConnections).toHaveBeenCalledTimes(1);
        }
    );

    test.each(['network', 'server'])('does not cache transient %s failures', async (kind) => {
        mocks.getUserConnections.mockRejectedValueOnce(Object.assign(new Error(kind), { kind })).mockResolvedValueOnce({
            results: [{ other_id: 'usr_a', co_seen_count: 1 }]
        });
        await expect(getMyCloudConnections()).resolves.toBeNull();
        await expect(getMyCloudConnections()).resolves.toBeInstanceOf(Map);
        expect(mocks.getUserConnections).toHaveBeenCalledTimes(2);
    });

    test('returns null without a request while logged out', async () => {
        mocks.currentUser.id = '';
        await expect(getMyCloudConnections()).resolves.toBeNull();
        expect(mocks.getUserConnections).not.toHaveBeenCalled();
    });

    test('invalidation starts a fresh request and prevents superseded writes', async () => {
        let resolveFirst;
        mocks.getUserConnections
            .mockImplementationOnce(
                () =>
                    new Promise((resolve) => {
                        resolveFirst = resolve;
                    })
            )
            .mockResolvedValue({
                results: [{ other_id: 'usr_new', co_seen_count: 1 }]
            });

        const first = getMyCloudConnections();
        invalidateMyCloudConnections();
        await getMyCloudConnections();
        expect(mocks.getUserConnections).toHaveBeenCalledTimes(2);

        resolveFirst({
            results: [{ other_id: 'usr_stale', co_seen_count: 1 }]
        });
        await first;

        const current = await getMyCloudConnections();
        expect([...current.keys()]).toEqual(['usr_new']);
        expect(mocks.getUserConnections).toHaveBeenCalledTimes(2);
    });
});

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getUserHistory: vi.fn()
}));

vi.mock('../dlcxApi', () => ({
    getUserHistory: mocks.getUserHistory
}));

import {
    buildCloudObservationSummary,
    clearCloudObservationCache,
    getCloudConnectionBadge,
    getCloudObservationSummary,
    isDLCXLicenseAvailable,
    shouldLoadCloudMutualFallback,
    stampCloudConnectionsOnPlayers
} from '../dlcxUserCardData';

describe('dlcxUserCardData.isDLCXLicenseAvailable', () => {
    test.each([
        [{ licenseKey: '', licenseStatus: 'ok' }, false],
        [{ licenseKey: 'key', licenseStatus: 'invalid' }, false],
        [{ licenseKey: 'key', licenseStatus: 'expired' }, false],
        [{ licenseKey: 'key', licenseStatus: 'offline' }, false],
        [{ licenseKey: 'key', licenseStatus: 'ok' }, true],
        [{ licenseKey: 'key', licenseStatus: 'unknown' }, true],
        [{ licenseKey: 'key', licenseStatus: 'checking' }, true]
    ])('maps %o to %s', (settings, expected) => {
        expect(isDLCXLicenseAvailable(settings)).toBe(expected);
    });
});

describe('dlcxUserCardData.shouldLoadCloudMutualFallback', () => {
    test('requires official failure, no snapshot and an available license', () => {
        expect(
            shouldLoadCloudMutualFallback({
                officialSucceeded: true,
                historicalCount: 0,
                licenseKey: 'key',
                licenseStatus: 'ok'
            })
        ).toBe(false);
        expect(
            shouldLoadCloudMutualFallback({
                officialSucceeded: false,
                historicalCount: 2,
                licenseKey: 'key',
                licenseStatus: 'ok'
            })
        ).toBe(false);
        expect(
            shouldLoadCloudMutualFallback({
                officialSucceeded: false,
                historicalCount: 0,
                licenseKey: '',
                licenseStatus: 'ok'
            })
        ).toBe(false);
        expect(
            shouldLoadCloudMutualFallback({
                officialSucceeded: false,
                historicalCount: 0,
                licenseKey: 'key',
                licenseStatus: 'unknown'
            })
        ).toBe(true);
    });
});

describe('dlcxUserCardData.buildCloudObservationSummary', () => {
    test('returns null for a completely empty observation', () => {
        expect(buildCloudObservationSummary({ user: null, history: [] })).toBeNull();
    });

    test('prefers user timestamps and falls back to history ordering', () => {
        expect(
            buildCloudObservationSummary({
                user: {
                    first_seen: '2026-01-01T00:00:00.000Z',
                    last_seen: '2026-11-20T00:00:00.000Z'
                },
                history: [{ at: '2026-11-21T00:00:00.000Z' }]
            })
        ).toEqual({
            firstSeen: '2026-01-01T00:00:00.000Z',
            lastSeen: '2026-11-20T00:00:00.000Z'
        });
        expect(
            buildCloudObservationSummary({
                user: null,
                history: [{ at: '2026-11-21T00:00:00.000Z' }, { at: '2026-01-01T00:00:00.000Z' }]
            })
        ).toEqual({
            firstSeen: '2026-01-01T00:00:00.000Z',
            lastSeen: '2026-11-21T00:00:00.000Z'
        });
    });

    test('keeps the newest observed location alongside the aggregate timestamps', () => {
        expect(
            buildCloudObservationSummary({
                user: { first_seen: '2026-01-01', last_seen: '2026-11-21' },
                history: [
                    {
                        at: '2026-11-21T00:00:00.000Z',
                        location: 'wrld_new:123',
                        world_id: 'wrld_new'
                    },
                    {
                        at: '2026-11-20T00:00:00.000Z',
                        location: 'wrld_old:456',
                        world_id: 'wrld_old'
                    }
                ]
            })
        ).toEqual({
            firstSeen: '2026-01-01',
            lastSeen: '2026-11-21',
            lastLocation: 'wrld_new:123',
            lastWorldId: 'wrld_new'
        });
    });
});

describe('dlcxUserCardData.getCloudObservationSummary', () => {
    beforeEach(() => {
        vi.useRealTimers();
        clearCloudObservationCache();
        mocks.getUserHistory.mockReset();
    });

    test('caches successful summaries for the TTL and caps the cache at 50 users', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_800_000_000_000);
        mocks.getUserHistory.mockImplementation((userId) =>
            Promise.resolve({
                user: { first_seen: '2026-01-01T00:00:00.000Z', last_seen: `2026-11-${userId.slice(-2)}` },
                history: []
            })
        );

        await expect(getCloudObservationSummary('usr_a')).resolves.toEqual({
            firstSeen: '2026-01-01T00:00:00.000Z',
            lastSeen: '2026-11-_a'
        });
        await getCloudObservationSummary('usr_a');
        expect(mocks.getUserHistory).toHaveBeenCalledTimes(1);

        for (let i = 0; i < 51; i++) {
            await getCloudObservationSummary(`usr_${String(i).padStart(2, '0')}`);
        }
        await getCloudObservationSummary('usr_a');
        expect(mocks.getUserHistory).toHaveBeenCalledTimes(53);
    });

    test('returns null silently after failures and shares in-flight requests', async () => {
        mocks.getUserHistory.mockRejectedValueOnce(new Error('network'));
        await expect(getCloudObservationSummary('usr_a')).resolves.toBeNull();
        mocks.getUserHistory.mockResolvedValueOnce({ user: null, history: [] });
        await getCloudObservationSummary('usr_a');

        let resolveRequest;
        mocks.getUserHistory.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveRequest = resolve;
                })
        );
        const first = getCloudObservationSummary('usr_b');
        const second = getCloudObservationSummary('usr_b');
        expect(first).toBe(second);
        resolveRequest({ user: { first_seen: '2026-01-01', last_seen: '2026-01-02' }, history: [] });
        await first;
        expect(mocks.getUserHistory).toHaveBeenCalledTimes(3);
    });
});

describe('dlcxUserCardData.getCloudConnectionBadge', () => {
    const connections = new Map([
        ['usr_a', { count: 3, lastSeen: '2026-11-22T00:00:00.000Z' }],
        ['usr_b', { count: 0, lastSeen: '' }]
    ]);

    test('matches only non-friend rows with a valid lastSeen', () => {
        expect(getCloudConnectionBadge({ isFriend: false, ref: { id: 'usr_a' } }, connections)).toEqual({
            count: 3,
            lastSeen: '2026-11-22T00:00:00.000Z'
        });
        expect(getCloudConnectionBadge({ isFriend: true, ref: { id: 'usr_a' } }, connections)).toBeNull();
        expect(getCloudConnectionBadge({ isFriend: false, ref: { id: 'usr_b' } }, connections)).toBeNull();
        expect(getCloudConnectionBadge({ isFriend: false, ref: { id: 'usr_missing' } }, connections)).toBeNull();
        expect(getCloudConnectionBadge({ isFriend: false, ref: { id: 'usr_a' } }, null)).toBeNull();
    });
});

describe('dlcxUserCardData.stampCloudConnectionsOnPlayers', () => {
    test('stamps in-memory fields, skips friends and clears stale stamps', () => {
        const friendRef = { id: 'usr_friend' };
        const matchedRef = { id: 'usr_a' };
        const staleRef = { id: 'usr_stale', $cloudLastSeen: 'old', $cloudCoSeenCount: 9 };
        const players = [
            { isFriend: true, ref: friendRef },
            { isFriend: false, ref: matchedRef },
            { isFriend: false, ref: staleRef }
        ];
        const connections = new Map([['usr_a', { count: 2, lastSeen: '2026-11-22T00:00:00.000Z' }]]);

        expect(stampCloudConnectionsOnPlayers(players, connections)).toBe(true);
        expect(friendRef.$cloudLastSeen).toBe('');
        expect(matchedRef).toMatchObject({
            $cloudLastSeen: '2026-11-22T00:00:00.000Z',
            $cloudCoSeenCount: 2
        });
        expect(staleRef).toMatchObject({ $cloudLastSeen: '', $cloudCoSeenCount: 0 });
        expect(stampCloudConnectionsOnPlayers(players, connections)).toBe(false);
        expect(stampCloudConnectionsOnPlayers(players, null)).toBe(true);
        expect(matchedRef).toMatchObject({ $cloudLastSeen: '', $cloudCoSeenCount: 0 });
    });
});

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    executeJson: vi.fn()
}));

vi.mock('../../sqlite.js', () => ({
    default: {
        execute: mocks.execute,
        executeJson: mocks.executeJson,
        executeNonQuery: vi.fn()
    }
}));
vi.mock('../index.js', () => ({
    dbVars: {
        maxTableSize: 500,
        userPrefix: ''
    }
}));

import { gameLog } from '../gameLog.js';

beforeEach(() => {
    mocks.execute.mockReset();
    mocks.executeJson.mockReset();
});

describe('gameLog.getMyTopWorlds', () => {
    test('adds an exclude clause when a home world id is provided', async () => {
        mocks.execute.mockImplementation(async (callback, _sql, _params) => {
            callback(['wrld_1', 'World One', 3, 9000]);
            return undefined;
        });

        const result = await gameLog.getMyTopWorlds(30, 5, 'time', 'wrld_home');

        expect(result).toEqual([
            {
                worldId: 'wrld_1',
                worldName: 'World One',
                visitCount: 3,
                totalTime: 9000
            }
        ]);
        expect(mocks.execute).toHaveBeenCalledTimes(1);
        expect(mocks.execute.mock.calls[0][1]).toContain('AND world_id != @excludeWorldId');
        expect(mocks.execute.mock.calls[0][2]).toMatchObject({
            '@limit': 5,
            '@daysOffset': '-30 days',
            '@excludeWorldId': 'wrld_home'
        });
    });
});

describe('gameLog Oversee queries', () => {
    test('loads all local co-seen rows through one executeJson call', async () => {
        mocks.executeJson.mockResolvedValue([
            ['usr_a', 'A', 'wrld_a:1', '2026-01-01T00:00:00Z', 'OnPlayerJoined'],
            [null, null, null, null, null]
        ]);

        const result = await gameLog.getLocalCoSeenRows('usr_self');

        expect(mocks.executeJson).toHaveBeenCalledTimes(1);
        expect(mocks.execute).not.toHaveBeenCalled();
        expect(mocks.executeJson.mock.calls[0][1]).toMatchObject({
            '@userId': 'usr_self',
            '@sinceDays': '-180 days',
            '@limit': 50000
        });
        expect(result).toEqual([
            {
                userId: 'usr_a',
                displayName: 'A',
                location: 'wrld_a:1',
                createdAt: '2026-01-01T00:00:00Z',
                type: 'OnPlayerJoined'
            },
            { userId: '', displayName: '', location: '', createdAt: '', type: '' }
        ]);
    });

    test('batch world-name lookup uses at most 100 IDs per query', async () => {
        const worldIds = Array.from({ length: 205 }, (_, index) => `wrld_${index}`);
        mocks.execute.mockImplementation(async (callback, _sql, args) => {
            for (const worldId of Object.values(args)) {
                callback([worldId, `World ${worldId}`]);
            }
        });

        const result = await gameLog.getGameLogWorldNamesByWorldIds(worldIds);

        expect(mocks.execute).toHaveBeenCalledTimes(3);
        expect(mocks.execute.mock.calls.map((call) => Object.keys(call[2]).length)).toEqual([100, 100, 5]);
        for (const call of mocks.execute.mock.calls) {
            expect(call[1]).toContain('GROUP BY world_id');
        }
        expect(result.size).toBe(205);
        expect(result.get('wrld_204')).toBe('World wrld_204');
    });
});

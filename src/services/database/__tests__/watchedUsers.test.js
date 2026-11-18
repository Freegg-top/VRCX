import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    executeNonQuery: vi.fn()
}));

vi.mock('../../sqlite.js', () => ({
    default: { execute: vi.fn(), executeNonQuery: mocks.executeNonQuery }
}));

vi.mock('../index.js', () => ({
    dbVars: { userId: '', userPrefix: '' }
}));

import { watchedUsers } from '../watchedUsers.js';
import { dbVars } from '../index.js';

describe('watchedUsers add/remove (P2-2)', () => {
    beforeEach(() => {
        mocks.executeNonQuery.mockReset();
        dbVars.userId = '';
    });

    test('未登录(dbVars.userId 为空)时不写库', async () => {
        await watchedUsers.addWatchedUser('usr_a', 'A');
        await watchedUsers.removeWatchedUser('usr_a');
        expect(mocks.executeNonQuery).not.toHaveBeenCalled();
    });

    test('登录后写库且带 owner, 失败会 reject 给调用方捕获', async () => {
        dbVars.userId = 'usr_me';
        await watchedUsers.addWatchedUser('usr_a', 'A');
        expect(mocks.executeNonQuery).toHaveBeenCalledTimes(1);
        expect(mocks.executeNonQuery.mock.calls[0][1]).toMatchObject({
            '@user_id': 'usr_a',
            '@owner_user_id': 'usr_me'
        });

        await watchedUsers.removeWatchedUser('usr_a');
        expect(mocks.executeNonQuery).toHaveBeenCalledTimes(2);
        expect(mocks.executeNonQuery.mock.calls[1][1]).toMatchObject({
            '@user_id': 'usr_a',
            '@owner_user_id': 'usr_me'
        });

        mocks.executeNonQuery.mockRejectedValueOnce(new Error('locked'));
        await expect(watchedUsers.addWatchedUser('usr_a', 'A')).rejects.toThrow('locked');
    });
});

import {
    beginEventFile,
    confirmFileAccount,
    currentAccount,
    getFileAccount,
    listFileAccounts,
    noteEventTime,
    reset
} from '../gameLogAccount.js';

describe('gameLogAccount', () => {
    beforeEach(() => {
        reset();
    });

    test('an unidentified log file writes no account instead of guessing one', () => {
        beginEventFile('output_log_2026-09-28_01-00-00.txt');
        noteEventTime('2026-09-28T01:00:05.000Z');

        expect(currentAccount()).toBe('');
    });

    test('confirming a file reports the window that needs backfilling', () => {
        const file = 'output_log_2026-09-28_01-00-00.txt';
        beginEventFile(file);
        noteEventTime('2026-09-28T01:00:05.000Z');
        noteEventTime('2026-09-28T01:00:01.000Z');
        noteEventTime('2026-09-28T01:02:00.000Z');

        expect(confirmFileAccount(file, 'usr_a')).toEqual({
            firstAt: '2026-09-28T01:00:01.000Z',
            lastAt: '2026-09-28T01:02:00.000Z'
        });
        expect(currentAccount()).toBe('usr_a');
    });

    test('a repeated identity for the same account does not re-backfill', () => {
        const file = 'output_log_2026-09-28_01-00-00.txt';
        beginEventFile(file);
        noteEventTime('2026-09-28T01:00:01.000Z');
        confirmFileAccount(file, 'usr_a');

        expect(confirmFileAccount(file, 'usr_a')).toBeNull();
    });

    test('interleaved events from two log files keep their own accounts', () => {
        const fileA = 'output_log_a.txt';
        const fileB = 'output_log_b.txt';
        beginEventFile(fileA);
        noteEventTime('2026-09-28T01:00:01.000Z');
        confirmFileAccount(fileA, 'usr_a');
        beginEventFile(fileB);
        noteEventTime('2026-09-28T01:00:02.000Z');

        expect(currentAccount()).toBe('');
        beginEventFile(fileA);
        expect(currentAccount()).toBe('usr_a');
        expect(getFileAccount(fileB)).toBe('');
    });

    test('an empty file name never resolves to an account', () => {
        beginEventFile(undefined);
        noteEventTime('2026-09-28T01:00:01.000Z');

        expect(currentAccount()).toBe('');
        expect(confirmFileAccount(undefined, 'usr_a')).toBeNull();
        expect(listFileAccounts()).toEqual([]);
    });
});

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

import {
    buildIngestPayload,
    getIngestRetryDelay,
    INGEST_DEBOUNCE_MS,
    INGEST_HEARTBEAT_MS,
    initOverseeIngest,
    isPublicInstanceLocation,
    notifyIngestGameLog,
    resetOverseeIngestForTests
} from '../overseeIngest';

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    settings: null,
    currentUser: { id: 'usr_self', displayName: 'Self' },
    watch: { isLoggedIn: true },
    ready: null
}));

vi.mock('../webapi', () => ({ default: { execute: mocks.execute } }));
vi.mock('../watchState', () => ({ watchState: mocks.watch }));
vi.mock('../../stores/settings/oversee', () => ({ useOverseeSettingsStore: () => mocks.settings }));
vi.mock('../../stores/user', () => ({ useUserStore: () => ({ currentUser: mocks.currentUser }) }));

mocks.settings = reactive({
    ingestEnabled: true,
    licenseKey: 'license-test',
    apiBase: 'https://api.example.test',
    ensureOverseeSettingsReady: () => mocks.ready
});

const PUBLIC_LOCATION = 'wrld_12345678:42~region(us)';

async function flushInitialization() {
    await vi.advanceTimersByTimeAsync(0);
}

function enterPublicInstance() {
    notifyIngestGameLog({ type: 'location', location: PUBLIC_LOCATION }, PUBLIC_LOCATION);
}

function join(displayName, userId = '') {
    notifyIngestGameLog({ type: 'player-joined', displayName, userId }, PUBLIC_LOCATION);
}

describe('overseeIngest pure helpers', () => {
    test.each([
        [PUBLIC_LOCATION, true],
        ['wrld_123:1~private(usr_abc)', false],
        ['wrld_123:1~friends(usr_abc)', false],
        ['wrld_123:1~hidden(usr_abc)', false],
        ['wrld_123:1~PRIVATE(usr_abc)', false],
        ['offline', false],
        ['', false]
    ])('classifies public instance location %s', (location, expected) => {
        expect(isPublicInstanceLocation(location)).toBe(expected);
    });

    test('includes self first, merges duplicate names, and prefers valid user IDs', () => {
        const payload = buildIngestPayload({
            location: PUBLIC_LOCATION,
            self: { id: 'usr_self', displayName: 'Self' },
            clientTs: 1_800_000_000_000,
            roster: new Map([
                ['Self', { name: 'Self', id: 'usr_duplicate' }],
                ['Alice', { name: 'Alice', id: 'usr_alice' }],
                ['Bob', { name: 'Bob', id: 'not-a-user-id' }],
                ['Carol', { name: 'Carol' }]
            ])
        });
        expect(payload).toEqual({
            reporter: 'usr_self',
            location: PUBLIC_LOCATION,
            n_users: 4,
            users: [{ name: 'Self', id: 'usr_self' }, { name: 'Alice', id: 'usr_alice' }, 'Bob', 'Carol'],
            client_ts: 1_800_000_000_000,
            client: 'vrcx-dlc/2026.11.24'
        });
    });

    test('refuses a payload without a usable self identity', () => {
        expect(
            buildIngestPayload({
                location: PUBLIC_LOCATION,
                self: { id: 'invalid', displayName: 'Self' },
                roster: new Map()
            })
        ).toBeNull();
    });

    test('caps the retry sequence at 120 seconds and applies bounded jitter', () => {
        expect(getIngestRetryDelay(1, 0)).toBe(30_000);
        expect(getIngestRetryDelay(2, 0)).toBe(60_000);
        expect(getIngestRetryDelay(3, 0)).toBe(120_000);
        expect(getIngestRetryDelay(20, 0)).toBe(120_000);
        expect(getIngestRetryDelay(1, 1)).toBe(36_000);
    });
});

describe('overseeIngest state machine', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_800_000_000_000);
        mocks.execute.mockReset().mockResolvedValue({ status: 202, data: '' });
        mocks.currentUser.id = 'usr_self';
        mocks.currentUser.displayName = 'Self';
        mocks.watch.isLoggedIn = true;
        mocks.settings.ingestEnabled = true;
        mocks.settings.licenseKey = 'license-test';
        mocks.settings.apiBase = 'https://api.example.test';
        mocks.ready = Promise.resolve();
        initOverseeIngest();
        await flushInitialization();
    });

    afterEach(() => {
        resetOverseeIngestForTests();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    test('location changes immediately upload a self-only snapshot with the request contract', () => {
        enterPublicInstance();
        expect(mocks.execute).toHaveBeenCalledTimes(1);
        const [request] = mocks.execute.mock.calls[0];
        expect(request).toMatchObject({
            url: 'https://api.example.test/v1/ingest/instance',
            method: 'POST',
            headers: {
                Authorization: 'Bearer license-test',
                'Content-Type': 'application/json'
            },
            keepalive: true
        });
        expect(JSON.parse(request.body)).toEqual({
            reporter: 'usr_self',
            location: PUBLIC_LOCATION,
            n_users: 1,
            users: [{ name: 'Self', id: 'usr_self' }],
            client_ts: 1_800_000_000_000,
            client: 'vrcx-dlc/2026.11.24'
        });
    });

    test('join and leave events merge into one 30 second report', async () => {
        enterPublicInstance();
        mocks.execute.mockClear();
        join('Alice', 'usr_alice');
        await vi.advanceTimersByTimeAsync(10_000);
        join('Bob');
        notifyIngestGameLog({ type: 'player-left', displayName: 'Alice' }, PUBLIC_LOCATION);
        await vi.advanceTimersByTimeAsync(INGEST_DEBOUNCE_MS - 1);
        expect(mocks.execute).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(mocks.execute).toHaveBeenCalledTimes(1);
        const payload = JSON.parse(mocks.execute.mock.calls[0][0].body);
        expect(payload.n_users).toBe(2);
        expect(payload.users).toEqual([{ name: 'Self', id: 'usr_self' }, 'Bob']);
    });

    test('the heartbeat reports every five minutes without an event', async () => {
        enterPublicInstance();
        await vi.advanceTimersByTimeAsync(INGEST_HEARTBEAT_MS - 1);
        expect(mocks.execute).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(mocks.execute).toHaveBeenCalledTimes(2);
    });

    test('private instances and missing prerequisites never make network requests', async () => {
        notifyIngestGameLog({ type: 'location', location: 'wrld_123:1~friends(usr_a)' }, '');
        join('Alice', 'usr_alice');
        await vi.advanceTimersByTimeAsync(INGEST_HEARTBEAT_MS * 2);
        expect(mocks.execute).not.toHaveBeenCalled();

        mocks.settings.licenseKey = '';
        await nextTick();
        enterPublicInstance();
        join('Alice', 'usr_alice');
        await vi.advanceTimersByTimeAsync(INGEST_DEBOUNCE_MS);
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    test('the disabled switch produces zero network traffic and clears pending work', async () => {
        enterPublicInstance();
        mocks.execute.mockClear();
        join('Alice', 'usr_alice');
        mocks.settings.ingestEnabled = false;
        await nextTick();
        await vi.advanceTimersByTimeAsync(INGEST_HEARTBEAT_MS * 2);
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    test('logout clears pending work and stops the heartbeat', async () => {
        enterPublicInstance();
        mocks.execute.mockClear();
        join('Alice', 'usr_alice');
        mocks.watch.isLoggedIn = false;
        await nextTick();
        await vi.advanceTimersByTimeAsync(INGEST_HEARTBEAT_MS * 2);
        expect(mocks.execute).not.toHaveBeenCalled();
    });

    test('401 stops future automatic requests and logs once', async () => {
        const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
        mocks.execute.mockResolvedValue({ status: 401, data: '' });
        enterPublicInstance();
        await flushInitialization();
        await vi.advanceTimersByTimeAsync(INGEST_HEARTBEAT_MS * 2);
        expect(mocks.execute).toHaveBeenCalledTimes(1);
        expect(debug).toHaveBeenCalledTimes(1);
    });

    test('429 does not retry the current cycle', async () => {
        mocks.execute.mockResolvedValue({ status: 429, data: '' });
        enterPublicInstance();
        await flushInitialization();
        await vi.advanceTimersByTimeAsync(29_999);
        expect(mocks.execute).toHaveBeenCalledTimes(1);
    });

    test('network errors retry with 30, 60, then 120 second backoff', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        mocks.execute.mockRejectedValue(new Error('offline'));
        enterPublicInstance();
        await flushInitialization();
        expect(mocks.execute).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(mocks.execute).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(mocks.execute).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(mocks.execute).toHaveBeenCalledTimes(4);
        await vi.advanceTimersByTimeAsync(120_000);
        expect(mocks.execute).toHaveBeenCalledTimes(5);
    });

    test('a 202 response resets network backoff', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        mocks.execute.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ status: 202, data: '' });
        enterPublicInstance();
        await flushInitialization();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(mocks.execute).toHaveBeenCalledTimes(2);
        join('Alice', 'usr_alice');
        await vi.advanceTimersByTimeAsync(30_000);
        expect(mocks.execute).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(mocks.execute).toHaveBeenCalledTimes(3);
    });
});

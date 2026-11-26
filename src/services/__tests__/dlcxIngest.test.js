import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

import {
    buildIngestPayload,
    buildSnapshot,
    getIngestRetryDelay,
    INGEST_HEARTBEAT_MS,
    INGEST_POLL_INTERVAL_MS,
    initDLCXIngest,
    isPublicInstanceLocation,
    notifyIngestGameLog,
    resetDLCXIngestForTests
} from '../dlcxIngest';

const mocks = vi.hoisted(() => ({
    execute: vi.fn(),
    settings: null,
    locationStore: { lastLocation: { location: 'offline', playerList: new Map() } },
    currentUser: { id: 'usr_self', displayName: 'Self' },
    watch: { isLoggedIn: true },
    ready: null
}));

vi.mock('worker-timers', () => ({
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
    setInterval: (...args) => globalThis.setInterval(...args),
    clearInterval: (...args) => globalThis.clearInterval(...args)
}));
vi.mock('../webapi', () => ({ default: { execute: mocks.execute } }));
vi.mock('../watchState', () => ({ watchState: mocks.watch }));
vi.mock('../../stores/location', () => ({ useLocationStore: () => mocks.locationStore }));
vi.mock('../../stores/settings/dlcx', () => ({ useDLCXSettingsStore: () => mocks.settings }));
vi.mock('../../stores/user', () => ({ useUserStore: () => ({ currentUser: mocks.currentUser }) }));

mocks.settings = reactive({
    ingestEnabled: true,
    licenseKey: 'license-test',
    apiBase: 'https://api.example.test',
    ensureDLCXSettingsReady: () => mocks.ready
});

const PUBLIC_LOCATION = 'wrld_12345678:42~region(us)';

async function flushInitialization() {
    await vi.advanceTimersByTimeAsync(0);
}

function changeLocation(location) {
    mocks.locationStore.lastLocation.location = location;
    notifyIngestGameLog({ type: 'location', location }, location);
}

function enterPublicInstance() {
    const { id, displayName } = mocks.currentUser;
    mocks.locationStore.lastLocation.playerList = new Map([[id, { displayName, userId: id }]]);
    changeLocation(PUBLIC_LOCATION);
}

function join(displayName, userId = '') {
    mocks.locationStore.lastLocation.playerList.set(userId || `pending-${displayName}`, { displayName, userId });
    notifyIngestGameLog({ type: 'player-joined', displayName, userId }, PUBLIC_LOCATION);
}

function leave(displayName, userId = '') {
    mocks.locationStore.lastLocation.playerList.delete(userId || `pending-${displayName}`);
    notifyIngestGameLog({ type: 'player-left', displayName, userId }, PUBLIC_LOCATION);
}

describe('dlcxIngest snapshots and pure helpers', () => {
    beforeEach(() => {
        mocks.locationStore.lastLocation.location = PUBLIC_LOCATION;
        mocks.locationStore.lastLocation.playerList = new Map();
        mocks.currentUser.id = 'usr_self';
        mocks.currentUser.displayName = 'Self';
    });

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

    test('reports only players in playerList, correcting the self entry and deduplicating by name', () => {
        mocks.locationStore.lastLocation.playerList = new Map([
            ['usr_self', { displayName: 'OldSelf', userId: 'usr_self' }],
            ['usr_alice', { displayName: 'Alice', userId: 'usr_alice' }],
            ['usr_alice_dup', { displayName: 'Alice', userId: 'usr_alice_dup' }],
            ['usr_bob', { displayName: 'Bob', userId: '' }]
        ]);
        expect(buildSnapshot()).toEqual({
            location: PUBLIC_LOCATION,
            users: [
                { name: 'Self', id: 'usr_self' },
                { name: 'Alice', id: 'usr_alice' },
                { name: 'Bob', id: 'usr_bob' }
            ]
        });
    });

    test('never adds the login account when it is not in the instance', () => {
        mocks.locationStore.lastLocation.playerList = new Map([
            ['usr_duplicate', { displayName: 'Self', userId: 'usr_duplicate' }],
            ['usr_alice', { displayName: 'Alice', userId: 'usr_alice' }]
        ]);
        expect(buildSnapshot()).toEqual({
            location: PUBLIC_LOCATION,
            users: [
                { name: 'Self', id: 'usr_duplicate' },
                { name: 'Alice', id: 'usr_alice' }
            ]
        });
        mocks.locationStore.lastLocation.playerList = new Map();
        expect(buildSnapshot()).toEqual({ location: PUBLIC_LOCATION, users: [] });
    });

    test('builds payload from the snapshot roster, valid IDs as objects, and names as fallback', () => {
        const payload = buildIngestPayload({
            location: PUBLIC_LOCATION,
            self: { id: 'usr_self', displayName: 'Self' },
            clientTs: 1_800_000_000_000,
            users: [
                { name: 'Self', id: 'usr_duplicate' },
                { name: 'Alice', id: 'usr_alice' },
                { name: 'Bob', id: 'not-a-user-id' },
                { name: 'Carol' }
            ]
        });
        expect(payload).toEqual({
            reporter: 'usr_self',
            location: PUBLIC_LOCATION,
            n_users: 4,
            users: [{ name: 'Self', id: 'usr_duplicate' }, { name: 'Alice', id: 'usr_alice' }, 'Bob', 'Carol'],
            client_ts: 1_800_000_000_000,
            client: 'vrcx-dlc/2026.11.24'
        });
    });

    test('allows the reporter to be absent from the roster', () => {
        expect(
            buildIngestPayload({
                location: PUBLIC_LOCATION,
                self: { id: 'usr_self' },
                users: [{ name: 'Alice', id: 'usr_alice' }]
            })
        ).toMatchObject({
            reporter: 'usr_self',
            n_users: 1,
            users: [{ name: 'Alice', id: 'usr_alice' }]
        });
    });

    test('refuses a payload without a usable self identity', () => {
        expect(
            buildIngestPayload({
                location: PUBLIC_LOCATION,
                self: { id: 'invalid', displayName: 'Self' },
                users: []
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

describe('dlcxIngest snapshot polling state machine', () => {
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
        mocks.locationStore.lastLocation.location = 'offline';
        mocks.locationStore.lastLocation.playerList = new Map();
        mocks.ready = Promise.resolve();
        initDLCXIngest();
        await flushInitialization();
    });

    afterEach(() => {
        resetDLCXIngestForTests();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    test('location changes immediately upload the store snapshot with the request contract', () => {
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

    test('never uploads an empty roster before the player list is known', async () => {
        changeLocation(PUBLIC_LOCATION);
        expect(mocks.execute).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(INGEST_POLL_INTERVAL_MS);
        expect(mocks.execute).not.toHaveBeenCalled();
        join('Self', 'usr_self');
        await vi.advanceTimersByTimeAsync(INGEST_POLL_INTERVAL_MS);
        expect(mocks.execute).toHaveBeenCalledTimes(1);
        expect(JSON.parse(mocks.execute.mock.calls[0][0].body).users).toEqual([{ name: 'Self', id: 'usr_self' }]);
    });

    test('an unchanged snapshot does not report on the 60 second poll', async () => {
        enterPublicInstance();
        await vi.advanceTimersByTimeAsync(INGEST_POLL_INTERVAL_MS * 3);
        expect(mocks.execute).toHaveBeenCalledTimes(1);
    });

    test('playerList changes wait for the next 60 second poll without event debounce', async () => {
        enterPublicInstance();
        join('Alice', 'usr_alice');
        expect(mocks.execute).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(INGEST_POLL_INTERVAL_MS - 1);
        expect(mocks.execute).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(mocks.execute).toHaveBeenCalledTimes(2);
        const payload = JSON.parse(mocks.execute.mock.calls[1][0].body);
        expect(payload.users).toEqual([
            { name: 'Self', id: 'usr_self' },
            { name: 'Alice', id: 'usr_alice' }
        ]);
        leave('Alice', 'usr_alice');
        expect(mocks.execute).toHaveBeenCalledTimes(2);
    });

    test('an unchanged snapshot is still forced every five minutes', async () => {
        enterPublicInstance();
        await vi.advanceTimersByTimeAsync(INGEST_HEARTBEAT_MS - 1);
        expect(mocks.execute).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(mocks.execute).toHaveBeenCalledTimes(2);
    });

    test('worker timers continue polling and heartbeat while the page is hidden', async () => {
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        enterPublicInstance();
        join('Alice', 'usr_alice');
        await vi.advanceTimersByTimeAsync(INGEST_POLL_INTERVAL_MS);
        expect(mocks.execute).toHaveBeenCalledTimes(2);
        // 60s 的变化上报会刷新成功时间, 下一次强制心跳在其 5 分钟后.
        await vi.advanceTimersByTimeAsync(INGEST_HEARTBEAT_MS);
        expect(mocks.execute).toHaveBeenCalledTimes(3);
        expect(document.hidden).toBe(true);
    });

    test('private instances and missing prerequisites never make network requests', async () => {
        changeLocation('wrld_123:1~friends(usr_a)');
        join('Alice', 'usr_alice');
        await vi.advanceTimersByTimeAsync(INGEST_HEARTBEAT_MS * 2);
        expect(mocks.execute).not.toHaveBeenCalled();

        mocks.settings.licenseKey = '';
        await nextTick();
        enterPublicInstance();
        await vi.advanceTimersByTimeAsync(INGEST_POLL_INTERVAL_MS);
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

    test('logout clears pending work and stops polling', async () => {
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
        await vi.advanceTimersByTimeAsync(INGEST_POLL_INTERVAL_MS - 1);
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

    test('a 202 response resets network backoff and records the comparison snapshot', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        mocks.execute.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ status: 202, data: '' });
        enterPublicInstance();
        await flushInitialization();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(mocks.execute).toHaveBeenCalledTimes(2);
        join('Alice', 'usr_alice');
        await vi.advanceTimersByTimeAsync(30_000);
        expect(mocks.execute).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(INGEST_POLL_INTERVAL_MS);
        expect(mocks.execute).toHaveBeenCalledTimes(3);
    });
});

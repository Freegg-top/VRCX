// Oversee SSE 核心纯函数单测: 解析/过滤/去重/窗口聚合.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
    BeaconIdDeduper,
    BeaconWindowAggregator,
    PresenceToastDeduper,
    SSE_DATA_EVENTS,
    classifyBeacon,
    parseSseChunk
} from '../overseeWatchCore';

describe('SSE_DATA_EVENTS (契约: beacon 为主, message 兜底)', () => {
    it('accepts beacon and message, rejects other event names', () => {
        expect(SSE_DATA_EVENTS.has('beacon')).toBe(true);
        expect(SSE_DATA_EVENTS.has('message')).toBe(true);
        expect(SSE_DATA_EVENTS.has('error')).toBe(false);
        expect(SSE_DATA_EVENTS.has('keepalive')).toBe(false);
    });
});

describe('parseSseChunk', () => {
    it('parses a complete beacon event', () => {
        const { events, rest } = parseSseChunk('event: beacon\ndata: {"id":1}\n\n');
        expect(events).toEqual([{ event: 'beacon', data: '{"id":1}' }]);
        expect(rest).toBe('');
    });

    it('ignores keepalive comment lines (no data field)', () => {
        const { events, rest } = parseSseChunk(': keepalive\n\n');
        expect(events).toEqual([]);
        expect(rest).toBe('');
    });

    it('keeps partial lines in rest and completes them on the next chunk', () => {
        const first = parseSseChunk('event: beacon\ndata: {"id":');
        expect(first.events).toEqual([]);
        expect(first.rest).toBe('event: beacon\ndata: {"id":');

        const second = parseSseChunk(first.rest + '2}\n\n');
        expect(second.events).toEqual([{ event: 'beacon', data: '{"id":2}' }]);
        expect(second.rest).toBe('');
    });

    it('handles multiple events glued in one chunk (粘包)', () => {
        const { events, rest } = parseSseChunk(
            'event: beacon\ndata: {"id":"a"}\n\nevent: beacon\ndata: {"id":"b"}\n\n: keepalive\n\n'
        );
        expect(events).toEqual([
            { event: 'beacon', data: '{"id":"a"}' },
            { event: 'beacon', data: '{"id":"b"}' }
        ]);
        expect(rest).toBe('');
    });

    it('handles an event split across chunks mid-block (半块)', () => {
        const first = parseSseChunk('event: beacon\ndata: {"id":"a"}\n\nevent: bea');
        expect(first.events).toEqual([{ event: 'beacon', data: '{"id":"a"}' }]);
        expect(first.rest).toBe('event: bea');
        const second = parseSseChunk(first.rest + 'con\ndata: {"id":"b"}\n\n');
        expect(second.events).toEqual([{ event: 'beacon', data: '{"id":"b"}' }]);
    });

    it('normalizes CRLF line endings split across chunks', () => {
        const first = parseSseChunk('event: beacon\r\ndata: {"id":"a"}\r');
        expect(first.events).toEqual([]);
        const second = parseSseChunk(first.rest + '\n\ndata: x\n\n');
        expect(second.events[0]).toEqual({ event: 'beacon', data: '{"id":"a"}' });
        expect(second.events[1]).toEqual({ event: 'message', data: 'x' });
    });

    it('joins multi-line data fields with newline', () => {
        const { events } = parseSseChunk('data: line1\ndata:line2\n\n');
        expect(events).toEqual([{ event: 'message', data: 'line1\nline2' }]);
    });

    it('drops unknown fields and defaults event name to message', () => {
        const { events } = parseSseChunk('id: 42\nretry: 500\ndata: hello\n\n');
        expect(events).toEqual([{ event: 'message', data: 'hello' }]);
    });
});

describe('classifyBeacon', () => {
    const watchSet = new Set(['usr_watch']);
    const blockSet = new Set(['usr_block']);

    it('returns watch for watchlist hit when D3 enabled', () => {
        expect(
            classifyBeacon({
                userId: 'usr_watch',
                watchSet,
                blockSet,
                enableWatchPush: true,
                enableBlockAlerts: true
            })
        ).toBe('watch');
    });

    it('returns block for blacklist hit when D6 enabled', () => {
        expect(
            classifyBeacon({
                userId: 'usr_block',
                watchSet,
                blockSet,
                enableWatchPush: true,
                enableBlockAlerts: true
            })
        ).toBe('block');
    });

    it('returns both for a user on both lists', () => {
        const set = new Set(['usr_x']);
        expect(
            classifyBeacon({
                userId: 'usr_x',
                watchSet: set,
                blockSet: set,
                enableWatchPush: true,
                enableBlockAlerts: true
            })
        ).toBe('both');
    });

    it('returns null for miss or disabled toggles', () => {
        expect(
            classifyBeacon({
                userId: 'usr_other',
                watchSet,
                blockSet,
                enableWatchPush: true,
                enableBlockAlerts: true
            })
        ).toBeNull();
        expect(
            classifyBeacon({
                userId: 'usr_watch',
                watchSet,
                blockSet,
                enableWatchPush: false,
                enableBlockAlerts: true
            })
        ).toBeNull();
        expect(
            classifyBeacon({
                userId: 'usr_block',
                watchSet,
                blockSet,
                enableWatchPush: true,
                enableBlockAlerts: false
            })
        ).toBeNull();
    });
});

describe('BeaconIdDeduper', () => {
    it('dedupes replayed beacon ids after reconnect', () => {
        const deduper = new BeaconIdDeduper();
        expect(deduper.isNew('a')).toBe(true);
        expect(deduper.isNew('a')).toBe(false);
        expect(deduper.isNew('b')).toBe(true);
    });

    it('passes through beacons without id (宁可重复不可漏报)', () => {
        const deduper = new BeaconIdDeduper();
        expect(deduper.isNew('')).toBe(true);
        expect(deduper.isNew(undefined)).toBe(true);
        // 缺 id 不写入去重表
        expect(deduper.ids.size).toBe(0);
    });

    it('evicts oldest entry beyond capacity', () => {
        const deduper = new BeaconIdDeduper(2);
        deduper.isNew('a');
        deduper.isNew('b');
        deduper.isNew('c');
        expect(deduper.isNew('a')).toBe(true); // 已被淘汰
        expect(deduper.isNew('c')).toBe(false);
    });
});

describe('PresenceToastDeduper (10 分钟去重)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('allows first push, blocks repeats within TTL', () => {
        const deduper = new PresenceToastDeduper(10 * 60 * 1000);
        expect(deduper.shouldNotify('usr_a', 'wrld_x:1')).toBe(true);
        expect(deduper.shouldNotify('usr_a', 'wrld_x:1')).toBe(false);
    });

    it('separates by location', () => {
        const deduper = new PresenceToastDeduper(10 * 60 * 1000);
        expect(deduper.shouldNotify('usr_a', 'wrld_x:1')).toBe(true);
        expect(deduper.shouldNotify('usr_a', 'wrld_x:2')).toBe(true);
    });

    it('allows again after TTL expiry', () => {
        const deduper = new PresenceToastDeduper(10 * 60 * 1000);
        expect(deduper.shouldNotify('usr_a', 'loc')).toBe(true);
        vi.advanceTimersByTime(10 * 60 * 1000 + 1);
        expect(deduper.shouldNotify('usr_a', 'loc')).toBe(true);
    });
});

describe('BeaconWindowAggregator (2.5s 窗口分组)', () => {
    let schedule;
    let cancel;

    function createAggregator(onFlush, windowMs = 2500) {
        schedule = vi.fn((fn, ms) => setTimeout(fn, ms));
        cancel = vi.fn((handle) => clearTimeout(handle));
        return new BeaconWindowAggregator({ windowMs, onFlush, schedule, cancel });
    }

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('flushes one group per location after the window', () => {
        const flushed = [];
        const aggregator = createAggregator((location, beacons) => flushed.push([location, beacons]));
        aggregator.add({ id: '1', user_id: 'usr_a', location: 'wrld_x:1' });
        aggregator.add({ id: '2', user_id: 'usr_b', location: 'wrld_x:1' });
        aggregator.add({ id: '3', user_id: 'usr_c', location: 'wrld_y:2' });

        vi.advanceTimersByTime(2500);
        expect(flushed).toHaveLength(2);
        const byLoc = Object.fromEntries(flushed.map(([loc, beacons]) => [loc, beacons]));
        expect(byLoc['wrld_x:1'].map((b) => b.user_id)).toEqual(['usr_a', 'usr_b']);
        expect(byLoc['wrld_y:2'].map((b) => b.user_id)).toEqual(['usr_c']);
    });

    it('drops beacons without location', () => {
        const flushed = [];
        const aggregator = createAggregator((location, beacons) => flushed.push([location, beacons]));
        expect(aggregator.add({ id: '1', user_id: 'usr_a' })).toBe(false);
        vi.advanceTimersByTime(2500);
        expect(flushed).toEqual([]);
    });

    it('reset drops pending groups without flushing', () => {
        const flushed = [];
        const aggregator = createAggregator((location, beacons) => flushed.push([location, beacons]));
        aggregator.add({ id: '1', user_id: 'usr_a', location: 'wrld_x:1' });
        aggregator.reset();
        vi.advanceTimersByTime(2500);
        expect(flushed).toEqual([]);
    });

    it('only schedules one timer per location group', () => {
        const aggregator = createAggregator(() => {});
        aggregator.add({ id: '1', user_id: 'usr_a', location: 'loc' });
        aggregator.add({ id: '2', user_id: 'usr_b', location: 'loc' });
        expect(schedule).toHaveBeenCalledTimes(1);
    });
});

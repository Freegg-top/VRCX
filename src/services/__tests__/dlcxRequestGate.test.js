// LatestRequestGate: TracePanel 的"只接受最新请求"令牌逻辑.

import { describe, expect, it } from 'vitest';

import { LatestRequestGate } from '../dlcxRequestGate';

describe('LatestRequestGate', () => {
    it('first request token is current until a newer request begins', () => {
        const gate = new LatestRequestGate();
        const token = gate.begin();
        expect(gate.isCurrent(token)).toBe(true);
    });

    it('supersedes older tokens when a new request begins (UserDialog 切用户场景)', () => {
        const gate = new LatestRequestGate();
        const oldToken = gate.begin(); // usr_a 请求发出
        const newToken = gate.begin(); // 用户切到 usr_b
        expect(gate.isCurrent(oldToken)).toBe(false); // 旧响应必须被丢弃
        expect(gate.isCurrent(newToken)).toBe(true);
    });

    it('reset invalidates outstanding tokens', () => {
        const gate = new LatestRequestGate();
        const token = gate.begin();
        gate.reset();
        expect(gate.isCurrent(token)).toBe(false);
        expect(gate.isCurrent(gate.begin())).toBe(true);
    });
});

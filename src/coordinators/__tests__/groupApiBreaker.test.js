import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    warning: vi.fn(),
    translate: vi.fn((key) => key)
}));

vi.mock('vue-sonner', () => ({
    toast: { warning: mocks.warning }
}));

vi.mock('../../plugins/i18n', () => ({
    i18n: { global: { t: mocks.translate } }
}));

async function loadBreaker() {
    vi.resetModules();
    return import('../groupApiBreaker');
}

describe('groupApiBreaker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-23T00:00:00Z'));
        mocks.warning.mockReset();
        mocks.translate.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test('cools down for 60 seconds and warns once on the first 429', async () => {
        const breaker = await loadBreaker();

        expect(breaker.isGroupApiCoolingDown()).toBe(false);

        breaker.markGroupApi429();

        expect(breaker.isGroupApiCoolingDown()).toBe(true);
        expect(mocks.warning).toHaveBeenCalledTimes(1);
        expect(mocks.warning).toHaveBeenCalledWith('message.group_api.rate_limited');

        vi.advanceTimersByTime(59_999);
        expect(breaker.isGroupApiCoolingDown()).toBe(true);

        vi.advanceTimersByTime(1);
        expect(breaker.isGroupApiCoolingDown()).toBe(false);
    });

    test('doubles the cooldown for consecutive 429s without warning again', async () => {
        const breaker = await loadBreaker();

        breaker.markGroupApi429();
        vi.advanceTimersByTime(30_000);
        breaker.markGroupApi429();

        expect(mocks.warning).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(119_999);
        expect(breaker.isGroupApiCoolingDown()).toBe(true);

        vi.advanceTimersByTime(1);
        expect(breaker.isGroupApiCoolingDown()).toBe(false);
    });

    test('caps consecutive cooldowns at 15 minutes', async () => {
        const breaker = await loadBreaker();

        for (let i = 0; i < 10; i++) {
            breaker.markGroupApi429();
            vi.advanceTimersByTime(1);
        }

        expect(breaker.isGroupApiCoolingDown()).toBe(true);

        vi.advanceTimersByTime(900_000);
        expect(breaker.isGroupApiCoolingDown()).toBe(false);
    });

    test('a success resets the breaker and allows the next warning', async () => {
        const breaker = await loadBreaker();

        breaker.markGroupApi429();
        breaker.markGroupApiSuccess();

        expect(breaker.isGroupApiCoolingDown()).toBe(false);

        breaker.markGroupApi429();
        expect(breaker.isGroupApiCoolingDown()).toBe(true);
        expect(mocks.warning).toHaveBeenCalledTimes(2);
    });
});

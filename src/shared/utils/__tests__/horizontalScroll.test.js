import { getHorizontalWheelScroll } from '../horizontalScroll';

describe('getHorizontalWheelScroll', () => {
    test('prioritizes horizontal wheel movement', () => {
        expect(
            getHorizontalWheelScroll({
                deltaX: 12,
                deltaY: 8,
                scrollLeft: 0,
                clientWidth: 100,
                scrollWidth: 100
            })
        ).toEqual({ delta: 12, preventDefault: true });
    });

    test('scrolls right with vertical wheel movement when content overflows', () => {
        expect(
            getHorizontalWheelScroll({
                deltaX: 0,
                deltaY: 20,
                scrollLeft: 0,
                clientWidth: 100,
                scrollWidth: 200
            })
        ).toEqual({ delta: 20, preventDefault: true });
    });

    test('does not intercept vertical wheel movement at the right edge', () => {
        expect(
            getHorizontalWheelScroll({
                deltaX: 0,
                deltaY: 20,
                scrollLeft: 100,
                clientWidth: 100,
                scrollWidth: 200
            })
        ).toEqual({ delta: 0, preventDefault: false });
    });

    test('scrolls left with vertical wheel movement after scrolling right', () => {
        expect(
            getHorizontalWheelScroll({
                deltaX: 0,
                deltaY: -20,
                scrollLeft: 50,
                clientWidth: 100,
                scrollWidth: 200
            })
        ).toEqual({ delta: -20, preventDefault: true });
    });

    test('does not intercept vertical wheel movement without room in either direction', () => {
        const options = {
            deltaX: 0,
            scrollLeft: 0,
            clientWidth: 100,
            scrollWidth: 100
        };

        expect(getHorizontalWheelScroll({ ...options, deltaY: 20 })).toEqual({
            delta: 0,
            preventDefault: false
        });
        expect(getHorizontalWheelScroll({ ...options, deltaY: -20 })).toEqual({
            delta: 0,
            preventDefault: false
        });
    });

    test('ignores a wheel event without movement', () => {
        expect(
            getHorizontalWheelScroll({
                deltaX: 0,
                deltaY: 0,
                scrollLeft: 50,
                clientWidth: 100,
                scrollWidth: 200
            })
        ).toEqual({ delta: 0, preventDefault: false });
    });
});

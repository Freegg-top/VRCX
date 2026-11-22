/**
 * @param {object} options
 * @param {number} options.deltaX
 * @param {number} options.deltaY
 * @param {number} options.scrollLeft
 * @param {number} options.clientWidth
 * @param {number} options.scrollWidth
 * @returns {{ delta: number; preventDefault: boolean }}
 */
export function getHorizontalWheelScroll({ deltaX, deltaY, scrollLeft, clientWidth, scrollWidth }) {
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
        return { delta: deltaX, preventDefault: true };
    }

    const canScrollRight = deltaY > 0 && scrollLeft + clientWidth < scrollWidth;
    const canScrollLeft = deltaY < 0 && scrollLeft > 0;

    return {
        delta: canScrollLeft || canScrollRight ? deltaY : 0,
        preventDefault: canScrollLeft || canScrollRight
    };
}

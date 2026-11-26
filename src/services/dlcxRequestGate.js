// DLCX 面板共用"只接受最新请求"门控 (纯逻辑, 便于单测).
// 场景: 查询进行中用户切换目标 (TracePanel), 旧响应不得覆盖新目标.

class LatestRequestGate {
    constructor() {
        this.sequence = 0;
    }

    /**
     * 开启一次新请求, 返回本次令牌.
     *
     * @returns {number}
     */
    begin() {
        this.sequence += 1;
        return this.sequence;
    }

    /**
     * @param {number} token 请求开始时拿到的令牌
     * @returns {boolean} 是否仍是最新一次请求
     */
    isCurrent(token) {
        return token === this.sequence;
    }

    reset() {
        this.sequence = 0;
    }
}

export { LatestRequestGate };

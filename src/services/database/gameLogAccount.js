const files = new Map();

let currentFile = '';

/**
 * C# 每次推事件都带上日志文件名, 一个文件对应一次客户端启动, 也就是对应一个账号。
 *
 * @param {string} fileName
 */
function beginEventFile(fileName) {
    currentFile = typeof fileName === 'string' ? fileName : '';
    if (!currentFile) {
        return;
    }
    if (!files.has(currentFile)) {
        files.set(currentFile, { accountId: '', confirmed: false, firstAt: '', lastAt: '' });
    }
}

/**
 * @param {string} dt 事件时间, ISO 字符串
 */
function noteEventTime(dt) {
    const entry = files.get(currentFile);
    if (!entry || typeof dt !== 'string' || !dt) {
        return;
    }
    if (!entry.firstAt || dt < entry.firstAt) {
        entry.firstAt = dt;
    }
    if (!entry.lastAt || dt > entry.lastAt) {
        entry.lastAt = dt;
    }
}

/**
 * 未确认归属的文件写入空串, 表示"不知道属于谁", 而不是猜一个账号。
 *
 * @returns {string}
 */
function currentAccount() {
    const entry = files.get(currentFile);
    return entry && entry.confirmed ? entry.accountId : '';
}

/**
 * @param {string} fileName
 * @param {string} accountId
 * @returns {{ firstAt: string; lastAt: string } | null} 需要回填的时间窗口, 已确认过时返回 null
 */
function confirmFileAccount(fileName, accountId) {
    const entry = files.get(fileName);
    if (!entry || !accountId) {
        return null;
    }
    if (entry.confirmed && entry.accountId === accountId) {
        return null;
    }
    entry.accountId = accountId;
    entry.confirmed = true;
    return { firstAt: entry.firstAt, lastAt: entry.lastAt };
}

/**
 * @param {string} fileName
 * @returns {string}
 */
function getFileAccount(fileName) {
    const entry = files.get(fileName);
    return entry && entry.confirmed ? entry.accountId : '';
}

/**
 * @returns {{ fileName: string; accountId: string; confirmed: boolean }[]}
 */
function listFileAccounts() {
    return Array.from(files.entries()).map(([fileName, entry]) => ({
        fileName,
        accountId: entry.accountId,
        confirmed: entry.confirmed
    }));
}

function reset() {
    files.clear();
    currentFile = '';
}

export { beginEventFile, confirmFileAccount, currentAccount, getFileAccount, listFileAccounts, noteEventTime, reset };

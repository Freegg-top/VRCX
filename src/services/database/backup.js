import configRepository from '../config.js';
import sqliteService from '../sqlite.js';

const SNAPSHOT_PREFIX = 'VRCX-snapshot-';
const SNAPSHOT_SUFFIX = '.sqlite3';
const SNAPSHOT_SCHEMA = 'vrcx_snapshot_check';
const MAIN_DATABASE_KEY = 'VRCX_backupMainDbPath';
const SNAPSHOT_INDEX_KEY = 'VRCX_backupIndex';
const VERIFICATION_OK = 'ok';

/**
 * VACUUM INTO / ATTACH 不接受绑定参数, 路径只能拼进 SQL 字面量, 所以单引号必须翻倍。
 *
 * @param {string} value
 * @returns {string}
 */
function escapeSqlLiteral(value) {
    return String(value).replaceAll("'", "''");
}

/**
 * @param {string} path
 * @returns {string} 目录部分, 取不到时为空串
 */
function directoryOfPath(path) {
    const value = String(path);
    const index = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
    return index > 1 ? value.slice(0, index) : '';
}

/**
 * @param {string} path
 * @returns {string} 最后一段文件名
 */
function baseNameOfPath(path) {
    const value = String(path);
    const index = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
    return index > -1 ? value.slice(index + 1) : value;
}

/**
 * @param {string} directory
 * @param {string} file
 * @param {string} dbPath 用于沿用原路径的分隔符风格
 * @returns {string}
 */
function joinPath(directory, file, dbPath) {
    return String(dbPath).includes('\\') ? `${directory}\\${file}` : `${directory}/${file}`;
}

/**
 * 文件名不能带 Windows 非法字符, 所以时间戳用点短横线而不是冒号。
 *
 * @param {Date} date
 * @returns {string}
 */
function snapshotFileName(date) {
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}-${pad(
        date.getHours()
    )}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
    return `${SNAPSHOT_PREFIX}${stamp}${SNAPSHOT_SUFFIX}`;
}

/**
 * @param {string} dbPath 当前数据库绝对路径
 * @param {Date} date
 * @returns {string} 快照目标路径, 无法推导时为空串
 */
function buildSnapshotPath(dbPath, date) {
    const directory = directoryOfPath(dbPath);
    if (!directory) {
        return '';
    }
    return joinPath(directory, snapshotFileName(date), dbPath);
}

/**
 * VACUUM INTO 需要 SQLite >= 3.27。
 *
 * @param {string} version
 * @returns {boolean}
 */
function sqliteVersionSupported(version) {
    const [major, minor] = String(version)
        .split('.')
        .map((part) => parseInt(part, 10));
    if (!Number.isFinite(major) || !Number.isFinite(minor)) {
        return false;
    }
    return major > 3 || (major === 3 && minor >= 27);
}

/**
 * @param {string} name
 * @param {Date} date
 * @returns {{ name: string; date: string }}
 */
function toIso(name, date) {
    return { name, date: (date || new Date()).toJSON() };
}

const databaseBackup = {
    /**
     * @returns {Promise<string>} 当前正在使用的数据库文件绝对路径
     */
    async getDatabasePath() {
        let path = '';
        await sqliteService.execute((row) => {
            path = row[0] || '';
        }, `SELECT file FROM pragma_database_list WHERE name = 'main'`);
        return path;
    },

    /**
     * @returns {Promise<string>}
     */
    async getSqliteVersion() {
        let version = '';
        await sqliteService.execute((row) => {
            version = row[0] || '';
        }, `SELECT sqlite_version()`);
        return version;
    },

    /**
     * @returns {Promise<number>} 主库当前占用字节数
     */
    async getDatabaseSize() {
        let pageCount = 0;
        let pageSize = 0;
        await sqliteService.execute((row) => {
            pageCount = Number(row[0]) || 0;
        }, `PRAGMA main.page_count`);
        await sqliteService.execute((row) => {
            pageSize = Number(row[0]) || 0;
        }, `PRAGMA main.page_size`);
        return pageCount * pageSize;
    },

    /**
     * 校验快照。ATTACH 一个不存在的路径会创建空文件, 所以用表数量而不是异常来判定缺失。
     *
     * @param {string} path
     * @returns {Promise<{ ok: boolean; missing: boolean; size: number; detail: string }>}
     */
    async verifySnapshot(path) {
        const missing = !baseNameOfPath(path).startsWith(SNAPSHOT_PREFIX);
        let attached = false;
        try {
            await sqliteService.executeNonQuery(`ATTACH DATABASE '${escapeSqlLiteral(path)}' AS ${SNAPSHOT_SCHEMA}`);
            attached = true;
            let tables = 0;
            await sqliteService.execute((row) => {
                tables = Number(row[0]) || 0;
            }, `SELECT count(*) FROM ${SNAPSHOT_SCHEMA}.sqlite_master WHERE name = 'configs'`);
            let pageCount = 0;
            let pageSize = 0;
            await sqliteService.execute((row) => {
                pageCount = Number(row[0]) || 0;
            }, `PRAGMA ${SNAPSHOT_SCHEMA}.page_count`);
            await sqliteService.execute((row) => {
                pageSize = Number(row[0]) || 0;
            }, `PRAGMA ${SNAPSHOT_SCHEMA}.page_size`);
            let detail = '';
            await sqliteService.execute((row) => {
                if (!detail) {
                    detail = String(row[0] || '');
                }
            }, `PRAGMA ${SNAPSHOT_SCHEMA}.integrity_check`);
            const ok = tables > 0 && pageCount > 0 && detail === VERIFICATION_OK;
            return { ok, missing: tables === 0 || missing, size: pageCount * pageSize, detail };
        } catch (err) {
            return { ok: false, missing: false, size: 0, detail: String(err?.message || err) };
        } finally {
            if (attached) {
                try {
                    await sqliteService.executeNonQuery(`DETACH DATABASE ${SNAPSHOT_SCHEMA}`);
                } catch (err) {
                    console.error('[backup] detach failed:', err);
                }
            }
        }
    },

    /**
     * @param {string} name 快照名, 例如 'Auto Backup'
     * @param {Date} [date]
     * @returns {Promise<{ path: string; name: string; date: string; size: number; invalid?: boolean }>}
     */
    async createSnapshot(name, date) {
        const dbPath = await this.getDatabasePath();
        if (!dbPath) {
            throw new Error('无法确定数据库路径');
        }
        if (!sqliteVersionSupported(await this.getSqliteVersion())) {
            throw new Error('当前 SQLite 版本不支持 VACUUM INTO');
        }
        const path = buildSnapshotPath(dbPath, date || new Date());
        if (!path) {
            throw new Error('无法推导快照保存位置');
        }
        // VACUUM INTO 拒绝已存在的目标文件, 所以文件名必须唯一, 不做槽位复用
        await sqliteService.executeNonQuery(`VACUUM INTO '${escapeSqlLiteral(path)}'`);
        const checked = await this.verifySnapshot(path);
        /** @type {{ path: string; name: string; date: string; size: number; invalid?: boolean }} */
        const snapshot = {
            path,
            ...toIso(name, date),
            size: checked.size
        };
        await this.addSnapshot(snapshot);
        if (!checked.ok) {
            snapshot.invalid = true;
        }
        return snapshot;
    },

    /**
     * @returns {Promise<{ path: string; name: string; date: string; size: number }[]>} 按时间倒序
     */
    async listSnapshots() {
        const list = await configRepository.getArray(SNAPSHOT_INDEX_KEY, []);
        return list
            .filter((item) => item && typeof item.path === 'string')
            .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    },

    /**
     * @param {object} snapshot
     * @returns {Promise<void>}
     */
    async addSnapshot(snapshot) {
        const list = await configRepository.getArray(SNAPSHOT_INDEX_KEY, []);
        list.push(snapshot);
        await configRepository.setArray(SNAPSHOT_INDEX_KEY, list);
    },

    /**
     * 只清掉清单里的记录, 磁盘文件由用户在资源管理器里删除(前端没有删除文件的绑定)。
     *
     * @param {string} path
     * @returns {Promise<void>}
     */
    async forgetSnapshot(path) {
        const list = await configRepository.getArray(SNAPSHOT_INDEX_KEY, []);
        await configRepository.setArray(
            SNAPSHOT_INDEX_KEY,
            list.filter((item) => item?.path !== path)
        );
    },

    /**
     * 恢复 = 把启动指针切到快照, 绝不覆盖正在使用的库, 这样误操作可以立刻切回来。
     *
     * @param {string} path
     * @returns {Promise<{ from: string; to: string }>}
     */
    async restoreSnapshot(path) {
        const from = await this.getDatabasePath();
        if (!(await configRepository.getString(MAIN_DATABASE_KEY))) {
            await configRepository.setString(MAIN_DATABASE_KEY, from);
        }
        await VRCXStorage.Set('VRCX_DatabaseLocation', path);
        await VRCXStorage.Save();
        return { from, to: path };
    },

    /**
     * @returns {Promise<string>} 切走之前记录的主库路径, 空串表示默认位置
     */
    async getMainDatabasePath() {
        return configRepository.getString(MAIN_DATABASE_KEY, '');
    },

    /**
     * @returns {Promise<boolean>} 当前是否正运行在某个快照上
     */
    async isRunningFromSnapshot() {
        const mainPath = await configRepository.getString(MAIN_DATABASE_KEY);
        if (!mainPath) {
            return false;
        }
        const current = await this.getDatabasePath();
        return !!current && normalizeForCompare(current) !== normalizeForCompare(mainPath);
    },

    /**
     * @returns {Promise<void>}
     */
    async returnToMainDatabase() {
        const mainPath = await configRepository.getString(MAIN_DATABASE_KEY, '');
        await VRCXStorage.Set('VRCX_DatabaseLocation', mainPath || '');
        await VRCXStorage.Save();
        await configRepository.remove(MAIN_DATABASE_KEY);
    }
};

/**
 * @param {string} path
 * @returns {string}
 */
function normalizeForCompare(path) {
    return String(path).replaceAll('\\', '/').toLowerCase();
}

// 独立 service, 不并入 database 命名空间: 这里做的是快照文件层面的操作, 不是行级 CRUD
export { databaseBackup, buildSnapshotPath, escapeSqlLiteral, snapshotFileName, sqliteVersionSupported };

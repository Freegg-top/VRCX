import sqliteService from '../sqlite.js';

const SNAPSHOT_PREFIX = 'VRCX-snapshot-';
const SNAPSHOT_SUFFIX = '.sqlite3';
const SNAPSHOT_SCHEMA = 'vrcx_snapshot_check';
// P1-6: 主库路径标记与快照索引原来写进 SQLite configs 表, 但恢复切换后
// 运行的是快照库, 读不到主库的 configs —— 改用 VRCXStorage (VRCX.json), 跨库可见
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
 * ATTACH 用 file: URI + mode=rw 打开: 文件不存在时打开失败而不是创建空文件,
 * 避免「检查快照」按钮在磁盘上留下 0 字节垃圾文件。URI 里 '?' '#' '%' 有特殊
 * 含义, 翻成百分号编码; 快照路径由本模块生成, 正常不会包含这些字符。
 *
 * @param {string} path
 * @returns {string}
 */
function toAttachSql(path) {
    const uri = String(path)
        .replaceAll('\\', '/')
        .replaceAll('%', '%25')
        .replaceAll('#', '%23')
        .replaceAll('?', '%3F');
    return `ATTACH DATABASE 'file:${escapeSqlLiteral(uri)}?mode=rw' AS ${SNAPSHOT_SCHEMA}`;
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

/**
 * VRCXStorage 的键值都是字符串; 快照索引以 JSON 存取。
 *
 * @param {string} key
 * @returns {Promise<any[]>}
 */
async function storageGetArray(key) {
    const raw = await VRCXStorage.Get(key);
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error(`[backup] failed to parse ${key}:`, err);
        return [];
    }
}

/**
 * @param {string} key
 * @param {any[]} list
 * @returns {Promise<void>}
 */
async function storageSetArray(key, list) {
    await VRCXStorage.Set(key, JSON.stringify(list));
    await VRCXStorage.Save();
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
     * 校验快照。ATTACH 用 mode=rw 打开: 文件不存在时直接失败, 不会创建空文件,
     * 所以 missing 的判定不再靠文件名前缀, 而是「configs 表存在 + 文件大小 > 0」。
     *
     * @param {string} path
     * @returns {Promise<{ ok: boolean; missing: boolean; size: number; detail: string }>}
     */
    async verifySnapshot(path) {
        let attached = false;
        try {
            await sqliteService.executeNonQuery(toAttachSql(path));
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
            // mode=rw 打不开(文件不存在/不可访问)时在 catch 里判 missing;
            // 打开了但 configs 表缺失或 0 字节(空文件)同样视为 missing
            const missing = tables === 0 || pageCount === 0;
            const ok = tables > 0 && pageCount > 0 && detail === VERIFICATION_OK;
            return { ok, missing, size: pageCount * pageSize, detail };
        } catch (err) {
            return { ok: false, missing: true, size: 0, detail: String(err?.message || err) };
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
     * @param {boolean} [auto] P1-8: 自动备份标记, 用于轮换时与手动快照区分
     * @returns {Promise<{ path: string; name: string; date: string; size: number; invalid?: boolean }>}
     */
    async createSnapshot(name, date, auto = false) {
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
        /** @type {{ path: string; name: string; date: string; size: number; invalid?: boolean; auto?: boolean }} */
        const snapshot = {
            path,
            ...toIso(name, date),
            size: checked.size,
            auto: auto === true
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
        const list = await storageGetArray(SNAPSHOT_INDEX_KEY);
        return list
            .filter((item) => item && typeof item.path === 'string')
            .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    },

    /**
     * @param {object} snapshot
     * @returns {Promise<void>}
     */
    async addSnapshot(snapshot) {
        const list = await storageGetArray(SNAPSHOT_INDEX_KEY);
        list.push(snapshot);
        await storageSetArray(SNAPSHOT_INDEX_KEY, list);
    },

    /**
     * 清掉清单里的记录; 磁盘文件物理删除需要 AppApi 提供 DeleteFile 绑定
     * (当前版本没有), 有绑定时由 pruneAutoSnapshots 尽力调用。
     *
     * @param {string} path
     * @returns {Promise<void>}
     */
    async forgetSnapshot(path) {
        const list = await storageGetArray(SNAPSHOT_INDEX_KEY);
        await storageSetArray(
            SNAPSHOT_INDEX_KEY,
            list.filter((item) => item?.path !== path)
        );
    },

    /**
     * P1-8: 自动备份轮换, 保留最近 keepCount 份自动快照, 超出删最旧的。
     * 手动快照不动。删除失败仅告警不中断。
     *
     * @param {number} keepCount
     * @returns {Promise<void>}
     */
    async pruneAutoSnapshots(keepCount) {
        const count = Number(keepCount) || 0;
        if (count <= 0) {
            return;
        }
        const list = await this.listSnapshots();
        // 旧索引记录没有 auto 标记, 用快照名兜底识别
        const autoSnapshots = list.filter(
            (item) => item?.auto === true || item?.name === 'Auto Backup'
        );
        const excess = autoSnapshots.slice(count);
        for (const item of excess) {
            try {
                if (typeof AppApi !== 'undefined' && typeof AppApi.DeleteFile === 'function') {
                    await AppApi.DeleteFile(item.path);
                } else {
                    console.warn('[backup] no AppApi.DeleteFile binding, snapshot file kept:', item.path);
                }
            } catch (err) {
                // 删除失败仅告警不中断
                console.warn('[backup] failed to delete auto snapshot file:', item.path, err);
            }
            await this.forgetSnapshot(item.path);
        }
    },

    /**
     * 恢复 = 把启动指针切到快照, 绝不覆盖正在使用的库, 这样误操作可以立刻切回来。
     * P1-7: 切换前先校验快照(ok 且文件存在), 校验不过拒绝切换。
     *
     * @param {string} path
     * @returns {Promise<{ from: string; to: string }>}
     */
    async restoreSnapshot(path) {
        const checked = await this.verifySnapshot(path);
        if (!checked.ok || checked.missing) {
            throw new Error(`快照校验未通过: ${checked.detail}`);
        }
        const from = await this.getDatabasePath();
        // P1-6: 标记写进 VRCX.json(跨库可见), 且必须先写好再切指针 ——
        // 快照库读不到主库 configs 表, 写晚了就再也回不去了
        if (!(await VRCXStorage.Get(MAIN_DATABASE_KEY))) {
            await VRCXStorage.Set(MAIN_DATABASE_KEY, from);
            await VRCXStorage.Save();
        }
        await VRCXStorage.Set('VRCX_DatabaseLocation', path);
        await VRCXStorage.Save();
        return { from, to: path };
    },

    /**
     * @returns {Promise<string>} 切走之前记录的主库路径, 空串表示默认位置
     */
    async getMainDatabasePath() {
        return (await VRCXStorage.Get(MAIN_DATABASE_KEY)) || '';
    },

    /**
     * @returns {Promise<boolean>} 当前是否正运行在某个快照上
     */
    async isRunningFromSnapshot() {
        const mainPath = await VRCXStorage.Get(MAIN_DATABASE_KEY);
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
        const mainPath = await VRCXStorage.Get(MAIN_DATABASE_KEY);
        // P1-6: 标记缺失说明不知道该切回哪个库, 拒绝切换而不是把
        // VRCX_DatabaseLocation 抹空(抹空 = 回落默认位置, 可能丢数据)
        if (!mainPath) {
            throw new Error('主库路径标记缺失, 拒绝切换');
        }
        await VRCXStorage.Set('VRCX_DatabaseLocation', mainPath);
        await VRCXStorage.Set(MAIN_DATABASE_KEY, '');
        await VRCXStorage.Save();
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
export {
    databaseBackup,
    buildSnapshotPath,
    escapeSqlLiteral,
    snapshotFileName,
    sqliteVersionSupported,
    toAttachSql
};

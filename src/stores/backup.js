import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { toast } from 'vue-sonner';

import { databaseBackup } from '../services/database/backup';
import { formatFileSize } from '../shared/utils/base/format';
import { AUTO_BACKUP_MAX_SNAPSHOTS } from '../shared/constants/settings';
import { useModalStore } from './modal';

import configRepository from '../services/config';

const MAX_AUTO_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;
const DAY_MS = 86400000;

export const useBackupStore = defineStore('Backup', () => {
    const modalStore = useModalStore();
    const { t } = useI18n();

    const autoBackupEnabled = ref(true);
    const backupIntervalDays = ref(7);
    const lastBackupDate = ref('');
    const snapshots = ref([]);
    const busy = ref(false);
    const databasePath = ref('');
    const databaseSize = ref(0);
    const runningFromSnapshot = ref(false);

    async function initBackupSettings() {
        const [enabled, interval, lastDate] = await Promise.all([
            configRepository.getBool('VRCX_autoBackupEnabled', true),
            configRepository.getInt('VRCX_backupIntervalDays', 7),
            configRepository.getString('VRCX_backupLastDate', '')
        ]);
        autoBackupEnabled.value = enabled;
        backupIntervalDays.value = interval;
        lastBackupDate.value = lastDate;
        await refreshDatabaseInfo();
    }

    initBackupSettings();

    async function refreshDatabaseInfo() {
        try {
            databasePath.value = await databaseBackup.getDatabasePath();
            databaseSize.value = await databaseBackup.getDatabaseSize();
            runningFromSnapshot.value = await databaseBackup.isRunningFromSnapshot();
        } catch (err) {
            console.error('[backup] failed to read database info:', err);
        }
    }

    async function refreshSnapshotList() {
        try {
            snapshots.value = await databaseBackup.listSnapshots();
        } catch (err) {
            console.error('[backup] failed to list snapshots:', err);
            snapshots.value = [];
        }
    }

    /**
     * @param {string} name
     * @param {boolean} [auto] P1-8: 标记为自动备份, 参与轮换
     * @returns {Promise<object | null>}
     */
    async function createSnapshot(name, auto = false) {
        if (busy.value) {
            return null;
        }
        busy.value = true;
        try {
            const snapshot = await databaseBackup.createSnapshot(name, undefined, auto);
            /** @type {{ path: string; name: string; date: string; size: number; invalid?: boolean; sizeLabel?: string }} */
            const labeled = snapshot;
            labeled.sizeLabel = formatFileSize(snapshot.size);
            if (labeled.invalid) {
                // P2-8: 校验失败的快照不更新 lastBackupDate; 无效文件尽力删除
                // (当前 AppApi 没有 DeleteFile 绑定, 删不掉只告警), 记录移出清单
                try {
                    if (typeof AppApi !== 'undefined' && typeof AppApi.DeleteFile === 'function') {
                        await AppApi.DeleteFile(labeled.path);
                    } else {
                        console.warn('[backup] no AppApi.DeleteFile binding, invalid snapshot file kept:', labeled.path);
                    }
                } catch (err) {
                    console.warn('[backup] failed to delete invalid snapshot file:', err);
                }
                await databaseBackup.forgetSnapshot(labeled.path);
            } else {
                // P2-8: 仅校验通过才更新备份时间, 失败不刷 lastBackupDate
                await configRepository.setString('VRCX_backupLastDate', snapshot.date);
                lastBackupDate.value = snapshot.date;
            }
            await refreshSnapshotList();
            if (labeled.invalid) {
                toast.error(t('view.settings.advanced.database_backup.check_failed', { error: labeled.path }));
            } else {
                toast.success(t('view.settings.advanced.database_backup.created'));
            }
            return labeled;
        } catch (err) {
            console.error('[backup] snapshot failed:', err);
            toast.error(t('view.settings.advanced.database_backup.failed', { error: err?.message || err }));
            return null;
        } finally {
            busy.value = false;
        }
    }

    async function backupNow() {
        await createSnapshot('Manual Backup');
    }

    /**
     * @param {boolean} value
     */
    async function setAutoBackupEnabled(value) {
        autoBackupEnabled.value = value;
        await configRepository.setBool('VRCX_autoBackupEnabled', value);
    }

    /**
     * @param {number} value
     */
    async function setBackupIntervalDays(value) {
        backupIntervalDays.value = value;
        await configRepository.setInt('VRCX_backupIntervalDays', value);
    }

    async function runAutoBackup() {
        if (!autoBackupEnabled.value || busy.value) {
            return;
        }
        if (lastBackupDate.value) {
            const elapsed = Date.now() - new Date(lastBackupDate.value).getTime();
            if (elapsed < backupIntervalDays.value * DAY_MS) {
                return;
            }
        }
        // 快照是整库拷贝, 库过大时静默跳过而不是撑爆磁盘; 手动备份不受此限制
        const size = await databaseBackup.getDatabaseSize();
        if (size > MAX_AUTO_BACKUP_BYTES) {
            console.warn('[backup] database too large for automatic backup, skipping');
            return;
        }
        await createSnapshot('Auto Backup', true);
        // P1-8: 自动备份保留最近 AUTO_BACKUP_MAX_SNAPSHOTS 份, 超出删最旧的
        try {
            await databaseBackup.pruneAutoSnapshots(AUTO_BACKUP_MAX_SNAPSHOTS);
        } catch (err) {
            console.warn('[backup] auto snapshot rotation failed:', err);
        }
        await refreshSnapshotList();
    }

    /**
     * @param {object} snapshot
     */
    async function checkSnapshot(snapshot) {
        const checked = await databaseBackup.verifySnapshot(snapshot.path);
        if (checked.ok && !checked.missing) {
            toast.success(t('view.settings.advanced.database_backup.check_ok', { size: formatFileSize(checked.size) }));
        } else if (checked.missing) {
            toast.error(t('view.settings.advanced.database_backup.missing'));
        } else {
            toast.error(t('view.settings.advanced.database_backup.check_failed', { error: checked.detail }));
        }
    }

    /**
     * @param {object} snapshot
     * @returns {Promise<void>}
     */
    function restoreSnapshot(snapshot) {
        return modalStore
            .confirm({
                title: t('view.settings.advanced.database_backup.header'),
                description: t('view.settings.advanced.database_backup.confirm_restore')
            })
            .then(async ({ ok }) => {
                if (!ok) {
                    return;
                }
                // P1-7: 快照不存在/校验不过时 service 会抛错, toast 提示且不重启
                try {
                    await databaseBackup.restoreSnapshot(snapshot.path);
                } catch (err) {
                    console.error('[backup] restore failed:', err);
                    toast.error(t('view.settings.advanced.database_backup.check_failed', { error: err?.message || err }));
                    return;
                }
                await askRestart();
            })
            .catch((err) => console.error('[backup] restore cancelled:', err));
    }

    /**
     * @returns {Promise<void>}
     */
    function returnToMainDatabase() {
        return modalStore
            .confirm({
                title: t('view.settings.advanced.database_backup.header'),
                description: t('view.settings.advanced.database_backup.confirm_return')
            })
            .then(async ({ ok }) => {
                if (!ok) {
                    return;
                }
                // P1-6: 主库路径标记缺失时 service 拒绝切换并抛错, 不再静默把指针抹空
                try {
                    await databaseBackup.returnToMainDatabase();
                } catch (err) {
                    console.error('[backup] return to main database failed:', err);
                    toast.error(t('view.settings.advanced.database_backup.check_failed', { error: err?.message || err }));
                    return;
                }
                await askRestart();
            })
            .catch((err) => console.error('[backup] return cancelled:', err));
    }

    async function askRestart() {
        const { ok } = await modalStore.confirm({
            title: t('view.settings.advanced.database_backup.header'),
            description: t('view.settings.advanced.database_backup.restart_required'),
            confirmText: t('view.settings.advanced.database_backup.restart_now')
        });
        if (ok) {
            AppApi.RestartApplication(false);
        }
    }

    /**
     * @param {object} snapshot
     */
    function revealSnapshot(snapshot) {
        AppApi.OpenFolderAndSelectItem(snapshot.path, false).catch((err) => console.error(err));
    }

    /**
     * 前端没有删除文件的绑定, 这里只把记录移出清单, 文件由用户在资源管理器里删除。
     *
     * @param {object} snapshot
     */
    async function forgetSnapshot(snapshot) {
        await databaseBackup.forgetSnapshot(snapshot.path);
        await refreshSnapshotList();
    }

    return {
        autoBackupEnabled,
        backupIntervalDays,
        lastBackupDate,
        snapshots,
        busy,
        databasePath,
        databaseSize,
        runningFromSnapshot,
        backupNow,
        checkSnapshot,
        createSnapshot,
        forgetSnapshot,
        initBackupSettings,
        refreshDatabaseInfo,
        refreshSnapshotList,
        restoreSnapshot,
        returnToMainDatabase,
        revealSnapshot,
        runAutoBackup,
        setAutoBackupEnabled,
        setBackupIntervalDays
    };
});

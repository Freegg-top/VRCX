import { activityV2 } from './activityV2.js';
import { avatarFavorites } from './avatarFavorites.js';
import { avatarTags } from './avatarTags.js';
import { feed } from './feed.js';
import { friendFavorites } from './friendFavorites.js';
import { friendGroups } from './friendGroups.js';
import { friendNetwork } from './friendNetwork.js';
import { friendLogCurrent } from './friendLogCurrent.js';
import { friendLogHistory } from './friendLogHistory.js';
import { gameLog } from './gameLog.js';
import { memos } from './memos.js';
import { moderation } from './moderation.js';
import { mutualGraph } from './mutualGraph.js';
import { mutualEvents } from './mutualEvents.js';
import { notifications } from './notifications.js';
import { tableAlter } from './tableAlter.js';
import { tableFixes } from './tableFixes.js';
import { tableSize } from './tableSize.js';
import { userProfile } from './userProfile.js';
import { worldFavorites } from './worldFavorites.js';
import { printFavorites } from './printFavorites.js';
import { watchedUsers } from './watchedUsers.js';

import sqliteService from '../sqlite.js';

import { FEED_GROUP_RETENTION_DAYS } from '../../shared/constants/settings.js';

// P2-9: watched_user 建表语句此前在 initTables / initUserTables 各写一份, 合并为一份
const WATCHED_USER_TABLE_SQL =
    'CREATE TABLE IF NOT EXISTS watched_user (user_id TEXT NOT NULL, display_name TEXT, created_at TEXT, owner_user_id TEXT NOT NULL DEFAULT \'\', PRIMARY KEY (user_id, owner_user_id))';

const dbVars = import.meta.hot?.data.dbVars ?? {
    userId: '',
    userPrefix: '',
    maxTableSize: 500,
    searchTableSize: 5000
};

if (import.meta.hot) {
    import.meta.hot.data.dbVars = dbVars;
}

const database = {
    ...feed,
    ...activityV2,
    ...gameLog,
    ...notifications,
    ...moderation,
    ...friendLogHistory,
    ...friendLogCurrent,
    ...memos,
    ...avatarFavorites,
    ...avatarTags,
    ...friendFavorites,
    ...worldFavorites,
    ...printFavorites,
    ...tableAlter,
    ...tableFixes,
    ...tableSize,
    ...mutualGraph,
    ...mutualEvents,
    ...friendNetwork,
    ...friendGroups,
    ...watchedUsers,
    ...userProfile,

    setMaxTableSize(limit) {
        dbVars.maxTableSize = limit;
    },

    setSearchTableSize(limit) {
        dbVars.searchTableSize = limit;
    },

    async initUserTables(userId) {
        dbVars.userId = userId;
        dbVars.userPrefix = userId.replaceAll('-', '').replaceAll('_', '');
        // Fix escape, add underscore if prefix starts with a number
        if (dbVars.userPrefix.match(/^\d/)) {
            dbVars.userPrefix = '_' + dbVars.userPrefix;
        }
        // P0-2: owner 归属修复必须发生在登录后 —— 全局迁移(upgradeDatabaseVersion)
        // 在 store 初始化阶段执行, 早于登录, 当时 dbVars.userId 为空会把收藏/关注
        // 写成无主行; 这里按当前登录用户回填, 兼容救回历史迁移写成的 '' 行
        await this.migrateWatchedUserOwner();
        await this.backfillFavoriteOwner();
        await this.backfillWatchedUserOwner();
        await sqliteService.executeNonQuery(WATCHED_USER_TABLE_SQL);
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_feed_gps (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, location TEXT, world_name TEXT, previous_location TEXT, time INTEGER, group_name TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${dbVars.userPrefix}_feed_gps_user_created_idx ON ${dbVars.userPrefix}_feed_gps (user_id, created_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_feed_status (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, status TEXT, status_description TEXT, previous_status TEXT, previous_status_description TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_feed_bio (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, bio TEXT, previous_bio TEXT, bio_links TEXT, previous_bio_links TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_feed_avatar (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, owner_id TEXT, avatar_name TEXT, current_avatar_image_url TEXT, current_avatar_thumbnail_image_url TEXT, previous_current_avatar_image_url TEXT, previous_current_avatar_thumbnail_image_url TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${dbVars.userPrefix}_feed_avatar_user_created_idx ON ${dbVars.userPrefix}_feed_avatar (user_id, created_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_feed_online_offline (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, type TEXT, location TEXT, world_name TEXT, time INTEGER, group_name TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${dbVars.userPrefix}_feed_online_offline_user_created_idx ON ${dbVars.userPrefix}_feed_online_offline (user_id, created_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_activity_sync_state_v2 (
                user_id TEXT PRIMARY KEY,
                updated_at TEXT NOT NULL DEFAULT '',
                is_self INTEGER NOT NULL DEFAULT 0,
                source_last_created_at TEXT NOT NULL DEFAULT '',
                pending_session_start_at INTEGER,
                cached_range_days INTEGER NOT NULL DEFAULT 0
            )`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_activity_sessions_v2 (
                session_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                start_at INTEGER NOT NULL,
                end_at INTEGER NOT NULL,
                is_open_tail INTEGER NOT NULL DEFAULT 0,
                source_revision TEXT NOT NULL DEFAULT ''
            )`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${dbVars.userPrefix}_activity_sessions_v2_user_start_idx ON ${dbVars.userPrefix}_activity_sessions_v2 (user_id, start_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${dbVars.userPrefix}_activity_sessions_v2_user_end_idx ON ${dbVars.userPrefix}_activity_sessions_v2 (user_id, end_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_activity_bucket_cache_v2 (
                user_id TEXT NOT NULL,
                target_user_id TEXT NOT NULL DEFAULT '',
                range_days INTEGER NOT NULL,
                view_kind TEXT NOT NULL,
                exclude_key TEXT NOT NULL DEFAULT '',
                bucket_version INTEGER NOT NULL DEFAULT 1,
                raw_buckets_json TEXT NOT NULL DEFAULT '[]',
                normalized_buckets_json TEXT NOT NULL DEFAULT '[]',
                built_from_cursor TEXT NOT NULL DEFAULT '',
                summary_json TEXT NOT NULL DEFAULT '{}',
                built_at TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (user_id, target_user_id, range_days, view_kind, exclude_key)
            )`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_friend_log_current (user_id TEXT PRIMARY KEY, display_name TEXT, trust_level TEXT, friend_number INTEGER)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_friend_log_history (id INTEGER PRIMARY KEY, created_at TEXT, type TEXT, user_id TEXT, display_name TEXT, previous_display_name TEXT, trust_level TEXT, previous_trust_level TEXT, friend_number INTEGER)`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${dbVars.userPrefix}_friend_log_history_user_id_idx ON ${dbVars.userPrefix}_friend_log_history (user_id)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_notifications (id TEXT PRIMARY KEY, created_at TEXT, type TEXT, sender_user_id TEXT, sender_username TEXT, receiver_user_id TEXT, message TEXT, world_id TEXT, world_name TEXT, image_url TEXT, invite_message TEXT, request_message TEXT, response_message TEXT, expired INTEGER)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_notifications_v2 (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, expires_at TEXT, type TEXT, link TEXT, link_text TEXT, message TEXT, title TEXT, image_url TEXT, seen INTEGER, sender_user_id TEXT, sender_username TEXT, data TEXT, responses TEXT, details TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_moderation (user_id TEXT PRIMARY KEY, updated_at TEXT, display_name TEXT, block INTEGER, mute INTEGER)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_avatar_history (avatar_id TEXT PRIMARY KEY, created_at TEXT, time INTEGER)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_notes (user_id TEXT PRIMARY KEY, display_name TEXT, note TEXT, created_at TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_mutual_graph_friends (friend_id TEXT PRIMARY KEY)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_mutual_graph_links (friend_id TEXT NOT NULL, mutual_id TEXT NOT NULL, PRIMARY KEY(friend_id, mutual_id))`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_mutual_graph_meta (friend_id TEXT PRIMARY KEY, last_fetched_at TEXT, opted_out INTEGER DEFAULT 0)`
        );
        // 老库加列: 记录 opted-out 首次检测时间 (SQLite 无 IF NOT EXISTS, try/catch 判重)
        try {
            await sqliteService.executeNonQuery(
                `ALTER TABLE ${dbVars.userPrefix}_mutual_graph_meta ADD COLUMN opt_out_detected_at TEXT`
            );
        } catch (e) {
            const msg = e?.message || e?.toString?.() || '';
            if (msg.indexOf('duplicate column name') === -1) {
                console.error('[db] mutual_graph_meta opt_out_detected_at alter failed:', e);
            }
        }
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_mutual_event_history (
                id INTEGER PRIMARY KEY,
                created_at TEXT,
                event_type TEXT,
                friend_id_a TEXT,
                friend_id_b TEXT
            )`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${dbVars.userPrefix}_mutual_event_history_created_idx ON ${dbVars.userPrefix}_mutual_event_history (created_at)`
        );
        // A组委托: dedup 索引升级为 UNIQUE, 新库直接建 unique
        await sqliteService.executeNonQuery(
            `CREATE UNIQUE INDEX IF NOT EXISTS ${dbVars.userPrefix}_mutual_event_history_dedup_idx ON ${dbVars.userPrefix}_mutual_event_history (event_type, friend_id_a, friend_id_b, created_at)`
        );
        // 老库升级: 同名旧索引是非 unique 的, 先按规范化 pair(a/b 排序)去重再换 unique。
        // 只在检测到非 unique 索引时跑一次, 不动 mutualEvents 的查询, 失败不阻塞启动
        let mutualDedupIndexSql = '';
        await sqliteService.execute((dbRow) => {
            mutualDedupIndexSql = String(dbRow[0] || '');
        }, `SELECT sql FROM sqlite_schema WHERE type='index' AND name = '${dbVars.userPrefix}_mutual_event_history_dedup_idx'`);
        if (mutualDedupIndexSql && !mutualDedupIndexSql.toUpperCase().includes('UNIQUE')) {
            try {
                await sqliteService.executeNonQuery(
                    `DELETE FROM ${dbVars.userPrefix}_mutual_event_history WHERE id NOT IN (
                        SELECT MIN(id) FROM ${dbVars.userPrefix}_mutual_event_history GROUP BY event_type,
                            CASE WHEN friend_id_a <= friend_id_b THEN friend_id_a ELSE friend_id_b END,
                            CASE WHEN friend_id_a <= friend_id_b THEN friend_id_b ELSE friend_id_a END,
                            created_at
                    )`
                );
                await sqliteService.executeNonQuery(
                    `DROP INDEX IF EXISTS ${dbVars.userPrefix}_mutual_event_history_dedup_idx`
                );
                await sqliteService.executeNonQuery(
                    `CREATE UNIQUE INDEX IF NOT EXISTS ${dbVars.userPrefix}_mutual_event_history_dedup_idx ON ${dbVars.userPrefix}_mutual_event_history (event_type, friend_id_a, friend_id_b, created_at)`
                );
            } catch (e) {
                console.error('[db] mutual_event_history unique dedup upgrade failed:', e);
            }
        }
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_friend_network_user (user_id TEXT PRIMARY KEY, mutual_ids TEXT NOT NULL DEFAULT '[]', last_fetched_at TEXT, opted_out INTEGER DEFAULT 0)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_friend_network_owner (owner_id TEXT PRIMARY KEY, display_name TEXT, last_seen TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_friend_group_snapshot (user_id TEXT PRIMARY KEY, group_ids TEXT NOT NULL DEFAULT '[]', updated_at TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_friend_fof_snapshot (user_id TEXT PRIMARY KEY, display_name TEXT, group_ids TEXT NOT NULL DEFAULT '[]', updated_at TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_feed_group (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, group_id TEXT, group_name TEXT, change_type TEXT)`
        );
        // feed 表查询按 (user_id, created_at) 过滤/排序, 补索引
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS ${dbVars.userPrefix}_feed_group_user_created_idx ON ${dbVars.userPrefix}_feed_group (user_id, created_at)`
        );
        // 保留期清理: 对齐 mutual 事件 180 天的清理模式; mutual 的清理在它的
        // coordinator 里跑(本组禁改区), 这里选在登录必经的 initUserTables 执行,
        // 每次登录清一次足够(见汇报说明)
        try {
            const cutoffDate = new Date(
                Date.now() - FEED_GROUP_RETENTION_DAYS * 24 * 60 * 60 * 1000
            ).toISOString();
            await sqliteService.executeNonQuery(
                `DELETE FROM ${dbVars.userPrefix}_feed_group WHERE created_at < @cutoff`,
                { '@cutoff': cutoffDate }
            );
        } catch (e) {
            console.error('[db] feed_group retention cleanup failed:', e);
        }
        // 老库升级: 清掉历史残留的空 group_id 行(旧版本 gmem->grp 迁移期的坏数据)
        // 与去重 DELETE 都有全表开销, 用「唯一索引是否已建成」做一次性门槛,
        // 索引在就不重跑(索引建失败时下个登录重试), 不再每次登录全表扫描
        let feedGroupDedupReady = false;
        await sqliteService.execute((dbRow) => {
            feedGroupDedupReady = !!dbRow[0];
        }, `SELECT 1 FROM sqlite_schema WHERE type='index' AND name = '${dbVars.userPrefix}_feed_group_dedup'`);
        if (!feedGroupDedupReady) {
            try {
                await sqliteService.executeNonQuery(
                    `DELETE FROM ${dbVars.userPrefix}_feed_group WHERE group_id = '' OR group_id IS NULL`
                );
                // 老数据里可能有同键重复行, 先去重再建唯一索引
                await sqliteService.executeNonQuery(
                    `DELETE FROM ${dbVars.userPrefix}_feed_group WHERE id NOT IN (SELECT MAX(id) FROM ${dbVars.userPrefix}_feed_group GROUP BY created_at, user_id, group_id, change_type)`
                );
                await sqliteService.executeNonQuery(
                    `CREATE UNIQUE INDEX IF NOT EXISTS ${dbVars.userPrefix}_feed_group_dedup ON ${dbVars.userPrefix}_feed_group (created_at, user_id, group_id, change_type)`
                );
            } catch (e) {
                console.error('[db] feed_group dedup index setup failed:', e);
            }
        }
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS ${dbVars.userPrefix}_user_profile (user_id TEXT PRIMARY KEY, bio TEXT, bio_links TEXT, updated_at TEXT)`
        );
    },

    async initTables() {
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_location (id INTEGER PRIMARY KEY, created_at TEXT, location TEXT, world_id TEXT, world_name TEXT, time INTEGER, group_name TEXT, account_user_id TEXT, UNIQUE(created_at, location))`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS gamelog_location_created_at_idx ON gamelog_location (created_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS idx_gamelog_location_world_created ON gamelog_location (world_id, created_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_join_leave (id INTEGER PRIMARY KEY, created_at TEXT, type TEXT, display_name TEXT, location TEXT, user_id TEXT, time INTEGER, account_user_id TEXT, UNIQUE(created_at, type, display_name))`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS idx_gamelog_jl_location ON gamelog_join_leave (location)`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS idx_gamelog_jl_user_created ON gamelog_join_leave (user_id, created_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS idx_gamelog_jl_display_created ON gamelog_join_leave (display_name, created_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_portal_spawn (id INTEGER PRIMARY KEY, created_at TEXT, display_name TEXT, location TEXT, user_id TEXT, instance_id TEXT, world_name TEXT, account_user_id TEXT, UNIQUE(created_at, display_name))`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_video_play (id INTEGER PRIMARY KEY, created_at TEXT, video_url TEXT, video_name TEXT, video_id TEXT, location TEXT, display_name TEXT, user_id TEXT, account_user_id TEXT, UNIQUE(created_at, video_url))`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_resource_load (id INTEGER PRIMARY KEY, created_at TEXT, resource_url TEXT, resource_type TEXT, location TEXT, account_user_id TEXT, UNIQUE(created_at, resource_url))`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_event (id INTEGER PRIMARY KEY, created_at TEXT, data TEXT, account_user_id TEXT, UNIQUE(created_at, data))`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_external (id INTEGER PRIMARY KEY, created_at TEXT, message TEXT, display_name TEXT, user_id TEXT, location TEXT, account_user_id TEXT, UNIQUE(created_at, message))`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS cache_avatar (id TEXT PRIMARY KEY, added_at TEXT, author_id TEXT, author_name TEXT, created_at TEXT, description TEXT, image_url TEXT, name TEXT, release_status TEXT, thumbnail_image_url TEXT, updated_at TEXT, version INTEGER)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS cache_world (id TEXT PRIMARY KEY, added_at TEXT, author_id TEXT, author_name TEXT, created_at TEXT, description TEXT, image_url TEXT, name TEXT, release_status TEXT, thumbnail_image_url TEXT, updated_at TEXT, version INTEGER)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS favorite_world (id INTEGER PRIMARY KEY, created_at TEXT, world_id TEXT, group_name TEXT, owner_user_id TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS favorite_print (id INTEGER PRIMARY KEY, print_id TEXT UNIQUE, created_at TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS favorite_avatar (id INTEGER PRIMARY KEY, created_at TEXT, avatar_id TEXT, group_name TEXT, owner_user_id TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS favorite_friend (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, group_name TEXT, owner_user_id TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS memos (user_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS world_memos (world_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS avatar_memos (avatar_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS avatar_tags (avatar_id TEXT NOT NULL, tag TEXT NOT NULL, color TEXT, PRIMARY KEY (avatar_id, tag))`
        );
        await sqliteService.executeNonQuery(WATCHED_USER_TABLE_SQL);
    },

    begin() {
        sqliteService.executeNonQuery('BEGIN');
    },

    commit() {
        sqliteService.executeNonQuery('COMMIT');
    },

    async vacuum() {
        await sqliteService.executeNonQuery('VACUUM');
    },

    async optimize() {
        await sqliteService.executeNonQuery('PRAGMA optimize');
    }
};

window.database = database;
export { database, dbVars };

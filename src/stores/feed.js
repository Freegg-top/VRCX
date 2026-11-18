import { ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';

import { database } from '../services/database';
import { MUTUAL_FEED_TYPES, mutualEventToFeedRow } from '../shared/utils/mutualFeedRows';
import { useFriendStore } from './friend';
import { useUserStore } from './user';
import { useVrcxStore } from './vrcx';
import { watchState } from '../services/watchState';

import configRepository from '../services/config';

export const useFeedStore = defineStore('Feed', () => {
    const friendStore = useFriendStore();
    const userStore = useUserStore();
    const vrcxStore = useVrcxStore();

    const feedTableData = shallowRef([]);
    const feedTable = ref({
        search: '',
        dateFrom: '',
        dateTo: '',
        vip: false,
        loading: false,
        filter: [],
        pageSize: 20,
        pageSizeLinked: true
    });

    watch(
        () => watchState.isLoggedIn,
        (isLoggedIn) => {
            feedTableData.value = [];
            if (isLoggedIn) {
                initFeedTable();
            }
        },
        { flush: 'sync' }
    );

    watch(
        () => watchState.isFavoritesLoaded,
        (isFavoritesLoaded) => {
            if (isFavoritesLoaded && feedTable.value.vip) {
                feedTableLookup(); // re-apply VIP filter after friends are loaded
            }
        }
    );

    async function init() {
        feedTable.value.filter = JSON.parse(await configRepository.getString('VRCX_feedTableFilters', '[]'));
        feedTable.value.vip = await configRepository.getBool('VRCX_feedTableVIPFilter', false);
    }

    init();

    function feedSearch(row) {
        const value = feedTable.value.search.trim().toUpperCase();
        if (!value) {
            return true;
        }
        if (
            (value.startsWith('wrld_') || value.startsWith('grp_')) &&
            (String(row.location).toUpperCase().includes(value) ||
                String(row.groupId).toUpperCase().includes(value))
        ) {
            return true;
        }
        switch (row.type) {
            case 'GPS':
                if (String(row.displayName).toUpperCase().includes(value)) {
                    return true;
                }
                if (String(row.worldName).toUpperCase().includes(value)) {
                    return true;
                }
                return false;
            case 'Online':
                if (String(row.displayName).toUpperCase().includes(value)) {
                    return true;
                }
                if (String(row.worldName).toUpperCase().includes(value)) {
                    return true;
                }
                return false;
            case 'Offline':
                if (String(row.displayName).toUpperCase().includes(value)) {
                    return true;
                }
                if (String(row.worldName).toUpperCase().includes(value)) {
                    return true;
                }
                return false;
            case 'Status':
                if (String(row.displayName).toUpperCase().includes(value)) {
                    return true;
                }
                if (String(row.status).toUpperCase().includes(value)) {
                    return true;
                }
                if (String(row.statusDescription).toUpperCase().includes(value)) {
                    return true;
                }
                return false;
            case 'Avatar':
                if (String(row.displayName).toUpperCase().includes(value)) {
                    return true;
                }
                if (String(row.avatarName).toUpperCase().includes(value)) {
                    return true;
                }
                return false;
            case 'Bio':
                if (String(row.displayName).toUpperCase().includes(value)) {
                    return true;
                }
                if (String(row.bio).toUpperCase().includes(value)) {
                    return true;
                }
                if (String(row.previousBio).toUpperCase().includes(value)) {
                    return true;
                }
                if (row.bioLinks?.some((link) => String(link).toUpperCase().includes(value))) {
                    return true;
                }
                return false;
            case 'GroupChange':
                if (String(row.displayName).toUpperCase().includes(value)) {
                    return true;
                }
                if (String(row.groupName).toUpperCase().includes(value)) {
                    return true;
                }
                return false;
            case 'MutualFriendshipEnd':
            case 'MutualFriendshipStart':
            case 'MutualOptOut': {
                // mutual 事件无 displayName 字段, 按解析后的双方显示名匹配
                const resolveName = (id) => (id ? (userStore.cachedUsers.get(id)?.displayName ?? id) : '');
                const nameA = String(resolveName(row.friendIdA || row.userId)).toUpperCase();
                const nameB = String(resolveName(row.friendIdB)).toUpperCase();
                return nameA.includes(value) || nameB.includes(value);
            }
        }
        return true;
    }

    let feedLookupSeq = 0;

    async function feedTableLookup() {
        const lookupSeq = ++feedLookupSeq;
        await configRepository.setString('VRCX_feedTableFilters', JSON.stringify(feedTable.value.filter));
        await configRepository.setBool('VRCX_feedTableVIPFilter', feedTable.value.vip);
        feedTable.value.loading = true;
        try {
            let vipList = [];
            if (feedTable.value.vip) {
                vipList = Array.from(friendStore.localFavoriteFriends.values());
            }
            const vipSet = feedTable.value.vip ? new Set(vipList) : null;
            const search = feedTable.value.search.trim();
            const { dateFrom, dateTo } = feedTable.value;
            const filter = feedTable.value.filter;
            const includeMutual = filter.length === 0 || MUTUAL_FEED_TYPES.some((t) => filter.includes(t));
            const rows =
                search || dateFrom || dateTo
                    ? await database.searchFeedDatabase(
                          search,
                          filter,
                          vipList,
                          vrcxStore.searchLimit,
                          dateFrom,
                          dateTo
                      )
                    : await database.lookupFeedDatabase(filter, vipList);
            let merged = rows;
            if (includeMutual) {
                // 共同好友事件独立查询后 JS 层合并: 不动现有 UNION 查询的列结构
                const mutualEvents = await database.getMutualEvents({ limit: vrcxStore.maxTableSize });
                merged = merged.concat(
                    mutualEvents.map(mutualEventToFeedRow).filter((row) => {
                        if (filter.length > 0 && !filter.includes(row.type)) {
                            return false;
                        }
                        // P2-7: mutual 行与其他行一致, 应用 VIP 过滤与搜索过滤
                        if (vipSet && !vipSet.has(row.userId)) {
                            return false;
                        }
                        if (!feedSearch(row)) {
                            return false;
                        }
                        if (dateFrom && row.created_at < dateFrom) {
                            return false;
                        }
                        if (dateTo && row.created_at > dateTo) {
                            return false;
                        }
                        return true;
                    })
                );
                merged.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
            }
            // P2-8: 校验移到最终赋值之前 (getMutualEvents 之后重新比较一次)
            if (lookupSeq !== feedLookupSeq) {
                // 已有更新的查询完成: 丢弃本次过期结果 (防止先发后至覆盖新数据)
                return;
            }
            feedTableData.value = [];
            feedTableData.value = [...feedTableData.value, ...merged];
        } finally {
            if (lookupSeq === feedLookupSeq) {
                feedTable.value.loading = false;
            }
        }
    }

    /**
     * Appends a feed entry to the local table if it passes filters.
     * Does NOT trigger notifications or shared feed — that is the caller's responsibility.
     *
     * @param {object} feed The feed entry to add.
     */
    function addFeedEntry(feed) {
        if (feedTable.value.filter.length > 0 && !feedTable.value.filter.includes(feed.type)) {
            return;
        }
        if (feedTable.value.vip && !friendStore.localFavoriteFriends.has(feed.userId)) {
            return;
        }
        if (!feedSearch(feed)) {
            return;
        }
        if (feedTable.value.dateFrom && feed.created_at < feedTable.value.dateFrom) {
            return;
        }
        if (feedTable.value.dateTo && feed.created_at > feedTable.value.dateTo) {
            return;
        }
        feedTableData.value = [feed, ...feedTableData.value];
        sweepFeed();
    }

    function sweepFeed() {
        const j = feedTableData.value.length;
        if (j > vrcxStore.maxTableSize + 50) {
            feedTableData.value = feedTableData.value.slice(0, -50);
        }
    }

    async function initFeedTable() {
        feedTable.value.loading = true;
        await feedTableLookup();
        feedTable.value.loading = false;
    }

    return {
        feedTable,
        feedTableData,
        initFeedTable,
        feedTableLookup,
        addFeedEntry
    };
});

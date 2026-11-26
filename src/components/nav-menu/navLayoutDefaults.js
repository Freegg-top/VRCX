import { DASHBOARD_NAV_KEY_PREFIX } from '../../shared/constants';

export const DLC_NAV_FOLDER_ID = 'default-folder-dlc';
export const DLC_NAV_KEYS = [
    'friend-network',
    'friend-avatars',
    'friend-worlds',
    'charts-friend-activity',
    'friend-groups',
    'watched-users'
];

export function createBaseDefaultNavLayout(t) {
    return [
        { type: 'item', key: 'feed' },
        { type: 'item', key: 'friends-locations' },
        { type: 'item', key: 'game-log' },
        { type: 'item', key: 'player-list' },
        {
            type: 'folder',
            id: DLC_NAV_FOLDER_ID,
            nameKey: 'nav_tooltip.dlc',
            name: t('nav_tooltip.dlc'),
            icon: 'ri-sparkling-line',
            items: [...DLC_NAV_KEYS]
        },
        { type: 'item', key: 'search' },
        {
            type: 'folder',
            id: 'default-folder-favorites',
            nameKey: 'nav_tooltip.favorites',
            name: t('nav_tooltip.favorites'),
            icon: 'ri-star-line',
            items: ['favorite-friends', 'favorite-worlds', 'favorite-avatars']
        },
        {
            type: 'folder',
            id: 'default-folder-social',
            nameKey: 'nav_tooltip.social',
            name: t('nav_tooltip.social'),
            icon: 'ri-group-line',
            items: ['friend-log', 'friend-list', 'moderation']
        },
        { type: 'item', key: 'notification' },
        { type: 'item', key: 'my-avatars' },
        {
            type: 'folder',
            id: 'default-folder-charts',
            nameKey: 'nav_tooltip.charts',
            name: t('nav_tooltip.charts'),
            icon: 'ri-pie-chart-line',
            items: ['charts-instance', 'charts-mutual', 'charts-hot-worlds']
        },
        { type: 'item', key: 'tools' },
        { type: 'item', key: 'direct-access' }
    ];
}

/**
 * Move DLC entries from older flat/custom layouts into one stable folder.
 * Other entries retain their relative order and custom folders stay intact.
 */
export function ensureDlcNavGroup(layout, t) {
    if (!Array.isArray(layout)) {
        return layout;
    }

    const dlcKeySet = new Set(DLC_NAV_KEYS);
    const foundKeys = new Set();
    const nextLayout = [];
    let insertAt = -1;

    layout.forEach((entry) => {
        if (entry?.type === 'item' && dlcKeySet.has(entry.key)) {
            foundKeys.add(entry.key);
            if (insertAt === -1) {
                insertAt = nextLayout.length;
            }
            return;
        }

        if (entry?.type === 'folder') {
            const existingDlcFolder = entry.id === DLC_NAV_FOLDER_ID;
            const remainingItems = (entry.items || []).filter((key) => {
                if (!dlcKeySet.has(key)) {
                    return true;
                }
                foundKeys.add(key);
                if (insertAt === -1) {
                    insertAt = nextLayout.length;
                }
                return false;
            });

            if (existingDlcFolder) {
                if (insertAt === -1) {
                    insertAt = nextLayout.length;
                }
                return;
            }
            if (remainingItems.length || !(entry.items || []).length) {
                nextLayout.push({ ...entry, items: remainingItems });
            }
            return;
        }

        nextLayout.push(entry);
    });

    if (!foundKeys.size && insertAt === -1) {
        return layout;
    }

    nextLayout.splice(insertAt === -1 ? nextLayout.length : insertAt, 0, {
        type: 'folder',
        id: DLC_NAV_FOLDER_ID,
        nameKey: 'nav_tooltip.dlc',
        name: t('nav_tooltip.dlc'),
        icon: 'ri-sparkling-line',
        items: [...DLC_NAV_KEYS]
    });
    return nextLayout;
}

export function insertDashboardEntries(layout, dashboardDefinitions) {
    const nextLayout = Array.isArray(layout) ? [...layout] : [];
    const dashboardEntries = (dashboardDefinitions || []).map((def) => ({
        type: 'item',
        key: def.key
    }));

    if (!dashboardEntries.length) {
        return nextLayout;
    }

    const directAccessIdx = nextLayout.findIndex((entry) => entry.type === 'item' && entry.key === 'direct-access');

    if (directAccessIdx !== -1) {
        nextLayout.splice(directAccessIdx, 0, ...dashboardEntries);
    } else {
        nextLayout.push(...dashboardEntries);
    }

    return nextLayout;
}

export function isDashboardNavKey(key) {
    return String(key || '').startsWith(DASHBOARD_NAV_KEY_PREFIX);
}

import { isNavEntryActionable } from './navActionUtils';
import { DLC_NAV_FOLDER_ID } from './navLayoutDefaults';

const DEFAULT_FOLDER_ICON = 'ri-folder-line';

/**
 * @param {Array} layout
 * @returns {Set<string>}
 */
export function collectLayoutKeys(layout) {
    const keys = new Set();
    if (!Array.isArray(layout)) {
        return keys;
    }

    layout.forEach((entry) => {
        if (entry?.type === 'item' && entry.key) {
            keys.add(entry.key);
            return;
        }

        if (entry?.type === 'folder' && Array.isArray(entry.items)) {
            entry.items.forEach((key) => {
                if (key) {
                    keys.add(key);
                }
            });
        }
    });

    return keys;
}

/**
 * @param {Array} layout
 * @param {Map<string, any>} navDefinitionMap
 * @param {Function} t
 * @returns {Array}
 */
export function buildMenuItems(layout, navDefinitionMap, t) {
    const items = [];

    layout.forEach((entry) => {
        if (entry.type === 'item') {
            const definition = navDefinitionMap.get(entry.key);
            if (!definition) {
                return;
            }

            items.push({
                ...definition,
                index: definition.key,
                title: definition.tooltip || definition.labelKey,
                titleIsCustom: Boolean(definition.isDashboard)
            });
            return;
        }

        if (entry.type === 'folder') {
            const folderDefinitions = (entry.items || []).map((key) => navDefinitionMap.get(key)).filter(Boolean);
            if (folderDefinitions.length === 0) {
                return;
            }

            const folderNameKey = entry.nameKey || (entry.id === DLC_NAV_FOLDER_ID ? 'nav_tooltip.dlc' : null);
            items.push({
                index: entry.id,
                icon: entry.icon || DEFAULT_FOLDER_ICON,
                title: folderNameKey || entry.name?.trim() || t('nav_menu.custom_nav.folder_name_placeholder'),
                titleIsCustom: !folderNameKey,
                children: folderDefinitions.map((definition) => ({
                    label: definition.labelKey,
                    routeName: definition.routeName,
                    routeParams: definition.routeParams,
                    index: definition.key,
                    icon: definition.icon,
                    action: definition.action,
                    path: definition.path,
                    titleIsCustom: Boolean(definition.isDashboard)
                }))
            });
        }
    });

    return items;
}

/**
 * @param {Array} layout
 * @param {Map<string, any>} navDefinitionMap
 * @returns {object | null}
 */
export function findFirstNavEntry(layout, navDefinitionMap) {
    for (const entry of layout) {
        if (entry.type === 'item') {
            const definition = navDefinitionMap.get(entry.key);
            if (isNavEntryActionable(definition)) {
                return definition;
            }
        }

        if (entry.type === 'folder' && entry.items?.length) {
            const definition = entry.items
                .map((key) => navDefinitionMap.get(key))
                .find((def) => isNavEntryActionable(def));
            if (definition) {
                return definition;
            }
        }
    }

    return null;
}

/**
 * @param {Array} layout
 * @param {Map<string, any>} navDefinitionMap
 * @returns {string | null}
 */
export function findFirstNavKey(layout, navDefinitionMap) {
    const entry = findFirstNavEntry(layout, navDefinitionMap);
    return entry?.key || null;
}

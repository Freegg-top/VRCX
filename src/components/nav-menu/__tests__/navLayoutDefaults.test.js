import { describe, expect, it } from 'vitest';

import { createBaseDefaultNavLayout, DLC_NAV_FOLDER_ID, DLC_NAV_KEYS, ensureDlcNavGroup } from '../navLayoutDefaults';

const t = (key) => key;

describe('DLC navigation layout', () => {
    it('uses the required order in the default layout', () => {
        const layout = createBaseDefaultNavLayout(t);
        const folder = layout.find((entry) => entry.id === DLC_NAV_FOLDER_ID);

        expect(folder.items).toEqual([
            'friend-network',
            'friend-avatars',
            'friend-worlds',
            'charts-friend-activity',
            'friend-groups',
            'watched-users'
        ]);
        expect(layout.find((entry) => entry.id === 'default-folder-charts').items).not.toContain(
            'charts-friend-activity'
        );
    });

    it('keeps the existing DLC folder position and adds new DLC entries', () => {
        const migrated = ensureDlcNavGroup(
            [
                { type: 'item', key: 'feed' },
                {
                    type: 'folder',
                    id: DLC_NAV_FOLDER_ID,
                    nameKey: 'nav_tooltip.dlc',
                    name: 'nav_tooltip.dlc',
                    items: ['friend-network']
                },
                { type: 'item', key: 'search' }
            ],
            t
        );

        expect(migrated.map((entry) => entry.id || entry.key)).toEqual(['feed', DLC_NAV_FOLDER_ID, 'search']);
        expect(migrated[1].items).toEqual(DLC_NAV_KEYS);
        expect(migrated[1].nameKey).toBe('nav_tooltip.dlc');
    });

    it('migrates flat and previous folder entries without reordering unrelated items', () => {
        const migrated = ensureDlcNavGroup(
            [
                { type: 'item', key: 'feed' },
                { type: 'item', key: 'friend-groups' },
                { type: 'item', key: 'friend-network' },
                { type: 'folder', id: 'charts', items: ['charts-instance', 'charts-friend-activity'] },
                { type: 'item', key: 'friend-avatars' },
                { type: 'item', key: 'friend-worlds' },
                { type: 'item', key: 'search' }
            ],
            t
        );

        expect(migrated.map((entry) => entry.id || entry.key)).toEqual(['feed', DLC_NAV_FOLDER_ID, 'charts', 'search']);
        expect(migrated[1].items).toEqual(DLC_NAV_KEYS);
        expect(migrated[2].items).toEqual(['charts-instance']);
    });
});

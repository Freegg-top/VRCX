import { describe, expect, it } from 'vitest';

import { buildMenuItems } from '../navLayoutHelpers';

const definitions = new Map([
    ['friend-network', { key: 'friend-network', labelKey: 'nav_tooltip.friend_network', routeName: 'friend-network' }]
]);

describe('buildMenuItems', () => {
    it('keeps built-in folder names translatable instead of displaying the stored key', () => {
        const [folder] = buildMenuItems(
            [
                {
                    type: 'folder',
                    id: 'default-folder-dlc',
                    nameKey: 'nav_tooltip.dlc',
                    name: 'nav_tooltip.dlc',
                    items: ['friend-network']
                }
            ],
            definitions,
            (key) => key
        );

        expect(folder.title).toBe('nav_tooltip.dlc');
        expect(folder.titleIsCustom).toBe(false);
    });

    it('repairs a persisted DLC folder that only has the raw key as its name', () => {
        const [folder] = buildMenuItems(
            [
                {
                    type: 'folder',
                    id: 'default-folder-dlc',
                    name: 'nav_tooltip.dlc',
                    items: ['friend-network']
                }
            ],
            definitions,
            (key) => `translated:${key}`
        );

        expect(folder.title).toBe('nav_tooltip.dlc');
        expect(folder.titleIsCustom).toBe(false);
    });

    it('preserves custom folder names', () => {
        const [folder] = buildMenuItems(
            [{ type: 'folder', id: 'custom', name: 'My folder', items: ['friend-network'] }],
            definitions,
            (key) => key
        );

        expect(folder.title).toBe('My folder');
        expect(folder.titleIsCustom).toBe(true);
    });
});

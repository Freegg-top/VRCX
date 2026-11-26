import { describe, expect, it } from 'vitest';

import { navDefinitions } from '../../../shared/constants';

function getDefinition(key) {
    return navDefinitions.find((definition) => definition.key === key);
}

describe('navDefinitions watched-users entry', () => {
    it('navigates to the watched-users page route instead of dispatching a dialog action', () => {
        const definition = getDefinition('watched-users');

        expect(definition).toBeTruthy();
        expect(definition.routeName).toBe('watched-users');
        expect(definition.action).toBeUndefined();
    });

    it('keeps the eye icon and label key', () => {
        const definition = getDefinition('watched-users');

        expect(definition.icon).toBe('ri-eye-line');
        expect(definition.labelKey).toBe('nav_tooltip.watched_users');
    });
});

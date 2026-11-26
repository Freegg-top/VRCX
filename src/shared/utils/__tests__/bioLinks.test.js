import { describe, expect, it } from 'vitest';

import { parseBioLinks } from '../bioLinks';

describe('parseBioLinks', () => {
    it('renders Markdown-style VRChat bio links with their label', () => {
        expect(parseBioLinks('My site: [Example](https://example.com/path)')).toEqual([
            { type: 'text', text: 'My site: ' },
            { type: 'link', text: 'Example', url: 'https://example.com/path' }
        ]);
    });

    it('linkifies raw HTTP URLs and keeps trailing punctuation as text', () => {
        expect(parseBioLinks('See https://example.com/profile, then http://example.org.')).toEqual([
            { type: 'text', text: 'See ' },
            { type: 'link', text: 'https://example.com/profile', url: 'https://example.com/profile' },
            { type: 'text', text: ', then ' },
            { type: 'link', text: 'http://example.org', url: 'http://example.org' },
            { type: 'text', text: '.' }
        ]);
    });

    it('does not turn non-HTTP schemes or HTML into links', () => {
        expect(parseBioLinks('[bad](javascript:alert(1)) <b>text</b>')).toEqual([
            { type: 'text', text: '[bad](javascript:alert(1)) <b>text</b>' }
        ]);
    });

    it('returns no segments for empty values', () => {
        expect(parseBioLinks('')).toEqual([]);
        expect(parseBioLinks(null)).toEqual([]);
    });
});

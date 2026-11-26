const BIO_LINK_PATTERN = /\[([^\]\r\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"']+)/gi;
const TRAILING_URL_PUNCTUATION = /[.,!?;:，。！？；：]+$/u;

/**
 * Split bio text into plain-text and safe HTTP(S) link segments. VRChat bios
 * commonly use Markdown-style links, while older profiles may contain raw URLs.
 *
 * @param {string} bio
 * @returns {{ type: 'text' | 'link'; text: string; url?: string }[]}
 */
function parseBioLinks(bio) {
    if (typeof bio !== 'string' || !bio) {
        return [];
    }

    const segments = [];
    let cursor = 0;
    for (const match of bio.matchAll(BIO_LINK_PATTERN)) {
        const markdownLabel = match[1];
        let url = match[2] || match[3];
        const rawStart = match.index;
        let rawEnd = rawStart + match[0].length;

        if (!markdownLabel) {
            const trailing = url.match(TRAILING_URL_PUNCTUATION)?.[0] || '';
            if (trailing) {
                url = url.slice(0, -trailing.length);
                rawEnd -= trailing.length;
            }
        }
        if (!url) {
            continue;
        }

        if (rawStart > cursor) {
            segments.push({ type: 'text', text: bio.slice(cursor, rawStart) });
        }
        segments.push({ type: 'link', text: markdownLabel || url, url });
        cursor = rawEnd;
    }

    if (cursor < bio.length) {
        segments.push({ type: 'text', text: bio.slice(cursor) });
    }
    return segments;
}

export { parseBioLinks };

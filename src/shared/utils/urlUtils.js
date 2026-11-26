/**
 * @param {string} resource
 * @returns {string}
 */
function getFaviconUrl(resource) {
    // 主源：站点自身 /favicon.ico —— 国内直连可靠（第三方图标服务不可达）
    if (!resource) {
        return '';
    }
    try {
        const url = new URL(resource);
        return `https://${url.host}/favicon.ico`;
    } catch (err) {
        console.error('Invalid URL:', resource, err);
        return '';
    }
}

function getFaviconFallbackUrl(resource) {
    // 回退：DuckDuckGo 图标服务（代理环境可达）
    if (!resource) {
        return '';
    }
    try {
        const url = new URL(resource);
        return `https://icons.duckduckgo.com/ip2/${url.host}.ico`;
    } catch (err) {
        return '';
    }
}

function onFaviconError(event, resource) {
    const img = event?.target;
    if (!img) {
        return;
    }
    if (img.dataset.faviconFallback !== '1') {
        img.dataset.faviconFallback = '1';
        const fallback = getFaviconFallbackUrl(resource);
        if (fallback) {
            img.src = fallback;
            return;
        }
    }
    img.style.display = 'none';
}

/**
 * @param {string} url
 * @returns {string}
 */
function replaceVrcPackageUrl(url) {
    if (!url) {
        return '';
    }
    return url.replace('https://api.vrchat.cloud/', 'https://vrchat.com/');
}

export { getFaviconUrl, getFaviconFallbackUrl, onFaviconError, replaceVrcPackageUrl };

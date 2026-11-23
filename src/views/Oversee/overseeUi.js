// Oversee 页面共用的小工具: API 错误文案映射.

import { toast } from 'vue-sonner';

/**
 * OverseeApiError.kind → i18n 文案 (view.oversee.error.*).
 *
 * @param {unknown} error
 * @param {(key: string, named?: Record<string, unknown>) => string} t
 * @returns {string}
 */
function overseeErrorMessage(error, t) {
    const kind = String(/** @type {{ kind?: string } | undefined} */ (error)?.kind || 'server');
    return t(`view.oversee.error.${kind}`);
}

/**
 * 统一弹 toast 错误提示.
 *
 * @param {unknown} error
 * @param {(key: string, named?: Record<string, unknown>) => string} t
 */
function showOverseeError(error, t) {
    toast.error(overseeErrorMessage(error, t));
}

export { showOverseeError };

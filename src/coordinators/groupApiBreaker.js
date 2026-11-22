import { toast } from 'vue-sonner';
import { i18n } from '../plugins/i18n';

// 群组接口 429 熔断: 任一群组后台流程遇 429, 全部群组后台任务统一暂停
// (指数退避: 60s 起, 每次连续 429 翻倍, 上限 15 分钟; 任一请求成功即重置)
const BASE_COOLDOWN_MS = 60000;
const MAX_COOLDOWN_MS = 900000;
const MAX_COOLDOWN_LEVEL = 4;

let cooldownUntil = 0;
let level = 0;

/**
 * @returns {boolean}
 */
export function isGroupApiCoolingDown() {
    return Date.now() < cooldownUntil;
}

export function markGroupApi429() {
    const wasCoolingDown = isGroupApiCoolingDown();
    level = wasCoolingDown ? Math.min(level + 1, MAX_COOLDOWN_LEVEL) : 0;
    cooldownUntil = Date.now() + Math.min(BASE_COOLDOWN_MS * 2 ** level, MAX_COOLDOWN_MS);
    if (!wasCoolingDown) {
        toast.warning(i18n.global.t('message.group_api.rate_limited'));
    }
}

export function markGroupApiSuccess() {
    level = 0;
    cooldownUntil = 0;
}

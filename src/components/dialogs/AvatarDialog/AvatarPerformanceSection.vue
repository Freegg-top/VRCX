<script setup>
    import { computed } from 'vue';
    import { useI18n } from 'vue-i18n';

    import { BYTES_PER_MIB, groupStatEntries, isAnalysisUsable } from '@/shared/constants/avatarPerformance';

    const props = defineProps({
        analysis: {
            type: Object,
            default: () => ({})
        }
    });

    const { t, te } = useI18n();

    const PLATFORM_ORDER = ['standalonewindows', 'android', 'ios'];
    const RANK_NONE = 'None';

    const platforms = computed(() => {
        const entries = Object.entries(props.analysis || {}).filter(([, value]) => value && typeof value === 'object');
        return entries.sort((a, b) => {
            const indexA = PLATFORM_ORDER.indexOf(a[0]);
            const indexB = PLATFORM_ORDER.indexOf(b[0]);
            return (indexA < 0 ? 99 : indexA) - (indexB < 0 ? 99 : indexB);
        });
    });

    /**
     * @param {string} rank
     * @returns {string}
     */
    function rankIcon(rank) {
        return `/images/performance_ranks/${String(rank).toLowerCase()}.png`;
    }

    /**
     * @param {string} key
     * @returns {string}
     */
    function metricLabel(key) {
        const path = `dialog.avatar.performance.metric.${key}`;
        return te(path)
            ? t(path)
            : key
                  .replace(/Count$/u, '')
                  .replace(/([A-Z])/gu, ' $1')
                  .trim();
    }

    /**
     * @param {string} platform
     * @returns {string}
     */
    function platformLabel(platform) {
        const path = `dialog.group_event_edit.platform_values.${platform}`;
        return te(path) ? t(path) : platform;
    }

    /**
     * @param {object} row
     * @returns {string}
     */
    function formatValue(row) {
        if (row.key === 'bounds' && Array.isArray(row.value)) {
            return `${row.value.map((axis) => Number(axis).toFixed(2)).join(' × ')} m`;
        }
        if (typeof row.value === 'boolean') {
            return row.value ? t('dialog.avatar.performance.yes') : t('dialog.avatar.performance.no');
        }
        if (row.key === 'totalTextureUsage') {
            return `${(row.value / BYTES_PER_MIB).toFixed(1)} MiB`;
        }
        if (typeof row.value === 'number') {
            return row.value.toLocaleString();
        }
        return '—';
    }

    /**
     * @param {object} row
     * @returns {string}
     */
    function formatLimit(row) {
        if (!row.scored || row.maximum === null || row.maximum === undefined) {
            return '—';
        }
        if (Array.isArray(row.maximum)) {
            return `${row.maximum.join(' × ')} m`;
        }
        if (row.key === 'totalTextureUsage') {
            return `${row.maximum} MiB`;
        }
        return Number(row.maximum).toLocaleString();
    }

    /**
     * @param {object} analysis
     * @param {string} platform
     * @returns {{ key: string; rows: object[] }[]}
     */
    function groupsFor(analysis, platform) {
        return groupStatEntries(analysis, platform);
    }

    /**
     * @param {object} analysis
     * @returns {boolean}
     */
    function usable(analysis) {
        return isAnalysisUsable(analysis);
    }

    /**
     * @param {string} rating
     * @returns {boolean}
     */
    function hasRank(rating) {
        return Boolean(rating) && rating !== RANK_NONE;
    }
</script>

<template>
    <div v-if="platforms.length" class="my-2 text-xs rounded-xl bg-(--profile-card) p-3">
        <div
            class="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2 pb-2 border-b border-border">
            {{ t('dialog.avatar.performance.header') }}
        </div>

        <div v-for="[platform, analysis] in platforms" :key="platform" class="mb-3 last:mb-0">
            <div class="flex items-center justify-between gap-2 mb-1.5">
                <span class="font-medium">{{ platformLabel(platform) }}</span>
                <span v-if="hasRank(analysis.performanceRating)" class="inline-flex items-center gap-1.5">
                    <img class="size-4" :src="rankIcon(analysis.performanceRating)" :alt="analysis.performanceRating" />
                    <span class="text-muted-foreground">{{
                        t(`dialog.avatar.tags.performanceRating.${analysis.performanceRating}`)
                    }}</span>
                </span>
            </div>

            <p v-if="!usable(analysis)" class="text-muted-foreground mb-1.5">
                {{ t('dialog.avatar.performance.unscanned') }}
            </p>

            <template v-for="group in groupsFor(analysis, platform)" :key="group.key">
                <div class="text-[10px] uppercase tracking-wide text-muted-foreground mt-1.5 mb-0.5">
                    {{ t(`dialog.avatar.performance.group.${group.key}`) }}
                </div>
                <div
                    v-for="row in group.rows"
                    :key="row.key"
                    class="flex items-center justify-between gap-2 py-0.5 border-b border-border last:border-0">
                    <span class="text-muted-foreground shrink-0 truncate">{{ metricLabel(row.key) }}</span>
                    <span class="flex items-center gap-2 shrink-0">
                        <span class="tabular-nums">{{ formatValue(row) }}</span>
                        <span class="text-muted-foreground tabular-nums w-20 text-right">
                            / {{ formatLimit(row) }}
                        </span>
                        <img
                            v-if="row.rank"
                            class="size-4"
                            :src="rankIcon(row.rank)"
                            :alt="row.rank"
                            :title="t(`dialog.avatar.tags.performanceRating.${row.rank}`)" />
                        <span v-else class="size-4 inline-block text-center leading-4">—</span>
                    </span>
                </div>
            </template>
        </div>
    </div>
</template>

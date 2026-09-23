<template>
    <div id="chart" class="x-container">
        <div ref="friendActivityRef" class="pt-12">
            <BackToTop :target="friendActivityRef" :right="30" :bottom="30" :teleport="false" />
            <div class="options-container flex items-center justify-between mt-0">
                <span class="shrink-0">{{ t('view.charts.friend_activity.header') }}</span>
                <div class="flex items-center">
                    <TooltipWrapper :content="t('view.charts.instance_activity.refresh')" side="top">
                        <Button class="rounded-full mr-1.5" size="icon" variant="ghost" @click="reloadData">
                            <RefreshCcw />
                        </Button>
                    </TooltipWrapper>
                    <ButtonGroup class="mr-2">
                        <TooltipWrapper :content="t('view.charts.instance_activity.previous_day')" side="top">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                :disabled="isPrevDayBtnDisabled"
                                @click="changeSelectedDateFromBtn(false)">
                                <ArrowLeft />
                            </Button>
                        </TooltipWrapper>
                        <TooltipWrapper :content="t('view.charts.instance_activity.next_day')" side="top">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                :disabled="isNextDayBtnDisabled"
                                @click="changeSelectedDateFromBtn(true)">
                                <ArrowRight />
                            </Button>
                        </TooltipWrapper>
                    </ButtonGroup>
                    <Popover v-model:open="isDatePickerOpen">
                        <PopoverTrigger asChild>
                            <div>
                                <Button
                                    variant="outline"
                                    class="w-50 justify-start text-left font-normal"
                                    :disabled="isLoading">
                                    <CalendarIcon class="mr-2 h-4 w-4" />
                                    {{ dayjs(selectedDate).format('YYYY-MM-DD') }}
                                </Button>
                            </div>
                        </PopoverTrigger>
                        <PopoverContent class="w-auto p-0" align="end">
                            <Calendar
                                :model-value="calendarModelValue"
                                :default-placeholder="defaultCalendarPlaceholder"
                                :is-date-disabled="isCalendarDateDisabled"
                                :prevent-deselect="true"
                                :week-starts-on="weekStartsOn"
                                initial-focus
                                @update:modelValue="handleCalendarModelUpdate" />
                        </PopoverContent>
                    </Popover>
                </div>
            </div>

            <div class="mt-4 flex flex-col items-center gap-2">
                <VirtualCombobox
                    class="w-72"
                    v-model="selectedFriendId"
                    :groups="friendPickerGroups"
                    :placeholder="t('view.charts.friend_activity.select')"
                    :search-placeholder="t('view.charts.friend_activity.select')"
                    :clearable="true"
                    :close-on-select="true"
                    :deselect-on-reselect="true">
                    <template #item="{ item, selected }">
                        <div class="flex w-full items-center p-1.5 text-[13px]">
                            <div class="mr-2.5 inline-block size-9 flex-none">
                                <img
                                    v-if="item.iconUrl"
                                    class="size-full rounded-full object-cover"
                                    :src="item.iconUrl"
                                    loading="lazy" />
                                <div
                                    v-else
                                    class="bg-muted flex size-full items-center justify-center rounded-full text-xs">
                                    {{ item.label?.charAt(0) }}
                                </div>
                            </div>
                            <div class="flex-1 overflow-hidden">
                                <span
                                    class="block truncate font-medium leading-[18px]"
                                    v-text="item.label"></span>
                            </div>
                            <CheckIcon
                                :class="[
                                    'ml-auto size-4',
                                    selected ? 'opacity-100' : 'opacity-0'
                                ]" />
                        </div>
                    </template>
                    <template #empty>
                        {{ t('view.charts.friend_activity.no_matches') }}
                    </template>
                </VirtualCombobox>
                <span class="text-muted-foreground text-xs">
                    {{ t('view.charts.friend_activity.description') }}
                </span>
            </div>

            <div v-if="!selectedFriendId" class="text-muted-foreground flex items-center justify-center py-10 text-sm">
                {{ t('view.charts.friend_activity.select_hint') }}
            </div>
            <template v-else-if="!isLoading">
                <div
                    v-if="
                        friendActivityDetailData.length === 0 &&
                        friendWorldRecords.length === 0
                    "
                    class="text-muted-foreground py-10 text-center text-sm">
                    {{ t('view.charts.friend_activity.no_data') }}
                </div>
                <template v-else>
                    <div v-if="friendActivityDetailData.length" class="mt-4 flex flex-col gap-2">
                        <div class="text-muted-foreground text-sm">
                            {{ t('view.charts.friend_activity.shared_instances') }}
                        </div>
                        <InstanceActivityDetail
                            v-for="arr in friendActivityDetailData"
                            :key="arr[0].location + arr[0].created_at"
                            :activity-detail-data="arr"
                            :bar-width="barWidth" />
                    </div>
                    <div v-if="friendWorldRecords.length" class="mt-6">
                        <div class="text-muted-foreground mb-2 text-sm">
                            {{ t('view.charts.friend_activity.world_records') }}
                        </div>
                        <div class="flex flex-col gap-1">
                            <div
                                v-for="row in friendWorldRecords"
                                :key="row.created_at + row.location"
                                class="hover:bg-accent flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm"
                                @click="openWorld(row)">
                                <span class="min-w-0 flex-1 truncate">
                                    {{ row.worldName || row.location }}
                                </span>
                                <Badge
                                    v-if="row.groupName"
                                    variant="outline"
                                    class="flex-none text-xs">
                                    {{ row.groupName }}
                                </Badge>
                                <span
                                    v-if="row.durationMs > 0"
                                    class="text-muted-foreground flex-none text-xs">
                                    {{ timeToText(row.durationMs, true) }}
                                </span>
                                <span
                                    v-else
                                    class="text-muted-foreground flex-none text-xs">
                                    {{ t('view.charts.friend_activity.still_here') }}
                                </span>
                                <span class="text-muted-foreground flex-none text-xs">
                                    {{ formatTime(row.created_at) }}
                                </span>
                            </div>
                        </div>
                    </div>
                </template>
            </template>
            <div v-else class="text-muted-foreground flex items-center justify-center py-10 text-sm">
                {{ t('view.charts.friend_activity.loading') }}
            </div>
        </div>
    </div>
</template>

<script setup>
    defineOptions({ name: 'ChartsFriendActivity' });

    import { computed, onMounted, ref, watch } from 'vue';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import { ArrowLeft, ArrowRight, Calendar as CalendarIcon, CheckIcon, RefreshCcw } from 'lucide-vue-next';
    import { fromDate, getLocalTimeZone, today } from '@internationalized/date';
    import { toDate } from 'reka-ui/date';

    import BackToTop from '@/components/BackToTop.vue';
    import dayjs from 'dayjs';

    import { Button } from '@/components/ui/button';
    import { ButtonGroup } from '@/components/ui/button-group';
    import { Calendar } from '@/components/ui/calendar';

    import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover';
    import { TooltipWrapper } from '../../../components/ui/tooltip';
    import { Badge } from '../../../components/ui/badge';
    import { timeToText } from '../../../shared/utils';
    import { useAppearanceSettingsStore, useFriendStore, useUserStore } from '../../../stores';
    import { database } from '../../../services/database';
    import { showWorldDialog } from '../../../coordinators/worldCoordinator';
    import { VirtualCombobox } from '../../../components/ui/virtual-combobox';
    import { useUserDisplay } from '../../../composables/useUserDisplay';

    import { useInstanceActivityData } from '../composables/useInstanceActivityData';
    import { useInstanceActivitySettings } from '../composables/useInstanceActivitySettings';

    import InstanceActivityDetail from './InstanceActivityDetail.vue';

    const appearanceSettingsStore = useAppearanceSettingsStore();
    const friendStore = useFriendStore();
    const { friends, allFavoriteFriendIds } = storeToRefs(friendStore);
    const { currentUser } = storeToRefs(useUserStore());
    const { t } = useI18n();
    const { weekStartsOn } = storeToRefs(appearanceSettingsStore);
    const { userImage } = useUserDisplay();

    const friendActivityRef = ref(null);
    const isLoading = ref(true);

    const { barWidth } = useInstanceActivitySettings();

    const {
        activityDetailData,
        getActivityData
    } = useInstanceActivityData();

    // 独立页专用日期导航: 好友的动态/世界记录可能存在于自己没有游戏日志的
    // 日期, 因此不沿用 useDateNavigation 的"按自己的日志日期集合禁用/跳转"逻辑,
    // 改为自由选择任何过去日期, 前后按钮按 ±1 天步进
    const selectedDate = ref(dayjs().toDate());
    const todayStart = dayjs().startOf('day');

    const isNextDayBtnDisabled = computed(() =>
        dayjs(selectedDate.value).isSameOrAfter(todayStart, 'day')
    );

    const isPrevDayBtnDisabled = ref(false);

    /**
     * @param isNext
     */
    function changeSelectedDateFromBtn(isNext = false) {
        const next = dayjs(selectedDate.value).add(isNext ? 1 : -1, 'day');
        if (next.isAfter(todayStart, 'day')) {
            return;
        }
        selectedDate.value = next.toDate();
        reloadData();
    }

    const isDatePickerOpen = ref(false);
    const calendarTimeZone = getLocalTimeZone();
    const defaultCalendarPlaceholder = today(calendarTimeZone);

    const calendarModelValue = computed(() => {
        return fromDate(selectedDate.value ?? new Date(), calendarTimeZone);
    });

    /**
     * @param dateValue
     */
    function isCalendarDateDisabled(dateValue) {
        try {
            // 只禁未来日期, 过去日期自由选择
            return toDate(dateValue, calendarTimeZone) > Date.now();
        } catch {
            return true;
        }
    }

    /**
     * @param dateValue
     */
    function handleCalendarModelUpdate(dateValue) {
        if (!dateValue) return;
        selectedDate.value = toDate(dateValue, calendarTimeZone);
        isDatePickerOpen.value = false;
        reloadData();
    }

    const selectedFriendId = ref(null);

    const allFriends = computed(() => {
        const list = [];
        for (const ctx of friends.value.values()) {
            const friendRef = ctx?.ref;
            if (friendRef?.id && friendRef?.displayName) {
                list.push(friendRef);
            }
        }
        list.sort((a, b) =>
            String(a.displayName).localeCompare(String(b.displayName))
        );
        return list;
    });

    const friendPickerGroups = computed(() => [
        {
            key: 'friends',
            items: allFriends.value.map((friend) => ({
                value: friend.id,
                label: friend.displayName,
                search: friend.displayName,
                user: friend,
                iconUrl: userImage(friend)
            }))
        }
    ]);

    // 选中好友当天在场的实例 (与活动记录同款展示)
    const friendActivityDetailData = computed(() => {
        if (!selectedFriendId.value) {
            return [];
        }
        const friendId = selectedFriendId.value;
        return activityDetailData.value.filter((arr) =>
            arr.some((row) => row.user_id === friendId)
        );
    });

    // 动态中可见的世界轨迹 (GPS 位置变动 + Online 上线, 不限于同框实例)
    const friendWorldRecords = ref([]);

    watch(
        [selectedFriendId, selectedDate],
        async () => {
            friendWorldRecords.value = [];
            if (!selectedFriendId.value) {
                return;
            }
            try {
                const start = dayjs
                    .tz(selectedDate.value)
                    .startOf('day')
                    .toISOString();
                const end = dayjs
                    .tz(selectedDate.value)
                    .endOf('day')
                    .toISOString();
                const rows = await database.getFriendWorldActivity(
                    selectedFriendId.value,
                    start,
                    end
                );
                // 相邻重复 (Online 后紧跟同世界的 GPS) 去重
                const deduped = [];
                for (const row of rows) {
                    const prev = deduped[deduped.length - 1];
                    if (prev && prev.location === row.location) {
                        continue;
                    }
                    deduped.push(row);
                }
                // 停留时长 = 与下一条(更新的)记录的时间差; 最新一条 = 至今
                deduped.forEach((row, index) => {
                    const newer = deduped[index - 1];
                    row.durationMs = newer
                        ? dayjs(newer.created_at).diff(row.created_at)
                        : 0;
                });
                friendWorldRecords.value = deduped;
            } catch (err) {
                console.error('[friend-activity] world records failed:', err);
            }
        },
        { immediate: true }
    );

    /**
     *
     * @param row
     */
    function openWorld(row) {
        if (row.location.startsWith('wrld_')) {
            showWorldDialog(row.location.split(':')[0]);
        }
    }

    /**
     *
     * @param date
     */
    function formatTime(date) {
        return dayjs(date).format('HH:mm');
    }

    let reloadData;

    onMounted(async () => {
        try {
            await getActivityData(
                selectedDate,
                currentUser,
                friends,
                allFavoriteFriendIds
            );
        } catch (error) {
            console.error('error in mounted', error);
        } finally {
            isLoading.value = false;
        }
    });

    reloadData = async function () {
        isLoading.value = true;
        try {
            await getActivityData(
                selectedDate,
                currentUser,
                friends,
                allFavoriteFriendIds
            );
        } catch (error) {
            console.error('Error in reloadData:', error);
        } finally {
            isLoading.value = false;
        }
    };
</script>

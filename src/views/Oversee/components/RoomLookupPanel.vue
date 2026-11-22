<template>
    <div class="flex min-h-0 flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
            <Input
                v-model="locationInput"
                class="w-96 font-mono"
                :placeholder="t('view.oversee.room.input_placeholder')"
                @keydown.enter="query" />
            <Button variant="outline" size="sm" :disabled="!currentLocation" @click="fillCurrentLocation">
                {{ t('view.oversee.room.fill_current') }}
            </Button>
            <Button :disabled="loading" @click="query">
                <Spinner v-if="loading" class="size-4" />
                {{ t('view.oversee.query') }}
            </Button>
        </div>

        <div v-if="errorKind" class="text-destructive text-sm">
            {{ t(`view.oversee.error.${errorKind}`) }}
        </div>

        <template v-if="loaded">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span class="truncate font-mono text-xs">
                    {{ queriedLocation }}
                </span>
                <Badge variant="secondary" class="text-xs">
                    {{ t('view.oversee.room.roster_count', { count: rows.length }) }}
                </Badge>
            </div>

            <div v-if="rows.length === 0" class="text-muted-foreground py-6 text-center text-sm">
                {{ t('view.oversee.room.empty') }}
            </div>

            <div v-else class="flex flex-col">
                <Item
                    v-for="row in rows"
                    :key="`${row.user_id}-${row.at}-${row.location}`"
                    class="cursor-pointer rounded-none hover:bg-muted"
                    @click="openUserDialog(row.user_id)">
                    <ItemMedia class="size-10">
                        <Avatar class="size-full">
                            <AvatarImage v-if="row.avatar_url" :src="row.avatar_url" loading="lazy" />
                            <AvatarFallback>
                                <User class="text-muted-foreground size-5" />
                            </AvatarFallback>
                        </Avatar>
                    </ItemMedia>
                    <ItemContent class="min-w-0">
                        <ItemTitle class="max-w-full truncate">
                            {{ row.display_name || row.user_id }}
                        </ItemTitle>
                        <ItemDescription class="text-xs!">
                            {{ formatDateTime(row.at) }}
                        </ItemDescription>
                    </ItemContent>
                </Item>
            </div>
        </template>

        <div v-else class="text-muted-foreground py-6 text-center text-sm">
            {{ t('view.oversee.room.hint') }}
        </div>
    </div>
</template>

<script setup>
    import { computed, ref } from 'vue';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import dayjs from 'dayjs';
    import { toast } from 'vue-sonner';
    import { User } from 'lucide-vue-next';

    import { Badge } from '@/components/ui/badge';
    import { Button } from '@/components/ui/button';
    import { Input } from '@/components/ui/input';
    import { Spinner } from '@/components/ui/spinner';
    import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
    import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
    import { useLocationStore } from '@/stores';
    import { showUserDialog } from '@/coordinators/userCoordinator';
    import { getInstanceRoster, OverseeApiError } from '@/services/overseeApi';
    import { extractLocationFromText } from '@/services/database/overseeMerge';
    import { showOverseeError } from '../overseeUi';

    const { t } = useI18n();

    const { lastLocation } = storeToRefs(useLocationStore());
    const currentLocation = computed(() => String(lastLocation.value?.location || '').trim());

    const locationInput = ref('');
    const loading = ref(false);
    const loaded = ref(false);
    const errorKind = ref('');
    const queriedLocation = ref('');
    /** @type {import('vue').Ref<object[]>} */
    const rows = ref([]);

    function fillCurrentLocation() {
        const location = String(lastLocation.value?.location || '').trim();
        if (!location) {
            return;
        }
        locationInput.value = location;
    }

    async function query() {
        if (loading.value) {
            return;
        }
        // 从粘贴文本/URL 中提取 location 片段; 提取不到才报错
        const location = extractLocationFromText(locationInput.value);
        if (!location) {
            toast.error(t('view.oversee.room.invalid_location'));
            return;
        }
        locationInput.value = location;
        loading.value = true;
        errorKind.value = '';
        loaded.value = false;
        rows.value = [];
        queriedLocation.value = location;
        try {
            const data = await getInstanceRoster(location);
            const results = Array.isArray(data?.results) ? data.results : [];
            rows.value = results.filter((row) => row?.user_id).sort((a, b) => String(b.at).localeCompare(String(a.at)));
            loaded.value = true;
        } catch (error) {
            if (error instanceof OverseeApiError && error.kind === 'notFound') {
                errorKind.value = 'notFound';
                loaded.value = true;
            } else {
                errorKind.value = String(error?.kind || 'server');
                showOverseeError(error, t);
            }
        } finally {
            loading.value = false;
        }
    }

    /**
     * @param userId
     */
    function openUserDialog(userId) {
        showUserDialog(userId);
    }

    /**
     * @param date
     */
    function formatDateTime(date) {
        return date ? dayjs(date).format('YYYY-MM-DD HH:mm') : '-';
    }
</script>

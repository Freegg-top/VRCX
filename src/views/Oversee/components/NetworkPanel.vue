<template>
    <div class="flex min-h-0 flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
            <Input
                v-model="queryInput"
                class="w-80"
                :placeholder="t('view.oversee.network.input_placeholder')"
                @keydown.enter="query" />
            <Button :disabled="loading" @click="query">
                <Spinner v-if="loading" class="size-4" />
                {{ t('view.oversee.query') }}
            </Button>
        </div>

        <div v-if="errorKind" class="text-destructive text-sm">
            {{ t(`view.oversee.error.${errorKind}`) }}
        </div>

        <template v-if="loaded">
            <div class="flex items-center gap-3 rounded-lg border p-3">
                <div class="size-10 flex-none overflow-hidden rounded-full">
                    <img v-if="centerAvatarUrl" class="size-full object-cover" :src="centerAvatarUrl" loading="lazy" />
                    <div v-else class="bg-muted flex size-full items-center justify-center">
                        <User class="text-muted-foreground size-5" />
                    </div>
                </div>
                <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium">
                        {{ centerDisplayName }}
                    </div>
                    <div class="text-muted-foreground truncate font-mono text-xs">
                        {{ centerId }}
                    </div>
                </div>
                <Button size="sm" variant="outline" @click="openUserDialog(centerId)">
                    {{ t('view.oversee.open_user_dialog') }}
                </Button>
            </div>

            <div class="text-muted-foreground text-xs">
                {{ t('view.oversee.network.neighbors', { count: neighbors.length }) }}
            </div>

            <div v-if="neighbors.length === 0" class="text-muted-foreground py-6 text-center text-sm">
                {{ t('view.oversee.network.empty') }}
            </div>

            <div v-else class="flex flex-col">
                <Item
                    v-for="row in neighbors"
                    :key="row.other_id"
                    class="cursor-pointer rounded-none hover:bg-muted"
                    @click="useAsCenter(row.other_id)">
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
                            {{ row.display_name || row.other_id }}
                        </ItemTitle>
                        <ItemDescription class="text-xs!">
                            {{
                                t('view.oversee.encounters.co_seen', {
                                    count: row.co_seen_count
                                })
                            }}
                            ·
                            {{ t('view.oversee.encounters.last_seen') }}
                            {{ formatDateTime(row.last_seen) }}
                        </ItemDescription>
                    </ItemContent>
                    <ItemActions class="flex-none">
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            :aria-label="t('view.oversee.open_user_dialog')"
                            @click.stop="openUserDialog(row.other_id)">
                            <ExternalLink class="size-4" />
                        </Button>
                    </ItemActions>
                </Item>
            </div>
        </template>

        <div v-else class="text-muted-foreground py-6 text-center text-sm">
            {{ t('view.oversee.network.hint') }}
        </div>
    </div>
</template>

<script setup>
    import { computed, ref } from 'vue';
    import { useI18n } from 'vue-i18n';

    import dayjs from 'dayjs';
    import { toast } from 'vue-sonner';
    import { ExternalLink, User } from 'lucide-vue-next';

    import { Button } from '@/components/ui/button';
    import { Input } from '@/components/ui/input';
    import { Spinner } from '@/components/ui/spinner';
    import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
    import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
    import { showUserDialog } from '@/coordinators/userCoordinator';
    import { getUserConnections, getUserHistory, OverseeApiError } from '@/services/overseeApi';
    import { LatestRequestGate } from '@/services/overseeRequestGate';
    import { extractUsrId } from '@/services/database/overseeMerge';
    import { showOverseeError } from '../overseeUi';

    const { t } = useI18n();

    const queryInput = ref('');
    const loading = ref(false);
    const loaded = ref(false);
    const errorKind = ref('');
    const centerId = ref('');
    /** @type {import('vue').Ref<object>} */
    const centerUser = ref(null);
    /** @type {import('vue').Ref<object[]>} */
    const neighbors = ref([]);
    const requestGate = new LatestRequestGate();

    const centerDisplayName = computed(() => String(centerUser.value?.display_name || '').trim() || centerId.value);

    const centerAvatarUrl = computed(() => centerUser.value?.avatar_url || '');

    async function query() {
        if (loading.value) {
            return;
        }
        const id = extractUsrId(queryInput.value);
        if (!id) {
            toast.error(t('view.oversee.error.invalidId'));
            return;
        }
        queryInput.value = id;
        await runQuery(id);
    }

    /**
     * @param otherId
     */
    function useAsCenter(otherId) {
        queryInput.value = otherId;
        runQuery(otherId);
    }

    /**
     * 加载中心用户资料: /v1/connections 实测只返回 {results}, 中心信息走 /v1/user/{id}/history.
     *
     * @param {string} id
     * @param {number} token
     */
    async function loadCenterProfile(id, token) {
        try {
            const data = await getUserHistory(id);
            if (!requestGate.isCurrent(token)) {
                return;
            }
            centerUser.value = data?.user || null;
        } catch {
            // 中心资料获取失败: 兜底显示 usr_id, 不影响关系网展示
        }
    }

    async function runQuery(id) {
        const token = requestGate.begin();
        loading.value = true;
        errorKind.value = '';
        loaded.value = false;
        centerId.value = id;
        centerUser.value = null;
        neighbors.value = [];
        try {
            const data = await getUserConnections(id, 100);
            if (!requestGate.isCurrent(token) || id !== centerId.value) {
                return;
            }
            const results = Array.isArray(data?.results) ? data.results : [];
            neighbors.value = results
                .filter((row) => row?.other_id)
                .sort((a, b) => String(b.last_seen).localeCompare(String(a.last_seen)));
            loaded.value = true;
            await loadCenterProfile(id, token);
        } catch (error) {
            if (!requestGate.isCurrent(token)) {
                return;
            }
            if (error instanceof OverseeApiError && error.kind === 'notFound') {
                errorKind.value = 'notFound';
                loaded.value = true;
            } else {
                errorKind.value = String(error?.kind || 'server');
                showOverseeError(error, t);
            }
        } finally {
            if (requestGate.isCurrent(token)) {
                loading.value = false;
            }
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

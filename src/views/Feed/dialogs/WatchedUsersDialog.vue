<template>
    <Dialog :open="open" @update:open="$emit('update:open', $event)">
        <DialogContent>
            <DialogHeader>
                <DialogTitle>{{ t('dialog.watched_users.header') }}</DialogTitle>
            </DialogHeader>
            <div v-if="open" style="max-height: 400px; overflow-y: auto">
                <div
                    v-if="watchedList.length === 0"
                    class="text-muted-foreground text-sm py-4 text-center">
                    {{ t('dialog.watched_users.empty') }}
                </div>
                <div
                    v-for="user in watchedList"
                    :key="user.userId"
                    class="flex items-center justify-between gap-2 py-1.5">
                    <div class="flex items-center gap-2 min-w-0">
                        <span
                            class="truncate cursor-pointer hover:underline"
                            @click="openUserDialog(user.userId)">
                            {{ user.displayName }}
                        </span>
                        <span class="text-xs text-muted-foreground flex-none">
                            {{ formatDate(user.created_at) }}
                        </span>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        @click="unwatch(user.userId)">
                        {{ t('dialog.watched_users.remove') }}
                    </Button>
                </div>
            </div>
        </DialogContent>
    </Dialog>
</template>

<script setup>
    import { computed } from 'vue';
    import { storeToRefs } from 'pinia';
    import { useI18n } from 'vue-i18n';

    import dayjs from 'dayjs';

    import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
    import { Button } from '../../../components/ui/button';
    import { useWatchedStore } from '../../../stores';
    import { showUserDialog } from '../../../coordinators/userCoordinator';
    import { removeWatchedUser } from '../../../coordinators/watchedCoordinator';

    defineProps({
        open: {
            type: Boolean,
            default: false
        }
    });

    defineEmits(['update:open']);

    const { t } = useI18n();

    const watchedStore = useWatchedStore();
    const { watchedUsers } = storeToRefs(watchedStore);

    const watchedList = computed(() => Array.from(watchedUsers.value.values()));

    /**
     *
     * @param userId
     */
    function openUserDialog(userId) {
        showUserDialog(userId);
    }

    /**
     *
     * @param userId
     */
    function unwatch(userId) {
        removeWatchedUser(userId);
    }

    /**
     *
     * @param date
     */
    function formatDate(date) {
        return dayjs(date).format('YYYY-MM-DD');
    }
</script>

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { ArrowRight, ArrowUpDown, Trash2, X } from 'lucide-vue-next';
import { storeToRefs } from 'pinia';

import { formatDateFilter } from '../../shared/utils';
import { i18n } from '../../plugins/i18n';
import { useUiStore, useUserStore } from '../../stores';
import { showUserDialog } from '../../coordinators/userCoordinator';

const { t } = i18n.global;
const MUTUAL_TYPES = new Set(['MutualFriendshipEnd', 'MutualFriendshipStart', 'MutualOptOut']);

/**
 * 按 userId 从 cachedUsers 解析显示名, 无缓存时回退为 id
 * @param {string} userId
 * @returns {string}
 */
const resolveDisplayName = (userId) => {
    if (!userId) {
        return '';
    }
    return useUserStore().cachedUsers.get(userId)?.displayName ?? userId;
};

export const createColumns = ({ onDelete, onDeletePrompt }) => {
    const { shiftHeld } = storeToRefs(useUiStore());

    return [
        {
            id: 'spacer',
            header: () => null,
            enableSorting: false,
            size: 20,
            minSize: 0,
            maxSize: 20,
            cell: () => null
        },
        {
            accessorKey: 'created_at',
            size: 120,
            meta: { label: () => t('table.friendLog.date') },
            header: ({ column }) => (
                <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
                    {t('table.friendLog.date')}
                    <ArrowUpDown class="ml-1 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => {
                const createdAt = row.getValue('created_at');
                const shortText = formatDateFilter(createdAt, 'short');
                const longText = formatDateFilter(createdAt, 'long');

                return (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span>{shortText}</span>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                            <span>{longText}</span>
                        </TooltipContent>
                    </Tooltip>
                );
            }
        },
        {
            accessorKey: 'type',

            size: 160,
            header: () => t('table.friendLog.type'),
            meta: { label: () => t('table.friendLog.type') },
            cell: ({ row }) => {
                const type = row.getValue('type');
                return (
                    <Badge variant="outline" class="text-muted-foreground">
                        {t(`view.friend_log.filters.${type}`)}
                    </Badge>
                );
            }
        },
        {
            accessorKey: 'displayName',
            size: 260,
            minSize: 80,
            header: () => t('table.friendLog.user'),
            meta: {
                stretch: true,
                label: () => t('table.friendLog.user')
            },
            cell: ({ row }) => {
                const original = row.original;
                if (MUTUAL_TYPES.has(original.type)) {
                    // 共同好友事件: 双方均可点击打开 UserDialog, 显示名从 cachedUsers 解析
                    const nameA = resolveDisplayName(original.friendIdA || original.userId);
                    // MutualOptOut 的 B 字段可能为空或与 A 相同, 只显示 A
                    const showB =
                        original.type !== 'MutualOptOut' &&
                        !!original.friendIdB &&
                        original.friendIdB !== original.friendIdA;
                    const nameB = showB ? resolveDisplayName(original.friendIdB) : '';
                    const predicateKey =
                        original.type === 'MutualFriendshipEnd'
                            ? 'view.friend_log.mutual_friendship_end_predicate'
                            : original.type === 'MutualFriendshipStart'
                              ? 'view.friend_log.mutual_friendship_start_predicate'
                              : 'view.friend_log.mutual_opt_out_suffix';
                    return (
                        <span class="block w-full whitespace-normal wrap-break-word">
                            <span
                                class="cursor-pointer hover:underline"
                                onClick={() => showUserDialog(original.friendIdA || original.userId)}>
                                {nameA}
                            </span>
                            {showB ? (
                                <>
                                    <span class="text-muted-foreground">{t('view.friend_log.mutual_and')}</span>
                                    <span
                                        class="cursor-pointer hover:underline"
                                        onClick={() => showUserDialog(original.friendIdB)}>
                                        {nameB}
                                    </span>
                                </>
                            ) : null}
                            <span class="text-muted-foreground">{t(predicateKey)}</span>
                        </span>
                    );
                }
                const displayName = original.displayName || original.userId || '';
                return (
                    <span class="block w-full whitespace-normal wrap-break-word cursor-pointer">
                        {original.type === 'DisplayName' ? (
                            <span class="mr-1">
                                {original.previousDisplayName}
                                <ArrowRight class="mx-1 inline h-3 w-3" />
                            </span>
                        ) : null}
                        <span class="cursor-pointer pr-2.5" onClick={() => showUserDialog(original.userId)}>
                            {displayName}
                        </span>
                        {original.type === 'TrustLevel' ? (
                            <span class="text-muted-foreground">
                                ({original.previousTrustLevel}
                                <ArrowRight class="mx-1 inline h-3 w-3" />
                                {original.trustLevel})
                            </span>
                        ) : null}
                    </span>
                );
            }
        },
        {
            id: 'action',
            meta: {
                class: 'w-[80px] max-w-[80px] text-right',
                label: () => t('table.friendLog.action')
            },
            size: 80,
            maxSize: 80,
            header: () => t('table.friendLog.action'),
            enableSorting: false,
            cell: ({ row }) => {
                const original = row.original;
                // mutual 事件存在独立表中且无删除接口, 不渲染删除按钮
                if (MUTUAL_TYPES.has(original.type)) {
                    return null;
                }
                return (
                    <div class="flex justify-end">
                        <button
                            type="button"
                            class="inline-flex h-6 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
                            onClick={() => (shiftHeld.value ? onDelete(original) : onDeletePrompt(original))}
                        >
                            {shiftHeld.value ? <X class="h-4 w-4 text-red-600" /> : <Trash2 class="h-4 w-4" />}
                        </button>
                    </div>
                );
            }
        },
        {
            id: 'trailing',
            header: () => null,
            enableSorting: false,
            enableResizing: false,
            size: 5,
            cell: () => null
        }
    ];
};

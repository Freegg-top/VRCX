import { defineStore } from 'pinia';
import { shallowReactive } from 'vue';

export const useWatchedStore = defineStore('Watched', () => {
    const watchedUsers = shallowReactive(new Map());

    /**
     * @param {string} userId
     * @returns {boolean}
     */
    function isWatched(userId) {
        return watchedUsers.has(userId);
    }

    /**
     * @param {{ userId: string, displayName: string, created_at: string }} user
     */
    function setWatchedUser(user) {
        watchedUsers.set(user.userId, user);
    }

    /**
     * @param {string} userId
     */
    function removeWatchedUser(userId) {
        watchedUsers.delete(userId);
    }

    return {
        watchedUsers,
        isWatched,
        setWatchedUser,
        removeWatchedUser
    };
});

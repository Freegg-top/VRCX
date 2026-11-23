/**
 * @typedef {import('@/services/overseeUserData').CloudConnection} CloudConnection
 */

/**
 * Adds cloud co-seen metadata to local met users. Cloud-only strangers are
 * deliberately not appended: they have no friend-analysis result, cannot be
 * queried, and must not inflate the local met-pool count.
 *
 * @param {object[]} localUsers
 * @param {Map<string, CloudConnection> | null} cloudConnections
 * @returns {object[]}
 */
export function mergeCloudIntoMetPool(localUsers, cloudConnections) {
    if (cloudConnections === null) {
        return localUsers;
    }
    return localUsers.map((user) => {
        const cloud = cloudConnections.get(user.userId);
        return cloud ? { ...user, cloud } : user;
    });
}

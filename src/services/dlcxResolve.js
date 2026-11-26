import userRequest from '@/api/user';
import { database } from '@/services/database';
import { extractUsrId } from '@/services/database/dlcxMerge';
import { userImage } from '@/shared/utils/user';
import { useFriendStore, useUserStore } from '@/stores';

/**
 * @typedef {'local' | 'friend' | 'vrc'} PlayerCandidateSource
 *
 * @typedef {{
 *   usrId: string;
 *   displayName: string;
 *   source: PlayerCandidateSource;
 *   avatar?: string;
 *   lastSeen?: string;
 * }} PlayerCandidate
 *
 * @typedef {{
 *   status: 'selected' | 'multiple' | 'notFound' | 'empty';
 *   candidate?: PlayerCandidate;
 *   candidates: PlayerCandidate[];
 *   vrcUnavailable?: boolean;
 *   vrcReason?: 'loggedOut' | 'error';
 * }} PlayerResolution
 */

class VrcSearchUnavailableError extends Error {
  /**
   * @param {'loggedOut' | 'error'} reason
   * @param {unknown} [cause]
   */
  constructor(reason, cause) {
    super(reason === 'loggedOut' ? 'VRChat login is required' : 'VRChat user search failed', {
      cause
    });
    this.name = 'VrcSearchUnavailableError';
    this.reason = reason;
  }
}

/**
 * Usr_id / 含 usr_id 的 URL 或文本沿用直接提取路径，其余按显示名解析。
 *
 * @param {string} text
 * @returns {{ type: 'usrId' | 'urlWithUsr' | 'name'; value: string }}
 */
function classifyPlayerInput(text) {
  const value = String(text ?? '').trim();
  const usrId = extractUsrId(value);
  if (usrId) {
    return { type: value === usrId ? 'usrId' : 'urlWithUsr', value: usrId };
  }
  return { type: 'name', value };
}

/**
 * @param {PlayerCandidate} candidate
 * @param {string} query
 * @returns {number[]} 精确匹配优先，其次好友、本地日志、VRChat。
 */
function candidateRank(candidate, query) {
  const exact =
    candidate.displayName.localeCompare(query, undefined, { sensitivity: 'accent' }) === 0;
  const sourceRank = { friend: 0, local: 1, vrc: 2 };
  return [exact ? 0 : 1, sourceRank[candidate.source] ?? 3];
}

/**
 * 合并候选并按 usrId 去重。同 ID 优先保留更高优先级来源，同时补齐头像与最近出现时间。
 *
 * @param {PlayerCandidate[]} candidates
 * @param {string} query
 * @param {number} [limit=10] Default is `10`
 * @returns {PlayerCandidate[]}
 */
function mergePlayerCandidates(candidates, query, limit = 10) {
  const normalizedQuery = String(query ?? '').trim();
  /** @type {Map<string, { candidate: PlayerCandidate; rank: number[] }>} */
  const byId = new Map();
  for (const raw of candidates || []) {
    const usrId = extractUsrId(raw?.usrId);
    if (!usrId || usrId !== raw.usrId) {
      continue;
    }
    const candidate = {
      usrId,
      displayName: String(raw.displayName || usrId),
      source: raw.source,
      avatar: raw.avatar || '',
      lastSeen: raw.lastSeen || ''
    };
    const rank = candidateRank(candidate, normalizedQuery);
    const existing = byId.get(usrId);
    if (!existing) {
      byId.set(usrId, { candidate, rank });
      continue;
    }
    const preferred = compareRank(rank, existing.rank) < 0 ? candidate : existing.candidate;
    const other = preferred === candidate ? existing.candidate : candidate;
    const merged = {
      ...preferred,
      avatar: preferred.avatar || other.avatar,
      lastSeen: preferred.lastSeen || other.lastSeen
    };
    if (other.lastSeen > merged.lastSeen) {
      merged.lastSeen = other.lastSeen;
    }
    byId.set(usrId, { candidate: merged, rank: candidateRank(merged, normalizedQuery) });
  }
  return [...byId.values()]
    .sort((a, b) => {
      const rankResult = compareRank(a.rank, b.rank);
      if (rankResult) {
        return rankResult;
      }
      const lastSeenResult = String(b.candidate.lastSeen).localeCompare(
        String(a.candidate.lastSeen)
      );
      if (lastSeenResult) {
        return lastSeenResult;
      }
      return a.candidate.displayName.localeCompare(b.candidate.displayName, undefined, {
        sensitivity: 'base'
      });
    })
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function compareRank(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const result = (a[index] ?? 0) - (b[index] ?? 0);
    if (result) {
      return result;
    }
  }
  return 0;
}

/**
 * @param {object} user
 * @returns {string}
 */
function candidateAvatar(user) {
  return userImage(
    {
      iconUrl:
        user?.userIcon || user?.userIconUrl || user?.iconUrl || user?.profilePicOverride || '',
      currentAvatarThumbnailImageUrl: user?.currentAvatarThumbnailImageUrl || '',
      currentAvatarImageUrl: user?.currentAvatarImageUrl || ''
    },
    true
  );
}

/**
 * 本地日志精确 + 模糊查询与好友列表过滤。日志查询失败时仍返回可用的好友候选。
 *
 * @param {string} name
 * @returns {Promise<PlayerCandidate[]>}
 */
async function resolveLocalCandidates(name) {
  const query = String(name ?? '').trim();
  if (!query) {
    return [];
  }
  const [exactResult, fuzzyResult] = await Promise.allSettled([
    database.getUserIdFromDisplayName(query),
    database.searchGameLogDatabase(query, ['OnPlayerJoined', 'OnPlayerLeft'], [], 5)
  ]);
  /** @type {PlayerCandidate[]} */
  const candidates = [];
  if (exactResult.status === 'fulfilled' && extractUsrId(exactResult.value) === exactResult.value) {
    candidates.push({ usrId: exactResult.value, displayName: query, source: 'local' });
  }
  if (fuzzyResult.status === 'fulfilled') {
    for (const row of fuzzyResult.value || []) {
      if (!extractUsrId(row?.userId)) {
        continue;
      }
      candidates.push({
        usrId: row.userId,
        displayName: row.displayName || row.userId,
        source: 'local',
        lastSeen: row.created_at || row.last_seen || ''
      });
    }
  }
  const friendStore = useFriendStore();
  const foldedQuery = query.toLocaleLowerCase();
  for (const context of friendStore.friends.values()) {
    const friend = context?.ref;
    if (!friend?.id || !extractUsrId(friend.id)) {
      continue;
    }
    const displayName = String(friend.displayName || '');
    if (!displayName.toLocaleLowerCase().includes(foldedQuery)) {
      continue;
    }
    candidates.push({
      usrId: friend.id,
      displayName: displayName || friend.id,
      source: 'friend',
      avatar: candidateAvatar(friend)
    });
  }
  return mergePlayerCandidates(candidates, query);
}

/**
 * 仅在显式提交时由解析管线调用，避免对官方搜索接口进行逐键轮询。
 *
 * @param {string} name
 * @returns {Promise<PlayerCandidate[]>}
 * @throws {VrcSearchUnavailableError} 未登录或官方搜索失败
 */
async function searchVrcCandidates(name) {
  const query = String(name ?? '').trim();
  const userStore = useUserStore();
  if (!userStore.currentUser.id) {
    throw new VrcSearchUnavailableError('loggedOut');
  }
  try {
    const { json } = await userRequest.getUsers({ n: 10, offset: 0, search: query });
    /** @type {PlayerCandidate[]} */
    const candidates = [];
    for (const user of json || []) {
      if (!extractUsrId(user?.id)) {
        continue;
      }
      candidates.push({
        usrId: user.id,
        displayName: user.displayName || user.id,
        source: 'vrc',
        avatar: candidateAvatar(user)
      });
    }
    return mergePlayerCandidates(candidates, query);
  } catch (error) {
    throw new VrcSearchUnavailableError('error', error);
  }
}

/**
 * @param {string} usrId
 * @returns {PlayerCandidate}
 */
function directCandidate(usrId) {
  return { usrId, displayName: usrId, source: 'local', avatar: '', lastSeen: '' };
}

/**
 * 显式提交解析管线：直接 ID 不查库；本地唯一命中直接选中；否则仅调用一次 VRChat 搜索。
 *
 * @param {string} text
 * @param {{
 *   resolveLocal?: (name: string) => Promise<PlayerCandidate[]>;
 *   searchVrc?: (name: string) => Promise<PlayerCandidate[]>;
 * }} [dependencies]
 *   测试可注入解析源
 * @returns {Promise<PlayerResolution>}
 */
async function resolvePlayerInput(text, dependencies = {}) {
  const input = classifyPlayerInput(text);
  if (!input.value) {
    return { status: 'empty', candidates: [] };
  }
  if (input.type !== 'name') {
    return { status: 'selected', candidate: directCandidate(input.value), candidates: [] };
  }
  const resolveLocal = dependencies.resolveLocal || resolveLocalCandidates;
  const searchVrc = dependencies.searchVrc || searchVrcCandidates;
  const localCandidates = await resolveLocal(input.value);
  if (localCandidates.length === 1) {
    return { status: 'selected', candidate: localCandidates[0], candidates: localCandidates };
  }
  let vrcCandidates = [];
  let vrcUnavailable = false;
  /** @type {'loggedOut' | 'error' | undefined} */
  let vrcReason;
  try {
    vrcCandidates = await searchVrc(input.value);
  } catch (error) {
    vrcUnavailable = true;
    vrcReason = error instanceof VrcSearchUnavailableError ? error.reason : 'error';
  }
  const candidates = mergePlayerCandidates([...localCandidates, ...vrcCandidates], input.value);
  if (candidates.length === 1) {
    return { status: 'selected', candidate: candidates[0], candidates, vrcUnavailable, vrcReason };
  }
  if (candidates.length > 1) {
    return { status: 'multiple', candidates, vrcUnavailable, vrcReason };
  }
  return { status: 'notFound', candidates: [], vrcUnavailable, vrcReason };
}

export {
  classifyPlayerInput,
  mergePlayerCandidates,
  resolveLocalCandidates,
  resolvePlayerInput,
  searchVrcCandidates,
  VrcSearchUnavailableError
};

import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  classifyPlayerInput,
  mergePlayerCandidates,
  resolveLocalCandidates,
  resolvePlayerInput,
  searchVrcCandidates,
  VrcSearchUnavailableError
} from '../overseeResolve';

const mocks = vi.hoisted(() => ({
  getUserIdFromDisplayName: vi.fn(),
  searchGameLogDatabase: vi.fn(),
  getUsers: vi.fn(),
  friends: new Map(),
  currentUser: { id: '' }
}));

vi.mock('@/services/database', () => ({
  database: {
    getUserIdFromDisplayName: mocks.getUserIdFromDisplayName,
    searchGameLogDatabase: mocks.searchGameLogDatabase
  }
}));

vi.mock('@/stores', () => ({
  useFriendStore: () => ({ friends: mocks.friends }),
  useUserStore: () => ({ currentUser: mocks.currentUser })
}));

vi.mock('@/api/user', () => ({
  default: { getUsers: mocks.getUsers }
}));

vi.mock('@/shared/utils/user', () => ({
  userImage: (user) =>
    user.iconUrl || user.currentAvatarThumbnailImageUrl || user.currentAvatarImageUrl || ''
}));

const ID_A = 'usr_01234567-89ab-cdef-0123-456789abcdef';
const ID_B = 'usr_11234567-89ab-cdef-0123-456789abcdef';
const ID_C = 'usr_21234567-89ab-cdef-0123-456789abcdef';

/**
 * @param {string} usrId
 * @param {string} displayName
 * @param {'local' | 'friend' | 'vrc'} source
 * @param {object} [extra]
 */
function candidate(usrId, displayName, source, extra = {}) {
  return { usrId, displayName, source, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.friends.clear();
  mocks.currentUser.id = ID_C;
  mocks.getUserIdFromDisplayName.mockResolvedValue('');
  mocks.searchGameLogDatabase.mockResolvedValue([]);
  mocks.getUsers.mockResolvedValue({ json: [] });
});

describe('overseeResolve.classifyPlayerInput', () => {
  test('classifies a bare usr_id without invoking name resolution', () => {
    expect(classifyPlayerInput(`  ${ID_A}  `)).toEqual({ type: 'usrId', value: ID_A });
  });

  test('extracts usr_id from URLs and surrounding text', () => {
    expect(classifyPlayerInput(`https://vrchat.com/home/user/${ID_A}`)).toEqual({
      type: 'urlWithUsr',
      value: ID_A
    });
    expect(classifyPlayerInput(`player: ${ID_A}`)).toEqual({ type: 'urlWithUsr', value: ID_A });
  });

  test('treats display names and empty input as names', () => {
    expect(classifyPlayerInput('  Some Player  ')).toEqual({ type: 'name', value: 'Some Player' });
    expect(classifyPlayerInput(null)).toEqual({ type: 'name', value: '' });
  });
});

describe('overseeResolve.mergePlayerCandidates', () => {
  test('deduplicates by usrId, prefers exact matches then friends, and enriches retained rows', () => {
    const merged = mergePlayerCandidates(
      [
        candidate(ID_A, 'Alice', 'local', { lastSeen: '2026-01-01' }),
        candidate(ID_A, 'Alice', 'friend', { avatar: 'friend.png' }),
        candidate(ID_B, 'Alice Cooper', 'local', { lastSeen: '2026-01-03' }),
        candidate(ID_C, 'ALICE', 'local', { avatar: 'local.png', lastSeen: '2026-01-04' })
      ],
      'alice'
    );
    expect(merged.map((row) => row.usrId)).toEqual([ID_A, ID_C, ID_B]);
    expect(merged[0]).toMatchObject({
      source: 'friend',
      avatar: 'friend.png',
      lastSeen: '2026-01-01'
    });
    expect(merged[1].source).toBe('local');
  });

  test('sorts same-rank local rows by recency then name and applies the limit', () => {
    const merged = mergePlayerCandidates(
      [
        candidate(ID_A, 'Beta', 'local', { lastSeen: '2026-01-01' }),
        candidate(ID_B, 'Alpha', 'local', { lastSeen: '2026-01-02' }),
        candidate(ID_C, 'Gamma', 'vrc', { lastSeen: '2026-01-03' })
      ],
      'not-exact',
      2
    );
    expect(merged.map((row) => row.usrId)).toEqual([ID_B, ID_A]);
  });
});

describe('overseeResolve local and VRChat sources', () => {
  test('combines exact/fuzzy log rows and friend filtering with a five-row log query limit', async () => {
    mocks.getUserIdFromDisplayName.mockResolvedValue(ID_A);
    mocks.searchGameLogDatabase.mockResolvedValue([
      { userId: ID_A, displayName: 'Alice', created_at: '2026-01-02' },
      { userId: ID_B, displayName: 'Alice Cooper', created_at: '2026-01-01' },
      { userId: '', displayName: 'No ID' }
    ]);
    mocks.friends.set(ID_A, { ref: { id: ID_A, displayName: 'Alice', userIcon: 'friend.png' } });
    mocks.friends.set(ID_C, {
      ref: { id: ID_C, displayName: 'Alice Alicia', userIcon: 'alicia.png' }
    });

    const result = await resolveLocalCandidates('Alice');
    expect(mocks.searchGameLogDatabase).toHaveBeenCalledWith(
      'Alice',
      ['OnPlayerJoined', 'OnPlayerLeft'],
      [],
      5
    );
    expect(result.map((row) => row.usrId)).toEqual([ID_A, ID_C, ID_B]);
    expect(result[0]).toMatchObject({
      source: 'friend',
      avatar: 'friend.png',
      lastSeen: '2026-01-02'
    });
  });

  test('maps official search results to VRChat candidates', async () => {
    mocks.getUsers.mockResolvedValue({
      json: [
        { id: ID_A, displayName: 'Alice', userIcon: 'alice.png' },
        { id: 'invalid', displayName: 'Invalid' }
      ]
    });
    await expect(searchVrcCandidates('Alice')).resolves.toEqual([
      { usrId: ID_A, displayName: 'Alice', source: 'vrc', avatar: 'alice.png', lastSeen: '' }
    ]);
    expect(mocks.getUsers).toHaveBeenCalledWith({ n: 10, offset: 0, search: 'Alice' });
  });

  test('reports logged-out and failed VRChat searches as unavailable', async () => {
    mocks.currentUser.id = '';
    await expect(searchVrcCandidates('Alice')).rejects.toMatchObject({ reason: 'loggedOut' });
    expect(mocks.getUsers).not.toHaveBeenCalled();

    mocks.currentUser.id = ID_C;
    mocks.getUsers.mockRejectedValue(new Error('401'));
    await expect(searchVrcCandidates('Alice')).rejects.toBeInstanceOf(VrcSearchUnavailableError);
  });
});

describe('overseeResolve.resolvePlayerInput pipeline', () => {
  test('direct usr_id/URL selection does not touch local or official search', async () => {
    const resolveLocal = vi.fn();
    const searchVrc = vi.fn();
    const result = await resolvePlayerInput(`https://vrchat.com/home/user/${ID_A}`, {
      resolveLocal,
      searchVrc
    });
    expect(result.status).toBe('selected');
    expect(result.candidate.usrId).toBe(ID_A);
    expect(resolveLocal).not.toHaveBeenCalled();
    expect(searchVrc).not.toHaveBeenCalled();
  });

  test('a unique local hit selects without calling VRChat', async () => {
    const local = candidate(ID_A, 'Alice', 'friend');
    const searchVrc = vi.fn();
    const result = await resolvePlayerInput('Alice', {
      resolveLocal: vi.fn().mockResolvedValue([local]),
      searchVrc
    });
    expect(result).toMatchObject({ status: 'selected', candidate: local });
    expect(searchVrc).not.toHaveBeenCalled();
  });

  test('zero local hits search VRChat once and auto-select a unique result', async () => {
    const remote = candidate(ID_A, 'Alice', 'vrc');
    const searchVrc = vi.fn().mockResolvedValue([remote]);
    const result = await resolvePlayerInput('Alice', {
      resolveLocal: vi.fn().mockResolvedValue([]),
      searchVrc
    });
    expect(result).toMatchObject({ status: 'selected', candidate: remote });
    expect(searchVrc).toHaveBeenCalledTimes(1);
  });

  test('multiple local hits trigger one explicit VRChat search and remain selectable', async () => {
    const locals = [candidate(ID_A, 'Alice', 'local'), candidate(ID_B, 'Alice Cooper', 'friend')];
    const remote = candidate(ID_C, 'Alice VRC', 'vrc');
    const searchVrc = vi.fn().mockResolvedValue([remote]);
    const result = await resolvePlayerInput('Alice', {
      resolveLocal: vi.fn().mockResolvedValue(locals),
      searchVrc
    });
    expect(result.status).toBe('multiple');
    expect(result.candidates).toHaveLength(3);
    expect(searchVrc).toHaveBeenCalledTimes(1);
  });

  test('zero hits distinguish not-found from unavailable official search', async () => {
    const notFound = await resolvePlayerInput('Nobody', {
      resolveLocal: vi.fn().mockResolvedValue([]),
      searchVrc: vi.fn().mockResolvedValue([])
    });
    expect(notFound).toMatchObject({ status: 'notFound', vrcUnavailable: false });

    const unavailable = await resolvePlayerInput('Nobody', {
      resolveLocal: vi.fn().mockResolvedValue([]),
      searchVrc: vi.fn().mockRejectedValue(new VrcSearchUnavailableError('loggedOut'))
    });
    expect(unavailable).toMatchObject({
      status: 'notFound',
      vrcUnavailable: true,
      vrcReason: 'loggedOut'
    });
  });
});

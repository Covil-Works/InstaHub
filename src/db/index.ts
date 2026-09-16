import Dexie, { type Table } from 'dexie';
import type { UserRecord, UserStatusResult, SyncMode, InstagramSyncSummary } from '../types';

export class InstaHubDatabase extends Dexie {
  users!: Table<UserRecord, string>;

  constructor() {
    super('InstaHubDB');
    this.version(1).stores({
      users: 'username, name, iFollow, followsMe, everFollowed, protected, updatedAt',
    });
  }
}

export const db = new InstaHubDatabase();

export function normalizeUsername(raw: string): string {
  if (!raw) return '';
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * Quick batch query to check a list of usernames
 */
export async function checkUsersBatch(
  rawUsernames: string[]
): Promise<Record<string, UserStatusResult>> {
  const normalizedMap = new Map<string, string>();
  for (const raw of rawUsernames) {
    const norm = normalizeUsername(raw);
    if (norm) {
      normalizedMap.set(norm, raw);
    }
  }

  const queryKeys = Array.from(normalizedMap.keys());
  if (queryKeys.length === 0) return {};

  const existingUsers = await db.users.where('username').anyOf(queryKeys).toArray();
  const existingMap = new Map<string, UserRecord>();
  for (const u of existingUsers) {
    existingMap.set(u.username, u);
  }

  const results: Record<string, UserStatusResult> = {};

  for (const [normUsername] of normalizedMap) {
    const user = existingMap.get(normUsername);
    if (!user) {
      results[normUsername] = {
        username: normUsername,
        found: false,
        status: 'neverFollowed',
        isProtected: false,
      };
    } else {
      let status: 'following' | 'previouslyFollowed' | 'neverFollowed' = 'neverFollowed';
      if (user.iFollow) {
        status = 'following';
      } else if (user.everFollowed) {
        status = 'previouslyFollowed';
      }

      results[normUsername] = {
        username: normUsername,
        found: true,
        status,
        isProtected: !!user.protected,
        user,
      };
    }
  }

  return results;
}

/**
 * Record a follow/unfollow user interaction
 */
export async function recordFollowInteraction(
  usernameRaw: string,
  name?: string,
  action: 'follow' | 'unfollow' = 'follow'
): Promise<UserRecord> {
  const username = normalizeUsername(usernameRaw);
  if (!username) throw new Error('Username inválido');

  const existing = await db.users.get(username);
  const now = Date.now();

  let updatedRecord: UserRecord;

  if (action === 'follow') {
    updatedRecord = {
      username,
      name: name || existing?.name || username,
      iFollow: true,
      followsMe: existing ? existing.followsMe : false,
      everFollowed: true, // Quando segue, já seguiu vira true
      protected: existing ? existing.protected : false,
      updatedAt: now,
      notes: existing?.notes,
    };
  } else {
    // Unfollow
    updatedRecord = {
      username,
      name: name || existing?.name || username,
      iFollow: false,
      followsMe: existing ? existing.followsMe : false,
      everFollowed: true, // Já segui permanece true mesmo após unfollow
      protected: existing ? existing.protected : false,
      updatedAt: now,
      notes: existing?.notes,
    };
  }

  await db.users.put(updatedRecord);
  return updatedRecord;
}

/**
 * Toggle or set protected (whitelist) status
 */
export async function toggleUserProtected(
  usernameRaw: string,
  name?: string
): Promise<UserRecord> {
  const username = normalizeUsername(usernameRaw);
  if (!username) throw new Error('Username inválido');

  const existing = await db.users.get(username);
  const now = Date.now();

  const updatedRecord: UserRecord = existing
    ? {
        ...existing,
        protected: !existing.protected,
        updatedAt: now,
      }
    : {
        username,
        name: name || username,
        iFollow: false,
        followsMe: false,
        everFollowed: false,
        protected: true,
        updatedAt: now,
      };

  await db.users.put(updatedRecord);
  return updatedRecord;
}

/**
 * Import user records from JSON array
 */
export async function importUsersFromJson(rawJson: unknown): Promise<{
  totalCount: number;
  addedCount: number;
  updatedCount: number;
  errors: string[];
}> {
  let list: unknown[] = [];
  if (Array.isArray(rawJson)) {
    list = rawJson;
  } else if (typeof rawJson === 'object' && rawJson !== null && 'users' in rawJson && Array.isArray((rawJson as { users: unknown[] }).users)) {
    list = (rawJson as { users: unknown[] }).users;
  } else if (typeof rawJson === 'object' && rawJson !== null && 'username' in rawJson) {
    list = [rawJson];
  } else {
    throw new Error('Formato JSON inválido. Esperava-se um array de usuários ou objeto de usuário.');
  }

  const errors: string[] = [];
  let addedCount = 0;
  let updatedCount = 0;
  const now = Date.now();

  for (let i = 0; i < list.length; i++) {
    const item = list[i] as Partial<UserRecord>;
    if (!item || typeof item !== 'object' || !item.username) {
      errors.push(`Item na linha ${i + 1} sem campo "username" obrigatório.`);
      continue;
    }

    const username = normalizeUsername(String(item.username));
    if (!username) {
      errors.push(`Item na linha ${i + 1} possui username inválido.`);
      continue;
    }

    const existing = await db.users.get(username);

    // Business rule: If iFollow is true, everFollowed must be true as well
    const iFollow = Boolean(item.iFollow);
    const everFollowed = iFollow ? true : Boolean(item.everFollowed ?? existing?.everFollowed ?? false);

    const recordToSave: UserRecord = {
      username,
      name: item.name ? String(item.name).trim() : existing?.name || username,
      iFollow,
      followsMe: Boolean(item.followsMe),
      everFollowed,
      protected: Boolean(item.protected),
      updatedAt: now,
      notes: typeof item.notes === 'string' ? item.notes : existing?.notes,
    };

    if (existing) {
      updatedCount++;
    } else {
      addedCount++;
    }

    await db.users.put(recordToSave);
  }

  return {
    totalCount: list.length,
    addedCount,
    updatedCount,
    errors,
  };
}

export interface DashboardStats {
  total: number;
  iFollow: number;
  followsMe: number;
  notFollowingBack: number;
  fans: number;
  everFollowed: number;
  protectedCount: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const all = await db.users.toArray();
  let iFollow = 0;
  let followsMe = 0;
  let notFollowingBack = 0;
  let fans = 0;
  let everFollowed = 0;
  let protectedCount = 0;

  for (const u of all) {
    if (u.iFollow) iFollow++;
    if (u.followsMe) followsMe++;
    if (u.iFollow && !u.followsMe) notFollowingBack++;
    if (u.followsMe && !u.iFollow) fans++;
    if (u.everFollowed && !u.iFollow) everFollowed++;
    if (u.protected) protectedCount++;
  }

  return {
    total: all.length,
    iFollow,
    followsMe,
    notFollowingBack,
    fans,
    everFollowed,
    protectedCount,
  };
}

export interface InstagramSyncInput {
  following?: Array<{ username: string; name?: string }>;
  followers?: Array<{ username: string; name?: string }>;
  mode: SyncMode;
}

/**
 * Synchronizes users fetched directly from Instagram Web API with the local Dexie DB.
 * Preserves whitelist (protected) and personal notes, and accurately tracks history (everFollowed).
 */
export async function syncInstagramUsers(
  input: InstagramSyncInput
): Promise<InstagramSyncSummary> {
  const mode = input.mode;
  const now = Date.now();

  const followingMap = new Map<string, string>();
  if (input.following) {
    for (const u of input.following) {
      const norm = normalizeUsername(u.username);
      if (norm) {
        followingMap.set(norm, u.name ? u.name.trim() : norm);
      }
    }
  }

  const followersMap = new Map<string, string>();
  if (input.followers) {
    for (const u of input.followers) {
      const norm = normalizeUsername(u.username);
      if (norm) {
        followersMap.set(norm, u.name ? u.name.trim() : norm);
      }
    }
  }

  const allExistingUsers = await db.users.toArray();
  const existingMap = new Map<string, UserRecord>();
  for (const u of allExistingUsers) {
    existingMap.set(u.username, u);
  }

  const allUsernames = new Set<string>();
  if (mode === 'both' || mode === 'following') {
    for (const u of followingMap.keys()) allUsernames.add(u);
  }
  if (mode === 'both' || mode === 'followers') {
    for (const u of followersMap.keys()) allUsernames.add(u);
  }
  for (const u of existingMap.keys()) allUsernames.add(u);

  const toSave: UserRecord[] = [];
  let addedCount = 0;
  let updatedCount = 0;
  let unfollowedMeCount = 0;
  let unfollowedByMeCount = 0;

  for (const username of allUsernames) {
    const existing = existingMap.get(username);
    const inFollowing = followingMap.has(username);
    const inFollowers = followersMap.has(username);

    let newIFollow: boolean;
    if (mode === 'both' || mode === 'following') {
      newIFollow = inFollowing;
    } else {
      newIFollow = existing ? existing.iFollow : false;
    }

    let newFollowsMe: boolean;
    if (mode === 'both' || mode === 'followers') {
      newFollowsMe = inFollowers;
    } else {
      newFollowsMe = existing ? existing.followsMe : false;
    }

    // everFollowed rule:
    // If currently following -> true
    // If ever was true previously -> remains true!
    const newEverFollowed = newIFollow ? true : Boolean(existing?.everFollowed);

    const displayName =
      (mode === 'both' || mode === 'following' ? followingMap.get(username) : null) ||
      (mode === 'both' || mode === 'followers' ? followersMap.get(username) : null) ||
      existing?.name ||
      username;

    if (existing) {
      if (existing.iFollow && !newIFollow && (mode === 'both' || mode === 'following')) {
        unfollowedByMeCount++;
      }
      if (existing.followsMe && !newFollowsMe && (mode === 'both' || mode === 'followers')) {
        unfollowedMeCount++;
      }

      const changed =
        existing.iFollow !== newIFollow ||
        existing.followsMe !== newFollowsMe ||
        existing.everFollowed !== newEverFollowed ||
        (displayName && displayName !== username && existing.name !== displayName);

      if (changed) {
        updatedCount++;
        toSave.push({
          ...existing,
          name: displayName || existing.name,
          iFollow: newIFollow,
          followsMe: newFollowsMe,
          everFollowed: newEverFollowed,
          updatedAt: now,
        });
      }
    } else {
      addedCount++;
      toSave.push({
        username,
        name: displayName || username,
        iFollow: newIFollow,
        followsMe: newFollowsMe,
        everFollowed: newEverFollowed,
        protected: false,
        updatedAt: now,
      });
    }
  }

  if (toSave.length > 0) {
    await db.users.bulkPut(toSave);
  }

  const finalTotal = await db.users.count();

  return {
    totalInDatabase: finalTotal,
    addedCount,
    updatedCount,
    followingCount: followingMap.size,
    followersCount: followersMap.size,
    unfollowedMeCount,
    unfollowedByMeCount,
  };
}



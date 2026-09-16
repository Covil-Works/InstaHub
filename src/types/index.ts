export interface UserRecord {
  username: string; // Identifier: unique @username (normalized to lowercase without @)
  name: string; // Display name
  iFollow: boolean; // Eu sigo: atualmente sigo esse usuário
  followsMe: boolean; // Me segue: atualmente me segue
  everFollowed: boolean; // Já segui: já segui anteriormente, mesmo que atualmente não siga
  protected: boolean; // Protegido: indica que o usuário está na whitelist
  updatedAt?: number; // Timestamp da última alteração
  notes?: string; // Anotações opcionais
}

export interface ExtensionSettings {
  flagsEnabled: boolean;
  keyboardNavEnabled: boolean;
}

export type FilterCategory =
  | 'all'
  | 'iFollow'
  | 'followsMe'
  | 'notFollowingBack'
  | 'fans'
  | 'everFollowed'
  | 'protected';

export type UserFlagStatus = 'following' | 'previouslyFollowed' | 'neverFollowed';

export interface UserStatusResult {
  username: string;
  found: boolean;
  status: UserFlagStatus;
  isProtected: boolean;
  user?: UserRecord;
}

export type SyncMode = 'both' | 'following' | 'followers';

export interface InstagramSyncSummary {
  totalInDatabase: number;
  addedCount: number;
  updatedCount: number;
  followingCount: number;
  followersCount: number;
  unfollowedMeCount: number;
  unfollowedByMeCount: number;
}

export interface InstagramSessionInfo {
  isLoggedIn: boolean;
  userId: string | null;
  csrfToken: string | null;
  username?: string | null;
}

// Background runtime messaging protocol
export type ExtensionMessage =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; settings: Partial<ExtensionSettings> }
  | { type: 'CHECK_USERS'; usernames: string[] }
  | { type: 'GET_USER'; username: string }
  | {
      type: 'RECORD_FOLLOW_INTERACTION';
      username: string;
      name?: string;
      action: 'follow' | 'unfollow';
    }
  | { type: 'TOGGLE_PROTECTED'; username: string }
  | { type: 'UPSERT_USER'; user: UserRecord }
  | { type: 'GET_INSTAGRAM_SESSION' }
  | {
      type: 'FETCH_INSTAGRAM_API';
      endpoint: 'following' | 'followers';
      userId: string;
      maxId?: string | null;
    };

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

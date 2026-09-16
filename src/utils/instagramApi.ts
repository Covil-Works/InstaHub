import type { InstagramSessionInfo } from '../types';

export interface ApiUserItem {
  username: string;
  name: string;
}

export interface FetchProgressCallback {
  (progress: {
    phase: 'following' | 'followers';
    currentCount: number;
    page: number;
    message: string;
  }): void;
}

/**
 * Checks if the user is currently logged into Instagram by reading the session cookies
 */
export async function getInstagramSession(): Promise<InstagramSessionInfo> {
  if (typeof chrome === 'undefined' || !chrome.cookies) {
    return {
      isLoggedIn: false,
      userId: null,
      csrfToken: null,
    };
  }

  try {
    const dsUserIdCookie = await chrome.cookies.get({
      url: 'https://www.instagram.com',
      name: 'ds_user_id',
    });

    const csrfTokenCookie = await chrome.cookies.get({
      url: 'https://www.instagram.com',
      name: 'csrftoken',
    });

    const sessionIdCookie = await chrome.cookies.get({
      url: 'https://www.instagram.com',
      name: 'sessionid',
    });

    const userId = dsUserIdCookie?.value || null;
    const csrfToken = csrfTokenCookie?.value || null;
    const isLoggedIn = Boolean(userId && sessionIdCookie?.value);

    return {
      isLoggedIn,
      userId,
      csrfToken,
    };
  } catch (err) {
    console.error('[InstaHub API] Erro ao consultar cookies do Instagram:', err);
    return {
      isLoggedIn: false,
      userId: null,
      csrfToken: null,
    };
  }
}

/**
 * Executes a single page fetch for followers or following
 */
async function fetchPageFromInstagram(
  endpoint: 'following' | 'followers',
  userId: string,
  csrfToken: string | null,
  maxId?: string | null
): Promise<{
  users: ApiUserItem[];
  nextMaxId: string | null;
}> {
  // Strategy 1: Check if an Instagram tab is open to fetch in its same-origin context
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    try {
      const tabs = await chrome.tabs.query({ url: '*://*.instagram.com/*' });
      const instaTab = tabs.find((t) => t.id && t.url?.includes('instagram.com'));

      if (instaTab && instaTab.id) {
        const result = await new Promise<{
          success: boolean;
          data?: { users: any[]; nextMaxId: string | null };
          error?: string;
        }>((resolve) => {
          chrome.tabs.sendMessage(
            instaTab.id!,
            {
              type: 'FETCH_INSTAGRAM_API',
              endpoint,
              userId,
              maxId,
            },
            (res) => {
              if (chrome.runtime.lastError) {
                resolve({ success: false, error: chrome.runtime.lastError.message });
              } else {
                resolve(res || { success: false, error: 'Resposta vazia' });
              }
            }
          );
        });

        if (result.success && result.data) {
          return {
            users: (result.data.users || []).map((u: any) => ({
              username: String(u.username || '').toLowerCase().trim(),
              name: String(u.full_name || u.username || '').trim(),
            })),
            nextMaxId: result.data.nextMaxId || null,
          };
        } else if (result.error === 'RATE_LIMIT') {
          throw new Error('RATE_LIMIT');
        }
      }
    } catch (tabErr: any) {
      if (tabErr?.message === 'RATE_LIMIT') throw tabErr;
      console.warn('[InstaHub API] Fallback para fetch direto após falha na aba:', tabErr);
    }
  }

  // Strategy 2: Direct fetch with credentials include and official web client headers
  const url = `https://www.instagram.com/api/v1/friendships/${userId}/${endpoint}/?count=50${
    maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''
  }`;

  const headers: Record<string, string> = {
    'X-IG-App-ID': '936619743392459',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': '*/*',
  };

  if (csrfToken) {
    headers['X-CSRFToken'] = csrfToken;
  }

  const res = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (res.status === 429) {
    throw new Error('RATE_LIMIT');
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error('UNAUTHORIZED');
  }

  if (!res.ok) {
    throw new Error(`HTTP_ERROR_${res.status}`);
  }

  const json = await res.json();
  if (json.status !== 'ok' && json.message) {
    if (json.message.includes('checkpoint') || json.message.includes('feedback')) {
      throw new Error('CHECKPOINT_REQUIRED');
    }
  }

  return {
    users: (json.users || []).map((u: any) => ({
      username: String(u.username || '').toLowerCase().trim(),
      name: String(u.full_name || u.username || '').trim(),
    })),
    nextMaxId: json.next_max_id || null,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches all users from followers or following with pagination and safe intervals
 */
export async function fetchFullList(
  endpoint: 'following' | 'followers',
  userId: string,
  csrfToken: string | null,
  onProgress: FetchProgressCallback,
  signal?: AbortSignal
): Promise<ApiUserItem[]> {
  const allUsers: ApiUserItem[] = [];
  const seenUsernames = new Set<string>();
  let nextMaxId: string | null = null;
  let page = 0;

  do {
    if (signal?.aborted) {
      console.log(`[InstaHub API] Busca de ${endpoint} interrompida pelo usuário.`);
      break;
    }

    page++;
    onProgress({
      phase: endpoint,
      currentCount: allUsers.length,
      page,
      message:
        endpoint === 'following'
          ? `Buscando perfis que você segue (Página ${page})...`
          : `Buscando seguidores da sua conta (Página ${page})...`,
    });

    const response = await fetchPageFromInstagram(endpoint, userId, csrfToken, nextMaxId);

    for (const user of response.users) {
      if (user.username && !seenUsernames.has(user.username)) {
        seenUsernames.add(user.username);
        allUsers.push(user);
      }
    }

    onProgress({
      phase: endpoint,
      currentCount: allUsers.length,
      page,
      message:
        endpoint === 'following'
          ? `${allUsers.length} perfis seguidos encontrados...`
          : `${allUsers.length} seguidores encontrados...`,
    });

    nextMaxId = response.nextMaxId;

    // If there are more pages, wait with safe randomized jitter (1200ms - 1800ms)
    if (nextMaxId && !signal?.aborted) {
      const waitTime = 1200 + Math.floor(Math.random() * 600);
      await sleep(waitTime);
    }
  } while (nextMaxId && !signal?.aborted);

  return allUsers;
}

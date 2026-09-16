import type {
  ExtensionSettings,
  UserStatusResult,
  MessageResponse,
  UserRecord,
} from '../types';
import { DEFAULT_SETTINGS } from '../utils/storage';

// Current state in page
let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
let activeRowIndex: number = -1;
let activeUsername: string | null = null;
let currentModalRows: HTMLElement[] = [];
let lastNavTimestamp: number = 0;

// Cache for known users to avoid redundant requests
const userStatusCache = new Map<string, UserStatusResult>();
const pendingUsernames = new Set<string>();
let batchTimeout: number | null = null;
let scanDebounceTimer: number | null = null;

// Lock to avoid MutationObserver reacting to our own DOM changes
let isInstaHubMutating: boolean = false;

// Reserved Instagram paths that are not usernames
const RESERVED_PATHS = new Set([
  '',
  'explore',
  'reels',
  'direct',
  'stories',
  'accounts',
  'your_activity',
  'settings',
  'p',
  'reel',
  'tv',
  'about',
  'legal',
  'help',
  'api',
  'developer',
  'graphql',
  'static',
  'privacy',
  'terms',
  'support',
  'meta',
  'directory',
  'lite',
  'threads',
  'comments',
]);

// Initialize
init();

async function init() {
  console.log('[InstaHub Content Script] Injected and running with performance optimizations.');

  // Fetch initial settings from background
  try {
    const res = await sendMessage<{ settings?: ExtensionSettings }>({ type: 'GET_SETTINGS' });
    if (res?.data && typeof res.data === 'object' && 'flagsEnabled' in res.data) {
      settings = res.data as ExtensionSettings;
    }
  } catch (err) {
    console.warn('[InstaHub] Não foi possível carregar configurações do background, usando padrão.', err);
  }

  // Listen for storage changes in real-time
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local') {
        if (changes.flagsEnabled) {
          settings.flagsEnabled = Boolean(changes.flagsEnabled.newValue);
          handleFlagsToggle(settings.flagsEnabled);
        }
        if (changes.keyboardNavEnabled) {
          settings.keyboardNavEnabled = Boolean(changes.keyboardNavEnabled.newValue);
          if (!settings.keyboardNavEnabled) {
            clearActiveRowHighlight();
          }
        }
      }
    });
  }

  // Listen for runtime messages from Dashboard or Popup (e.g. FETCH_INSTAGRAM_API)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'FETCH_INSTAGRAM_API') {
        (async () => {
          try {
            const { endpoint, userId, maxId } = msg;
            const url = `/api/v1/friendships/${userId}/${endpoint}/?count=50${
              maxId ? `&max_id=${encodeURIComponent(maxId)}` : ''
            }`;
            const res = await fetch(url, {
              headers: {
                'X-IG-App-ID': '936619743392459',
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': '*/*',
              },
              credentials: 'include',
            });

            if (res.status === 429) {
              sendResponse({ success: false, error: 'RATE_LIMIT' });
              return;
            }

            if (!res.ok) {
              sendResponse({ success: false, error: `HTTP_${res.status}` });
              return;
            }

            const json = await res.json();
            sendResponse({
              success: true,
              data: {
                users: (json.users || []).map((u: any) => ({
                  username: u.username,
                  full_name: u.full_name,
                })),
                nextMaxId: json.next_max_id || null,
                status: json.status || 'ok',
              },
            });
          } catch (err: any) {
            sendResponse({ success: false, error: err?.message || 'Erro na requisição' });
          }
        })();
        return true;
      }
    });
  }

  // Setup Keyboard Navigation
  window.addEventListener('keydown', handleKeyDown, true);

  // Setup MutationObserver with debouncing and loop-prevention
  setupObserver();

  // Listen to SPA URL navigation changes (Instagram pushState/replaceState)
  setupUrlChangeListener();

  // Initial debounced scan
  triggerDebouncedScan(200);
}

function handleFlagsToggle(enabled: boolean) {
  const existingBadges = document.querySelectorAll<HTMLElement>('.instahub-badge-wrapper');
  existingBadges.forEach((el) => {
    el.style.display = enabled ? 'inline-flex' : 'none';
  });
  if (enabled) {
    triggerDebouncedScan(50);
  }
}

function sendMessage<T = any>(msg: any): Promise<MessageResponse<T>> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      resolve({ success: false, error: 'chrome.runtime unavailable' });
      return;
    }
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: true });
        }
      });
    } catch (e: any) {
      resolve({ success: false, error: e?.message || 'Falha ao enviar mensagem' });
    }
  });
}

/**
 * Triggers a debounced scan to avoid freezing Instagram with repeated microtask calls
 */
function triggerDebouncedScan(delay = 150) {
  if (scanDebounceTimer !== null) {
    window.clearTimeout(scanDebounceTimer);
  }
  scanDebounceTimer = window.setTimeout(() => {
    scanDebounceTimer = null;
    scanAndInject();
  }, delay);
}

/**
 * Detect SPA URL changes in Instagram
 */
function setupUrlChangeListener() {
  let lastUrl = window.location.href;

  const onUrlChange = () => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      activeRowIndex = -1;
      activeUsername = null;
      currentModalRows = [];
      clearActiveRowHighlight();
      triggerDebouncedScan(100);
    }
  };

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    onUrlChange();
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    onUrlChange();
  };

  window.addEventListener('popstate', onUrlChange);
}

/**
 * Observer that ignores our own injected badges and only reacts to external changes
 */
function setupObserver() {
  const observer = new MutationObserver((mutations) => {
    // 1. If InstaHub is actively injecting elements, ignore all mutations
    if (isInstaHubMutating) return;

    // Check if dialog state changed
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog && activeRowIndex !== -1) {
      activeRowIndex = -1;
      activeUsername = null;
      currentModalRows = [];
      clearActiveRowHighlight();
    } else if (dialog && activeRowIndex === -1) {
      triggerDebouncedScan(50);
    }

    // 2. Check if external nodes were actually added by Instagram
    let hasExternalAddedNodes = false;
    for (const m of mutations) {
      if (m.addedNodes.length === 0) continue;

      for (let i = 0; i < m.addedNodes.length; i++) {
        const node = m.addedNodes[i];
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          // Ignore our own badge elements, indicators or children
          if (
            el.classList.contains('instahub-badge-wrapper') ||
            el.classList.contains('instahub-badge') ||
            el.classList.contains('instahub-badge-protect-toggle') ||
            el.classList.contains('instahub-enter-indicator') ||
            el.closest?.('.instahub-badge-wrapper') ||
            el.closest?.('.instahub-enter-indicator')
          ) {
            continue;
          }
          hasExternalAddedNodes = true;
          break;
        }
      }
      if (hasExternalAddedNodes) break;
    }

    if (hasExternalAddedNodes) {
      triggerDebouncedScan(150);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function extractUsernameFromHref(href: string): string | null {
  try {
    const url = new URL(href, window.location.origin);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 1) {
      const u = parts[0].toLowerCase();
      if (!RESERVED_PATHS.has(u) && /^[a-zA-Z0-9._]+$/.test(u)) {
        return u;
      }
    }
  } catch {
    // Ignore invalid urls
  }
  return null;
}

/**
 * Checks if a button is a follow/unfollow action button
 */
function isFollowButton(btn: HTMLElement): boolean {
  const text = (btn.textContent || '').toLowerCase().trim();
  const aria = (btn.getAttribute('aria-label') || '').toLowerCase().trim();
  const combined = text + ' ' + aria;

  return (
    combined.includes('seguir') ||
    combined.includes('seguindo') ||
    combined.includes('follow') ||
    combined.includes('following') ||
    combined.includes('solicitado') ||
    combined.includes('requested') ||
    combined.includes('remover') ||
    combined.includes('remove') ||
    combined.includes('deixar de seguir') ||
    combined.includes('unfollow')
  );
}

/**
 * Efficiently finds the row container for a user item
 */
function findRowContainer(link: HTMLElement): HTMLElement | null {
  // If already marked as valid row, return it
  const existingRow = link.closest<HTMLElement>('[data-instahub-row="true"]');
  if (existingRow) {
    const rRect = existingRow.getBoundingClientRect();
    if (rRect.height >= 35 && rRect.height <= 130) {
      return existingRow;
    }
    delete existingRow.dataset.instahubRow;
  }

  // Walk up parents from link
  let current: HTMLElement | null = link.parentElement;
  let depth = 0;
  while (current && depth < 8 && current !== document.body) {
    if (current.getAttribute('role') === 'dialog') break;

    const rect = current.getBoundingClientRect();
    // In Instagram modal, each row has height between 35px and 130px and contains a button
    if (rect.height >= 35 && rect.height <= 130 && rect.width >= 180) {
      const btn = current.querySelector('button');
      if (btn) {
        current.dataset.instahubRow = 'true';
        return current;
      }
    }
    current = current.parentElement;
    depth++;
  }

  // Fallback: search closest li or role=listitem
  const listitem = link.closest<HTMLElement>('li, [role="listitem"]');
  if (listitem) {
    listitem.dataset.instahubRow = 'true';
    return listitem;
  }

  // Fallback: 3 levels up from link
  const fallback = link.parentElement?.parentElement?.parentElement || link.parentElement?.parentElement;
  if (fallback) {
    const fRect = fallback.getBoundingClientRect();
    if (fRect.height >= 35 && fRect.height <= 130) {
      fallback.dataset.instahubRow = 'true';
      return fallback;
    }
  }

  return null;
}

/**
 * Injects badge on a profile page header if viewing someone's profile directly
 */
function checkProfileHeader() {
  if (!settings.flagsEnabled) return;

  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length !== 1) return;

  const username = parts[0].toLowerCase();
  if (RESERVED_PATHS.has(username) || !/^[a-zA-Z0-9._]+$/.test(username)) {
    return;
  }

  const header = document.querySelector('header');
  if (!header) return;

  // Instagram profile header username is in h2 or h1
  const heading = header.querySelector('h2, h1');
  if (!heading) return;

  const headingText = (heading.textContent || '').trim().toLowerCase();
  if (headingText !== username) return;

  let badgeWrapper = header.querySelector<HTMLElement>(
    `.instahub-badge-wrapper[data-username="${username}"]`
  );

  if (!badgeWrapper) {
    badgeWrapper = document.createElement('span');
    badgeWrapper.className = 'instahub-badge-wrapper instahub-profile-header-badge';
    badgeWrapper.dataset.username = username;

    isInstaHubMutating = true;
    try {
      heading.insertAdjacentElement('afterend', badgeWrapper);
    } catch {
      heading.appendChild(badgeWrapper);
    } finally {
      isInstaHubMutating = false;
    }
  }

  // Attach follow button listener if button present in header
  const headerBtn = Array.from(header.querySelectorAll('button')).find(isFollowButton);
  if (headerBtn && header.dataset.instahubButtonListening !== 'true') {
    attachButtonListener(header, username);
  }

  if (userStatusCache.has(username)) {
    renderBadge(badgeWrapper, userStatusCache.get(username)!, username);
  } else {
    pendingUsernames.add(username);
    scheduleBatchFetch();
  }
}

/**
 * Scan ONLY relevant user containers (Follower modals, Suggestions, Explore People)
 * NEVER scans the entire document.body or the infinite post feed!
 */
function scanAndInject() {
  // Check profile header first if flags are enabled
  if (settings.flagsEnabled) {
    checkProfileHeader();
  }

  // Find targeted containers:
  // 1. Dialog (Followers, Following, Likes)
  const dialog = document.querySelector('div[role="dialog"]');

  // 2. Suggestions container or Explore People page
  const isExplorePeople = window.location.pathname.startsWith('/explore/people');
  const suggestions =
    isExplorePeople
      ? document.querySelector('main')
      : document.querySelector('div[data-page-type="discover_people"]') ||
        document.querySelector('aside');

  const roots: HTMLElement[] = [];
  if (dialog) roots.push(dialog as HTMLElement);
  if (suggestions) roots.push(suggestions as HTMLElement);

  // If no dialog or suggestions container is active, exit and reset modal state
  if (roots.length === 0) {
    if (activeRowIndex !== -1) {
      activeRowIndex = -1;
      activeUsername = null;
      currentModalRows = [];
      clearActiveRowHighlight();
    }
    return;
  }

  const usernamesToFetch: string[] = [];

  for (const root of roots) {
    // Only query links that haven't been processed yet to keep CPU at near zero
    const links = root.querySelectorAll<HTMLAnchorElement>(
      'a[href^="/"]:not([data-instahub-processed]), a[role="link"]:not([data-instahub-processed])'
    );

    links.forEach((link) => {
      link.dataset.instahubProcessed = 'true';

      const href = link.getAttribute('href') || '';
      const username = extractUsernameFromHref(href);
      if (!username) return;

      // Skip avatar image links (they only have an img and no username text)
      const hasImgOnly = link.querySelector('img') && !link.textContent?.trim();
      if (hasImgOnly) return;

      // Find the row container
      const row = findRowContainer(link);
      if (!row) return;

      // Attach row follow button click interceptor
      attachButtonListener(row, username);

      // Attach row selection on click
      if (row.dataset.instahubClickListening !== 'true') {
        row.dataset.instahubClickListening = 'true';
        row.addEventListener('click', (ev) => {
          const targetEl = ev.target as HTMLElement | null;
          if (targetEl?.closest?.('.instahub-badge-wrapper, button, a')) return;

          const searchRoot =
            row.closest('div[role="dialog"]') ||
            document.querySelector('main') ||
            document.body;
          currentModalRows = ensureModalRows(searchRoot as HTMLElement);
          const idx = currentModalRows.indexOf(row);
          if (idx !== -1) {
            activeRowIndex = idx;
            activeUsername = getUsernameFromRow(row);
            updateActiveRow('none');
          }
        });
      }

      // If flags are disabled, do not inject badges
      if (!settings.flagsEnabled) return;

      // Check if we already injected a badge next to this link
      let badgeWrapper = link.nextElementSibling?.classList.contains('instahub-badge-wrapper')
        ? (link.nextElementSibling as HTMLElement)
        : row.querySelector<HTMLElement>(`.instahub-badge-wrapper[data-username="${username}"]`);

      if (!badgeWrapper) {
        badgeWrapper = document.createElement('span');
        badgeWrapper.className = 'instahub-badge-wrapper';
        badgeWrapper.dataset.username = username;

        isInstaHubMutating = true;
        try {
          link.insertAdjacentElement('afterend', badgeWrapper);
        } catch {
          link.appendChild(badgeWrapper);
        } finally {
          isInstaHubMutating = false;
        }
      }

      if (userStatusCache.has(username)) {
        renderBadge(badgeWrapper, userStatusCache.get(username)!, username);
      } else {
        usernamesToFetch.push(username);
        pendingUsernames.add(username);
      }
    });
  }

  if (usernamesToFetch.length > 0) {
    scheduleBatchFetch();
  }

  // Auto-initialize or refresh keyboard selection when modal is active
  if (settings.keyboardNavEnabled && dialog) {
    const freshRows = ensureModalRows(dialog as HTMLElement);
    if (freshRows.length > 0) {
      currentModalRows = freshRows;
      if (activeRowIndex < 0 || !document.querySelector('.instahub-row-active')) {
        activeRowIndex = 0;
        activeUsername = getUsernameFromRow(freshRows[0]);
        updateActiveRow('none');
      } else if (activeUsername) {
        const found = freshRows.findIndex((r) => getUsernameFromRow(r) === activeUsername);
        if (found !== -1) {
          activeRowIndex = found;
          freshRows[found].classList.add('instahub-row-active');
          renderEnterIndicator(freshRows[found]);
        }
      }
    }
  }
}

function attachButtonListener(row: HTMLElement, username: string) {
  if (row.dataset.instahubButtonListening === 'true') return;

  const buttons = Array.from(row.querySelectorAll('button'));
  const button = buttons.find(isFollowButton);
  if (!button) return;

  row.dataset.instahubButtonListening = 'true';

  button.addEventListener('click', () => {
    // Capture state AT THE TIME of the click
    const btnText = (button.textContent || '').toLowerCase().trim();
    const btnAria = (button.getAttribute('aria-label') || '').toLowerCase().trim();
    const combined = btnText + ' ' + btnAria;

    let action: 'follow' | 'unfollow' = 'follow';
    if (
      combined.includes('seguindo') ||
      combined.includes('following') ||
      combined.includes('solicitado') ||
      combined.includes('requested') ||
      combined.includes('deixar de seguir') ||
      combined.includes('unfollow')
    ) {
      action = 'unfollow';
    } else if (combined.includes('seguir') || combined.includes('follow')) {
      action = 'follow';
    }

    // Try to extract display name
    let name = username;
    const spans = Array.from(row.querySelectorAll('span'));
    for (const span of spans) {
      const text = (span.textContent || '').trim();
      if (text && text.toLowerCase() !== username.toLowerCase() && !text.includes('•') && text.length > 1) {
        name = text;
        break;
      }
    }

    setTimeout(async () => {
      const res = await sendMessage<UserRecord>({
        type: 'RECORD_FOLLOW_INTERACTION',
        username,
        name,
        action,
      });

      if (res.success && res.data) {
        const updated = res.data;
        const newStatus: UserStatusResult = {
          username,
          found: true,
          status: updated.iFollow
            ? 'following'
            : updated.everFollowed
            ? 'previouslyFollowed'
            : 'neverFollowed',
          isProtected: Boolean(updated.protected),
          user: updated,
        };

        userStatusCache.set(username, newStatus);

        const wrappers = document.querySelectorAll<HTMLElement>(
          `.instahub-badge-wrapper[data-username="${username}"]`
        );
        wrappers.forEach((w) => renderBadge(w, newStatus, username));
      }
    }, 300);
  });
}

function scheduleBatchFetch() {
  if (batchTimeout) return;

  batchTimeout = window.setTimeout(async () => {
    batchTimeout = null;
    const usernames = Array.from(pendingUsernames);
    pendingUsernames.clear();

    if (usernames.length === 0) return;

    try {
      const res = await sendMessage<Record<string, UserStatusResult>>({
        type: 'CHECK_USERS',
        usernames,
      });

      if (res.success && res.data) {
        for (const [u, result] of Object.entries(res.data)) {
          userStatusCache.set(u, result);
          const wrappers = document.querySelectorAll<HTMLElement>(
            `.instahub-badge-wrapper[data-username="${u}"]`
          );
          wrappers.forEach((w) => renderBadge(w, result, u));
        }
      }
    } catch (err) {
      console.warn('[InstaHub] Erro ao consultar batch de usuários:', err);
    }
  }, 50);
}

function renderBadge(wrapper: HTMLElement, info: UserStatusResult, username: string) {
  isInstaHubMutating = true;
  try {
    wrapper.innerHTML = '';
    if (!settings.flagsEnabled) {
      wrapper.style.display = 'none';
      return;
    }
    wrapper.style.display = 'inline-flex';

    // 1. Protected Flag (Whitelist)
    if (info.isProtected) {
      const protBadge = document.createElement('span');
      protBadge.className = 'instahub-badge instahub-badge-protected';
      protBadge.title = 'Perfil Protegido (Whitelist). Clique para alterar.';
      protBadge.innerHTML = `<span>🛡️ Protegido</span>`;
      protBadge.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        handleToggleWhitelist(username);
      };
      wrapper.appendChild(protBadge);
    } else {
      const addProtBtn = document.createElement('span');
      addProtBtn.className = 'instahub-badge-protect-toggle';
      addProtBtn.title = 'Adicionar à Whitelist (Protegido)';
      addProtBtn.innerHTML = `+🛡️`;
      addProtBtn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        handleToggleWhitelist(username);
      };
      wrapper.appendChild(addProtBtn);
    }

    // 2. Follow Status Flag
    const statusBadge = document.createElement('span');
    statusBadge.className = 'instahub-badge';

    if (info.status === 'following') {
      statusBadge.classList.add('instahub-badge-following');
      statusBadge.innerHTML = `<span>✓ Segue</span>`;
      statusBadge.title = 'Você segue este perfil atualmente.';
    } else if (info.status === 'previouslyFollowed') {
      statusBadge.classList.add('instahub-badge-previously-followed');
      statusBadge.innerHTML = `<span>↺ Já seguiu</span>`;
      statusBadge.title = 'Você já seguiu este perfil no passado, mas não segue mais.';
    } else {
      // neverFollowed
      statusBadge.classList.add('instahub-badge-never-followed');
      statusBadge.innerHTML = `<span>– Nunca seguiu</span>`;
      statusBadge.title = 'Não consta histórico de ter seguido este perfil.';
    }

    wrapper.appendChild(statusBadge);
  } finally {
    isInstaHubMutating = false;
  }
}

async function handleToggleWhitelist(username: string) {
  const res = await sendMessage<UserRecord>({
    type: 'TOGGLE_PROTECTED',
    username,
  });

  if (res.success && res.data) {
    const updated = res.data;
    const newStatus: UserStatusResult = {
      username,
      found: true,
      status: updated.iFollow
        ? 'following'
        : updated.everFollowed
        ? 'previouslyFollowed'
        : 'neverFollowed',
      isProtected: Boolean(updated.protected),
      user: updated,
    };
    userStatusCache.set(username, newStatus);

    const wrappers = document.querySelectorAll<HTMLElement>(
      `.instahub-badge-wrapper[data-username="${username}"]`
    );
    wrappers.forEach((w) => renderBadge(w, newStatus, username));
  }
}

// ----------------------------------------------------
// KEYBOARD NAVIGATION & AUTO-SCROLL
// ----------------------------------------------------

/**
 * Obtém o username a partir de um elemento de linha
 */
function getUsernameFromRow(row: HTMLElement): string | null {
  const badge = row.querySelector<HTMLElement>('.instahub-badge-wrapper[data-username]');
  if (badge?.dataset.username) return badge.dataset.username.toLowerCase();

  const links = Array.from(row.querySelectorAll<HTMLAnchorElement>('a[href^="/"]'));
  for (const link of links) {
    const hasImgOnly = link.querySelector('img') && !link.textContent?.trim();
    if (hasImgOnly) continue;
    const u = extractUsernameFromHref(link.getAttribute('href') || '');
    if (u) return u;
  }

  for (const link of links) {
    const u = extractUsernameFromHref(link.getAttribute('href') || '');
    if (u) return u;
  }

  return null;
}

/**
 * Garante e retorna todas as linhas de usuário carregadas no contêiner
 */
function ensureModalRows(searchRoot: HTMLElement): HTMLElement[] {
  const links = Array.from(
    searchRoot.querySelectorAll<HTMLAnchorElement>('a[href^="/"], a[role="link"]')
  );

  for (const link of links) {
    const hasImgOnly = link.querySelector('img') && !link.textContent?.trim();
    if (hasImgOnly) continue;

    const href = link.getAttribute('href') || '';
    const username = extractUsernameFromHref(href);
    if (!username) continue;

    findRowContainer(link);
  }

  const allRows = Array.from(
    searchRoot.querySelectorAll<HTMLElement>('[data-instahub-row="true"]')
  );

  // Mantém apenas linhas válidas com dimensões coerentes e remove duplicatas ou ancestrais
  const validRows = allRows.filter((r) => {
    if (!r.isConnected) return false;
    const rect = r.getBoundingClientRect();
    if (rect.height > 130 || rect.height < 30) return false;
    return !allRows.some((other) => other !== r && r.contains(other));
  });

  // Ordena estritamente pela ordem visual no DOM (posição top)
  validRows.sort((a, b) => {
    return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
  });

  return validRows;
}

/**
 * Renderiza o indicador de navegação ("↵ Enter") ao lado do botão de ação
 */
function renderEnterIndicator(row: HTMLElement) {
  removeEnterIndicator();

  const indicator = document.createElement('span');
  indicator.className = 'instahub-enter-indicator';
  indicator.textContent = '↵ Enter';
  indicator.setAttribute('aria-hidden', 'true');

  const updatePosition = () => {
    if (!indicator.isConnected) return;
    const buttons = Array.from(row.querySelectorAll('button'));
    const actionButton = buttons.find(isFollowButton) || buttons[0];

    if (actionButton) {
      const rowRect = row.getBoundingClientRect();
      const btnRect = actionButton.getBoundingClientRect();
      if (rowRect.width > 0 && btnRect.width > 0) {
        const offsetFromRight = Math.max(0, rowRect.right - btnRect.left);
        indicator.style.right = `${offsetFromRight + 8}px`;
        return;
      }
    }
    indicator.style.right = '12px';
  };

  updatePosition();

  isInstaHubMutating = true;
  try {
    row.appendChild(indicator);
  } finally {
    isInstaHubMutating = false;
  }

  requestAnimationFrame(updatePosition);
}

/**
 * Remove qualquer indicador de navegação presente na página
 */
function removeEnterIndicator() {
  isInstaHubMutating = true;
  try {
    document.querySelectorAll('.instahub-enter-indicator').forEach((el) => el.remove());
  } finally {
    isInstaHubMutating = false;
  }
}

/**
 * Localiza exclusivamente o contêiner interno com rolagem do diálogo de Seguidores/Seguindo do Instagram.
 * Começa procurando pelos ancestrais da linha ativa no DOM (garantindo que é o contêiner da lista)
 * e nunca retorna window ou document.body para não rolar a página principal.
 */
function getDialogScrollContainer(targetElement?: HTMLElement | null): HTMLElement | null {
  const ref =
    (targetElement && targetElement.isConnected ? targetElement : null) ||
    (activeRowIndex >= 0 && currentModalRows[activeRowIndex]?.isConnected
      ? currentModalRows[activeRowIndex]
      : currentModalRows.find((r) => r?.isConnected));

  // 1. Procura subindo diretamente pelos ancestrais da linha no DOM
  if (ref && ref.isConnected) {
    let curr: HTMLElement | null = ref.parentElement;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (curr.scrollHeight > curr.clientHeight + 5 && curr.clientHeight >= 80) {
        const style = window.getComputedStyle(curr);
        const oy = style.overflowY;
        if (
          oy === 'auto' ||
          oy === 'scroll' ||
          oy === 'overlay' ||
          style.overflow === 'auto' ||
          style.overflow === 'scroll'
        ) {
          return curr;
        }
      }
      curr = curr.parentElement;
    }

    // Segunda passagem pelos ancestrais da linha (sem exigir overflow explícito)
    curr = ref.parentElement;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (curr.scrollHeight > curr.clientHeight + 5 && curr.clientHeight >= 80) {
        return curr;
      }
      curr = curr.parentElement;
    }
  }

  // 2. Busca dentro do modal aberto (role="dialog" ou aria-modal="true")
  const modal =
    document.querySelector<HTMLElement>('div[role="dialog"]') ||
    document.querySelector<HTMLElement>('[role="dialog"]') ||
    document.querySelector<HTMLElement>('div[aria-modal="true"]');

  if (modal) {
    // Seletor clássico _aano
    const aano = modal.querySelector<HTMLElement>('div._aano');
    if (aano && aano.scrollHeight > aano.clientHeight) return aano;

    // Busca todos os elementos internos com scrollHeight > clientHeight
    const candidates = Array.from(modal.querySelectorAll<HTMLElement>('div, ul, section')).filter(
      (el) => el.clientHeight >= 80 && el.scrollHeight > el.clientHeight + 5
    );

    if (candidates.length > 0) {
      if (ref) {
        const matching = candidates.filter((c) => c.contains(ref));
        if (matching.length > 0) {
          // O mais interno que contém a linha
          matching.sort((a, b) => a.scrollHeight - b.scrollHeight);
          return matching[0];
        }
      }

      const withOverflow = candidates.find((c) => {
        const s = window.getComputedStyle(c);
        return s.overflowY === 'auto' || s.overflowY === 'scroll';
      });
      if (withOverflow) return withOverflow;

      return candidates[0];
    }
  }

  return null;
}

/**
 * Notifica os listeners de rolagem do Instagram para carregar mais usuários em segundo plano
 */
function triggerInstagramPagination(searchRoot?: HTMLElement | null) {
  const row = currentModalRows[activeRowIndex] || currentModalRows[0];
  const scrollContainer = getDialogScrollContainer(row || (searchRoot as HTMLElement));
  if (scrollContainer) {
    scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
  }
  triggerDebouncedScan(60);
}

function handleKeyDown(e: KeyboardEvent) {
  if (!settings.keyboardNavEnabled) return;

  const target = e.target as HTMLElement | null;
  const isInputTarget =
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable ||
      target.getAttribute('role') === 'textbox');

  const dialog = document.querySelector('div[role="dialog"]');
  const isExplorePeople = window.location.pathname.startsWith('/explore/people');
  const suggestions = isExplorePeople ? document.querySelector('main') : null;
  const searchRoot = (dialog || suggestions) as HTMLElement | null;

  if (!searchRoot) return;

  // Se o foco estiver em um input dentro do modal de seguidores e pressionar ArrowDown,
  // remove o foco do input de busca e transfere a navegação diretamente para a lista!
  if (isInputTarget) {
    if (dialog && target && dialog.contains(target) && e.key === 'ArrowDown') {
      target.blur();
    } else {
      return;
    }
  }

  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') {
    return;
  }

  // Escaneia para garantir que novos usuários no DOM estejam indexados
  const freshRows = ensureModalRows(searchRoot);
  if (freshRows.length === 0) return;
  currentModalRows = freshRows;

  // Mantém a sincronia com o username selecionado caso itens tenham sido inseridos
  if (activeUsername) {
    const found = currentModalRows.findIndex((r) => getUsernameFromRow(r) === activeUsername);
    if (found !== -1) {
      activeRowIndex = found;
    }
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();

    // Se nenhuma linha estiver selecionada ainda, seleciona a primeira (usuário 1)
    if (
      activeRowIndex < 0 ||
      activeRowIndex >= currentModalRows.length ||
      !document.querySelector('.instahub-row-active')
    ) {
      activeRowIndex = 0;
      updateActiveRow('none');
      return;
    }

    // Se aproximando do final dos itens carregados, pede para o Instagram buscar mais
    if (activeRowIndex >= currentModalRows.length - 4) {
      triggerInstagramPagination(searchRoot);
    }

    if (activeRowIndex < currentModalRows.length - 1) {
      activeRowIndex++;
      updateActiveRow('down');
    } else {
      // Já está no último item carregado: tenta ver se novas linhas surgiram
      triggerInstagramPagination(searchRoot);
      const recheckedRows = ensureModalRows(searchRoot);

      if (recheckedRows.length > currentModalRows.length) {
        currentModalRows = recheckedRows;
        activeRowIndex++;
        updateActiveRow('down');
      } else {
        updateActiveRow('down');
      }
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();

    // Se nenhuma linha estiver selecionada, seleciona a primeira
    if (
      activeRowIndex <= 0 ||
      activeRowIndex >= currentModalRows.length ||
      !document.querySelector('.instahub-row-active')
    ) {
      activeRowIndex = 0;
      updateActiveRow('none');
      return;
    }

    activeRowIndex--;
    updateActiveRow('up');
  } else if (e.key === 'Enter') {
    if (activeRowIndex >= 0 && activeRowIndex < currentModalRows.length) {
      e.preventDefault();
      e.stopPropagation();

      const selectedRow = currentModalRows[activeRowIndex];
      const buttons = Array.from(selectedRow?.querySelectorAll('button') || []);
      const actionButton = buttons.find(isFollowButton) || buttons[0];
      if (actionButton) {
        actionButton.focus();
        actionButton.click();
      }
    }
  }
}


function updateActiveRow(direction: 'down' | 'up' | 'none' = 'none') {
  clearActiveRowHighlight();

  if (activeRowIndex < 0 || activeRowIndex >= currentModalRows.length) {
    return;
  }

  const row = currentModalRows[activeRowIndex];
  if (!row || !row.isConnected) {
    return;
  }

  activeUsername = getUsernameFromRow(row);
  row.classList.add('instahub-row-active');
  renderEnterIndicator(row);

  const scrollContainer = getDialogScrollContainer(row);
  if (!scrollContainer || scrollContainer === row) {
    return;
  }

  const now = performance.now();
  const isRapid = now - lastNavTimestamp < 200;
  lastNavTimestamp = now;
  const scrollBehavior: ScrollBehavior = isRapid ? 'auto' : 'smooth';

  // Regra de rolagem da navegação:
  // - Usuário 1 (índice 0): nenhum scroll (scrollTop = 0).
  // - Usuário 2 (índice 1): nenhum scroll (scrollTop = 0).
  // - Usuário 3 (índice 2): nenhum scroll (mantém o topo, 0).
  // - A partir do usuário 3 (ao avançar 3 -> 4, 4 -> 5, 5 -> 6, etc.):
  //   o diálogo desce 20% da sua área visível (clientHeight) a cada nova navegação para baixo.
  // - Ao navegar para cima com ↑: comportamento simétrico subindo 20% a cada passo até parar naturalmente no topo (0).
  const visibleHeight = scrollContainer.clientHeight;
  const step = Math.round(visibleHeight * 0.20);
  const targetScrollTop = activeRowIndex >= 3 ? Math.round((activeRowIndex - 2) * step) : 0;

  // 1. Tenta scroll suave nativo
  try {
    scrollContainer.scrollTo({
      top: targetScrollTop,
      behavior: scrollBehavior,
    });
  } catch {
    scrollContainer.scrollTop = targetScrollTop;
  }

  // 2. Garantia de execução do scroll:
  // Se for navegação rápida ou se o scroll suave não mover o scrollTop em 50ms,
  // atribui scrollTop diretamente para garantir que o modal role visualmente.
  if (isRapid) {
    scrollContainer.scrollTop = targetScrollTop;
  } else {
    const expected = targetScrollTop;
    setTimeout(() => {
      if (Math.abs(scrollContainer.scrollTop - expected) > 10) {
        scrollContainer.scrollTop = expected;
      }
    }, 50);
  }

  // 3. Emite evento de rolagem para acionar a paginação do Instagram
  scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));

  if (activeRowIndex >= currentModalRows.length - 4) {
    triggerInstagramPagination();
  }
}

function clearActiveRowHighlight() {
  document.querySelectorAll('.instahub-row-active').forEach((el) => {
    el.classList.remove('instahub-row-active');
  });
  removeEnterIndicator();
}

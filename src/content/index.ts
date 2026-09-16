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
let currentModalRows: HTMLElement[] = [];

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

    // 2. Check if external nodes were actually added by Instagram
    let hasExternalAddedNodes = false;
    for (const m of mutations) {
      if (m.addedNodes.length === 0) continue;

      for (let i = 0; i < m.addedNodes.length; i++) {
        const node = m.addedNodes[i];
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          // Ignore our own badge elements or children
          if (
            el.classList.contains('instahub-badge-wrapper') ||
            el.classList.contains('instahub-badge') ||
            el.classList.contains('instahub-badge-protect-toggle') ||
            el.closest?.('.instahub-badge-wrapper')
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
 * Efficiently finds the row container for a user item (max 6 parent levels, no full tree queries)
 */
function findRowContainer(link: HTMLElement): HTMLElement | null {
  // If parent already marked as row, return it
  const existingRow = link.closest<HTMLElement>('[data-instahub-row="true"]');
  if (existingRow) return existingRow;

  // Check closest listitem or li
  const listitem = link.closest<HTMLElement>('li, [role="listitem"]');
  if (listitem) {
    listitem.dataset.instahubRow = 'true';
    return listitem;
  }

  // Walk up at most 6 levels looking for a container that has a follow button
  let current: HTMLElement | null = link.parentElement;
  let depth = 0;
  while (current && depth < 6 && current !== document.body) {
    if (current.getAttribute('role') === 'dialog') break;

    const btn = current.querySelector('button');
    if (btn && isFollowButton(btn)) {
      current.dataset.instahubRow = 'true';
      return current;
    }
    current = current.parentElement;
    depth++;
  }

  // Fallback: 2 levels up
  const fallback = link.parentElement?.parentElement || link.parentElement;
  if (fallback) {
    fallback.dataset.instahubRow = 'true';
  }
  return fallback;
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
  if (!settings.flagsEnabled) return;

  // Check profile header first
  checkProfileHeader();

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

  // If no dialog or suggestions container is active, exit immediately!
  if (roots.length === 0) {
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
 * Finds the actual scrollable container inside the Instagram dialog
 */
function getDialogScrollContainer(searchRoot: HTMLElement): HTMLElement {
  // Check if searchRoot itself is scrollable
  if (searchRoot.scrollHeight > searchRoot.clientHeight && searchRoot.clientHeight > 0) {
    const style = window.getComputedStyle(searchRoot);
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
      return searchRoot;
    }
  }

  // Check child divs with scroll
  const divs = Array.from(searchRoot.querySelectorAll<HTMLElement>('div'));
  for (const el of divs) {
    if (el.scrollHeight > el.clientHeight && el.clientHeight > 80) {
      const style = window.getComputedStyle(el);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
        return el;
      }
    }
  }

  // Check row parents
  if (currentModalRows.length > 0 && currentModalRows[0].parentElement) {
    let curr: HTMLElement | null = currentModalRows[0].parentElement;
    while (curr && curr !== searchRoot && curr !== document.body) {
      if (curr.scrollHeight > curr.clientHeight && curr.clientHeight > 80) {
        return curr;
      }
      curr = curr.parentElement;
    }
  }

  return searchRoot;
}

/**
 * Scrolls the container and fires scroll events to trigger Instagram's infinite scroll loading
 */
function triggerInfiniteScroll(searchRoot: HTMLElement) {
  const scrollContainer = getDialogScrollContainer(searchRoot);
  if (scrollContainer) {
    // Scroll container down to bottom to trigger Instagram's observer/fetch
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));

    // Re-scan quickly so newly mounted rows receive badges and row tags immediately
    triggerDebouncedScan(80);
  }
}

function handleKeyDown(e: KeyboardEvent) {
  if (!settings.keyboardNavEnabled) return;

  // Ignore if focus is in an input or contenteditable element
  const target = e.target as HTMLElement | null;
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable ||
      target.getAttribute('role') === 'textbox')
  ) {
    return;
  }

  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') {
    return;
  }

  // Check if dialog or suggestions list is visible
  const dialog = document.querySelector('div[role="dialog"]');
  const isExplorePeople = window.location.pathname.startsWith('/explore/people');
  const suggestions = isExplorePeople ? document.querySelector('main') : null;

  const searchRoot = (dialog || suggestions) as HTMLElement | null;
  if (!searchRoot) return;

  // Scan immediately to ensure any recently rendered items are recognized
  scanAndInject();

  // Update current list of rows marked by InstaHub
  const rows = Array.from(
    searchRoot.querySelectorAll<HTMLElement>('[data-instahub-row="true"]')
  );

  if (rows.length === 0) return;
  currentModalRows = rows;

  // If activeRowIndex is unset, find the first item visible in the container viewport
  if (activeRowIndex < 0 || activeRowIndex >= currentModalRows.length) {
    const scrollContainer = getDialogScrollContainer(searchRoot);
    const containerRect = scrollContainer.getBoundingClientRect();
    const visibleIndex = currentModalRows.findIndex((r) => {
      const rRect = r.getBoundingClientRect();
      return rRect.top >= containerRect.top - 20 && rRect.bottom <= containerRect.bottom + 20;
    });
    activeRowIndex = visibleIndex !== -1 ? visibleIndex : 0;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();

    if (activeRowIndex < currentModalRows.length - 1) {
      activeRowIndex++;
      updateActiveRow(searchRoot);

      // Proactively trigger infinite scroll when approaching the bottom (last 3 rows)
      if (activeRowIndex >= currentModalRows.length - 3) {
        triggerInfiniteScroll(searchRoot);
      }
    } else {
      // Reached the end of currently loaded rows!
      // Trigger Instagram's pagination to load more
      triggerInfiniteScroll(searchRoot);

      // Re-scan immediately and see if new rows appeared
      scanAndInject();
      const freshRows = Array.from(
        searchRoot.querySelectorAll<HTMLElement>('[data-instahub-row="true"]')
      );

      if (freshRows.length > currentModalRows.length) {
        currentModalRows = freshRows;
        activeRowIndex++;
        updateActiveRow(searchRoot);
      } else {
        // Stay on the last item while Instagram loads new rows from network
        updateActiveRow(searchRoot);
      }
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();

    if (activeRowIndex > 0) {
      activeRowIndex--;
      updateActiveRow(searchRoot);
    } else {
      activeRowIndex = 0;
      updateActiveRow(searchRoot);
    }
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

function updateActiveRow(searchRoot?: HTMLElement) {
  clearActiveRowHighlight();

  if (activeRowIndex >= 0 && activeRowIndex < currentModalRows.length) {
    const row = currentModalRows[activeRowIndex];
    if (row && row.isConnected) {
      row.classList.add('instahub-row-active');

      // 1. Smoothly center the row in the viewport
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });

      // 2. Explicitly ensure the parent container scrollbar moves along
      const root = searchRoot || document.querySelector('div[role="dialog"]') || document.body;
      const scrollContainer = getDialogScrollContainer(root as HTMLElement);

      if (scrollContainer && scrollContainer !== row) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();

        // If row is too low, push scroll down
        if (rowRect.bottom > containerRect.bottom - 50) {
          const delta = rowRect.bottom - containerRect.bottom + 60;
          scrollContainer.scrollTop += delta;
          scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
        // If row is too high, pull scroll up
        else if (rowRect.top < containerRect.top + 50) {
          const delta = containerRect.top - rowRect.top + 60;
          scrollContainer.scrollTop -= delta;
          scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
      }
    }
  }
}

function clearActiveRowHighlight() {
  document.querySelectorAll('.instahub-row-active').forEach((el) => {
    el.classList.remove('instahub-row-active');
  });
}

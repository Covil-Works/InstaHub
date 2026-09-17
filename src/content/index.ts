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
let globalUserIndex: number = -1;
let activeUsername: string | null = null;
let currentModalRows: HTMLElement[] = [];
let lastNavTimestamp: number = 0;
const DEFAULT_SCROLL_STEP_PX = 56;
let modalScrollStepPx: number = 0;

// State for Instagram Unfollow Confirmation Dialog
let isConfirmationDialogOpen: boolean = false;
let activeConfirmationDialogBtnIndex: number = 0; // 0: confirm ("Deixar de seguir"), 1: cancel ("Cancelar")
let pendingUnfollowUsername: string | null = null;
let pendingUnfollowName: string | null = null;

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

function isExtensionValid(): boolean {
  try {
    return Boolean(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function sendMessage<T = any>(msg: any): Promise<MessageResponse<T>> {
  return new Promise((resolve) => {
    if (!isExtensionValid() || !chrome.runtime?.sendMessage) {
      resolve({ success: false, error: 'Contexto da extensão desconectado ou indisponível' });
      return;
    }
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          resolve({ success: false, error: lastErr.message });
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
  if (!isExtensionValid()) return;
  if (scanDebounceTimer !== null) {
    window.clearTimeout(scanDebounceTimer);
  }
  scanDebounceTimer = window.setTimeout(() => {
    scanDebounceTimer = null;
    if (!isExtensionValid()) return;
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
      globalUserIndex = -1;
      modalScrollStepPx = 0;
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
    if (!isExtensionValid()) {
      observer.disconnect();
      return;
    }

    // 1. If InstaHub is actively injecting elements, ignore all mutations
    if (isInstaHubMutating) return;

    // Check confirmation dialog state first
    const confirmDlg = getUnfollowConfirmationDialog();
    if (confirmDlg) {
      handleConfirmationDialogOpened(confirmDlg);
    } else if (isConfirmationDialogOpen) {
      isConfirmationDialogOpen = false;
      restoreListFocus();
    }

    // Check if main list dialog state changed
    const dialog = getMainListDialog();
    if (!dialog && (activeRowIndex !== -1 || globalUserIndex !== -1)) {
      activeRowIndex = -1;
      globalUserIndex = -1;
      modalScrollStepPx = 0;
      activeUsername = null;
      currentModalRows = [];
      clearActiveRowHighlight();
    } else if (dialog && activeRowIndex === -1 && globalUserIndex === -1) {
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
            el.classList.contains('instahub-dialog-btn-active') ||
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

// ----------------------------------------------------
// UNFOLLOW CONFIRMATION DIALOG HANDLING (ZERO CLASS NAMES)
// ----------------------------------------------------

interface UnfollowDialogInfo {
  dialog: HTMLElement;
  confirmBtn: HTMLElement;
  cancelBtn: HTMLElement;
  buttons: HTMLElement[];
  username: string | null;
}

function isUnfollowText(text: string): boolean {
  const t = text.toLowerCase().trim();
  return (
    t.includes('deixar de seguir') ||
    t.includes('unfollow') ||
    t.includes('dejar de seguir') ||
    t.includes('ne plus suivre') ||
    t.includes('não seguir') ||
    t.includes('nicht mehr folgen') ||
    t.includes('smetti di seguire') ||
    t.includes('non seguire')
  );
}

function isCancelText(text: string): boolean {
  const t = text.toLowerCase().trim();
  return (
    t === 'cancelar' ||
    t === 'cancel' ||
    t === 'anular' ||
    t === 'annuler' ||
    t === 'abbrechen' ||
    t === 'annulla' ||
    t.includes('cancelar') ||
    t.includes('cancel')
  );
}

/**
 * Identifica se um diálogo é o diálogo de confirmação para Deixar de Seguir,
 * sem depender de nenhum nome de classe gerado pelo Instagram.
 */
function isUnfollowConfirmationDialog(dlg: HTMLElement): boolean {
  const buttons = Array.from(dlg.querySelectorAll<HTMLElement>('button'));
  if (buttons.length < 2 || buttons.length > 4) return false;

  const hasConfirm = buttons.some((b) => isUnfollowText(b.textContent || ''));
  const hasCancel = buttons.some((b) => isCancelText(b.textContent || ''));
  if (hasConfirm && hasCancel) return true;

  const text = (dlg.textContent || '').toLowerCase();
  if ((isUnfollowText(text) || (text.includes('?') && text.includes('@'))) && buttons.length === 2) {
    return true;
  }

  return false;
}

/**
 * Localiza o diálogo principal da lista de usuários (Seguidores / Seguindo),
 * ignorando diálogos de confirmação de ação como "Deixar de seguir".
 */
function getMainListDialog(): HTMLElement | null {
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(
      'div[role="dialog"], [role="dialog"], div[aria-modal="true"]'
    )
  );

  for (const dlg of dialogs) {
    if (isUnfollowConfirmationDialog(dlg)) continue;
    if (dlg.querySelector('a[href^="/"], a[role="link"]')) {
      return dlg;
    }
  }

  return dialogs.find((d) => !isUnfollowConfirmationDialog(d)) || null;
}

/**
 * Retorna as informações do diálogo de confirmação de Deixar de Seguir atualmente aberto,
 * com os botões e username identificados semanticamente (sem classes).
 */
function getUnfollowConfirmationDialog(): UnfollowDialogInfo | null {
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(
      'div[role="dialog"], [role="dialog"], div[aria-modal="true"]'
    )
  );

  for (const dlg of dialogs) {
    if (!isUnfollowConfirmationDialog(dlg)) continue;

    const buttons = Array.from(dlg.querySelectorAll<HTMLElement>('button'));
    let confirmBtn = buttons.find((b) => isUnfollowText(b.textContent || ''));
    let cancelBtn = buttons.find((b) => isCancelText(b.textContent || ''));

    if (!confirmBtn || !cancelBtn) {
      confirmBtn = buttons[0];
      cancelBtn = buttons[buttons.length - 1];
    }

    const username = extractUsernameFromDialog(dlg);

    return {
      dialog: dlg,
      confirmBtn,
      cancelBtn,
      buttons,
      username,
    };
  }

  return null;
}

/**
 * Extrai o username mencionado no diálogo de confirmação via texto ou atributo alt
 */
function extractUsernameFromDialog(dlg: HTMLElement): string | null {
  const text = dlg.textContent || '';
  const match = text.match(/@([a-zA-Z0-9._]+)/);
  if (match && match[1]) {
    return match[1].toLowerCase();
  }

  const img = dlg.querySelector('img[alt]');
  if (img) {
    const alt = img.getAttribute('alt') || '';
    const imgMatch = alt.match(/([a-zA-Z0-9._]+)$/);
    if (imgMatch && imgMatch[1]) {
      return imgMatch[1].toLowerCase();
    }
  }

  return activeUsername || pendingUnfollowUsername || null;
}

/**
 * Move o foco e o destaque visual para o botão especificado do diálogo de confirmação
 */
function highlightConfirmationButton(info: UnfollowDialogInfo, index: number) {
  activeConfirmationDialogBtnIndex = Math.max(0, Math.min(info.buttons.length - 1, index));

  info.buttons.forEach((btn, i) => {
    if (i === activeConfirmationDialogBtnIndex) {
      btn.classList.add('instahub-dialog-btn-active');
      btn.focus();
    } else {
      btn.classList.remove('instahub-dialog-btn-active');
    }
  });
}

/**
 * Trata a abertura do diálogo de confirmação:
 * Muda imediatamente o foco para o botão "Deixar de seguir" e prepara a escuta de cliques
 */
function handleConfirmationDialogOpened(info: UnfollowDialogInfo) {
  isConfirmationDialogOpen = true;

  if (info.dialog.dataset.instahubTracked !== 'true') {
    info.dialog.dataset.instahubTracked = 'true';
    activeConfirmationDialogBtnIndex = 0;
    highlightConfirmationButton(info, 0);

    info.confirmBtn.addEventListener(
      'click',
      () => {
        const u = info.username || pendingUnfollowUsername || activeUsername;
        if (u) {
          recordConfirmedUnfollow(u, pendingUnfollowName || undefined);
        }
        setTimeout(restoreListFocus, 150);
      },
      { once: true }
    );

    info.cancelBtn.addEventListener(
      'click',
      () => {
        setTimeout(restoreListFocus, 150);
      },
      { once: true }
    );

    // Instagram/React às vezes re-renderiza ou rouba o foco logo após montar o diálogo.
    // Reforçamos o foco no botão de confirmação em 40ms e 120ms.
    setTimeout(() => {
      const recheck = getUnfollowConfirmationDialog();
      if (recheck) {
        highlightConfirmationButton(recheck, activeConfirmationDialogBtnIndex);
      }
    }, 40);

    setTimeout(() => {
      const recheck = getUnfollowConfirmationDialog();
      if (recheck) {
        highlightConfirmationButton(recheck, activeConfirmationDialogBtnIndex);
      }
    }, 120);
  }
}

/**
 * Registra formalmente a ação de unfollow confirmada no banco e atualiza badges/cache
 */
async function recordConfirmedUnfollow(username: string, displayName?: string) {
  const res = await sendMessage<UserRecord>({
    type: 'RECORD_FOLLOW_INTERACTION',
    username,
    name: displayName || username,
    action: 'unfollow',
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

/**
 * Restaura o foco e destaque visual na linha da lista após o diálogo de confirmação ser fechado
 */
function restoreListFocus() {
  document.querySelectorAll('.instahub-dialog-btn-active').forEach((el) => {
    el.classList.remove('instahub-dialog-btn-active');
  });
  activeConfirmationDialogBtnIndex = 0;
  pendingUnfollowUsername = null;
  pendingUnfollowName = null;

  const listDialog = getMainListDialog();
  if (listDialog && settings.keyboardNavEnabled) {
    const freshRows = ensureModalRows(listDialog);
    if (freshRows.length > 0) {
      currentModalRows = freshRows;
      let rowToHighlight: HTMLElement | null = null;
      if (activeUsername) {
        rowToHighlight = freshRows.find((r) => getUsernameFromRow(r) === activeUsername) || null;
      }
      if (!rowToHighlight && activeRowIndex >= 0 && activeRowIndex < freshRows.length) {
        rowToHighlight = freshRows[activeRowIndex];
      }
      if (rowToHighlight) {
        clearActiveRowHighlight();
        rowToHighlight.classList.add('instahub-row-active');
        renderEnterIndicator(rowToHighlight);
        activeRowIndex = freshRows.indexOf(rowToHighlight);
      }
    }
  }
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
  const dialog = getMainListDialog();

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
    if (activeRowIndex !== -1 || globalUserIndex !== -1) {
      activeRowIndex = -1;
      globalUserIndex = -1;
      modalScrollStepPx = 0;
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
            row.closest('div[role="dialog"], [role="dialog"], [aria-modal="true"]') ||
            document.querySelector('main') ||
            document.body;
          currentModalRows = ensureModalRows(searchRoot as HTMLElement);
          const idx = currentModalRows.indexOf(row);
          if (idx !== -1) {
            activeRowIndex = idx;
            globalUserIndex = idx;
            activeUsername = getUsernameFromRow(row);
            clearActiveRowHighlight();
            row.classList.add('instahub-row-active');
            renderEnterIndicator(row);
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
      if (globalUserIndex < 0) {
        globalUserIndex = 0;
        activeRowIndex = 0;
        activeUsername = getUsernameFromRow(freshRows[0]);
        updateActiveRow('none', freshRows[0]);
      } else {
        // Modal já está ativo e em navegação: nunca reinicie globalUserIndex para 0!
        const existingActive = document.querySelector('.instahub-row-active');
        if (!existingActive) {
          let rowToHighlight: HTMLElement | null = null;
          if (activeUsername) {
            rowToHighlight = freshRows.find((r) => getUsernameFromRow(r) === activeUsername) || null;
          }
          if (!rowToHighlight) {
            rowToHighlight = findRowNearContainerFocalPoint(freshRows, dialog as HTMLElement);
          }
          if (rowToHighlight) {
            rowToHighlight.classList.add('instahub-row-active');
            renderEnterIndicator(rowToHighlight);
            activeUsername = getUsernameFromRow(rowToHighlight);
            activeRowIndex = freshRows.indexOf(rowToHighlight);
          }
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

    if (action === 'unfollow') {
      pendingUnfollowUsername = username;
      pendingUnfollowName = name;

      // O Instagram abre o diálogo de confirmação "Deixar de seguir @usuario?".
      // Prepara e foca imediatamente no botão "Deixar de seguir".
      setTimeout(() => {
        const dlg = getUnfollowConfirmationDialog();
        if (dlg) handleConfirmationDialogOpened(dlg);
      }, 40);
      setTimeout(() => {
        const dlg = getUnfollowConfirmationDialog();
        if (dlg) handleConfirmationDialogOpened(dlg);
      }, 120);

      // Fallback: se porventura não abriu modal em 800ms e tiver deixado de seguir diretamente:
      setTimeout(() => {
        const dlg = getUnfollowConfirmationDialog();
        if (!dlg) {
          const currentBtn = Array.from(row.querySelectorAll('button')).find(isFollowButton);
          const currentText = (currentBtn?.textContent || '').toLowerCase().trim();
          if (
            currentText.includes('seguir') &&
            !currentText.includes('seguindo') &&
            !currentText.includes('deixar')
          ) {
            recordConfirmedUnfollow(username, name);
          }
        }
      }, 800);
      return;
    }

    // Ação de Seguir (Follow) imediata (sem diálogo de confirmação)
    setTimeout(async () => {
      const res = await sendMessage<UserRecord>({
        type: 'RECORD_FOLLOW_INTERACTION',
        username,
        name,
        action: 'follow',
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
 * Determina o deslocamento de rolagem em pixels por linha.
 * Ao invés de usar um percentual fixo da altura do contêiner (que varia e causa descompasso onde
 * o scroll desce mais rápido do que a seleção), calcula o deslocamento em pixels com base no pitch real
 * entre as linhas montadas (ou na altura da linha em pixels, com fallback de DEFAULT_SCROLL_STEP_PX).
 */
function getScrollStepPx(row?: HTMLElement | null): number {
  if (modalScrollStepPx > 0) {
    return modalScrollStepPx;
  }

  if (currentModalRows.length >= 2) {
    const row0 = currentModalRows[0];
    const row1 = currentModalRows[1];
    if (row0?.isConnected && row1?.isConnected) {
      const diff = Math.round(
        row1.getBoundingClientRect().top - row0.getBoundingClientRect().top
      );
      if (diff >= 35 && diff <= 120) {
        modalScrollStepPx = diff;
        return modalScrollStepPx;
      }
    }
  }

  if (row && row.isConnected) {
    const rowHeight = Math.round(row.getBoundingClientRect().height);
    if (rowHeight >= 35 && rowHeight <= 120) {
      modalScrollStepPx = rowHeight;
      return modalScrollStepPx;
    }
  }

  return DEFAULT_SCROLL_STEP_PX;
}

/**
 * Localiza a linha mais próxima do ponto focal (centro) da área visível do diálogo
 */
function findRowNearContainerFocalPoint(rows: HTMLElement[], dialog: HTMLElement): HTMLElement | null {
  if (rows.length === 0) return null;
  const validRow = rows.find((r) => r?.isConnected) || rows[0];
  const container = getDialogScrollContainer(validRow) || dialog;
  if (!container) return validRow || null;
  const containerRect = container.getBoundingClientRect();
  const step = getScrollStepPx(validRow);
  // As 3 primeiras linhas ocupam o topo (0, step, 2*step). O cursor estabiliza a partir da 3ª linha (~2*step)
  const focalY = containerRect.top + step * 2 + step * 0.5;

  let bestRow = validRow;
  let minDiff = Infinity;

  for (const r of rows) {
    if (!r || !r.isConnected) continue;
    const rRect = r.getBoundingClientRect();
    const rowCenterY = rRect.top + rRect.height / 2;
    const diff = Math.abs(rowCenterY - focalY);
    if (diff < minDiff) {
      minDiff = diff;
      bestRow = r;
    }
  }

  return bestRow;
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

  // 2. Busca dentro do modal aberto da lista
  const modal = getMainListDialog();

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
  const row = (activeRowIndex >= 0 ? currentModalRows[activeRowIndex] : null) || currentModalRows[0];
  const scrollContainer = getDialogScrollContainer(row || (searchRoot as HTMLElement));
  if (scrollContainer) {
    scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
  }
  triggerDebouncedScan(60);
}

function handleKeyDown(e: KeyboardEvent) {
  if (!isExtensionValid()) {
    window.removeEventListener('keydown', handleKeyDown, true);
    return;
  }
  if (!settings.keyboardNavEnabled) return;

  // 1. VERIFICAÇÃO PRIORITÁRIA DO DIÁLOGO DE CONFIRMAÇÃO DE DEIXAR DE SEGUIR
  const confirmInfo = getUnfollowConfirmationDialog();
  if (confirmInfo) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      // Desce para o botão Cancelar (ou próximo botão)
      const nextIdx = Math.min(confirmInfo.buttons.length - 1, activeConfirmationDialogBtnIndex + 1);
      highlightConfirmationButton(confirmInfo, nextIdx);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      // Sobe para o botão Deixar de seguir (ou botão anterior)
      const prevIdx = Math.max(0, activeConfirmationDialogBtnIndex - 1);
      highlightConfirmationButton(confirmInfo, prevIdx);
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const nextIdx = e.shiftKey
        ? (activeConfirmationDialogBtnIndex - 1 + confirmInfo.buttons.length) % confirmInfo.buttons.length
        : (activeConfirmationDialogBtnIndex + 1) % confirmInfo.buttons.length;
      highlightConfirmationButton(confirmInfo, nextIdx);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();

      const selectedBtn = confirmInfo.buttons[activeConfirmationDialogBtnIndex] || confirmInfo.confirmBtn;
      const isConfirm = selectedBtn === confirmInfo.confirmBtn || isUnfollowText(selectedBtn.textContent || '');

      if (isConfirm) {
        const userToUnfollow = confirmInfo.username || pendingUnfollowUsername || activeUsername;
        if (userToUnfollow) {
          recordConfirmedUnfollow(userToUnfollow, pendingUnfollowName || undefined);
        }
      }

      selectedBtn.focus();
      selectedBtn.click();

      setTimeout(() => {
        restoreListFocus();
      }, 150);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      confirmInfo.cancelBtn.focus();
      confirmInfo.cancelBtn.click();
      setTimeout(() => {
        restoreListFocus();
      }, 150);
      return;
    }

    return;
  }

  const target = e.target as HTMLElement | null;
  const isInputTarget =
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable ||
      target.getAttribute('role') === 'textbox');

  const dialog = getMainListDialog();
  const isExplorePeople = window.location.pathname.startsWith('/explore/people');
  const suggestions = isExplorePeople ? document.querySelector('main') : null;
  const searchRoot = (dialog || suggestions) as HTMLElement | null;

  if (!searchRoot) return;

  // Se o foco estiver em um input dentro do modal e pressionar ArrowDown,
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

  // Localiza o índice da linha atualmente destacada no DOM
  let currentIdx = -1;
  const activeEl = document.querySelector<HTMLElement>('.instahub-row-active');
  if (activeEl && currentModalRows.includes(activeEl)) {
    currentIdx = currentModalRows.indexOf(activeEl);
  } else if (activeUsername) {
    currentIdx = currentModalRows.findIndex((r) => getUsernameFromRow(r) === activeUsername);
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();

    // Se nenhuma linha estiver selecionada ainda, seleciona a primeira (usuário 1)
    if (globalUserIndex < 0 || currentIdx === -1) {
      globalUserIndex = 0;
      activeRowIndex = 0;
      const targetRow = currentModalRows[0];
      activeUsername = getUsernameFromRow(targetRow);
      updateActiveRow('none', targetRow);
      return;
    }

    // Avança o contador sequencial do usuário
    globalUserIndex++;

    // Se aproximando do final dos itens carregados, pede para o Instagram buscar mais
    if (currentIdx >= currentModalRows.length - 4 || globalUserIndex >= currentModalRows.length - 4) {
      triggerInstagramPagination(searchRoot);
    }

    if (currentIdx < currentModalRows.length - 1) {
      const nextRow = currentModalRows[currentIdx + 1];
      activeRowIndex = currentIdx + 1;
      activeUsername = getUsernameFromRow(nextRow);
      updateActiveRow('down', nextRow);
    } else {
      // Já está no último item carregado no DOM: aciona scroll e paginação para novas linhas surgirem
      triggerInstagramPagination(searchRoot);
      updateActiveRow('down', currentModalRows[currentModalRows.length - 1]);

      setTimeout(() => {
        const recheckedRows = ensureModalRows(searchRoot);
        if (recheckedRows.length > 0) {
          currentModalRows = recheckedRows;
          if (activeUsername) {
            const recheckedIdx = currentModalRows.findIndex((r) => getUsernameFromRow(r) === activeUsername);
            if (recheckedIdx !== -1 && recheckedIdx + 1 < currentModalRows.length) {
              const newerRow = currentModalRows[recheckedIdx + 1];
              activeRowIndex = recheckedIdx + 1;
              activeUsername = getUsernameFromRow(newerRow);
              clearActiveRowHighlight();
              newerRow.classList.add('instahub-row-active');
              renderEnterIndicator(newerRow);
            }
          }
        }
      }, 60);
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();

    // Se já estiver no primeiro usuário
    if (globalUserIndex <= 0) {
      globalUserIndex = 0;
      activeRowIndex = 0;
      const targetRow = currentModalRows[0];
      activeUsername = getUsernameFromRow(targetRow);
      updateActiveRow('none', targetRow);
      return;
    }

    globalUserIndex--;

    let prevRow: HTMLElement | null = null;
    if (currentIdx > 0) {
      prevRow = currentModalRows[currentIdx - 1];
      activeRowIndex = currentIdx - 1;
    } else {
      prevRow = currentModalRows[0];
      activeRowIndex = 0;
    }

    if (prevRow) {
      activeUsername = getUsernameFromRow(prevRow);
      updateActiveRow('up', prevRow);
    }
  } else if (e.key === 'Enter') {
    const activeEl = document.querySelector<HTMLElement>('.instahub-row-active');
    const selectedRow =
      activeEl ||
      (activeRowIndex >= 0 && activeRowIndex < currentModalRows.length
        ? currentModalRows[activeRowIndex]
        : null);

    if (selectedRow) {
      e.preventDefault();
      e.stopPropagation();

      const buttons = Array.from(selectedRow.querySelectorAll('button') || []);
      const actionButton = buttons.find(isFollowButton) || buttons[0];
      if (actionButton) {
        const u = getUsernameFromRow(selectedRow);
        if (u) {
          activeUsername = u;
          pendingUnfollowUsername = u;
        }
        actionButton.focus();
        actionButton.click();

        // Checagem imediata para focar no botão do diálogo de confirmação assim que abrir
        setTimeout(() => {
          const dlg = getUnfollowConfirmationDialog();
          if (dlg) handleConfirmationDialogOpened(dlg);
        }, 40);
        setTimeout(() => {
          const dlg = getUnfollowConfirmationDialog();
          if (dlg) handleConfirmationDialogOpened(dlg);
        }, 120);
      }
    }
  }
}

function updateActiveRow(direction: 'down' | 'up' | 'none' = 'none', targetRow?: HTMLElement | null) {
  clearActiveRowHighlight();

  let row = targetRow || null;
  if (!row || !row.isConnected) {
    if (activeRowIndex >= 0 && activeRowIndex < currentModalRows.length) {
      row = currentModalRows[activeRowIndex];
    }
  }

  if (!row || !row.isConnected) {
    if (currentModalRows.length > 0) {
      row = currentModalRows[0];
    } else {
      return;
    }
  }

  activeRowIndex = currentModalRows.indexOf(row);
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

  // Regra de rolagem da navegação definida em pixels (ao invés de percentual):
  // - Usuário 1 (globalUserIndex = 0): nenhum scroll (scrollTop = 0).
  // - Usuário 2 (globalUserIndex = 1): nenhum scroll (scrollTop = 0).
  // - Usuário 3 (globalUserIndex = 2): nenhum scroll (mantém o topo, 0).
  // - A partir do usuário 3 (ao avançar 3 -> 4, 4 -> 5, 5 -> 6, etc.):
  //   o diálogo desce o passo fixo em pixels correspondente à linha (step em px).
  // - Ao navegar para cima com ↑: comportamento simétrico subindo o passo em pixels até o topo (0).
  const step = getScrollStepPx(row);
  const targetScrollTop = globalUserIndex >= 3 ? Math.round((globalUserIndex - 2) * step) : 0;

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

  if (activeRowIndex >= currentModalRows.length - 4 || globalUserIndex >= currentModalRows.length - 4) {
    triggerInstagramPagination();
  }
}

function clearActiveRowHighlight() {
  document.querySelectorAll('.instahub-row-active').forEach((el) => {
    el.classList.remove('instahub-row-active');
  });
  removeEnterIndicator();
}

import {
  checkUsersBatch,
  recordFollowInteraction,
  toggleUserProtected,
  db,
  normalizeUsername,
} from '../db';
import { getExtensionSettings, saveExtensionSettings } from '../utils/storage';
import type { ExtensionMessage, MessageResponse, UserRecord } from '../types';

console.log('[InstaHub Background] Service worker initialized.');

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[InstaHub Background] Extension installed/updated:', details.reason);
  // Ensure default settings exist
  const settings = await getExtensionSettings();
  await saveExtensionSettings(settings);
});

// Listener for messages from content scripts and popups
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse<any>) => void
  ) => {
    (async () => {
      try {
        if (!message || typeof message !== 'object') {
          sendResponse({ success: false, error: 'Mensagem vazia ou inválida' });
          return;
        }
        switch (message.type) {
          case 'GET_SETTINGS': {
            const settings = await getExtensionSettings();
            sendResponse({ success: true, data: settings });
            break;
          }

          case 'SAVE_SETTINGS': {
            const updated = await saveExtensionSettings(message.settings);
            sendResponse({ success: true, data: updated });
            break;
          }

          case 'CHECK_USERS': {
            const results = await checkUsersBatch(message.usernames || []);
            sendResponse({ success: true, data: results });
            break;
          }

          case 'GET_USER': {
            const norm = normalizeUsername(message.username);
            const user = await db.users.get(norm);
            sendResponse({ success: true, data: user });
            break;
          }

          case 'RECORD_FOLLOW_INTERACTION': {
            const updated = await recordFollowInteraction(
              message.username,
              message.name,
              message.action
            );
            sendResponse({ success: true, data: updated });
            break;
          }

          case 'TOGGLE_PROTECTED': {
            const updated = await toggleUserProtected(message.username);
            sendResponse({ success: true, data: updated });
            break;
          }

          case 'UPSERT_USER': {
            const norm = normalizeUsername(message.user.username);
            const toSave: UserRecord = {
              ...message.user,
              username: norm,
              updatedAt: Date.now(),
            };
            await db.users.put(toSave);
            sendResponse({ success: true, data: toSave });
            break;
          }

          default:
            sendResponse({
              success: false,
              error: `Tipo de mensagem não reconhecido: ${(message as any)?.type}`,
            });
            break;
        }
      } catch (err: any) {
        console.error('[InstaHub Background] Erro ao processar mensagem:', err);
        sendResponse({
          success: false,
          error: err?.message || 'Erro interno no background worker',
        });
      }
    })();

    // Return true to indicate asynchronous response
    return true;
  }
);

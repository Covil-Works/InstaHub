import type { ExtensionSettings } from '../types';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  flagsEnabled: true,
  keyboardNavEnabled: true,
};

export async function getExtensionSettings(): Promise<ExtensionSettings> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      resolve(DEFAULT_SETTINGS);
      return;
    }

    chrome.storage.local.get(['flagsEnabled', 'keyboardNavEnabled'], (result) => {
      resolve({
        flagsEnabled: result.flagsEnabled !== undefined ? Boolean(result.flagsEnabled) : DEFAULT_SETTINGS.flagsEnabled,
        keyboardNavEnabled: result.keyboardNavEnabled !== undefined ? Boolean(result.keyboardNavEnabled) : DEFAULT_SETTINGS.keyboardNavEnabled,
      });
    });
  });
}

export async function saveExtensionSettings(
  patch: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const current = await getExtensionSettings();
  const updated = { ...current, ...patch };

  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      resolve(updated);
      return;
    }

    chrome.storage.local.set(updated, () => {
      resolve(updated);
    });
  });
}

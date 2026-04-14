// src/shared/i18n.ts
// Thin wrapper around chrome.i18n so call sites never call chrome.i18n directly.
// [MULTILINGUAL] All UI strings go through this module — no string literals elsewhere.

/**
 * Returns the localized string for the given message key.
 * Falls back to the key itself if the message is not found (dev safety net).
 *
 * @param key - A key defined in _locales/en/messages.json
 * @param substitutions - Optional ordered substitution strings.
 */
export function t(key: string, substitutions?: string | string[]): string {
  const msg = chrome.i18n.getMessage(key, substitutions);
  if (!msg) {
    console.warn(`[LexLens i18n] Missing message key: "${key}"`);
    return key;
  }
  return msg;
}

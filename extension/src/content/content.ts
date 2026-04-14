// src/content/content.ts
// Injected into matching legislation pages via manifest content_scripts.
// Detects the page, extracts text, hashes it, and emits LEXLENS_PAGE_READY.

import { sha256Hex } from "../shared/hash.js";
import {
  detectJurisdiction,
  deriveLanguage,
  extractText,
} from "./extractor.js";
import type { PageReadyMessage } from "../shared/types.js";
import { MSG_PAGE_READY } from "../shared/types.js";

async function main(): Promise<void> {
  const hostname = window.location.hostname;
  const sourceUrl = window.location.href;

  // 1. Derive jurisdiction from hostname.
  const jurisdiction = detectJurisdiction(hostname);
  if (!jurisdiction) {
    // Not a recognised legislation page — silently exit (no error).
    return;
  }

  // 2. Derive language from jurisdiction. [MULTILINGUAL]
  const language = deriveLanguage(jurisdiction);

  // 3. Extract text.
  const extraction = extractText(document, jurisdiction, language, sourceUrl);
  if (!extraction.success) {
    // Could not extract sufficient text — do not emit message.
    console.warn(`[LexLens] Extraction failed: ${extraction.reason}`);
    return;
  }

  // 4. Hash the excerpt (client-side, before any network call).
  const contentHash = await sha256Hex(extraction.text);

  // 5. Send LEXLENS_PAGE_READY to the background service worker.
  const message: PageReadyMessage = {
    type: MSG_PAGE_READY,
    contentHash,
    textExcerpt: extraction.text,
    sourceUrl,
    jurisdiction,
    language,
  };

  chrome.runtime.sendMessage(message);
}

main().catch((err) => {
  console.error("[LexLens] Content script error:", err);
});

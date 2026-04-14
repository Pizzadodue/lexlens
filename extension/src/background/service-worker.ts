// src/background/service-worker.ts
// Single orchestration layer: cache lookup → API call → response to popup.
// Implements in-flight deduplication to prevent stampede on same cache key.

import { callAnalyseApi } from "../shared/api-client.js";
import {
  buildCacheKey,
  MSG_PAGE_READY,
  MSG_GET_RESULT,
} from "../shared/types.js";
import type {
  CachedResult,
  ContentToSWMessage,
  PopupToSWMessage,
  SWResponse,
  Language,
  Jurisdiction,
} from "../shared/types.js";

const LEGISLATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * In-flight deduplication map.
 * Key: cache key string → Promise resolving to CachedResult | null.
 * Prevents multiple concurrent Claude API calls for the same content hash.
 */
const inFlight = new Map<string, Promise<CachedResult | null>>();

/** Retrieve a cached result from chrome.storage.local. Returns null on miss or expired TTL. */
async function getCached(cacheKeyStr: string): Promise<CachedResult | null> {
  const items = await chrome.storage.local.get(cacheKeyStr);
  const cached = items[cacheKeyStr] as CachedResult | undefined;
  if (!cached) return null;

  const age = Date.now() - cached.cachedAt;
  if (age > cached.ttlMs) {
    // Expired — remove silently.
    void chrome.storage.local.remove(cacheKeyStr);
    return null;
  }
  return cached;
}

/** Write a result to chrome.storage.local with TTL metadata. */
async function writeCached(
  cacheKeyStr: string,
  result: Omit<CachedResult, "cachedAt" | "ttlMs">
): Promise<CachedResult> {
  const full: CachedResult = {
    ...result,
    cachedAt: Date.now(),
    ttlMs: LEGISLATION_TTL_MS,
  };
  await chrome.storage.local.set({ [cacheKeyStr]: full });
  return full;
}

/**
 * Fetch a fresh analysis from the Scoring API.
 * Uses in-flight map to deduplicate concurrent calls for the same key.
 */
async function fetchAnalysis(
  cacheKeyStr: string,
  contentHash: string,
  textExcerpt: string,
  language: Language,
  jurisdiction: Jurisdiction,
  sourceUrl: string
): Promise<CachedResult | null> {
  // Check if a call is already in flight for this key.
  const existing = inFlight.get(cacheKeyStr);
  if (existing) {
    return existing;
  }

  const promise = (async (): Promise<CachedResult | null> => {
    const apiResult = await callAnalyseApi(
      contentHash,
      textExcerpt,
      language,
      jurisdiction,
      sourceUrl
    );

    if (!apiResult.ok) {
      return null;
    }

    return writeCached(cacheKeyStr, apiResult.data);
  })().finally(() => {
    inFlight.delete(cacheKeyStr);
  });

  inFlight.set(cacheKeyStr, promise);
  return promise;
}

// ─── Persistent state per tab ─────────────────────────────────────────────────
// Maps tabId → latest PageReadyMessage (stored in-memory; cleared on tab close).
// This allows the popup to request results without re-running the content script.

interface TabState {
  cacheKeyStr: string;
  contentHash: string;
  textExcerpt: string;
  language: Language;
  jurisdiction: Jurisdiction;
  sourceUrl: string;
}

const tabStateMap = new Map<number, TabState>();

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStateMap.delete(tabId);
});

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: ContentToSWMessage | PopupToSWMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: SWResponse) => void
  ) => {
    if (message.type === MSG_PAGE_READY) {
      // Content script is reporting a legislation page.
      const { contentHash, textExcerpt, sourceUrl, jurisdiction, language } = message;

      // Validate: language and jurisdiction MUST be present. [MULTILINGUAL]
      if (!jurisdiction || !language) {
        console.error("[LexLens SW] PageReadyMessage missing jurisdiction or language — ignoring.");
        return false;
      }

      const cacheKeyStr = buildCacheKey({ contentHash, language, jurisdiction });
      const tabId = sender.tab?.id;

      if (tabId !== undefined) {
        tabStateMap.set(tabId, {
          cacheKeyStr,
          contentHash,
          textExcerpt,
          language,
          jurisdiction,
          sourceUrl,
        });
      }

      // Pre-fetch analysis so it's ready when popup opens.
      (async () => {
        const cached = await getCached(cacheKeyStr);
        if (!cached) {
          await fetchAnalysis(
            cacheKeyStr,
            contentHash,
            textExcerpt,
            language,
            jurisdiction,
            sourceUrl
          );
        }
      })().catch(console.error);

      return false; // No synchronous response needed.
    }

    if (message.type === MSG_GET_RESULT) {
      // Popup is requesting the result for the current tab.
      const tabId = sender.tab?.id;

      if (tabId === undefined || !tabStateMap.has(tabId)) {
        // Not a legislation page.
        sendResponse({ status: "idle" });
        return false;
      }

      const state = tabStateMap.get(tabId)!;

      // Respond asynchronously.
      (async (): Promise<void> => {
        // 1. Check cache.
        let result = await getCached(state.cacheKeyStr);

        if (result) {
          sendResponse({ status: "result", result });
          return;
        }

        // 2. Cache miss — call API (deduplication handled inside fetchAnalysis).
        sendResponse({ status: "loading" }); // Popup should show spinner.

        result = await fetchAnalysis(
          state.cacheKeyStr,
          state.contentHash,
          state.textExcerpt,
          state.language,
          state.jurisdiction,
          state.sourceUrl
        );

        if (!result) {
          sendResponse({ status: "error_unavailable" });
          return;
        }

        sendResponse({ status: "result", result });
      })().catch((err) => {
        console.error("[LexLens SW] Unexpected error:", err);
        sendResponse({ status: "error_unavailable" });
      });

      return true; // Keep message channel open for async response.
    }

    return false;
  }
);

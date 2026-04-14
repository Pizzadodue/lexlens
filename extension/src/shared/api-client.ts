// src/shared/api-client.ts
// HTTP client for the LexLens Ideology Scoring API (POST /v1/analyse).
// [MULTILINGUAL] language and jurisdiction are always forwarded.

import type {
  AnalyseErrorResponse,
  AnalyseRequest,
  AnalyseResponse,
  Language,
  Jurisdiction,
} from "./types.js";

// Injected by esbuild define at build time.
// `npm run build -- --dev` → http://localhost:3001/v1
// `npm run build`          → https://api.lexlens.com/v1
declare const __API_BASE__: string;
const API_BASE = __API_BASE__;
const REQUEST_TIMEOUT_MS = 5000;

export type ApiCallResult =
  | { ok: true; data: AnalyseResponse }
  | { ok: false; errorKey: string };

/**
 * Call POST /v1/analyse with a 5-second timeout.
 * Returns a typed result union — never throws.
 *
 * @param contentHash - SHA-256 hex of the text excerpt.
 * @param textExcerpt - Legislation text (max 8,000 tokens).
 * @param language - BCP-47. Required. [MULTILINGUAL]
 * @param jurisdiction - ISO 3166-1 alpha-2. Required. [MULTILINGUAL]
 * @param sourceUrl - Canonical URL of the legislation page.
 */
export async function callAnalyseApi(
  contentHash: string,
  textExcerpt: string,
  language: Language,
  jurisdiction: Jurisdiction,
  sourceUrl: string
): Promise<ApiCallResult> {
  const body: AnalyseRequest = {
    text: textExcerpt,
    content_hash: contentHash,
    language,
    jurisdiction,
    source_url: sourceUrl,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}/analyse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = (await response.json()) as AnalyseResponse;
      return { ok: true, data };
    }

    if (response.status >= 400 && response.status < 500) {
      const err = (await response.json()) as AnalyseErrorResponse;
      if (err.error === "UNSUPPORTED_JURISDICTION" || err.error === "UNSUPPORTED_LANGUAGE") {
        return { ok: false, errorKey: "error_unsupported" };
      }
      if (err.error === "TEXT_TOO_SHORT") {
        return { ok: false, errorKey: "error_unsupported" };
      }
    }

    // 5xx or unexpected
    return { ok: false, errorKey: "error_unavailable" };
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as Error).name === "AbortError") {
      return { ok: false, errorKey: "error_network" };
    }
    return { ok: false, errorKey: "error_unavailable" };
  }
}

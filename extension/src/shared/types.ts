// src/shared/types.ts
// [MULTILINGUAL] language and jurisdiction are NEVER optional anywhere in this file.
// Absence is a hard error at every layer boundary (per ADR-001 §1.1, §1.3).

// ─── Jurisdiction & Language ──────────────────────────────────────────────────

/** ISO 3166-1 alpha-2 jurisdiction codes supported in Phase 1. */
export type Jurisdiction = "US" | "GB";

/** BCP-47 language codes supported in Phase 1. */
export type Language = "en";

// ─── Content Script → Service Worker ─────────────────────────────────────────

export const MSG_PAGE_READY = "LEXLENS_PAGE_READY" as const;
export const MSG_GET_RESULT = "LEXLENS_GET_RESULT" as const;

/**
 * Emitted by the content script once text has been extracted and hashed.
 * All fields are required — absent values indicate extraction failure and
 * MUST NOT be forwarded to the background worker.
 */
export interface PageReadyMessage {
  type: typeof MSG_PAGE_READY;
  /** SHA-256 hex of extracted text (first 8,000 tokens). */
  contentHash: string;
  /** Extracted text excerpt, max 8,000 tokens. */
  textExcerpt: string;
  /** Canonical URL of the legislation page. */
  sourceUrl: string;
  /** ISO 3166-1 alpha-2. NEVER optional. [MULTILINGUAL] */
  jurisdiction: Jurisdiction;
  /** BCP-47. NEVER optional. [MULTILINGUAL] */
  language: Language;
}

/**
 * Popup requests the current result for the active tab.
 */
export interface GetResultMessage {
  type: typeof MSG_GET_RESULT;
}

export type ContentToSWMessage = PageReadyMessage;
export type PopupToSWMessage = GetResultMessage;

// ─── Service Worker → Popup ───────────────────────────────────────────────────

export type AnalysisStatus =
  | "idle"
  | "loading"
  | "result"
  | "error_unsupported"
  | "error_network"
  | "error_unavailable";

export interface AnalysisResult {
  /** Score on the single axis: -1.0 (far-left) to +1.0 (far-right). */
  score: number;
  /** Certainty 0–100 integer. */
  confidence: number;
  /** [lower_bound, upper_bound] at 80% CI. */
  uncertaintyRange: [number, number];
  /** Required disclaimer text. Must be visible without user interaction. */
  methodologyDisclaimer: string;
  /** URL to full methodology page on lexlens.com. */
  methodologyUrl: string;
  /** Echo of the language analysed. [MULTILINGUAL] */
  language: Language;
  /** Echo of the jurisdiction analysed. [MULTILINGUAL] */
  jurisdiction: Jurisdiction;
  /** ISO 8601 UTC — when was this analysis performed. */
  analysedAt: string;
  /** True if this result was served from cache. */
  cached: boolean;
}

export interface CachedResult extends AnalysisResult {
  /** Unix ms — when the result was written to chrome.storage.local. */
  cachedAt: number;
  /** TTL in milliseconds (7 days for legislation). */
  ttlMs: number;
}

export interface SWResponse {
  status: AnalysisStatus;
  result?: CachedResult;
  /** User-facing error string (i18n key, NOT raw error). */
  errorKey?: string;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

/**
 * Canonical cache key components.
 * Combined as: `cache:{contentHash}:{language}:{jurisdiction}`
 * All three dimensions are required. [MULTILINGUAL]
 */
export interface CacheKey {
  contentHash: string;
  language: Language;
  jurisdiction: Jurisdiction;
}

export function buildCacheKey(k: CacheKey): string {
  return `cache:${k.contentHash}:${k.language}:${k.jurisdiction}`;
}

// ─── Scoring API ──────────────────────────────────────────────────────────────

/** Request body for POST /v1/analyse */
export interface AnalyseRequest {
  text: string;
  content_hash: string;
  /** BCP-47. Required. [MULTILINGUAL] */
  language: Language;
  /** ISO 3166-1 alpha-2. Required. [MULTILINGUAL] */
  jurisdiction: Jurisdiction;
  source_url: string;
}

/** Success response from POST /v1/analyse */
export interface AnalyseResponse extends AnalysisResult {
  // Extends AnalysisResult — no additional fields in Phase 1.
}

/** Structured API error response */
export interface AnalyseErrorResponse {
  error:
    | "UNSUPPORTED_JURISDICTION"
    | "UNSUPPORTED_LANGUAGE"
    | "TEXT_TOO_SHORT"
    | "ANALYSIS_UNAVAILABLE";
  message: string;
  supportedJurisdictions?: string[];
  supportedLanguages?: string[];
}

// ─── Extraction ───────────────────────────────────────────────────────────────

export type ExtractionFailureReason =
  | "no_selector_match"
  | "text_too_short"
  | "unknown_jurisdiction";

export type ExtractionResult =
  | {
      success: true;
      text: string;
      jurisdiction: Jurisdiction;
      language: Language;
      sourceUrl: string;
    }
  | {
      success: false;
      reason: ExtractionFailureReason;
    };

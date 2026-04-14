// src/types.ts

/**
 * BCP-47 language tag (e.g. "en", "nl", "de").
 * Phase 1 allowlist: ["en"] — enforced by Zod schema, not this type.
 */
export type LanguageCode = string;

/**
 * ISO 3166-1 alpha-2 jurisdiction code (e.g. "US", "GB", "NL").
 * Phase 1 allowlist: ["US", "GB"] — enforced by Zod schema, not this type.
 */
export type JurisdictionCode = string;

/**
 * SHA-256 hex string (64 lowercase hex chars) of the legislation text.
 */
export type ContentHash = string;

export interface AnalyseRequest {
  text: string;              // legislation text excerpt, max 8000 tokens
  content_hash: ContentHash; // SHA-256 hex — pre-computed client-side
  language: LanguageCode;    // BCP-47 — REQUIRED, never optional [MULTILINGUAL]
  jurisdiction: JurisdictionCode; // ISO 3166-1 alpha-2 — REQUIRED, never optional [MULTILINGUAL]
  source_url: string;        // canonical URL of the originating legislation page
}

export interface AnalyseResponse {
  score: number;                      // [-1.0, +1.0]
  confidence: number;                 // 0–100 integer
  uncertaintyRange: [number, number]; // [lower, upper] at 80% CI
  methodologyDisclaimer: string;      // ALWAYS present, NEVER empty
  methodologyUrl: string;             // link to /methodology
  language: LanguageCode;             // echoed from request [MULTILINGUAL]
  jurisdiction: JurisdictionCode;     // echoed from request [MULTILINGUAL]
  analysedAt: string;                 // ISO 8601 UTC
  cached: boolean;                    // true = Redis hit, false = fresh Claude call
}

export type ErrorCode =
  | "UNSUPPORTED_JURISDICTION"
  | "UNSUPPORTED_LANGUAGE"
  | "TEXT_TOO_SHORT"
  | "ANALYSIS_UNAVAILABLE";

export interface ErrorResponse {
  error: ErrorCode;
  message: string;
  supportedJurisdictions?: string[]; // present on UNSUPPORTED_JURISDICTION
  supportedLanguages?: string[];     // present on UNSUPPORTED_LANGUAGE
}

/**
 * Structured cache key components. Always use buildCacheKey() to serialise.
 */
export interface CacheKey {
  content_hash: ContentHash;
  language: LanguageCode;
  jurisdiction: JurisdictionCode;
}

/**
 * The JSON shape Claude MUST return inside its message content.
 * Validated with Zod before trusting any field.
 */
export interface ClaudeScorePayload {
  score: number;                      // [-1.0, +1.0]
  confidence: number;                 // 0–100 integer
  uncertaintyRange: [number, number]; // [lower, upper] 80% CI
  methodologyDisclaimer: string;
}

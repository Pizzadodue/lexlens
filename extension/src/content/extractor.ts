// src/content/extractor.ts
// Per-jurisdiction DOM text extraction.
// [MULTILINGUAL] language and jurisdiction are passed through; never assumed.

import type { ExtractionResult, Jurisdiction, Language } from "../shared/types.js";

/** Minimum extracted token count for reliable analysis (ADR-001 §2.1). */
const MIN_TOKEN_ESTIMATE = 200;

/**
 * Derive jurisdiction from the current page hostname.
 * Returns null if the hostname is not a recognised Phase 1 source.
 */
export function detectJurisdiction(hostname: string): Jurisdiction | null {
  if (hostname.includes("congress.gov")) return "US";
  if (hostname.includes("legislation.gov.uk")) return "GB";
  return null;
}

/**
 * Derive language from jurisdiction.
 * Phase 1: all supported jurisdictions use English.
 * Phase 2: this function expands or is replaced by a proper i18n lookup.
 * [MULTILINGUAL] — never hardcode "en" at call sites; call this function.
 */
export function deriveLanguage(_jurisdiction: Jurisdiction): Language {
  // Phase 1: all jurisdictions → "en"
  // Phase 2: add jurisdiction→language mapping here.
  return "en";
}

/**
 * Extract legislation text from `congress.gov` pages.
 * Primary selector: `div#bill-summary`
 * Fallback: `div.field-title` + `section.bill-body`
 */
function extractCongressGov(doc: Document): string | null {
  const primary = doc.querySelector("div#bill-summary");
  if (primary?.textContent?.trim()) {
    return primary.textContent.trim();
  }
  const title = doc.querySelector("div.field-title")?.textContent?.trim() ?? "";
  const body = doc.querySelector("section.bill-body")?.textContent?.trim() ?? "";
  const combined = [title, body].filter(Boolean).join("\n\n");
  return combined.length > 0 ? combined : null;
}

/**
 * Extract legislation text from `legislation.gov.uk` pages.
 * Primary selector: `div#viewLegSnippet`
 * Fallback: `article.LegBody`
 */
function extractLegislationGovUk(doc: Document): string | null {
  const primary = doc.querySelector("div#viewLegSnippet");
  if (primary?.textContent?.trim()) {
    return primary.textContent.trim();
  }
  const fallback = doc.querySelector("article.LegBody");
  return fallback?.textContent?.trim() ?? null;
}

/**
 * Rough token count estimate (1 token ≈ 4 chars for English).
 * Not used for billing — only used to enforce MIN_TOKEN_ESTIMATE guard.
 */
function estimateTokens(text: string): number {
  return Math.floor(text.length / 4);
}

/**
 * Truncate text to approximately maxTokens tokens.
 * Splits on word boundaries to avoid cutting mid-word.
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated;
}

/**
 * Main entry point. Extracts text from the current document for the given
 * jurisdiction and language.
 *
 * @param doc - The Document to extract from (allows unit testing with mocks).
 * @param jurisdiction - ISO 3166-1 alpha-2. NEVER optional. [MULTILINGUAL]
 * @param language - BCP-47. NEVER optional. [MULTILINGUAL]
 * @param sourceUrl - Canonical URL of the current page.
 */
export function extractText(
  doc: Document,
  jurisdiction: Jurisdiction,
  language: Language,
  sourceUrl: string
): ExtractionResult {
  let rawText: string | null = null;

  switch (jurisdiction) {
    case "US":
      rawText = extractCongressGov(doc);
      break;
    case "GB":
      rawText = extractLegislationGovUk(doc);
      break;
    default: {
      // TypeScript exhaustiveness guard — jurisdiction is typed Jurisdiction,
      // but the runtime value from detectJurisdiction could be unexpected.
      const _exhaustive: never = jurisdiction;
      void _exhaustive;
      return { success: false, reason: "unknown_jurisdiction" };
    }
  }

  if (!rawText) {
    return { success: false, reason: "no_selector_match" };
  }

  const excerpt = truncateToTokens(rawText, 8000);

  if (estimateTokens(excerpt) < MIN_TOKEN_ESTIMATE) {
    return { success: false, reason: "text_too_short" };
  }

  return { success: true, text: excerpt, jurisdiction, language, sourceUrl };
}

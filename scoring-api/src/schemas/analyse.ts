// src/schemas/analyse.ts
import { z } from "zod";
import { Errors } from "../errors.js";

// Phase 1 allowlists — expand in Phase 2 by adding entries here only
export const SUPPORTED_LANGUAGES: readonly string[] = ["en"] as const;
export const SUPPORTED_JURISDICTIONS: readonly string[] = ["US", "GB"] as const;

// Minimum token count heuristic: 200 tokens ≈ 800 characters
const MIN_TEXT_LENGTH = 800;
// Max 8000 tokens ≈ 32000 characters (rough heuristic)
const MAX_TEXT_LENGTH = 32000;

export const AnalyseRequestSchema = z.object({
  text: z
    .string()
    .min(MIN_TEXT_LENGTH, "TEXT_TOO_SHORT")
    .max(MAX_TEXT_LENGTH, "Text exceeds maximum allowed length."),
  content_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/, "content_hash must be a SHA-256 hex string (64 lowercase hex chars)."),
  language: z
    .string()
    .min(1, "language is required."),
  jurisdiction: z
    .string()
    .min(1, "jurisdiction is required."),
  source_url: z
    .string()
    .url("source_url must be a valid URL."),
});

export type AnalyseRequestInput = z.input<typeof AnalyseRequestSchema>;

/**
 * Validate language and jurisdiction against Phase 1 allowlists.
 * Returns a LexLensError if invalid, null if valid.
 */
export function validateAllowlists(
  language: string,
  jurisdiction: string
): import("../errors.js").LexLensError | null {
  if (!(SUPPORTED_LANGUAGES as string[]).includes(language)) {
    return Errors.unsupportedLanguage(language, [...SUPPORTED_LANGUAGES]);
  }
  if (!(SUPPORTED_JURISDICTIONS as string[]).includes(jurisdiction)) {
    return Errors.unsupportedJurisdiction(jurisdiction, [...SUPPORTED_JURISDICTIONS]);
  }
  return null;
}

export const ClaudeScorePayloadSchema = z.object({
  score: z.number().min(-1.0).max(1.0),
  confidence: z.number().int().min(0).max(100),
  uncertaintyRange: z.tuple([z.number(), z.number()]),
  methodologyDisclaimer: z.string().min(1),
});

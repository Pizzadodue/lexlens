// src/services/scoring.stub.ts
import type { ClaudeScorePayload } from "../types.js";
import type { ScoringParams } from "./scoring.js";

/**
 * Deterministic stub: score derived from content_hash modulo arithmetic.
 * Same hash always returns same score — safe for caching and UI testing.
 */
export class ScoringServiceStub {
  async analyseText(params: ScoringParams): Promise<ClaudeScorePayload> {
    const { language, jurisdiction, requestId } = params;
    console.info({ requestId, language, jurisdiction }, "[STUB] Returning deterministic mock score");

    // Use last 4 hex chars of content_hash to produce a stable score in [-0.5, +0.5]
    // This is intentionally simplistic — it is a development stub only
    const hashSuffix = params.text // stub receives text, we use requestId as proxy
      ? parseInt(requestId.replace(/-/g, "").slice(-4), 16)
      : 0;
    const normalized = (hashSuffix % 1000) / 1000; // 0..1
    const score = parseFloat(((normalized - 0.5) * 2 * 0.5).toFixed(2)); // -0.5..+0.5
    const confidence = 55 + (hashSuffix % 30); // 55..84
    const halfRange = parseFloat((0.15 + (hashSuffix % 10) / 100).toFixed(2));

    return {
      score,
      confidence,
      uncertaintyRange: [
        parseFloat((score - halfRange).toFixed(2)),
        parseFloat((score + halfRange).toFixed(2)),
      ],
      methodologyDisclaimer:
        "[DEVELOPMENT STUB] This is a synthetic score for testing purposes only. Not a real analysis.",
    };
  }
}

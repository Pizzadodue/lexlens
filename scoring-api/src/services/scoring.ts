// src/services/scoring.ts
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { ClaudeScorePayloadSchema } from "../schemas/analyse.js";
import { Errors } from "../errors.js";
import type { ClaudeScorePayload, LanguageCode, JurisdictionCode } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load system prompt at startup — never inline in code, must be version-controlled
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../../prompts/scoring-system.txt"),
  "utf-8"
);

if (!SYSTEM_PROMPT || SYSTEM_PROMPT.trim().length === 0) {
  throw new Error("prompts/scoring-system.txt is missing or empty. Cannot start.");
}

export interface ScoringParams {
  text: string;
  language: LanguageCode;      // BCP-47 [MULTILINGUAL]
  jurisdiction: JurisdictionCode; // ISO 3166-1 alpha-2 [MULTILINGUAL]
  requestId: string;           // for log correlation only
}

export class ScoringService {
  private readonly client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
  }

  /**
   * Call Claude to score legislation text.
   * NEVER log the text param — only content_hash, language, jurisdiction, requestId.
   *
   * @param params - scoring inputs
   * @returns ClaudeScorePayload
   * @throws LexLensError(ANALYSIS_UNAVAILABLE) on Claude failure or invalid JSON
   */
  async analyseText(
    params: ScoringParams
  ): Promise<ClaudeScorePayload> {
    const { text, language, jurisdiction, requestId } = params;

    let response;
    try {
      response = await this.client.messages.create({
        model: config.CLAUDE_MODEL,
        max_tokens: 512,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            // Prompt caching: system prompt is static, cache it on every call
            // Expected cache hit rate >95% — reduces cost and latency significantly
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                // Include language + jurisdiction context for Phase 2 multilingual prompts
                text: `Language: ${language}\nJurisdiction: ${jurisdiction}\n\n${text}`,
              },
            ],
          },
        ],
      });
    } catch (err) {
      // Do not include text in logs
      const message = err instanceof Error ? err.message : String(err);
      console.error({ requestId, language, jurisdiction, error: message }, "Claude API call failed");
      throw Errors.analysisUnavailable();
    }

    const rawContent = response.content[0];
    if (!rawContent || rawContent.type !== "text") {
      console.error({ requestId, language, jurisdiction }, "Claude returned unexpected content type");
      throw Errors.analysisUnavailable();
    }

    // Strip markdown code fences if present — some model versions wrap JSON in ```json...```
    // despite the prompt explicitly prohibiting it. This is a defensive normalisation.
    const rawText = rawContent.text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      console.error({ requestId, language, jurisdiction }, "Claude returned non-JSON response");
      throw Errors.analysisUnavailable();
    }

    const validated = ClaudeScorePayloadSchema.safeParse(parsed);
    if (!validated.success) {
      console.error(
        { requestId, language, jurisdiction, issues: validated.error.issues },
        "Claude response failed schema validation"
      );
      throw Errors.analysisUnavailable();
    }

    return validated.data;
  }
}

// src/routes/analyse.ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { AnalyseRequestSchema, validateAllowlists } from "../schemas/analyse.js";
import { CacheService } from "../services/cache.js";
import { ScoringService } from "../services/scoring.js";
import { ScoringServiceStub } from "../services/scoring.stub.js";
import { config } from "../config.js";
import { Errors, LexLensError } from "../errors.js";
import type { AnalyseResponse, CacheKey } from "../types.js";

export function registerAnalyseRoute(
  app: FastifyInstance,
  cacheService: CacheService,
  scoringService: ScoringService | ScoringServiceStub
): void {
  app.post("/v1/analyse", async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = randomUUID();

    // ── Step 1: Validate request schema ─────────────────────────────────────
    const parsed = AnalyseRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      // TEXT_TOO_SHORT is a known validation message — return typed error
      if (firstIssue?.message === "TEXT_TOO_SHORT") {
        return reply.code(422).send(Errors.textTooShort().toResponse());
      }
      return reply.code(400).send({ error: "VALIDATION_ERROR", message: firstIssue?.message ?? "Invalid request." });
    }

    const { text, content_hash, language, jurisdiction } = parsed.data;

    // ── Step 2: Validate language + jurisdiction allowlists ──────────────────
    const allowlistError = validateAllowlists(language, jurisdiction);
    if (allowlistError) {
      return reply.code(allowlistError.httpStatus).send(allowlistError.toResponse());
    }

    const cacheKey: CacheKey = { content_hash, language, jurisdiction };

    // Log correlation — never log text or source_url to persistent storage
    request.log.info({ requestId, content_hash, language, jurisdiction }, "analyse request received");

    try {
      // ── Step 3: Check Redis cache ──────────────────────────────────────────
      const cached = await cacheService.getCachedResult(cacheKey);
      if (cached) {
        request.log.info({ requestId, content_hash, language, jurisdiction }, "cache hit");
        return reply.code(200).send({ ...cached, cached: true });
      }

      // ── Step 4: Acquire Redis lock (stampede protection) ──────────────────
      let lockAcquired = await cacheService.acquireLock(cacheKey);
      if (!lockAcquired) {
        // Another request is already computing this score — wait for it
        request.log.info({ requestId, content_hash }, "waiting for lock");
        const released = await cacheService.waitForLock(cacheKey);
        if (!released) {
          // Lock timeout — fall through to re-attempt computation
          request.log.warn({ requestId, content_hash }, "lock wait timed out, proceeding");
          lockAcquired = await cacheService.acquireLock(cacheKey);
        }
      }

      // ── Step 5: Double-check cache after acquiring lock ───────────────────
      const cachedAfterLock = await cacheService.getCachedResult(cacheKey);
      if (cachedAfterLock) {
        if (lockAcquired) await cacheService.releaseLock(cacheKey);
        return reply.code(200).send({ ...cachedAfterLock, cached: true });
      }

      // ── Step 6: Call scoring service ──────────────────────────────────────
      let scorePayload;
      try {
        scorePayload = await scoringService.analyseText({ text, language, jurisdiction, requestId });
      } finally {
        // Always release the lock — even on error
        if (lockAcquired) await cacheService.releaseLock(cacheKey);
      }

      // ── Step 7: Build and cache result ────────────────────────────────────
      const result: AnalyseResponse = {
        score: scorePayload.score,
        confidence: scorePayload.confidence,
        uncertaintyRange: scorePayload.uncertaintyRange,
        methodologyDisclaimer: scorePayload.methodologyDisclaimer,
        methodologyUrl: config.METHODOLOGY_URL,
        language,
        jurisdiction,
        analysedAt: new Date().toISOString(),
        cached: false,
      };

      await cacheService.setCachedResult(cacheKey, result);

      request.log.info({ requestId, content_hash, language, jurisdiction }, "analyse complete");

      // ── Step 8: Return result ──────────────────────────────────────────────
      return reply.code(200).send(result);
    } catch (err) {
      if (err instanceof LexLensError) {
        return reply.code(err.httpStatus).send(err.toResponse());
      }
      request.log.error({ requestId, error: String(err) }, "unexpected error in analyse route");
      return reply.code(503).send(Errors.analysisUnavailable().toResponse());
    }
  });
}

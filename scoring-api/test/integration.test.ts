/**
 * Integration tests — GMA-24: End-to-end integration (stub mode)
 *
 * Covers all 7 scenarios from the GMA-24 test plan:
 *  1. Health check
 *  2. Stub analysis — congress.gov (US jurisdiction)
 *  3. Stub analysis — legislation.gov.uk (GB jurisdiction)
 *  4. Cache hit — second identical request returns cached:true
 *  5. Error path — scoring failure returns 503 (not stuck on loading)
 *  6. Unsupported page (invalid jurisdiction → 422)
 *  7. Latency check — p95 cold <50ms, p95 warm <10ms
 *
 * Uses app.inject() so no real HTTP port is needed.
 * Uses an in-memory Redis mock — no Docker / real Redis required.
 */

// Env vars are set in test/setup-env.ts (jest.config.js setupFiles) before
// any module is loaded — config.ts reads them at module-load time.

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { buildApp } from "../src/app.js";
import { ScoringServiceStub } from "../src/services/scoring.stub.js";
import type { AnalyseResponse, ErrorResponse } from "../src/types.js";

// ---------------------------------------------------------------------------
// Minimal in-memory Redis mock
// Implements only the methods used by CacheService + HealthRoute:
//   get, set, del, exists, ping
// ---------------------------------------------------------------------------
class InMemoryRedis {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async ping(): Promise<"PONG"> {
    return "PONG";
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(
    key: string,
    value: string,
    ...args: unknown[]
  ): Promise<"OK" | null> {
    const argList = args as Array<string | number>;
    let ttlMs: number | null = null;
    let nx = false;

    for (let i = 0; i < argList.length; i++) {
      const arg = String(argList[i]).toUpperCase();
      if (arg === "EX" && i + 1 < argList.length) {
        ttlMs = Number(argList[i + 1]) * 1000;
        i++;
      } else if (arg === "PX" && i + 1 < argList.length) {
        ttlMs = Number(argList[i + 1]);
        i++;
      } else if (arg === "NX") {
        nx = true;
      }
    }

    if (nx && this.store.has(key)) {
      const entry = this.store.get(key)!;
      if (entry.expiresAt === null || Date.now() <= entry.expiresAt) {
        return null; // NX: only set if not exists
      }
    }

    this.store.set(key, {
      value,
      expiresAt: ttlMs !== null ? Date.now() + ttlMs : null,
    });
    return "OK";
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return 0;
    }
    return 1;
  }

  /** Test helper — clear all keys between tests. */
  flushAll(): void {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const VALID_US_REQUEST = {
  text: "A".repeat(800), // well above the 200-token minimum
  content_hash: "a".repeat(64),
  language: "en",
  jurisdiction: "US",
  source_url: "https://www.congress.gov/bill/119th-congress/house-bill/1",
};

const VALID_GB_REQUEST = {
  text: "B".repeat(800),
  content_hash: "b".repeat(64),
  language: "en",
  jurisdiction: "GB",
  source_url: "https://www.legislation.gov.uk/ukpga/2023/1/contents",
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("GMA-24 Integration — scoring-api stub mode", () => {
  let app: FastifyInstance;
  let redis: InMemoryRedis;

  beforeAll(async () => {
    redis = new InMemoryRedis();
    // Inject a real ScoringServiceStub — no Claude API calls made
    app = await buildApp(redis as unknown as Redis, new ScoringServiceStub());
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 1 — Health check
  // ─────────────────────────────────────────────────────────────────────────
  describe("Scenario 1 — Health check", () => {
    it("GET /health returns 200 with status ok", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ status: string; redis: string }>();
      expect(body.status).toBe("ok");
      expect(body.redis).toBe("ok");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 2 — congress.gov page (US, en) — stub analysis
  // ─────────────────────────────────────────────────────────────────────────
  describe("Scenario 2 — US congress.gov stub analysis", () => {
    beforeAll(() => redis.flushAll());

    it("returns 200 with well-formed score payload", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/analyse",
        payload: VALID_US_REQUEST,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<AnalyseResponse>();

      expect(typeof body.score).toBe("number");
      expect(body.score).toBeGreaterThanOrEqual(-1.0);
      expect(body.score).toBeLessThanOrEqual(1.0);

      expect(Number.isInteger(body.confidence)).toBe(true);
      expect(body.confidence).toBeGreaterThanOrEqual(0);
      expect(body.confidence).toBeLessThanOrEqual(100);

      expect(Array.isArray(body.uncertaintyRange)).toBe(true);
      expect(body.uncertaintyRange).toHaveLength(2);

      expect(body.methodologyDisclaimer.length).toBeGreaterThan(0);
      expect(body.methodologyUrl).toBe("https://lexlens.com/methodology");

      expect(body.language).toBe("en");
      expect(body.jurisdiction).toBe("US");
      expect(typeof body.analysedAt).toBe("string");
      expect(body.cached).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 3 — legislation.gov.uk (GB, en) — stub analysis
  // ─────────────────────────────────────────────────────────────────────────
  describe("Scenario 3 — GB legislation.gov.uk stub analysis", () => {
    beforeAll(() => redis.flushAll());

    it("returns 200 with jurisdiction=GB and language=en", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/analyse",
        payload: VALID_GB_REQUEST,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<AnalyseResponse>();
      expect(body.jurisdiction).toBe("GB");
      expect(body.language).toBe("en");
      expect(body.cached).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 4 — Cache hit
  // ─────────────────────────────────────────────────────────────────────────
  describe("Scenario 4 — Cache hit on repeated request", () => {
    beforeAll(() => redis.flushAll());

    it("first request returns cached:false", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/analyse",
        payload: VALID_US_REQUEST,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<AnalyseResponse>().cached).toBe(false);
    });

    it("second identical request returns cached:true", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/analyse",
        payload: VALID_US_REQUEST,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<AnalyseResponse>().cached).toBe(true);
    });

    it("cached result has identical score to original", async () => {
      const first = await app.inject({
        method: "POST",
        url: "/v1/analyse",
        payload: VALID_GB_REQUEST,
      });
      const second = await app.inject({
        method: "POST",
        url: "/v1/analyse",
        payload: VALID_GB_REQUEST,
      });
      const b1 = first.json<AnalyseResponse>();
      const b2 = second.json<AnalyseResponse>();
      expect(b1.score).toBe(b2.score);
      expect(b1.confidence).toBe(b2.confidence);
      expect(b2.cached).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 5 — Error path — scoring service failure → 503
  // ─────────────────────────────────────────────────────────────────────────
  describe("Scenario 5 — Error path: scoring service throws → 503", () => {
    let errorApp: FastifyInstance;
    let errorRedis: InMemoryRedis;

    beforeAll(async () => {
      errorRedis = new InMemoryRedis();
      // Inject a stub that always throws — simulates ANTHROPIC_API_KEY=invalid
      const failingStub = {
        analyseText: async () => {
          throw new Error("Claude API unreachable");
        },
      } as unknown as ScoringServiceStub;
      errorApp = await buildApp(
        errorRedis as unknown as Redis,
        failingStub
      );
      await errorApp.ready();
    });

    afterAll(async () => {
      await errorApp.close();
    });

    it("returns 503 ANALYSIS_UNAVAILABLE (not a hung/stuck response)", async () => {
      const res = await errorApp.inject({
        method: "POST",
        url: "/v1/analyse",
        payload: VALID_US_REQUEST,
      });
      expect(res.statusCode).toBe(503);
      const body = res.json<ErrorResponse>();
      expect(body.error).toBe("ANALYSIS_UNAVAILABLE");
      expect(typeof body.message).toBe("string");
      expect(body.message.length).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 6 — Unsupported page / invalid parameters
  // ─────────────────────────────────────────────────────────────────────────
  describe("Scenario 6 — Unsupported / invalid requests", () => {
    it("rejects unsupported jurisdiction with 422 UNSUPPORTED_JURISDICTION", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/analyse",
        payload: { ...VALID_US_REQUEST, jurisdiction: "DE" },
      });
      expect(res.statusCode).toBe(422);
      const body = res.json<ErrorResponse>();
      expect(body.error).toBe("UNSUPPORTED_JURISDICTION");
      expect(Array.isArray(body.supportedJurisdictions)).toBe(true);
    });

    it("rejects unsupported language with 422 UNSUPPORTED_LANGUAGE", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/analyse",
        payload: { ...VALID_US_REQUEST, language: "fr" },
      });
      expect(res.statusCode).toBe(422);
      const body = res.json<ErrorResponse>();
      expect(body.error).toBe("UNSUPPORTED_LANGUAGE");
      expect(Array.isArray(body.supportedLanguages)).toBe(true);
    });

    it("rejects text below minimum length with 422 TEXT_TOO_SHORT", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/analyse",
        payload: { ...VALID_US_REQUEST, text: "too short" },
      });
      expect(res.statusCode).toBe(422);
      const body = res.json<ErrorResponse>();
      expect(body.error).toBe("TEXT_TOO_SHORT");
    });

    it("rejects missing language with 400 VALIDATION_ERROR", async () => {
      const { language: _l, ...noLang } = VALID_US_REQUEST;
      const res = await app.inject({
        method: "POST",
        url: "/v1/analyse",
        payload: noLang,
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects missing jurisdiction with 400 VALIDATION_ERROR", async () => {
      const { jurisdiction: _j, ...noJuris } = VALID_US_REQUEST;
      const res = await app.inject({
        method: "POST",
        url: "/v1/analyse",
        payload: noJuris,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 7 — Latency check (stub mode)
  // Cold p95 target: <50ms | Warm p95 target: <10ms
  // ─────────────────────────────────────────────────────────────────────────
  describe("Scenario 7 — Latency benchmarks (stub mode)", () => {
    const N = 10;

    function percentile(sorted: number[], pct: number): number {
      const idx = Math.ceil((pct / 100) * sorted.length) - 1;
      return sorted[Math.max(0, idx)];
    }

    it(`cold p95 < 50ms over ${N} requests`, async () => {
      const latencies: number[] = [];

      for (let i = 0; i < N; i++) {
        // Different hash per request to avoid cache hits
        const coldReq = {
          ...VALID_US_REQUEST,
          content_hash: String(i).padStart(2, "0").repeat(32), // unique 64-char hash
        };
        const t0 = performance.now();
        const res = await app.inject({
          method: "POST",
          url: "/v1/analyse",
          payload: coldReq,
        });
        const elapsed = performance.now() - t0;
        latencies.push(elapsed);
        expect(res.statusCode).toBe(200);
      }

      latencies.sort((a, b) => a - b);
      const p95 = percentile(latencies, 95);
      console.info(`[Latency] Cold p95: ${p95.toFixed(2)}ms (target <50ms)`);
      expect(p95).toBeLessThan(50);
    });

    it(`warm (cached) p95 < 10ms over ${N} requests`, async () => {
      // Prime the cache with one request
      const warmReq = {
        ...VALID_US_REQUEST,
        content_hash: "f".repeat(64),
      };
      await app.inject({ method: "POST", url: "/v1/analyse", payload: warmReq });

      const latencies: number[] = [];
      for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        const res = await app.inject({
          method: "POST",
          url: "/v1/analyse",
          payload: warmReq,
        });
        const elapsed = performance.now() - t0;
        latencies.push(elapsed);
        expect(res.statusCode).toBe(200);
        expect(res.json<AnalyseResponse>().cached).toBe(true);
      }

      latencies.sort((a, b) => a - b);
      const p95 = percentile(latencies, 95);
      console.info(`[Latency] Warm p95: ${p95.toFixed(2)}ms (target <10ms)`);
      expect(p95).toBeLessThan(10);
    });
  });
});

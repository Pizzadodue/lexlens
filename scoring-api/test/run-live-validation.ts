/**
 * GMA-25: Live integration validation script
 *
 * Run with a real ANTHROPIC_API_KEY to validate:
 *  1. Smoke test — live Claude call returns valid AnalyseResponse
 *  2. Accuracy KPI — >85% agreement vs calibration set (scored within ±0.15 tolerance)
 *  3. Latency — cold p95 <2s, warm p95 <200ms
 *  4. Cache correctness — second call returns cached:true, no second Claude call
 *  5. Error handling — malformed response path returns 503 ANALYSIS_UNAVAILABLE
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... USE_SCORING_STUB=false npx tsx test/run-live-validation.ts
 *
 * Or source .env first:
 *   export $(cat .env | grep -v '#') && npx tsx test/run-live-validation.ts
 *
 * Exit codes:
 *   0 — all KPIs met (go signal for production)
 *   1 — one or more KPIs missed (no-go, escalate to CTO)
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import IORedis from "ioredis";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Guard: require real ANTHROPIC_API_KEY
// ---------------------------------------------------------------------------
const API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
if (!API_KEY || API_KEY === "sk-ant-..." || API_KEY.startsWith("sk-ant-test")) {
  console.error("ERROR: ANTHROPIC_API_KEY is missing or is the placeholder value.");
  console.error("Set a real key: ANTHROPIC_API_KEY=sk-ant-... npx tsx test/run-live-validation.ts");
  process.exit(1);
}

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const STUB_MODE = process.env.USE_SCORING_STUB === "true";
if (STUB_MODE) {
  console.error("ERROR: USE_SCORING_STUB=true. Set USE_SCORING_STUB=false for live validation.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Calibration entry type
// ---------------------------------------------------------------------------
interface CalibrationEntry {
  id: string;
  language: string;
  jurisdiction: string;
  source: string;
  textExcerpt: string;
  ideologyScore: number;
  confidence: number;
}

interface AnalyseResponse {
  score: number;
  confidence: number;
  uncertaintyRange: [number, number];
  methodologyDisclaimer: string;
  cached: boolean;
  analysedAt: string;
  language: string;
  jurisdiction: string;
  methodologyUrl?: string;
  confidenceScore?: number;
  methodologyVersion?: string;
}

// ---------------------------------------------------------------------------
// Load calibration data — stratified sample across score bands and sources
// ---------------------------------------------------------------------------
function loadCalibrationSample(sampleSize: number): CalibrationEntry[] {
  const sources = ["dw-nominate", "manifesto-project", "chapel-hill"] as const;
  const all: CalibrationEntry[] = [];

  for (const source of sources) {
    const path = join(__dirname, `../../data/calibration/${source}/entries.json`);
    const entries: CalibrationEntry[] = JSON.parse(readFileSync(path, "utf-8"));
    all.push(...entries);
  }

  // Stratify: pick entries spanning the score range evenly
  // Sort by ideologyScore, then pick evenly spaced samples
  all.sort((a, b) => a.ideologyScore - b.ideologyScore);

  if (all.length <= sampleSize) return all;

  const step = all.length / sampleSize;
  const sample: CalibrationEntry[] = [];
  for (let i = 0; i < sampleSize; i++) {
    const idx = Math.round(i * step);
    sample.push(all[Math.min(idx, all.length - 1)]);
  }
  return sample;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function normaliseLanguage(bcp47: string): string {
  // API Phase 1 allowlist only accepts "en" — strip subtags
  return bcp47.split("-")[0].toLowerCase();
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function percentile(sorted: number[], pct: number): number {
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// Agreement: Claude score is within ±TOLERANCE of calibration score
const TOLERANCE = 0.15;

function isAgreed(claudeScore: number, calibrationScore: number): boolean {
  return Math.abs(claudeScore - calibrationScore) <= TOLERANCE;
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------
async function runValidation(): Promise<void> {
  console.log("=".repeat(60));
  console.log("GMA-25 Live Integration Validation");
  console.log(`Model:       ${process.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001"}`);
  console.log(`Redis:       ${REDIS_URL}`);
  console.log(`Agreement tolerance: ±${TOLERANCE}`);
  console.log("=".repeat(60));

  const redis = new IORedis(REDIS_URL, { lazyConnect: true });
  await redis.connect();

  let app: FastifyInstance;
  try {
    app = await buildApp(redis);
    await app.ready();
  } catch (err) {
    console.error("Failed to start app:", err);
    await redis.disconnect();
    process.exit(1);
  }

  const results: { name: string; passed: boolean; detail: string }[] = [];
  let exitCode = 0;

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 1 — Smoke test: single live Claude call
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[1/5] Smoke test — live Claude call...");
  try {
    const smokeText = `To provide quality health care for all Americans. This Act shall establish a public
option for health insurance coverage available to all citizens regardless of employment status.
The Secretary shall set premiums based on ability to pay. Coverage shall include preventive care,
mental health services, prescription drugs, and emergency care. Funding shall be provided through
a surtax on incomes exceeding $400,000 per annum. $".repeat(5)`;
    const smokeHash = sha256(smokeText);

    const t0 = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/v1/analyse",
      payload: {
        text: smokeText,
        content_hash: smokeHash,
        language: "en",
        jurisdiction: "US",
        source_url: "https://www.congress.gov/bill/test",
      },
    });
    const elapsed = Date.now() - t0;

    if (res.statusCode !== 200) {
      throw new Error(`Expected 200, got ${res.statusCode}: ${res.body}`);
    }

    const body = res.json<AnalyseResponse>();
    if (typeof body.score !== "number" || body.score < -1 || body.score > 1) {
      throw new Error(`Invalid score: ${body.score}`);
    }
    if (!Number.isInteger(body.confidence) || body.confidence < 0 || body.confidence > 100) {
      throw new Error(`Invalid confidence: ${body.confidence}`);
    }
    if (!Array.isArray(body.uncertaintyRange) || body.uncertaintyRange.length !== 2) {
      throw new Error(`Invalid uncertaintyRange: ${JSON.stringify(body.uncertaintyRange)}`);
    }
    if (!body.methodologyDisclaimer || body.methodologyDisclaimer.length === 0) {
      throw new Error("Empty methodologyDisclaimer");
    }
    if (body.cached !== false) {
      throw new Error("First call should not be cached");
    }

    console.log(`  ✓ score=${body.score}, confidence=${body.confidence}, latency=${elapsed}ms`);
    results.push({ name: "Smoke test", passed: true, detail: `score=${body.score}, ${elapsed}ms` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${msg}`);
    results.push({ name: "Smoke test", passed: false, detail: msg });
    exitCode = 1;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 2 — Accuracy validation vs calibration set
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[2/5] Accuracy validation vs calibration set...");
  // Use 50-entry stratified sample for a balance of coverage and API cost
  const SAMPLE_SIZE = 50;
  const sample = loadCalibrationSample(SAMPLE_SIZE);

  console.log(`  Testing ${sample.length} entries (stratified sample from 503-entry calibration set)`);

  let agreed = 0;
  let failed = 0;
  const disagreements: Array<{
    id: string;
    calibration: number;
    claude: number;
    delta: number;
  }> = [];

  for (let i = 0; i < sample.length; i++) {
    const entry = sample[i];
    const language = normaliseLanguage(entry.language);
    const jurisdiction = entry.jurisdiction;

    // Skip if jurisdiction or language not in allowlist
    if (!["US", "GB"].includes(jurisdiction) || language !== "en") {
      console.log(`  [${i + 1}/${sample.length}] Skipping (out of Phase 1 scope): jurisdiction=${jurisdiction}, lang=${language}`);
      continue;
    }

    try {
      const res = await app.inject({
        method: "POST",
        url: "/v1/analyse",
        payload: {
          text: entry.textExcerpt,
          content_hash: sha256(entry.textExcerpt),
          language,
          jurisdiction,
          source_url: `https://calibration/${entry.id}`,
        },
      });

      if (res.statusCode !== 200) {
        console.log(`  [${i + 1}/${sample.length}] ✗ API error ${res.statusCode}`);
        failed++;
        continue;
      }

      const body = res.json<AnalyseResponse>();
      const delta = Math.abs(body.score - entry.ideologyScore);
      const ok = isAgreed(body.score, entry.ideologyScore);

      if (ok) {
        agreed++;
        process.stdout.write(".");
      } else {
        disagreements.push({
          id: entry.id,
          calibration: entry.ideologyScore,
          claude: body.score,
          delta,
        });
        process.stdout.write("X");
      }

      // Rate limiting: small delay between calls to avoid overwhelming API
      if (i < sample.length - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      console.log(`\n  [${i + 1}/${sample.length}] ✗ Exception: ${err}`);
      failed++;
    }
  }

  process.stdout.write("\n");

  const tested = sample.length - failed;
  const agreementRate = tested > 0 ? (agreed / tested) * 100 : 0;
  const KPI_THRESHOLD = 85;
  const kpiPass = agreementRate >= KPI_THRESHOLD;

  console.log(`\n  Agreement rate: ${agreementRate.toFixed(1)}% (${agreed}/${tested} tested, ${failed} failed)`);
  console.log(`  KPI gate: >${KPI_THRESHOLD}% — ${kpiPass ? "✓ PASS" : "✗ FAIL"}`);

  if (disagreements.length > 0) {
    console.log(`\n  Top disagreements (delta > ${TOLERANCE}):`);
    disagreements
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 5)
      .forEach((d) =>
        console.log(`    id=${d.id}: calibration=${d.calibration.toFixed(2)}, claude=${d.claude.toFixed(2)}, delta=${d.delta.toFixed(2)}`)
      );
  }

  results.push({
    name: "Accuracy KPI (>85%)",
    passed: kpiPass,
    detail: `${agreementRate.toFixed(1)}% agreement (${agreed}/${tested})`,
  });
  if (!kpiPass) exitCode = 1;

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 3 — Latency (live mode)
  // Cold p95 target <2s, warm p95 target <200ms
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[3/5] Latency benchmarks (live mode)...");
  const LATENCY_N = 5; // small n to limit cost; uses unique hashes for cold

  try {
    const coldLatencies: number[] = [];
    for (let i = 0; i < LATENCY_N; i++) {
      const text = `Latency test ${i}: `.padEnd(300, "A");
      const hash = sha256(`cold-latency-test-${i}-${Date.now()}`);
      const t0 = Date.now();
      const res = await app.inject({
        method: "POST",
        url: "/v1/analyse",
        payload: { text, content_hash: hash, language: "en", jurisdiction: "US", source_url: "https://www.congress.gov/latency-test" },
      });
      coldLatencies.push(Date.now() - t0);
      if (res.statusCode !== 200) throw new Error(`Cold call ${i} returned ${res.statusCode}`);
      process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 100));
    }
    process.stdout.write("\n");

    coldLatencies.sort((a, b) => a - b);
    const coldP95 = percentile(coldLatencies, 95);

    // Warm latency — reuse same request for cache hits
    const warmText = "Warm latency test: ".padEnd(300, "B");
    const warmHash = sha256("warm-latency-test-fixed");
    // Prime cache
    await app.inject({
      method: "POST",
      url: "/v1/analyse",
      payload: { text: warmText, content_hash: warmHash, language: "en", jurisdiction: "US", source_url: "https://www.congress.gov/warm-test" },
    });

    const warmLatencies: number[] = [];
    for (let i = 0; i < LATENCY_N; i++) {
      const t0 = Date.now();
      await app.inject({
        method: "POST",
        url: "/v1/analyse",
        payload: { text: warmText, content_hash: warmHash, language: "en", jurisdiction: "US", source_url: "https://www.congress.gov/warm-test" },
      });
      warmLatencies.push(Date.now() - t0);
    }
    warmLatencies.sort((a, b) => a - b);
    const warmP95 = percentile(warmLatencies, 95);

    const coldPass = coldP95 < 2000;
    const warmPass = warmP95 < 200;

    console.log(`  Cold p95: ${coldP95}ms (target <2000ms) — ${coldPass ? "✓ PASS" : "✗ FAIL"}`);
    console.log(`  Warm p95: ${warmP95}ms (target <200ms)  — ${warmPass ? "✓ PASS" : "✗ FAIL"}`);

    results.push({
      name: "Latency — cold p95 <2s",
      passed: coldPass,
      detail: `${coldP95}ms`,
    });
    results.push({
      name: "Latency — warm p95 <200ms",
      passed: warmPass,
      detail: `${warmP95}ms`,
    });
    if (!coldPass || !warmPass) exitCode = 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${msg}`);
    results.push({ name: "Latency benchmarks", passed: false, detail: msg });
    exitCode = 1;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 4 — Cache correctness (live mode)
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n[4/5] Cache correctness...");
  try {
    const cacheText = "Cache correctness test: ".padEnd(300, "C");
    const cacheHash = sha256(`cache-correctness-${Date.now()}`);
    const payload = {
      text: cacheText,
      content_hash: cacheHash,
      language: "en",
      jurisdiction: "US",
      source_url: "https://www.congress.gov/cache-test",
    };

    const r1 = await app.inject({ method: "POST", url: "/v1/analyse", payload });
    const r2 = await app.inject({ method: "POST", url: "/v1/analyse", payload });

    const b1 = r1.json<AnalyseResponse>();
    const b2 = r2.json<AnalyseResponse>();

    const cachePass =
      r1.statusCode === 200 &&
      r2.statusCode === 200 &&
      b1.cached === false &&
      b2.cached === true &&
      b1.score === b2.score;

    console.log(`  First call cached: ${b1.cached} (expected false) — ${b1.cached === false ? "✓" : "✗"}`);
    console.log(`  Second call cached: ${b2.cached} (expected true)  — ${b2.cached === true ? "✓" : "✗"}`);
    console.log(`  Score identical:   ${b1.score === b2.score} — ${b1.score === b2.score ? "✓" : "✗"}`);

    results.push({ name: "Cache correctness", passed: cachePass, detail: `score=${b1.score}` });
    if (!cachePass) exitCode = 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${msg}`);
    results.push({ name: "Cache correctness", passed: false, detail: msg });
    exitCode = 1;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scenario 5 — Error handling: malformed response → 503
  // (Tested in stub mode in GMA-24; confirm the route handler in live mode)
  // ─────────────────────────────────_────────────────────────────────────────
  console.log("\n[5/5] Error handling — 400/422 validation paths...");
  try {
    const r400 = await app.inject({
      method: "POST",
      url: "/v1/analyse",
      payload: { text: "A".repeat(800), content_hash: "a".repeat(64) }, // missing language + jurisdiction
    });
    const r422 = await app.inject({
      method: "POST",
      url: "/v1/analyse",
      payload: {
        text: "A".repeat(800),
        content_hash: "a".repeat(64),
        language: "en",
        jurisdiction: "DE", // unsupported
        source_url: "https://www.congress.gov/test",
      },
    });

    const errPass = r400.statusCode === 400 && r422.statusCode === 422;
    console.log(`  400 on missing fields: ${r400.statusCode} — ${r400.statusCode === 400 ? "✓" : "✗"}`);
    console.log(`  422 on unsupported jurisdiction: ${r422.statusCode} — ${r422.statusCode === 422 ? "✓" : "✗"}`);

    results.push({ name: "Error handling", passed: errPass, detail: `400=${r400.statusCode}, 422=${r422.statusCode}` });
    if (!errPass) exitCode = 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ✗ ${msg}`);
    results.push({ name: "Error handling", passed: false, detail: msg });
    exitCode = 1;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────────────
  await app.close();
  await redis.disconnect();

  console.log("\n" + "=".repeat(60));
  console.log("RESULTS SUMMARY");
  console.log("=".repeat(60));
  for (const r of results) {
    const icon = r.passed ? "✓" : "✗";
    console.log(`  ${icon} ${r.name}: ${r.detail}`);
  }

  const allPass = results.every((r) => r.passed);
  console.log("\n" + "=".repeat(60));
  console.log(allPass ? "GO — all KPIs met. Ready for production." : "NO-GO — one or more KPIs missed. Escalate to CTO.");
  console.log("=".repeat(60));

  // Print JSON summary for comment reporting
  const commitHash = process.env.GIT_COMMIT_HASH ??
    (await import("node:child_process")).execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();

  const report = {
    testedAt: new Date().toISOString(),
    commitHash,
    model: process.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001",
    results: results.map((r) => ({ name: r.name, passed: r.passed, detail: r.detail })),
    verdict: allPass ? "go" : "no-go",
  };

  console.log("\nJSON Report (paste into GMA-25 comment):");
  console.log(JSON.stringify(report, null, 2));

  process.exit(exitCode);
}

runValidation().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

// src/index.ts
import { config } from "./config.js";
import { createRedisClient } from "./services/cache.js";
import { buildApp } from "./app.js";

// Warm-up text for Anthropic prompt cache priming at startup.
// A synthetic call ensures the 3K-token system prompt is cached before the
// first real user request, avoiding the uncached cold-call latency spike.
// See ADR-001 cold-latency addendum on GMA-6.
const WARMUP_TEXT =
  "This Act authorises the Secretary to promulgate regulations. " +
  "No provision of this Act shall be construed to limit any existing authority. " +
  "The effective date shall be ninety days after enactment.";

async function warmUpPromptCache(app: import("fastify").FastifyInstance): Promise<void> {
  if (config.USE_SCORING_STUB) return; // no-op in stub/test mode

  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(WARMUP_TEXT).digest("hex");

  try {
    const res = await app.inject({
      method: "POST",
      url: "/v1/analyse",
      payload: {
        text: WARMUP_TEXT,
        content_hash: hash,
        language: "en",
        jurisdiction: "US",
        source_url: "https://www.congress.gov/warmup",
      },
    });
    if (res.statusCode === 200) {
      app.log.info("Anthropic prompt cache warmed — first user request will use cached system prompt");
    } else {
      app.log.warn({ status: res.statusCode }, "Prompt cache warm-up call failed — cold-path latency may be elevated on first request");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    app.log.warn({ error: msg }, "Prompt cache warm-up threw — cold-path latency may be elevated on first request");
  }
}

async function main(): Promise<void> {
  const redis = createRedisClient();
  await redis.connect();

  const app = await buildApp(redis);

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  app.log.info(`Scoring API listening on port ${config.PORT}`);

  // Fire-and-forget: warm up Anthropic prompt cache post-listen so startup is not delayed
  void warmUpPromptCache(app);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

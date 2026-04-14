// src/index.ts
import Fastify from "fastify";
import { config } from "./config.js";
import { createRedisClient, getCacheService } from "./services/cache.js";
import { ScoringService } from "./services/scoring.js";
import { ScoringServiceStub } from "./services/scoring.stub.js";
import { registerAnalyseRoute } from "./routes/analyse.js";
import { registerHealthRoute } from "./routes/health.js";

async function main(): Promise<void> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // GDPR: redact any field that could contain personal data
      // IP addresses must NOT reach persistent log storage
      redact: ["req.headers.authorization", "req.remoteAddress", "req.socket.remoteAddress"],
    },
  });

  const redis = createRedisClient();
  await redis.connect();

  const cacheService = getCacheService(redis);
  const scoringService = config.USE_SCORING_STUB
    ? new ScoringServiceStub()
    : new ScoringService();

  if (config.USE_SCORING_STUB) {
    app.log.warn("USE_SCORING_STUB=true — using deterministic mock scoring, not Claude API");
  }

  registerHealthRoute(app, redis);
  registerAnalyseRoute(app, cacheService, scoringService);

  // Global error handler
  app.setErrorHandler((error: Error, _request, reply) => {
    app.log.error({ error: error.message }, "unhandled error");
    void reply.code(500).send({ error: "INTERNAL_ERROR", message: "An unexpected error occurred." });
  });

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  app.log.info(`Scoring API listening on port ${config.PORT}`);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

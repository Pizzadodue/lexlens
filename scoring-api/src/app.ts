// src/app.ts
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import type { Redis } from "ioredis";
import { config } from "./config.js";
import { getCacheService } from "./services/cache.js";
import { ScoringService } from "./services/scoring.js";
import { ScoringServiceStub } from "./services/scoring.stub.js";
import { registerAnalyseRoute } from "./routes/analyse.js";
import { registerHealthRoute } from "./routes/health.js";

/**
 * Builds and configures the Fastify application without starting the server.
 * Accepts an optional redis instance and scoring service for testability.
 */
export async function buildApp(
  redis: Redis,
  scoringService?: ScoringService | ScoringServiceStub
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // GDPR: redact any field that could contain personal data
      // IP addresses must NOT reach persistent log storage
      redact: [
        "req.headers.authorization",
        "req.remoteAddress",
        "req.socket.remoteAddress",
      ],
    },
  });

  const cacheService = getCacheService(redis);
  const scoring =
    scoringService ??
    (config.USE_SCORING_STUB ? new ScoringServiceStub() : new ScoringService());

  if (config.USE_SCORING_STUB && !scoringService) {
    app.log.warn(
      "USE_SCORING_STUB=true — using deterministic mock scoring, not Claude API"
    );
  }

  registerHealthRoute(app, redis);
  registerAnalyseRoute(app, cacheService, scoring);

  // Global error handler
  app.setErrorHandler((error: Error, _request, reply) => {
    app.log.error({ error: error.message }, "unhandled error");
    void reply
      .code(500)
      .send({ error: "INTERNAL_ERROR", message: "An unexpected error occurred." });
  });

  return app;
}

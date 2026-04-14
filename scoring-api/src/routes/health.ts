// src/routes/health.ts
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";

export function registerHealthRoute(app: FastifyInstance, redis: Redis): void {
  app.get("/health", async (_request, reply) => {
    try {
      await redis.ping();
      return reply.code(200).send({ status: "ok", redis: "ok" });
    } catch {
      return reply.code(503).send({ status: "degraded", redis: "unreachable" });
    }
  });
}

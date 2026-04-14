// src/index.ts
import { config } from "./config.js";
import { createRedisClient } from "./services/cache.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const redis = createRedisClient();
  await redis.connect();

  const app = await buildApp(redis);

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  app.log.info(`Scoring API listening on port ${config.PORT}`);
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

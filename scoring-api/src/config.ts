// src/config.ts
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  ANTHROPIC_API_KEY: z.string().min(1),
  REDIS_URL: z.string().url(),
  METHODOLOGY_URL: z.string().url().default("https://lexlens.com/methodology"),
  CLAUDE_MODEL: z.string().default("claude-sonnet-4-6"),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(604800), // 7 days
  LOCK_TTL_SECONDS: z.coerce.number().int().positive().default(10),
  LOCK_WAIT_MS: z.coerce.number().int().positive().default(3000),
  // z.coerce.boolean() treats the string "false" as true (truthy string).
  // Use explicit string comparison so USE_SCORING_STUB=false works correctly.
  USE_SCORING_STUB: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1")
    .default("false"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(): Config {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment configuration:", result.error.flatten());
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();

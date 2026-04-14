/**
 * Jest setup: inject required env vars before any test module is loaded.
 * This runs before test files import config.ts (which calls loadConfig() at
 * module load time and calls process.exit(1) on missing required vars).
 */
process.env.NODE_ENV = "test";
process.env.PORT = "3001";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-placeholder";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.USE_SCORING_STUB = "true";
process.env.LOG_LEVEL = "error";
process.env.METHODOLOGY_URL = "https://lexlens.com/methodology";

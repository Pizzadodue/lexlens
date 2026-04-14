// src/services/cache.ts
import { Redis } from "ioredis";
import { config } from "../config.js";
import type { AnalyseResponse, CacheKey } from "../types.js";

const LOCK_PREFIX = "lock";
const CACHE_PREFIX = "cache";

/**
 * Serialise a CacheKey to the canonical Redis key string.
 * Format per ADR-001: cache:{content_hash}:{language}:{jurisdiction}
 */
export function buildCacheKey(key: CacheKey): string {
  return `${CACHE_PREFIX}:${key.content_hash}:${key.language}:${key.jurisdiction}`;
}

function buildLockKey(key: CacheKey): string {
  return `${LOCK_PREFIX}:${buildCacheKey(key)}`;
}

export class CacheService {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async getCachedResult(key: CacheKey): Promise<AnalyseResponse | null> {
    const raw = await this.redis.get(buildCacheKey(key));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AnalyseResponse;
    } catch {
      // Corrupted cache entry — treat as miss
      return null;
    }
  }

  async setCachedResult(
    key: CacheKey,
    result: AnalyseResponse,
    ttlSeconds: number = config.CACHE_TTL_SECONDS
  ): Promise<void> {
    await this.redis.set(
      buildCacheKey(key),
      JSON.stringify(result),
      "EX",
      ttlSeconds
    );
  }

  /**
   * Attempt to acquire a per-key lock using SETNX (Redis SET NX EX).
   * Returns true if the lock was acquired, false if already held.
   * Stampede protection: concurrent requests for the same key wait on the lock
   * rather than all calling Claude simultaneously.
   */
  async acquireLock(
    key: CacheKey,
    ttlSeconds: number = config.LOCK_TTL_SECONDS
  ): Promise<boolean> {
    const result = await this.redis.set(
      buildLockKey(key),
      "1",
      "EX",
      ttlSeconds,
      "NX"
    );
    return result === "OK";
  }

  async releaseLock(key: CacheKey): Promise<void> {
    await this.redis.del(buildLockKey(key));
  }

  /**
   * Wait for a lock to be released, polling every 100ms up to maxWaitMs.
   * Returns true when the lock is gone, false if timeout reached.
   */
  async waitForLock(key: CacheKey, maxWaitMs: number = config.LOCK_WAIT_MS): Promise<boolean> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const exists = await this.redis.exists(buildLockKey(key));
      if (!exists) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }
}

export function createRedisClient(): Redis {
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
}

export function getCacheService(redis: Redis): CacheService {
  return new CacheService(redis);
}

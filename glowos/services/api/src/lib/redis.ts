import Redis from "ioredis";
import { config } from "./config.js";

// ─── Redis client ──────────────────────────────────────────────────────────────

export const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
});

redis.on("error", (err) => {
  // Log but don't crash — availability falls back gracefully to DB queries
  console.error("[Redis] Connection error:", err.message);
});

// ─── Cache helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the cached string value for the given key, or null if missing/expired.
 */
export async function getCache(key: string): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

/**
 * Stores a string value in Redis with a TTL in seconds.
 */
export async function setCache(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, value, "EX", ttlSeconds);
  } catch {
    // Non-fatal — availability is best-effort cached
  }
}

/**
 * Deletes all keys matching a glob pattern.
 * Uses SCAN + DEL to avoid blocking the Redis event loop (never uses KEYS).
 */
export async function deleteCache(pattern: string): Promise<void> {
  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } while (cursor !== "0");
  } catch {
    // Non-fatal
  }
}

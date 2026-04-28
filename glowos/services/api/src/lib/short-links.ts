import { db, shortLinks } from "@glowos/db";
import { eq } from "drizzle-orm";
import { config } from "./config.js";

// Strip ambiguous chars (l/1/0/o) so codes spoken aloud / squinted at don't
// mis-resolve. 32 chars × 8 positions = ~1.1 trillion combinations; collision
// probability is negligible at our scale, but the insert still retries.
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 8;

function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

/**
 * Create (or reuse) a short link for the given full URL. Returns the
 * short URL ready to drop into a message. Idempotent on `fullUrl` —
 * re-uses an existing code if one exists with the same fullUrl, so resending
 * a notification doesn't mint a new code.
 *
 * Optional ttlDays defaults to 90 (most booking links are time-bound to
 * the appointment day, so 90d is comfortable headroom).
 */
export async function createShortLink(fullUrl: string, ttlDays = 90): Promise<string> {
  // Reuse if a code already exists for the same URL.
  const [existing] = await db
    .select({ code: shortLinks.code })
    .from(shortLinks)
    .where(eq(shortLinks.fullUrl, fullUrl))
    .limit(1);
  if (existing) return `${config.frontendUrl}/s/${existing.code}`;

  // Mint a new one. Retry on collision (extremely unlikely with 32^8 space).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    try {
      const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
      await db.insert(shortLinks).values({ code, fullUrl, expiresAt });
      return `${config.frontendUrl}/s/${code}`;
    } catch (err) {
      // Unique constraint collision — try again
      if (attempt === 4) throw err;
    }
  }
  throw new Error("short link generation exhausted retries");
}

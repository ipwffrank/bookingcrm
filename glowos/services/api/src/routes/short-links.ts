import { Hono } from "hono";
import { eq, and, or, isNull, gt } from "drizzle-orm";
import { db, shortLinks } from "@glowos/db";

/**
 * Public lookup endpoint for the internal URL shortener. Mounted at `/s` and
 * called by the Next.js `/s/[code]/route.ts` proxy so that DB access stays
 * server-side and Next stays unaware of Drizzle / DATABASE_URL.
 *
 * Returns `{ url }` on hit, `404` on miss or expired entry.
 */
export const shortLinksRouter = new Hono();

shortLinksRouter.get("/:code", async (c) => {
  const code = c.req.param("code");
  const now = new Date();
  const [row] = await db
    .select({ fullUrl: shortLinks.fullUrl })
    .from(shortLinks)
    .where(
      and(
        eq(shortLinks.code, code),
        or(isNull(shortLinks.expiresAt), gt(shortLinks.expiresAt, now)),
      ),
    )
    .limit(1);
  if (!row) return c.json({ error: "Not Found" }, 404);
  return c.json({ url: row.fullUrl });
});

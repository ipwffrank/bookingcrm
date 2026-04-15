import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { db } from "@glowos/db";
import { groupUsers } from "@glowos/db";
import { verifyGroupAccessToken, type GroupAccessTokenPayload } from "../lib/jwt.js";
import type { AppVariables } from "../lib/types.js";

type AppContext = Context<{ Variables: AppVariables }>;

/**
 * Hono middleware that requires a valid group admin JWT.
 * Sets groupId and userId on the context.
 */
export async function requireGroupAdmin(c: AppContext, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized", message: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);

  let payload: GroupAccessTokenPayload;
  try {
    payload = verifyGroupAccessToken(token);
  } catch {
    return c.json({ error: "Unauthorized", message: "Invalid or expired token" }, 401);
  }

  // Verify user still exists in groupUsers
  const [user] = await db
    .select({ id: groupUsers.id, groupId: groupUsers.groupId, role: groupUsers.role })
    .from(groupUsers)
    .where(eq(groupUsers.id, payload.userId))
    .limit(1);

  // NOTE: groupUsers has no isActive column yet. If one is added later,
  // add the active check here (parallel to requireMerchant's isActive guard).
  if (!user) {
    return c.json({ error: "Unauthorized", message: "Group user not found" }, 401);
  }

  // Verify token groupId matches DB groupId (prevents token reuse after reassignment)
  if (user.groupId !== payload.groupId) {
    return c.json({ error: "Unauthorized", message: "Group mismatch" }, 401);
  }

  c.set("userId", user.id);
  c.set("groupId", user.groupId);
  c.set("userRole", user.role);

  await next();
}

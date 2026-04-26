import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { db } from "@glowos/db";
import { groupUsers, merchantUsers } from "@glowos/db";
import {
  verifyAccessToken,
  verifyGroupAccessToken,
  type GroupAccessTokenPayload,
} from "../lib/jwt.js";
import type { AppVariables } from "../lib/types.js";

type AppContext = Context<{ Variables: AppVariables }>;

/**
 * Unified group-context middleware. Accepts EITHER:
 *   - a merchant_users JWT whose owner has a non-null brand_admin_group_id
 *     (the unified path — same login as their branch dashboard), OR
 *   - a legacy group_users JWT (HQ-only accounts; kept for back-compat)
 *
 * Either way, sets userId / groupId / userRole on the context so downstream
 * handlers can read `c.get("groupId")` without caring which path was taken.
 * Brand-admin path also sets `brandAdminGroupId` so handlers can distinguish
 * if they ever need to (currently none do).
 */
export async function requireGroupAccess(c: AppContext, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized", message: "Missing or invalid Authorization header" }, 401);
  }
  const token = authHeader.slice(7);

  // Path 1: merchant_users JWT with brand-admin claim.
  try {
    const payload = verifyAccessToken(token);
    // Token verifies — must be a merchant_users token. From here we either
    // grant brand access or reject; never fall through to the group_users
    // path because that would mean checking the wrong secret.
    if (payload.impersonating) {
      return c.json(
        { error: "Forbidden", message: "End impersonation before accessing /group" },
        403,
      );
    }
    if (!payload.brandAdminGroupId) {
      return c.json({ error: "Forbidden", message: "Brand admin access required" }, 403);
    }
    // Re-read DB so revoking brand authority takes effect immediately rather
    // than waiting up to 15 minutes for the access token to expire.
    const [user] = await db
      .select({
        id: merchantUsers.id,
        isActive: merchantUsers.isActive,
        brandAdminGroupId: merchantUsers.brandAdminGroupId,
        role: merchantUsers.role,
      })
      .from(merchantUsers)
      .where(eq(merchantUsers.id, payload.userId))
      .limit(1);
    if (!user || !user.isActive || !user.brandAdminGroupId) {
      return c.json({ error: "Forbidden", message: "Brand admin access revoked" }, 403);
    }
    if (user.brandAdminGroupId !== payload.brandAdminGroupId) {
      return c.json({ error: "Unauthorized", message: "Brand group mismatch" }, 401);
    }
    c.set("userId", user.id);
    c.set("groupId", user.brandAdminGroupId);
    c.set("userRole", user.role);
    c.set("brandAdminGroupId", user.brandAdminGroupId);
    return next();
  } catch {
    // Not a merchant_users JWT — try the legacy group_users path next.
  }

  // Path 2: legacy group_users JWT.
  let payload: GroupAccessTokenPayload;
  try {
    payload = verifyGroupAccessToken(token);
  } catch {
    return c.json({ error: "Unauthorized", message: "Invalid or expired token" }, 401);
  }

  const [user] = await db
    .select({ id: groupUsers.id, groupId: groupUsers.groupId, role: groupUsers.role })
    .from(groupUsers)
    .where(eq(groupUsers.id, payload.userId))
    .limit(1);

  if (!user) {
    return c.json({ error: "Unauthorized", message: "Group user not found" }, 401);
  }
  if (user.groupId !== payload.groupId) {
    return c.json({ error: "Unauthorized", message: "Group mismatch" }, 401);
  }

  c.set("userId", user.id);
  c.set("groupId", user.groupId);
  c.set("userRole", user.role);

  await next();
}

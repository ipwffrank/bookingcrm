import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { db } from "@glowos/db";
import { merchantUsers, merchants } from "@glowos/db";
import { verifyAccessToken, type AccessTokenPayload } from "../lib/jwt.js";
import { isSuperAdminEmail } from "../lib/config.js";
import type { AppVariables } from "../lib/types.js";

type AppContext = Context<{ Variables: AppVariables }>;

/**
 * Hono middleware that requires a valid merchant user JWT.
 * Sets merchantId, userId, userRole on the context.
 */
export async function requireMerchant(c: AppContext, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "Unauthorized", message: "Missing or invalid Authorization header" }, 401);
  }

  const token = authHeader.slice(7);

  let payload: AccessTokenPayload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return c.json({ error: "Unauthorized", message: "Invalid or expired token" }, 401);
  }

  // Verify user is still active in DB. When impersonating, the JWT's userId
  // is the impersonated owner — but we still load that row so role/merchantId
  // stay in sync with current DB state.
  const [user] = await db
    .select({
      id: merchantUsers.id,
      email: merchantUsers.email,
      isActive: merchantUsers.isActive,
      merchantId: merchantUsers.merchantId,
      role: merchantUsers.role,
      staffId: merchantUsers.staffId,
      brandAdminGroupId: merchantUsers.brandAdminGroupId,
    })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, payload.userId))
    .limit(1);

  if (!user || !user.isActive) {
    return c.json({ error: "Unauthorized", message: "User account is inactive or not found" }, 401);
  }

  // view-as-branch: brand admin scoping their session to a branch in their group.
  // The JWT carries the target merchantId; we re-validate group membership on every
  // request so revoking brand authority or moving a branch out of the group takes
  // effect immediately.
  if (payload.viewingMerchantId) {
    if (!user.brandAdminGroupId) {
      return c.json(
        { error: "Forbidden", message: "Brand authority revoked" },
        403,
      );
    }
    const [target] = await db
      .select({ id: merchants.id, groupId: merchants.groupId })
      .from(merchants)
      .where(eq(merchants.id, payload.viewingMerchantId))
      .limit(1);
    if (!target || target.groupId !== user.brandAdminGroupId) {
      return c.json(
        { error: "Forbidden", message: "Branch not in your group" },
        403,
      );
    }
    c.set("userId", user.id);
    c.set("merchantId", payload.viewingMerchantId);
    c.set("userRole", "owner"); // synthetic — brand admin holds owner-equivalent within their group
    c.set("brandViewing", true);
    c.set("homeMerchantId", user.merchantId);
    c.set("viewingMerchantId", payload.viewingMerchantId);
    if (user.staffId) c.set("staffId", user.staffId);
    if (payload.brandAdminGroupId) c.set("brandAdminGroupId", payload.brandAdminGroupId);
    await next();
    return;
  }

  c.set("userId", user.id);
  c.set("merchantId", user.merchantId);
  c.set("userRole", user.role);
  if (user.staffId) c.set("staffId", user.staffId);

  // Forward superadmin claims. Re-validate against the allowlist on every
  // request — rotating SUPER_ADMIN_EMAILS effectively revokes access without
  // waiting for token expiry. Impersonation flag is trusted from the JWT.
  if (payload.superAdmin && isSuperAdminEmail(payload.actorEmail ?? user.email)) {
    c.set("superAdmin", true);
  }
  if (payload.impersonating) {
    c.set("impersonating", true);
    if (payload.actorUserId) c.set("actorUserId", payload.actorUserId);
    if (payload.actorEmail) c.set("actorEmail", payload.actorEmail);
  }
  if (payload.brandAdminGroupId) {
    c.set("brandAdminGroupId", payload.brandAdminGroupId);
  }

  await next();
}

/**
 * Requires the caller to be an active superadmin AND not currently
 * impersonating a merchant. /super/* endpoints are cross-tenant and
 * should only run from the superadmin's own session.
 */
export async function requireSuperAdmin(c: AppContext, next: Next) {
  if (!c.get("superAdmin")) {
    return c.json({ error: "Forbidden", message: "Superadmin access required" }, 403);
  }
  if (c.get("impersonating")) {
    return c.json(
      { error: "Forbidden", message: "End impersonation before accessing /super" },
      403,
    );
  }
  await next();
}

/**
 * Requires the caller to be acting as a brand admin — their JWT must carry a
 * brandAdminGroupId, set when their merchant_users row has a non-null
 * brand_admin_group_id. The targeted group is always taken from the JWT, never
 * from a path param, so a brand admin for group A cannot reach into group B.
 *
 * Blocks impersonating sessions: a superadmin viewing-as a merchant should
 * not also wield brand-admin powers in the same hop.
 */
export async function requireBrandAdmin(c: AppContext, next: Next) {
  if (!c.get("brandAdminGroupId")) {
    return c.json({ error: "Forbidden", message: "Brand admin access required" }, 403);
  }
  if (c.get("impersonating")) {
    return c.json(
      { error: "Forbidden", message: "End impersonation before accessing /group" },
      403,
    );
  }
  await next();
}

/**
 * Middleware factory that restricts access to specific roles.
 * Must be used after requireMerchant.
 */
export function requireRole(...roles: string[]) {
  return async function (c: AppContext, next: Next) {
    const userRole = c.get("userRole");

    if (!userRole || !roles.includes(userRole)) {
      return c.json(
        {
          error: "Forbidden",
          message: `This action requires one of the following roles: ${roles.join(", ")}`,
        },
        403
      );
    }

    await next();
  };
}

// New: blocks staff role, allows owner + manager only
export function requireAdmin() {
  return async function (c: AppContext, next: Next) {
    const userRole = c.get("userRole");
    if (!userRole || !["owner", "manager"].includes(userRole)) {
      return c.json({ error: "Forbidden", message: "Admin access required. Requires owner or manager role." }, 403);
    }
    await next();
  };
}

// ─── RBAC permissions map ──────────────────────────────────────────────────────

export const PERMISSIONS: Record<string, string[]> = {
  owner: ["*"],
  manager: ["bookings.*", "clients.read", "clients.notes", "analytics.read"],
  staff: [
    "bookings.read_own",
    "bookings.checkin",
    "bookings.complete",
    "bookings.noshow",
    "bookings.create_walkin",
  ],
};

/**
 * Checks if a given role has the specified permission.
 * Supports wildcard matching: "bookings.*" matches "bookings.read", etc.
 * The owner role with ["*"] matches everything.
 */
function hasPermission(role: string, permission: string): boolean {
  const perms = PERMISSIONS[role];
  if (!perms) return false;

  for (const p of perms) {
    if (p === "*") return true;
    if (p === permission) return true;
    if (p.endsWith(".*")) {
      const prefix = p.slice(0, -2);
      if (permission === prefix || permission.startsWith(`${prefix}.`)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Middleware factory that checks if the authenticated user has a specific RBAC permission.
 * Must be used after requireMerchant.
 */
export function requirePermission(permission: string) {
  return async function (c: AppContext, next: Next) {
    const userRole = c.get("userRole");

    if (!userRole || !hasPermission(userRole, permission)) {
      return c.json(
        {
          error: "Forbidden",
          message: `You do not have the required permission: ${permission}`,
        },
        403
      );
    }

    await next();
  };
}

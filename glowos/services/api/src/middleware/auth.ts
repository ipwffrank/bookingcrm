import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { db } from "@glowos/db";
import { merchantUsers } from "@glowos/db";
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
    })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, payload.userId))
    .limit(1);

  if (!user || !user.isActive) {
    return c.json({ error: "Unauthorized", message: "User account is inactive or not found" }, 401);
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

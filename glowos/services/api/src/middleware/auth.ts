import type { Context, Next } from "hono";
import { eq } from "drizzle-orm";
import { db } from "@glowos/db";
import { merchantUsers } from "@glowos/db";
import { verifyAccessToken } from "../lib/jwt.js";
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

  let payload: { userId: string; merchantId: string; role: string };
  try {
    payload = verifyAccessToken(token);
  } catch {
    return c.json({ error: "Unauthorized", message: "Invalid or expired token" }, 401);
  }

  // Verify user is still active in DB
  const [user] = await db
    .select({
      id: merchantUsers.id,
      isActive: merchantUsers.isActive,
      merchantId: merchantUsers.merchantId,
      role: merchantUsers.role,
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

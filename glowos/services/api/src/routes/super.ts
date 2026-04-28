import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, count, desc, eq, gte, ilike, or, sql, sum } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  merchants,
  merchantUsers,
  bookings,
  clients,
  notificationLog,
  whatsappInboundLog,
  superAdminAuditLog,
} from "@glowos/db";
import { generateAccessToken, generateRefreshToken } from "../lib/jwt.js";
import { requireMerchant, requireSuperAdmin } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import { isSuperAdminEmail } from "../lib/config.js";
import type { AppVariables } from "../lib/types.js";

const superRouter = new Hono<{ Variables: AppVariables }>();

// All /super endpoints require an authenticated user AND superadmin elevation,
// AND they must not currently be impersonating (otherwise /super access would
// leak cross-tenant data while the session thinks it's acting as the target).
superRouter.use("*", requireMerchant, requireSuperAdmin);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function periodStart(period: "7d" | "30d" | "90d"): Date {
  const now = new Date();
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

async function logAudit(params: {
  actorUserId: string;
  actorEmail: string;
  action: "impersonate_start" | "impersonate_end" | "write" | "read";
  targetMerchantId?: string;
  method?: string;
  path?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(superAdminAuditLog).values({
    actorUserId: params.actorUserId,
    actorEmail: params.actorEmail,
    action: params.action,
    targetMerchantId: params.targetMerchantId ?? null,
    method: params.method ?? null,
    path: params.path ?? null,
    metadata: (params.metadata as never) ?? null,
  });
}

// ─── POST /super/impersonate ──────────────────────────────────────────────────
// Issues a new access + refresh token scoped to the target merchant. The
// returned JWT carries impersonating:true + actor* claims so middleware can
// audit any writes performed while the caller is acting as the merchant.

const impersonateSchema = z.object({
  merchant_id: z.string().uuid("merchant_id must be a UUID"),
});

superRouter.post("/impersonate", zValidator(impersonateSchema), async (c) => {
  const body = c.get("body") as z.infer<typeof impersonateSchema>;
  const actorUserId = c.get("userId");

  // Load the actor's email — we read it from the DB (not trusted from JWT)
  // to keep the audit log honest even if JWT claims drift.
  const [actor] = await db
    .select({ email: merchantUsers.email })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, actorUserId))
    .limit(1);

  if (!actor || !isSuperAdminEmail(actor.email)) {
    return c.json({ error: "Forbidden", message: "Not eligible for impersonation" }, 403);
  }

  if (c.get("brandViewing")) {
    return c.json(
      { error: "Forbidden", message: "End brand-view before impersonating" },
      403,
    );
  }

  // Resolve target merchant + pick an owner to impersonate. We prefer the
  // canonical owner so the JWT's role matches what the merchant themselves
  // would see.
  const [merchant] = await db
    .select({ id: merchants.id, name: merchants.name, slug: merchants.slug })
    .from(merchants)
    .where(eq(merchants.id, body.merchant_id))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
  }

  const [targetUser] = await db
    .select({
      id: merchantUsers.id,
      staffId: merchantUsers.staffId,
      role: merchantUsers.role,
    })
    .from(merchantUsers)
    .where(
      and(
        eq(merchantUsers.merchantId, merchant.id),
        eq(merchantUsers.role, "owner"),
        eq(merchantUsers.isActive, true),
      ),
    )
    .limit(1);

  if (!targetUser) {
    return c.json(
      { error: "Conflict", message: "Merchant has no active owner to impersonate" },
      409,
    );
  }

  const accessToken = generateAccessToken({
    userId: targetUser.id,
    merchantId: merchant.id,
    role: targetUser.role,
    ...(targetUser.staffId ? { staffId: targetUser.staffId } : {}),
    superAdmin: true,
    impersonating: true,
    actorUserId,
    actorEmail: actor.email,
  });
  const refreshToken = generateRefreshToken({
    userId: targetUser.id,
    impersonating: true,
    actorUserId,
    actorEmail: actor.email,
  });

  await logAudit({
    actorUserId,
    actorEmail: actor.email,
    action: "impersonate_start",
    targetMerchantId: merchant.id,
    metadata: { targetUserId: targetUser.id, merchantName: merchant.name },
  });

  return c.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    merchant,
    impersonating: true,
    actorEmail: actor.email,
  });
});

// End-impersonation lives on /auth — not /super — because requireSuperAdmin
// (applied to this router) blocks impersonating sessions, which is exactly
// what an end-impersonation request is. See auth.ts for the handler.

// ─── GET /super/merchants ─────────────────────────────────────────────────────
// Cross-tenant merchant list with recent-activity stats.

const listMerchantsQuery = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

superRouter.get("/merchants", async (c) => {
  const parsed = listMerchantsQuery.safeParse({
    search: c.req.query("search"),
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  if (!parsed.success) {
    return c.json({ error: "Bad Request", message: parsed.error.message }, 400);
  }
  const { search, limit, offset } = parsed.data;

  const searchPattern = search ? `%${search}%` : null;

  const rows = await db
    .select({
      id: merchants.id,
      name: merchants.name,
      slug: merchants.slug,
      email: merchants.email,
      phone: merchants.phone,
      category: merchants.category,
      country: merchants.country,
      createdAt: merchants.createdAt,
      subscriptionTier: merchants.subscriptionTier,
      isPilot: merchants.isPilot,
      paymentGateway: merchants.paymentGateway,
      // 30-day activity
      bookings30d: sql<number>`(
        SELECT COUNT(*)::int FROM ${bookings}
        WHERE ${bookings.merchantId} = ${merchants.id}
          AND ${bookings.createdAt} > NOW() - INTERVAL '30 days'
      )`,
      revenue30d: sql<string>`(
        SELECT COALESCE(SUM(${bookings.priceSgd}), 0)::text FROM ${bookings}
        WHERE ${bookings.merchantId} = ${merchants.id}
          AND ${bookings.status} = 'completed'
          AND ${bookings.createdAt} > NOW() - INTERVAL '30 days'
      )`,
      lastBookingAt: sql<string | null>`(
        SELECT MAX(${bookings.createdAt})::text FROM ${bookings}
        WHERE ${bookings.merchantId} = ${merchants.id}
      )`,
    })
    .from(merchants)
    .where(
      searchPattern
        ? or(
            ilike(merchants.name, searchPattern),
            ilike(merchants.slug, searchPattern),
            ilike(merchants.email, searchPattern),
          )
        : undefined,
    )
    .orderBy(desc(merchants.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: count() })
    .from(merchants)
    .where(
      searchPattern
        ? or(
            ilike(merchants.name, searchPattern),
            ilike(merchants.slug, searchPattern),
            ilike(merchants.email, searchPattern),
          )
        : undefined,
    );

  await logAudit({
    actorUserId: c.get("userId"),
    actorEmail: c.get("actorEmail") ?? "",
    action: "read",
    method: "GET",
    path: "/super/merchants",
  });

  return c.json({ merchants: rows, total, limit, offset });
});

// ─── PATCH /super/merchants/:id/tier ──────────────────────────────────────────
// Host-admin tier flip. Soft gate — does not touch existing groupId or
// brandAdminGroupId rows. Logged via the existing logAudit helper using
// action: 'write' (the action enum is closed); the discriminator lives in
// metadata.subAction so audit consumers can filter on it.

const setTierSchema = z.object({
  tier: z.enum(["starter", "multibranch"]),
});

superRouter.patch("/merchants/:id/tier", zValidator(setTierSchema), async (c) => {
  const merchantId = c.req.param("id")!;
  const body = c.get("body") as z.infer<typeof setTierSchema>;
  const actorUserId = c.get("userId")!;

  const [previous] = await db
    .select({ id: merchants.id, subscriptionTier: merchants.subscriptionTier })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  if (!previous) {
    return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
  }

  const [updated] = await db
    .update(merchants)
    .set({ subscriptionTier: body.tier, updatedAt: new Date() })
    .where(eq(merchants.id, merchantId))
    .returning();

  // Resolve actor email from DB (not JWT) — keeps the audit log honest even
  // if claims drift between sessions. Mirrors the impersonate handler.
  const [actor] = await db
    .select({ email: merchantUsers.email })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, actorUserId))
    .limit(1);

  await logAudit({
    actorUserId,
    actorEmail: actor?.email ?? "unknown",
    action: "write",
    targetMerchantId: merchantId,
    method: "PATCH",
    path: `/super/merchants/${merchantId}/tier`,
    metadata: {
      subAction: "set_tier",
      previousTier: previous.subscriptionTier,
      newTier: body.tier,
    },
  });

  return c.json(updated);
});

// ─── PATCH /super/merchants/:id/gateway ──────────────────────────────────────
// Host-admin gateway flip. Routes the merchant's online payments through
// either Stripe (default) or iPay88 (preferred for MY merchants). Logged
// via logAudit using action: 'write' + metadata.subAction.

const setGatewaySchema = z.object({
  gateway: z.enum(["stripe", "ipay88"]),
});

superRouter.patch("/merchants/:id/gateway", zValidator(setGatewaySchema), async (c) => {
  const merchantId = c.req.param("id")!;
  const body = c.get("body") as z.infer<typeof setGatewaySchema>;
  const actorUserId = c.get("userId")!;

  const [previous] = await db
    .select({ id: merchants.id, paymentGateway: merchants.paymentGateway })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  if (!previous) {
    return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
  }

  const [updated] = await db
    .update(merchants)
    .set({ paymentGateway: body.gateway, updatedAt: new Date() })
    .where(eq(merchants.id, merchantId))
    .returning();

  const [actor] = await db
    .select({ email: merchantUsers.email })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, actorUserId))
    .limit(1);

  await logAudit({
    actorUserId,
    actorEmail: actor?.email ?? "unknown",
    action: "write",
    targetMerchantId: merchantId,
    method: "PATCH",
    path: `/super/merchants/${merchantId}/gateway`,
    metadata: {
      subAction: "set_gateway",
      previousGateway: previous.paymentGateway,
      newGateway: body.gateway,
    },
  });

  return c.json(updated);
});

// ─── PATCH /super/merchants/:id/pilot ─────────────────────────────────────────
// Host-admin pilot flag toggle. Drives the merchant-side "you're on pilot"
// banner. Independent of subscription_tier — pilot merchants can be on any
// tier. Logged via logAudit using action: 'write' + metadata.subAction.

const setPilotSchema = z.object({
  isPilot: z.boolean(),
});

superRouter.patch("/merchants/:id/pilot", zValidator(setPilotSchema), async (c) => {
  const merchantId = c.req.param("id")!;
  const body = c.get("body") as z.infer<typeof setPilotSchema>;
  const actorUserId = c.get("userId")!;

  const [previous] = await db
    .select({ id: merchants.id, isPilot: merchants.isPilot })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  if (!previous) {
    return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
  }

  const [updated] = await db
    .update(merchants)
    .set({ isPilot: body.isPilot, updatedAt: new Date() })
    .where(eq(merchants.id, merchantId))
    .returning();

  const [actor] = await db
    .select({ email: merchantUsers.email })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, actorUserId))
    .limit(1);

  await logAudit({
    actorUserId,
    actorEmail: actor?.email ?? "unknown",
    action: "write",
    targetMerchantId: merchantId,
    method: "PATCH",
    path: `/super/merchants/${merchantId}/pilot`,
    metadata: {
      subAction: "set_pilot",
      previousIsPilot: previous.isPilot,
      newIsPilot: body.isPilot,
    },
  });

  return c.json(updated);
});

// ─── GET /super/analytics/overview ────────────────────────────────────────────
// Cross-tenant aggregates.

const overviewQuery = z.object({
  period: z.enum(["7d", "30d", "90d"]).optional().default("30d"),
});

superRouter.get("/analytics/overview", async (c) => {
  const parsed = overviewQuery.safeParse({ period: c.req.query("period") });
  if (!parsed.success) {
    return c.json({ error: "Bad Request", message: parsed.error.message }, 400);
  }
  const since = periodStart(parsed.data.period);

  const [{ totalMerchants }] = await db
    .select({ totalMerchants: count() })
    .from(merchants);

  const [{ newMerchants }] = await db
    .select({ newMerchants: count() })
    .from(merchants)
    .where(gte(merchants.createdAt, since));

  const activeMerchantRows = await db
    .selectDistinct({ merchantId: bookings.merchantId })
    .from(bookings)
    .where(gte(bookings.createdAt, since));

  const [bookingTotals] = await db
    .select({
      total: count(),
      revenue: sum(bookings.priceSgd),
    })
    .from(bookings)
    .where(
      and(
        gte(bookings.createdAt, since),
        eq(bookings.status, "completed"),
      ),
    );

  const [{ totalClients }] = await db
    .select({ totalClients: count() })
    .from(clients);

  const [{ gbpConnected }] = await db
    .select({ gbpConnected: count() })
    .from(merchants)
    .where(sql`${merchants.gbpBookingLinkConnectedAt} IS NOT NULL`);

  return c.json({
    period: parsed.data.period,
    totalMerchants,
    activeMerchants: activeMerchantRows.length,
    newMerchants,
    totalBookings: bookingTotals?.total ?? 0,
    totalRevenue: bookingTotals?.revenue ?? "0",
    totalClients,
    gbpConnected,
  });
});

// ─── GET /super/analytics/whatsapp-funnel ─────────────────────────────────────
// Outbound sends, inbound replies, and 7-/30-day booking conversion per merchant.
//
// Math (per merchant, for the requested period):
//   outboundSent    = notification_log where channel='whatsapp' AND status='sent'
//                     AND sent_at in period
//   inboundReplies  = whatsapp_inbound_log where received_at in period
//                     (restricted to this merchant's attribution)
//   conversions7d   = distinct clients who:
//                     1. replied during the period, and
//                     2. created a booking within 7 days AFTER their earliest
//                        reply in the period
//   conversions30d  = same, 30 days

const funnelQuery = z.object({
  period: z.enum(["7d", "30d"]).optional().default("30d"),
  merchant_id: z.string().uuid().optional(),
});

interface FunnelRow {
  merchantId: string;
  merchantName: string;
  outboundSent: number;
  inboundReplies: number;
  conversions7d: number;
  conversions30d: number;
  conversionRate7d: string;
  conversionRate30d: string;
}

superRouter.get("/analytics/whatsapp-funnel", async (c) => {
  const parsed = funnelQuery.safeParse({
    period: c.req.query("period"),
    merchant_id: c.req.query("merchant_id"),
  });
  if (!parsed.success) {
    return c.json({ error: "Bad Request", message: parsed.error.message }, 400);
  }
  const since = periodStart(parsed.data.period as "7d" | "30d" | "90d");

  // Use one raw SQL aggregate — the per-merchant funnel requires a CTE-style
  // join of three tables. Keeps the hot path to a single DB round-trip.
  const result = await db.execute<{
    merchant_id: string;
    merchant_name: string;
    outbound_sent: number;
    inbound_replies: number;
    conversions_7d: number;
    conversions_30d: number;
  }>(sql`
    WITH params AS (
      SELECT ${since.toISOString()}::timestamptz AS since
    ),
    merchant_scope AS (
      SELECT id, name FROM ${merchants}
      ${parsed.data.merchant_id
        ? sql`WHERE id = ${parsed.data.merchant_id}::uuid`
        : sql``}
    ),
    outbound AS (
      SELECT ${notificationLog.merchantId} AS merchant_id, COUNT(*)::int AS n
      FROM ${notificationLog}, params
      WHERE ${notificationLog.channel} = 'whatsapp'
        AND ${notificationLog.status} = 'sent'
        AND ${notificationLog.sentAt} >= params.since
      GROUP BY ${notificationLog.merchantId}
    ),
    inbound_raw AS (
      SELECT
        ${whatsappInboundLog.merchantId} AS merchant_id,
        ${whatsappInboundLog.matchedClientId} AS client_id,
        MIN(${whatsappInboundLog.receivedAt}) AS first_reply_at
      FROM ${whatsappInboundLog}, params
      WHERE ${whatsappInboundLog.receivedAt} >= params.since
        AND ${whatsappInboundLog.merchantId} IS NOT NULL
      GROUP BY ${whatsappInboundLog.merchantId}, ${whatsappInboundLog.matchedClientId}
    ),
    inbound AS (
      SELECT merchant_id, COUNT(*)::int AS n
      FROM inbound_raw
      GROUP BY merchant_id
    ),
    inbound_clients AS (
      SELECT merchant_id, client_id, first_reply_at
      FROM inbound_raw
      WHERE client_id IS NOT NULL
    ),
    conversions_7d AS (
      SELECT ic.merchant_id, COUNT(DISTINCT ic.client_id)::int AS n
      FROM inbound_clients ic
      WHERE EXISTS (
        SELECT 1 FROM ${bookings} b
        WHERE b.client_id = ic.client_id
          AND b.merchant_id = ic.merchant_id
          AND b.created_at >= ic.first_reply_at
          AND b.created_at <= ic.first_reply_at + INTERVAL '7 days'
      )
      GROUP BY ic.merchant_id
    ),
    conversions_30d AS (
      SELECT ic.merchant_id, COUNT(DISTINCT ic.client_id)::int AS n
      FROM inbound_clients ic
      WHERE EXISTS (
        SELECT 1 FROM ${bookings} b
        WHERE b.client_id = ic.client_id
          AND b.merchant_id = ic.merchant_id
          AND b.created_at >= ic.first_reply_at
          AND b.created_at <= ic.first_reply_at + INTERVAL '30 days'
      )
      GROUP BY ic.merchant_id
    )
    SELECT
      ms.id AS merchant_id,
      ms.name AS merchant_name,
      COALESCE(o.n, 0) AS outbound_sent,
      COALESCE(i.n, 0) AS inbound_replies,
      COALESCE(c7.n, 0) AS conversions_7d,
      COALESCE(c30.n, 0) AS conversions_30d
    FROM merchant_scope ms
    LEFT JOIN outbound o ON o.merchant_id = ms.id
    LEFT JOIN inbound i ON i.merchant_id = ms.id
    LEFT JOIN conversions_7d c7 ON c7.merchant_id = ms.id
    LEFT JOIN conversions_30d c30 ON c30.merchant_id = ms.id
    WHERE COALESCE(o.n, 0) + COALESCE(i.n, 0) > 0
    ORDER BY COALESCE(o.n, 0) DESC, ms.name ASC
  `);

  const rows: FunnelRow[] = (result.rows ?? []).map((r) => {
    const rate7 = r.inbound_replies > 0 ? (r.conversions_7d / r.inbound_replies) * 100 : 0;
    const rate30 = r.inbound_replies > 0 ? (r.conversions_30d / r.inbound_replies) * 100 : 0;
    return {
      merchantId: r.merchant_id,
      merchantName: r.merchant_name,
      outboundSent: r.outbound_sent,
      inboundReplies: r.inbound_replies,
      conversions7d: r.conversions_7d,
      conversions30d: r.conversions_30d,
      conversionRate7d: rate7.toFixed(1),
      conversionRate30d: rate30.toFixed(1),
    };
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.outboundSent += r.outboundSent;
      acc.inboundReplies += r.inboundReplies;
      acc.conversions7d += r.conversions7d;
      acc.conversions30d += r.conversions30d;
      return acc;
    },
    { outboundSent: 0, inboundReplies: 0, conversions7d: 0, conversions30d: 0 },
  );

  return c.json({
    period: parsed.data.period,
    merchantId: parsed.data.merchant_id ?? null,
    totals,
    merchants: rows,
  });
});

// ─── GET /super/audit-log ─────────────────────────────────────────────────────

superRouter.get("/audit-log", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10) || 100, 500);
  const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);

  const rows = await db
    .select({
      id: superAdminAuditLog.id,
      actorUserId: superAdminAuditLog.actorUserId,
      actorEmail: superAdminAuditLog.actorEmail,
      action: superAdminAuditLog.action,
      targetMerchantId: superAdminAuditLog.targetMerchantId,
      targetMerchantName: merchants.name,
      method: superAdminAuditLog.method,
      path: superAdminAuditLog.path,
      metadata: superAdminAuditLog.metadata,
      createdAt: superAdminAuditLog.createdAt,
    })
    .from(superAdminAuditLog)
    .leftJoin(merchants, eq(superAdminAuditLog.targetMerchantId, merchants.id))
    .orderBy(desc(superAdminAuditLog.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ entries: rows, limit, offset });
});

// ─── /super/users — user account management ────────────────────────────────────
// Super admin can deactivate (reversible), reactivate, and delete (irreversible
// PII scrub) any merchant_user account. Hard DELETE is intentionally not used —
// FK references to merchant_users (audit log, booking_edits, treatment_quotes,
// booking_groups) would either cascade-orphan or block. "Delete" instead means
// permanent anonymization: scrub email/name/passwordHash and lock the row.

// Marker for "deleted" rows. We detect deleted state by email pattern instead
// of adding a deletedAt column to avoid a schema migration.
const DELETED_EMAIL_DOMAIN = "@deleted.glowos.app";
function deletedEmailFor(userId: string): string {
  return `deleted-${userId}${DELETED_EMAIL_DOMAIN}`;
}
function isDeletedEmail(email: string): boolean {
  return email.endsWith(DELETED_EMAIL_DOMAIN);
}

const listUsersQuery = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["all", "active", "inactive", "deleted"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// GET /super/users — list merchant_users with filters
superRouter.get("/users", async (c) => {
  const parsed = listUsersQuery.safeParse({
    search: c.req.query("search"),
    status: c.req.query("status"),
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  if (!parsed.success) {
    return c.json({ error: "Bad Request", message: parsed.error.message }, 400);
  }
  const { search, status, limit, offset } = parsed.data;

  const conditions = [];
  if (search) {
    const pat = `%${search}%`;
    conditions.push(or(ilike(merchantUsers.email, pat), ilike(merchantUsers.name, pat)));
  }
  if (status === "active") {
    conditions.push(eq(merchantUsers.isActive, true));
    conditions.push(sql`${merchantUsers.email} NOT LIKE ${"%" + DELETED_EMAIL_DOMAIN}`);
  } else if (status === "inactive") {
    conditions.push(eq(merchantUsers.isActive, false));
    conditions.push(sql`${merchantUsers.email} NOT LIKE ${"%" + DELETED_EMAIL_DOMAIN}`);
  } else if (status === "deleted") {
    conditions.push(sql`${merchantUsers.email} LIKE ${"%" + DELETED_EMAIL_DOMAIN}`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: merchantUsers.id,
      name: merchantUsers.name,
      email: merchantUsers.email,
      role: merchantUsers.role,
      isActive: merchantUsers.isActive,
      brandAdminGroupId: merchantUsers.brandAdminGroupId,
      lastLoginAt: merchantUsers.lastLoginAt,
      createdAt: merchantUsers.createdAt,
      merchantId: merchantUsers.merchantId,
      merchantName: merchants.name,
    })
    .from(merchantUsers)
    .leftJoin(merchants, eq(merchantUsers.merchantId, merchants.id))
    .where(whereClause)
    .orderBy(desc(merchantUsers.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: count() })
    .from(merchantUsers)
    .where(whereClause);

  const callerUserId = c.get("userId");

  await logAudit({
    actorUserId: callerUserId,
    actorEmail: c.get("actorEmail") ?? "",
    action: "read",
    method: "GET",
    path: "/super/users",
  });

  return c.json({
    users: rows.map((r) => ({
      ...r,
      isSelf: r.id === callerUserId,
      isSuperAdmin: isSuperAdminEmail(r.email),
      isDeleted: isDeletedEmail(r.email),
    })),
    total,
    limit,
    offset,
  });
});

// Shared self-protection check
function rejectIfSelf(callerUserId: string | undefined, targetUserId: string) {
  return callerUserId === targetUserId;
}

// PATCH /super/users/:id/deactivate
superRouter.patch("/users/:id/deactivate", async (c) => {
  const callerUserId = c.get("userId")!;
  const targetId = c.req.param("id")!;
  if (rejectIfSelf(callerUserId, targetId)) {
    return c.json(
      { error: "Forbidden", message: "Cannot deactivate yourself" },
      403,
    );
  }
  const [target] = await db
    .select({ id: merchantUsers.id, email: merchantUsers.email, isActive: merchantUsers.isActive })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, targetId))
    .limit(1);
  if (!target) {
    return c.json({ error: "Not Found", message: "User not found" }, 404);
  }
  if (isDeletedEmail(target.email)) {
    return c.json(
      { error: "Conflict", message: "Cannot modify a deleted account" },
      409,
    );
  }
  if (!target.isActive) {
    return c.json({ user: { id: target.id, isActive: false } });
  }
  await db
    .update(merchantUsers)
    .set({ isActive: false })
    .where(eq(merchantUsers.id, targetId));
  await logAudit({
    actorUserId: callerUserId,
    actorEmail: c.get("actorEmail") ?? "",
    action: "write",
    method: "PATCH",
    path: `/super/users/${targetId}/deactivate`,
    metadata: { subAction: "deactivate_user", targetUserId: targetId, targetEmail: target.email },
  });
  return c.json({ user: { id: target.id, isActive: false } });
});

// PATCH /super/users/:id/reactivate
superRouter.patch("/users/:id/reactivate", async (c) => {
  const callerUserId = c.get("userId")!;
  const targetId = c.req.param("id")!;
  const [target] = await db
    .select({ id: merchantUsers.id, email: merchantUsers.email, isActive: merchantUsers.isActive })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, targetId))
    .limit(1);
  if (!target) {
    return c.json({ error: "Not Found", message: "User not found" }, 404);
  }
  if (isDeletedEmail(target.email)) {
    return c.json(
      { error: "Conflict", message: "Cannot reactivate a deleted account" },
      409,
    );
  }
  if (target.isActive) {
    return c.json({ user: { id: target.id, isActive: true } });
  }
  await db
    .update(merchantUsers)
    .set({ isActive: true })
    .where(eq(merchantUsers.id, targetId));
  await logAudit({
    actorUserId: callerUserId,
    actorEmail: c.get("actorEmail") ?? "",
    action: "write",
    method: "PATCH",
    path: `/super/users/${targetId}/reactivate`,
    metadata: { subAction: "reactivate_user", targetUserId: targetId, targetEmail: target.email },
  });
  return c.json({ user: { id: target.id, isActive: true } });
});

// DELETE /super/users/:id — irreversible PII scrub. Email is replaced with a
// deleted-{uuid}@deleted.glowos.app sentinel; name → "[deleted]";
// passwordHash → bcrypt of an unguessable random string; isActive → false;
// staffId / brandAdminGroupId cleared. Row is preserved so FK references
// (audit logs, booking edits) stay intact.
superRouter.delete("/users/:id", async (c) => {
  const callerUserId = c.get("userId")!;
  const targetId = c.req.param("id")!;
  if (rejectIfSelf(callerUserId, targetId)) {
    return c.json({ error: "Forbidden", message: "Cannot delete yourself" }, 403);
  }
  const [target] = await db
    .select({ id: merchantUsers.id, email: merchantUsers.email })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, targetId))
    .limit(1);
  if (!target) {
    return c.json({ error: "Not Found", message: "User not found" }, 404);
  }
  if (isDeletedEmail(target.email)) {
    return c.json({ user: { id: target.id, isDeleted: true } });
  }

  const newEmail = deletedEmailFor(targetId);
  const passwordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);

  await db
    .update(merchantUsers)
    .set({
      email: newEmail,
      name: "[deleted]",
      passwordHash,
      isActive: false,
      staffId: null,
      brandAdminGroupId: null,
    })
    .where(eq(merchantUsers.id, targetId));

  await logAudit({
    actorUserId: callerUserId,
    actorEmail: c.get("actorEmail") ?? "",
    action: "write",
    method: "DELETE",
    path: `/super/users/${targetId}`,
    metadata: {
      subAction: "delete_user",
      targetUserId: targetId,
      originalEmail: target.email, // recorded in audit log only — not on the row anymore
    },
  });

  return c.json({ user: { id: target.id, isDeleted: true } });
});

export { superRouter };

import { Hono } from "hono";
import { eq, and, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db, merchants, merchantUsers, groups, clinicalRecordAccessLog, clients } from "@glowos/db";
import { requireMerchant, requireRole } from "../middleware/auth.js";
import { generateAccessToken, generateRefreshToken } from "../lib/jwt.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";

const merchantRouter = new Hono<{ Variables: AppVariables }>();

// ─── Schema ────────────────────────────────────────────────────────────────────

const updateMerchantSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  postalCode: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  category: z
    .enum(["hair_salon", "nail_studio", "spa", "massage", "beauty_centre", "restaurant", "beauty_clinic", "medical_clinic", "other"])
    .optional(),
  timezone: z.string().optional(),
  logoUrl: z.string().url().optional().or(z.literal("")),
  coverPhotoUrl: z.string().url().optional().or(z.literal("")),
  operatingHours: z.record(
    z.string(),
    z.object({
      open: z.string(),
      close: z.string(),
      closed: z.boolean(),
    })
  ).optional(),
  // Lets the merchant flip between Stripe and iPay88 from the onboarding
  // wizard before any credentials are entered. Actual credentials still come
  // through /merchant/payments/ipay88/connect or /payments/connect-account.
  paymentGateway: z.enum(["stripe", "ipay88"]).optional(),
});

const upgradeToBrandSchema = z.object({
  groupName: z.string().trim().min(1).max(255),
}).strict();

// ─── GET /merchant/me ──────────────────────────────────────────────────────────

merchantRouter.get("/me", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;

  const [merchant] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
  }

  return c.json({ merchant });
});

// ─── PUT /merchant/me ──────────────────────────────────────────────────────────

merchantRouter.put(
  "/me",
  requireMerchant,
  requireRole("owner"),
  zValidator(updateMerchantSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const body = c.get("body") as z.infer<typeof updateMerchantSchema>;

    if (Object.keys(body).length === 0) {
      return c.json({ error: "Bad Request", message: "No fields provided to update" }, 400);
    }

    const [updated] = await db
      .update(merchants)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(merchants.id, merchantId))
      .returning();

    if (!updated) {
      return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
    }

    return c.json({ merchant: updated });
  }
);

// ─── PUT /merchant/settings/cancellation-policy ───────────────────────────────

const cancellationPolicySchema = z.object({
  free_cancellation_hours: z.number().int().min(0),
  late_cancellation_refund_pct: z.number().int().min(0).max(100),
  no_show_charge: z.enum(["full", "partial", "none"]),
});

merchantRouter.put(
  "/settings/cancellation-policy",
  requireMerchant,
  requireRole("owner"),
  zValidator(cancellationPolicySchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const body = c.get("body") as z.infer<typeof cancellationPolicySchema>;

    const [updated] = await db
      .update(merchants)
      .set({ cancellationPolicy: body, updatedAt: new Date() })
      .where(eq(merchants.id, merchantId))
      .returning();

    if (!updated) {
      return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
    }

    return c.json({ cancellation_policy: updated.cancellationPolicy });
  }
);

// ─── POST /merchant/onboarding/complete ───────────────────────────────────────

merchantRouter.post(
  "/onboarding/complete",
  requireMerchant,
  requireRole("owner"),
  async (c) => {
    const merchantId = c.get("merchantId")!;

    const [updated] = await db
      .update(merchants)
      .set({ subscriptionStatus: "active", updatedAt: new Date() })
      .where(eq(merchants.id, merchantId))
      .returning();

    if (!updated) {
      return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
    }

    return c.json({
      success: true,
      message: "Onboarding complete. Subscription is now active.",
      merchant: updated,
    });
  }
);

// ─── PATCH /merchant/google-booking-link/connected ────────────────────────────
// Self-serve toggle for the merchant to confirm they've pasted their public
// booking URL into their Google Business Profile's Booking link field.
// Powers the /super GBP-adoption stat. Stored as a timestamp rather than a
// boolean so the /super card can show recency / mark stale connections.

const gbpConnectedSchema = z.object({
  connected: z.boolean(),
});

merchantRouter.patch(
  "/google-booking-link/connected",
  requireMerchant,
  requireRole("owner", "manager"),
  zValidator(gbpConnectedSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const body = c.get("body") as z.infer<typeof gbpConnectedSchema>;

    const [updated] = await db
      .update(merchants)
      .set({
        gbpBookingLinkConnectedAt: body.connected ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(merchants.id, merchantId))
      .returning({
        id: merchants.id,
        gbpBookingLinkConnectedAt: merchants.gbpBookingLinkConnectedAt,
      });

    if (!updated) {
      return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
    }

    return c.json({
      gbp_booking_link_connected_at: updated.gbpBookingLinkConnectedAt,
    });
  },
);

// ─── POST /merchant/upgrade-to-brand ───────────────────────────────────────────
// Self-upgrade: an owner-role merchant_user creates a new group with their
// existing merchant as the first branch and grants themselves brand-admin
// authority. Re-issues tokens so the upgrade takes effect without a logout.
//
// Refuses to run for managers/staff (frontend gates anyway, but the API is
// authoritative), for users who already hold brandAdminGroupId, for merchants
// already in a group, and for impersonating sessions.
merchantRouter.post(
  "/upgrade-to-brand",
  requireMerchant,
  requireRole("owner"),
  zValidator(upgradeToBrandSchema),
  async (c) => {
    const userId = c.get("userId")!;
    const merchantId = c.get("merchantId")!;
    const body = c.get("body") as z.infer<typeof upgradeToBrandSchema>;

    if (c.get("impersonating")) {
      return c.json(
        { error: "Forbidden", message: "End impersonation before upgrading" },
        403,
      );
    }

    // Plan gate — `starter` is the only tier that blocks multi-branch
    // features. Any non-starter tier (multibranch, professional, future paid
    // tiers) passes. Read the tier outside the transaction so we can
    // short-circuit cheaply. Treat a missing merchant as starter-equivalent
    // (default-deny) — the in-tx merchant lookup will surface a clearer
    // 4xx if needed.
    const [tierRow] = await db
      .select({ tier: merchants.subscriptionTier })
      .from(merchants)
      .where(eq(merchants.id, merchantId))
      .limit(1);

    if (!tierRow || tierRow.tier === "starter") {
      return c.json(
        {
          error: "Forbidden",
          message: "Contact support to enable multi-branch on your plan",
        },
        403,
      );
    }

    const result = await db.transaction(async (tx) => {
      const [user] = await tx
        .select({
          id: merchantUsers.id,
          email: merchantUsers.email,
          name: merchantUsers.name,
          role: merchantUsers.role,
          staffId: merchantUsers.staffId,
          brandAdminGroupId: merchantUsers.brandAdminGroupId,
          merchantId: merchantUsers.merchantId,
          isActive: merchantUsers.isActive,
        })
        .from(merchantUsers)
        .where(eq(merchantUsers.id, userId))
        .limit(1);

      if (!user || !user.isActive) {
        return { error: "user_inactive" as const };
      }
      if (user.brandAdminGroupId) {
        return { error: "already_brand_admin" as const };
      }

      const [merchant] = await tx
        .select()
        .from(merchants)
        .where(eq(merchants.id, merchantId))
        .limit(1);

      if (!merchant) {
        return { error: "merchant_missing" as const };
      }
      if (merchant.groupId) {
        return { error: "merchant_in_group" as const };
      }

      const [newGroup] = await tx
        .insert(groups)
        .values({ name: body.groupName })
        .returning({ id: groups.id, name: groups.name });

      await tx
        .update(merchants)
        .set({ groupId: newGroup.id, updatedAt: new Date() })
        .where(eq(merchants.id, merchantId));

      await tx
        .update(merchantUsers)
        .set({ brandAdminGroupId: newGroup.id })
        .where(eq(merchantUsers.id, userId));

      return {
        ok: true as const,
        user,
        merchant: { ...merchant, groupId: newGroup.id },
        group: newGroup,
      };
    });

    if ("error" in result) {
      switch (result.error) {
        case "user_inactive":
          return c.json({ error: "Unauthorized", message: "Account inactive" }, 401);
        case "already_brand_admin":
          return c.json(
            { error: "Conflict", message: "You are already a brand admin" },
            409,
          );
        case "merchant_in_group":
          return c.json(
            {
              error: "Conflict",
              message:
                "This branch is already part of a group. Contact support to merge or transfer.",
            },
            409,
          );
        case "merchant_missing":
          return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
      }
    }

    const { user, merchant, group } = result;

    const accessToken = generateAccessToken({
      userId: user.id,
      merchantId: user.merchantId,
      role: user.role,
      ...(user.staffId ? { staffId: user.staffId } : {}),
      brandAdminGroupId: group.id,
    });
    const refreshToken = generateRefreshToken({
      userId: user.id,
      brandAdminGroupId: group.id,
    });

    return c.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      user: { ...user, brandAdminGroupId: group.id },
      merchant,
      group,
    });
  },
);

// ─── GET /merchant/audit-log/export ───────────────────────────────────────────
// PDPA inspection-ready CSV export of clinical_record_access_log events.
// Owner/manager only. Date range defaults to the last 30 days if not supplied.
// Does NOT log to the access log itself (would be circular noise).

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

merchantRouter.get("/audit-log/export", requireMerchant, async (c) => {
  const role = c.get("userRole");
  if (role !== "owner" && role !== "manager") {
    return c.json({ error: "Forbidden", message: "Owner or manager only" }, 403);
  }

  const merchantId = c.get("merchantId")!;
  const fromStr = c.req.query("from");
  const toStr = c.req.query("to");
  const format = c.req.query("format") ?? "csv";

  if (format !== "csv") {
    return c.json({ error: "Bad Request", message: "Only csv supported" }, 400);
  }

  // Default: last 30 days.
  const toDate = toStr ? new Date(`${toStr}T23:59:59Z`) : new Date();
  const fromDate = fromStr
    ? new Date(`${fromStr}T00:00:00Z`)
    : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return c.json({ error: "Bad Request", message: "Invalid date format; use YYYY-MM-DD" }, 400);
  }

  // Build filter conditions.
  const conditions = [
    eq(clinicalRecordAccessLog.merchantId, merchantId),
    gte(clinicalRecordAccessLog.createdAt, fromDate),
    lte(clinicalRecordAccessLog.createdAt, toDate),
  ];

  // Join with clients to get client name.
  const entries = await db
    .select({
      createdAt: clinicalRecordAccessLog.createdAt,
      userEmail: clinicalRecordAccessLog.userEmail,
      action: clinicalRecordAccessLog.action,
      recordId: clinicalRecordAccessLog.recordId,
      clientId: clinicalRecordAccessLog.clientId,
      ipAddress: clinicalRecordAccessLog.ipAddress,
      clientName: clients.name,
    })
    .from(clinicalRecordAccessLog)
    .leftJoin(clients, eq(clinicalRecordAccessLog.clientId, clients.id))
    .where(and(...conditions))
    .orderBy(clinicalRecordAccessLog.createdAt);

  const header = ["timestamp", "user_email", "action", "record_id", "client_id", "client_name", "ip_address"];
  const rows = entries.map((e) =>
    [
      e.createdAt.toISOString(),
      e.userEmail,
      e.action,
      e.recordId,
      e.clientId,
      e.clientName ?? "",
      e.ipAddress ?? "",
    ]
      .map(csvEscape)
      .join(","),
  );
  const csv = [header.join(","), ...rows].join("\n");

  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header(
    "Content-Disposition",
    `attachment; filename="audit-log-${merchantId}-${fromStr ?? "all"}-to-${toStr ?? "now"}.csv"`,
  );
  return c.body(csv);
});

export { merchantRouter };

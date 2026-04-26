import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, merchants, merchantUsers, groups } from "@glowos/db";
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

export { merchantRouter };

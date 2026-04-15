import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, merchants } from "@glowos/db";
import { requireMerchant, requireRole } from "../middleware/auth.js";
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
});

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

export { merchantRouter };

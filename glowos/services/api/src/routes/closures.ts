import { Hono } from "hono";
import { and, eq, gte, lte, asc } from "drizzle-orm";
import { z } from "zod";
import { db, merchantClosures } from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import { invalidateAvailabilityCacheByMerchantId } from "../lib/availability.js";
import type { AppVariables } from "../lib/types.js";

const closuresRouter = new Hono<{ Variables: AppVariables }>();

// ─── Schemas ───────────────────────────────────────────────────────────────────

const createClosureSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
  title: z.string().min(1, "Title is required").max(255),
  is_full_day: z.boolean().default(true),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Start time must be HH:MM")
    .optional(),
  end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "End time must be HH:MM")
    .optional(),
  notes: z.string().max(1000).optional(),
});

const updateClosureSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
    .optional(),
  title: z.string().min(1).max(255).optional(),
  is_full_day: z.boolean().optional(),
  start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Start time must be HH:MM")
    .nullable()
    .optional(),
  end_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "End time must be HH:MM")
    .nullable()
    .optional(),
  notes: z.string().max(1000).nullable().optional(),
});

// ─── GET /merchant/closures ──────────────────────────────────────────────────
// List closures, optionally filtered by date range

closuresRouter.get("/", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const from = c.req.query("from");
  const to = c.req.query("to");

  const conditions = [eq(merchantClosures.merchantId, merchantId)];

  if (from) conditions.push(gte(merchantClosures.date, from));
  if (to) conditions.push(lte(merchantClosures.date, to));

  const rows = await db
    .select()
    .from(merchantClosures)
    .where(and(...conditions))
    .orderBy(asc(merchantClosures.date));

  return c.json({ closures: rows });
});

// ─── POST /merchant/closures ─────────────────────────────────────────────────

closuresRouter.post(
  "/",
  requireMerchant,
  zValidator(createClosureSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const body = c.get("body") as z.infer<typeof createClosureSchema>;

    // Validate partial-day closures have times
    if (!body.is_full_day && (!body.start_time || !body.end_time)) {
      return c.json(
        {
          error: "Bad Request",
          message:
            "Partial-day closures require both start_time and end_time",
        },
        400
      );
    }

    const [closure] = await db
      .insert(merchantClosures)
      .values({
        merchantId,
        date: body.date,
        title: body.title,
        isFullDay: body.is_full_day,
        startTime: body.is_full_day ? null : body.start_time,
        endTime: body.is_full_day ? null : body.end_time,
        notes: body.notes,
      })
      .returning();

    if (!closure) {
      return c.json(
        { error: "Internal Server Error", message: "Failed to create closure" },
        500
      );
    }

    await invalidateAvailabilityCacheByMerchantId(merchantId);

    return c.json({ closure }, 201);
  }
);

// ─── POST /merchant/closures/bulk ────────────────────────────────────────────
// Create multiple closures at once (e.g. multi-day holiday)

const bulkCreateSchema = z.object({
  closures: z
    .array(
      z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
        title: z.string().min(1).max(255),
        is_full_day: z.boolean().default(true),
        start_time: z.string().optional(),
        end_time: z.string().optional(),
        notes: z.string().max(1000).optional(),
      })
    )
    .min(1, "At least one closure required")
    .max(60, "Maximum 60 closures per batch"),
});

closuresRouter.post(
  "/bulk",
  requireMerchant,
  zValidator(bulkCreateSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const body = c.get("body") as z.infer<typeof bulkCreateSchema>;

    const rows = await db
      .insert(merchantClosures)
      .values(
        body.closures.map((cl) => ({
          merchantId,
          date: cl.date,
          title: cl.title,
          isFullDay: cl.is_full_day,
          startTime: cl.is_full_day ? null : cl.start_time,
          endTime: cl.is_full_day ? null : cl.end_time,
          notes: cl.notes,
        }))
      )
      .returning();

    await invalidateAvailabilityCacheByMerchantId(merchantId);

    return c.json({ closures: rows, count: rows.length }, 201);
  }
);

// ─── PATCH /merchant/closures/:id ────────────────────────────────────────────

closuresRouter.patch(
  "/:id",
  requireMerchant,
  zValidator(updateClosureSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const closureId = c.req.param("id")!;
    const body = c.get("body") as z.infer<typeof updateClosureSchema>;

    // Verify ownership
    const [existing] = await db
      .select({ id: merchantClosures.id })
      .from(merchantClosures)
      .where(
        and(
          eq(merchantClosures.id, closureId),
          eq(merchantClosures.merchantId, merchantId)
        )
      )
      .limit(1);

    if (!existing) {
      return c.json(
        { error: "Not Found", message: "Closure not found" },
        404
      );
    }

    const updateData: Record<string, unknown> = {};
    if (body.date !== undefined) updateData.date = body.date;
    if (body.title !== undefined) updateData.title = body.title;
    if (body.is_full_day !== undefined) {
      updateData.isFullDay = body.is_full_day;
      if (body.is_full_day) {
        updateData.startTime = null;
        updateData.endTime = null;
      }
    }
    if (body.start_time !== undefined) updateData.startTime = body.start_time;
    if (body.end_time !== undefined) updateData.endTime = body.end_time;
    if (body.notes !== undefined) updateData.notes = body.notes;

    const [updated] = await db
      .update(merchantClosures)
      .set(updateData)
      .where(
        and(
          eq(merchantClosures.id, closureId),
          eq(merchantClosures.merchantId, merchantId)
        )
      )
      .returning();

    await invalidateAvailabilityCacheByMerchantId(merchantId);

    return c.json({ closure: updated });
  }
);

// ─── DELETE /merchant/closures/:id ───────────────────────────────────────────

closuresRouter.delete("/:id", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const closureId = c.req.param("id")!;

  const [existing] = await db
    .select({ id: merchantClosures.id })
    .from(merchantClosures)
    .where(
      and(
        eq(merchantClosures.id, closureId),
        eq(merchantClosures.merchantId, merchantId)
      )
    )
    .limit(1);

  if (!existing) {
    return c.json(
      { error: "Not Found", message: "Closure not found" },
      404
    );
  }

  await db
    .delete(merchantClosures)
    .where(eq(merchantClosures.id, closureId));

  await invalidateAvailabilityCacheByMerchantId(merchantId);

  return c.json({ success: true, message: "Closure deleted" });
});

// ─── Public: GET /booking/:slug/closures ─────────────────────────────────────
// Used by the booking widget to grey out closed dates

export const publicClosuresRouter = new Hono<{ Variables: AppVariables }>();

import { merchants } from "@glowos/db";

publicClosuresRouter.get("/:slug/closures", async (c) => {
  const slug = c.req.param("slug")!;

  const [merchant] = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Not Found", message: "Business not found" }, 404);
  }

  // Return closures for the next 60 days
  const today = new Date().toISOString().slice(0, 10);
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 60);
  const futureDateStr = futureDate.toISOString().slice(0, 10);

  const rows = await db
    .select({
      date: merchantClosures.date,
      title: merchantClosures.title,
      isFullDay: merchantClosures.isFullDay,
      startTime: merchantClosures.startTime,
      endTime: merchantClosures.endTime,
    })
    .from(merchantClosures)
    .where(
      and(
        eq(merchantClosures.merchantId, merchant.id),
        gte(merchantClosures.date, today),
        lte(merchantClosures.date, futureDateStr)
      )
    )
    .orderBy(asc(merchantClosures.date));

  return c.json({ closures: rows });
});

export { closuresRouter };

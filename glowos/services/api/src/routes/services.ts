import { Hono } from "hono";
import { and, eq, asc } from "drizzle-orm";
import { z } from "zod";
import { db, services, consultOutcomes, bookings } from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import { invalidateAvailabilityCacheByMerchantId } from "../lib/availability.js";
import type { AppVariables } from "../lib/types.js";

const servicesRouter = new Hono<{ Variables: AppVariables }>();

// ─── Schemas ───────────────────────────────────────────────────────────────────

const createServiceSchema = z.object({
  name: z.string().min(1, "Service name is required"),
  description: z.string().min(1, "Description is required"),
  category: z.enum(["hair", "nails", "face", "body", "massage", "other"], {
    errorMap: () => ({
      message: "Category must be one of: hair, nails, face, body, massage, other",
    }),
  }),
  duration_minutes: z
    .number()
    .int("Duration must be a whole number")
    .positive("Duration must be positive"),
  buffer_minutes: z.number().int().min(0).optional().default(0),
  price_sgd: z.number().positive("Price must be positive"),
  display_order: z.number().int().min(0).optional().default(0),
  slot_type: z.enum(["standard", "consult", "treatment"]).optional().default("standard"),
  requires_consult_first: z.boolean().optional().default(false),
  consult_service_id: z.string().uuid().nullable().optional(),
});

const updateServiceSchema = createServiceSchema.partial();

// ─── GET /merchant/services ────────────────────────────────────────────────────

servicesRouter.get("/", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const activeParam = c.req.query("active");

  const conditions = [eq(services.merchantId, merchantId)];
  if (activeParam === "true") {
    conditions.push(eq(services.isActive, true));
  }

  const rows = await db
    .select()
    .from(services)
    .where(and(...conditions))
    .orderBy(asc(services.displayOrder));

  return c.json({ services: rows });
});

// ─── POST /merchant/services ───────────────────────────────────────────────────

servicesRouter.post("/", requireMerchant, zValidator(createServiceSchema), async (c) => {
  const merchantId = c.get("merchantId")!;
  const body = c.get("body") as z.infer<typeof createServiceSchema>;

  const [created] = await db
    .insert(services)
    .values({
      merchantId,
      name: body.name,
      description: body.description,
      category: body.category,
      durationMinutes: body.duration_minutes,
      bufferMinutes: body.buffer_minutes,
      priceSgd: String(body.price_sgd),
      displayOrder: body.display_order,
      slotType: body.slot_type,
      requiresConsultFirst: body.requires_consult_first,
      consultServiceId: body.consult_service_id ?? null,
    })
    .returning();

  if (!created) {
    return c.json({ error: "Internal Server Error", message: "Failed to create service" }, 500);
  }

  return c.json({ service: created }, 201);
});

// ─── PUT /merchant/services/:id ────────────────────────────────────────────────

servicesRouter.put("/:id", requireMerchant, zValidator(updateServiceSchema), async (c) => {
  const merchantId = c.get("merchantId")!;
  const serviceId = c.req.param("id")!;
  const body = c.get("body") as z.infer<typeof updateServiceSchema>;

  // Verify the service belongs to this merchant
  const [existing] = await db
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Not Found", message: "Service not found" }, 404);
  }

  const updateData: Partial<typeof services.$inferInsert> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.category !== undefined) updateData.category = body.category;
  if (body.duration_minutes !== undefined) updateData.durationMinutes = body.duration_minutes;
  if (body.buffer_minutes !== undefined) updateData.bufferMinutes = body.buffer_minutes;
  if (body.price_sgd !== undefined) updateData.priceSgd = String(body.price_sgd);
  if (body.display_order !== undefined) updateData.displayOrder = body.display_order;
  if (body.slot_type !== undefined) updateData.slotType = body.slot_type;
  if (body.requires_consult_first !== undefined) updateData.requiresConsultFirst = body.requires_consult_first;
  if (body.consult_service_id !== undefined) updateData.consultServiceId = body.consult_service_id;

  if (Object.keys(updateData).length === 0) {
    return c.json({ error: "Bad Request", message: "No fields provided to update" }, 400);
  }

  const [updated] = await db
    .update(services)
    .set(updateData)
    .where(and(eq(services.id, serviceId), eq(services.merchantId, merchantId)))
    .returning();

  await invalidateAvailabilityCacheByMerchantId(merchantId);

  return c.json({ service: updated });
});

// ─── DELETE /merchant/services/:id ────────────────────────────────────────────

servicesRouter.delete("/:id", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const serviceId = c.req.param("id")!;

  const [existing] = await db
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Not Found", message: "Service not found" }, 404);
  }

  await db
    .update(services)
    .set({ isActive: false })
    .where(and(eq(services.id, serviceId), eq(services.merchantId, merchantId)));

  await invalidateAvailabilityCacheByMerchantId(merchantId);

  return c.json({ success: true, message: "Service deactivated" });
});

// ─── Schemas for consult outcomes ─────────────────────────────────────────────

const consultOutcomeSchema = z.object({
  booking_id: z.string().uuid(),
  recommended_service_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).optional(),
  follow_up_booking_id: z.string().uuid().nullable().optional(),
});

// ─── POST /merchant/services/consult-outcomes ──────────────────────────────────

servicesRouter.post("/consult-outcomes", requireMerchant, zValidator(consultOutcomeSchema), async (c) => {
  const merchantId = c.get("merchantId")!;
  const body = c.get("body") as z.infer<typeof consultOutcomeSchema>;

  // Fix 1: Verify the booking belongs to the authenticated merchant
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.id, body.booking_id), eq(bookings.merchantId, merchantId)))
    .limit(1);

  if (!booking) {
    return c.json({ error: "Booking not found" }, 404);
  }

  // Fix 3: Prevent duplicate outcome records
  const [existingOutcome] = await db
    .select({ id: consultOutcomes.id })
    .from(consultOutcomes)
    .where(eq(consultOutcomes.bookingId, body.booking_id))
    .limit(1);

  if (existingOutcome) {
    return c.json({ error: "An outcome already exists for this booking" }, 409);
  }

  const [outcome] = await db
    .insert(consultOutcomes)
    .values({
      bookingId: body.booking_id,
      recommendedServiceId: body.recommended_service_id ?? null,
      notes: body.notes ?? null,
      followUpBookingId: body.follow_up_booking_id ?? null,
      createdByStaffId: null,
    })
    .returning();

  return c.json({ outcome }, 201);
});

// ─── GET /merchant/services/consult-outcomes/:bookingId ────────────────────────

servicesRouter.get("/consult-outcomes/:bookingId", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const bookingId = c.req.param("bookingId")!;

  // Fix 2: Verify the booking belongs to the authenticated merchant
  const [booking] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .limit(1);

  if (!booking) {
    return c.json({ error: "Booking not found" }, 404);
  }

  const [outcome] = await db
    .select()
    .from(consultOutcomes)
    .where(eq(consultOutcomes.bookingId, bookingId))
    .limit(1);

  if (!outcome) {
    return c.json({ error: "No outcome found" }, 404);
  }

  return c.json({ outcome });
});

export { servicesRouter };

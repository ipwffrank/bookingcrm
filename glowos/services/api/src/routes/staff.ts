import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, staff, staffServices, staffHours } from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import { invalidateAvailabilityCacheByMerchantId } from "../lib/availability.js";
import type { AppVariables } from "../lib/types.js";

const staffRouter = new Hono<{ Variables: AppVariables }>();

// ─── Schemas ───────────────────────────────────────────────────────────────────

const workingHoursSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "start_time must be HH:MM"),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, "end_time must be HH:MM"),
  is_working: z.boolean(),
});

const createStaffSchema = z.object({
  name: z.string().min(1, "Staff name is required"),
  title: z.string().optional(),
  photo_url: z.string().url().optional(),
  is_any_available: z.boolean().optional().default(false),
  service_ids: z.array(z.string().uuid()).optional().default([]),
  working_hours: z.array(workingHoursSchema).optional().default([]),
});

const updateStaffSchema = createStaffSchema.partial();

const updateProfileSchema = z.object({
  bio: z.string().max(1000).optional(),
  specialty_tags: z.array(z.string().max(50)).max(10).optional(),
  credentials: z.string().max(500).optional(),
  is_publicly_visible: z.boolean().optional(),
});

// ─── GET /merchant/staff ───────────────────────────────────────────────────────

staffRouter.get("/", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId");

  const staffList = await db
    .select()
    .from(staff)
    .where(eq(staff.merchantId, merchantId));

  if (staffList.length === 0) {
    return c.json({ staff: [] });
  }

  const staffIds = staffList.map((s) => s.id);

  const serviceAssignments = await db
    .select({ staffId: staffServices.staffId, serviceId: staffServices.serviceId })
    .from(staffServices)
    .where(inArray(staffServices.staffId, staffIds));

  // Build a map of staff_id -> service_ids
  const serviceMap = new Map<string, string[]>();
  for (const assignment of serviceAssignments) {
    const existing = serviceMap.get(assignment.staffId) ?? [];
    existing.push(assignment.serviceId);
    serviceMap.set(assignment.staffId, existing);
  }

  const result = staffList.map((s) => ({
    ...s,
    service_ids: serviceMap.get(s.id) ?? [],
  }));

  return c.json({ staff: result });
});

// ─── POST /merchant/staff ──────────────────────────────────────────────────────

staffRouter.post("/", requireMerchant, zValidator(createStaffSchema), async (c) => {
  const merchantId = c.get("merchantId");
  const body = c.get("body") as z.infer<typeof createStaffSchema>;

  // Create staff record
  const [created] = await db
    .insert(staff)
    .values({
      merchantId,
      name: body.name,
      title: body.title,
      photoUrl: body.photo_url,
      isAnyAvailable: body.is_any_available,
    })
    .returning();

  if (!created) {
    return c.json({ error: "Internal Server Error", message: "Failed to create staff member" }, 500);
  }

  // Create staff_services entries
  if (body.service_ids.length > 0) {
    await db.insert(staffServices).values(
      body.service_ids.map((serviceId) => ({
        staffId: created.id,
        serviceId,
      }))
    );
  }

  // Create staff_hours entries
  if (body.working_hours.length > 0) {
    await db.insert(staffHours).values(
      body.working_hours.map((wh) => ({
        staffId: created.id,
        dayOfWeek: wh.day_of_week,
        startTime: wh.start_time,
        endTime: wh.end_time,
        isWorking: wh.is_working,
      }))
    );
  }

  return c.json(
    {
      staff: {
        ...created,
        service_ids: body.service_ids,
        working_hours: body.working_hours,
      },
    },
    201
  );
});

// ─── PUT /merchant/staff/:id ───────────────────────────────────────────────────

staffRouter.put("/:id", requireMerchant, zValidator(updateStaffSchema), async (c) => {
  const merchantId = c.get("merchantId");
  const staffId = c.req.param("id")!;
  const body = c.get("body") as z.infer<typeof updateStaffSchema>;

  // Verify ownership
  const [existing] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.id, staffId), eq(staff.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Not Found", message: "Staff member not found" }, 404);
  }

  // Update staff fields
  const updateData: Partial<typeof staff.$inferInsert> = {};
  if (body.name !== undefined) updateData.name = body.name;
  if (body.title !== undefined) updateData.title = body.title;
  if (body.photo_url !== undefined) updateData.photoUrl = body.photo_url;
  if (body.is_any_available !== undefined) updateData.isAnyAvailable = body.is_any_available;

  if (Object.keys(updateData).length > 0) {
    await db
      .update(staff)
      .set(updateData)
      .where(and(eq(staff.id, staffId), eq(staff.merchantId, merchantId)));
  }

  // Sync service assignments if provided
  if (body.service_ids !== undefined) {
    await db.delete(staffServices).where(eq(staffServices.staffId, staffId));
    if (body.service_ids.length > 0) {
      await db.insert(staffServices).values(
        body.service_ids.map((serviceId) => ({
          staffId,
          serviceId,
        }))
      );
    }
  }

  // Sync working hours if provided
  if (body.working_hours !== undefined) {
    await db.delete(staffHours).where(eq(staffHours.staffId, staffId));
    if (body.working_hours.length > 0) {
      await db.insert(staffHours).values(
        body.working_hours.map((wh) => ({
          staffId,
          dayOfWeek: wh.day_of_week,
          startTime: wh.start_time,
          endTime: wh.end_time,
          isWorking: wh.is_working,
        }))
      );
    }
  }

  // Reload updated record
  const [updated] = await db
    .select()
    .from(staff)
    .where(eq(staff.id, staffId))
    .limit(1);

  const currentServiceIds = await db
    .select({ serviceId: staffServices.serviceId })
    .from(staffServices)
    .where(eq(staffServices.staffId, staffId));

  await invalidateAvailabilityCacheByMerchantId(merchantId);

  return c.json({
    staff: {
      ...updated,
      service_ids: currentServiceIds.map((r) => r.serviceId),
    },
  });
});

// ─── DELETE /merchant/staff/:id ────────────────────────────────────────────────

staffRouter.delete("/:id", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId");
  const staffId = c.req.param("id")!;

  const [existing] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.id, staffId), eq(staff.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Not Found", message: "Staff member not found" }, 404);
  }

  await db
    .update(staff)
    .set({ isActive: false })
    .where(and(eq(staff.id, staffId), eq(staff.merchantId, merchantId)));

  await invalidateAvailabilityCacheByMerchantId(merchantId);

  return c.json({ success: true, message: "Staff member deactivated" });
});

// ─── PATCH /merchant/staff/:id/profile ─────────────────────────────────────────

staffRouter.patch("/:id/profile", requireMerchant, zValidator(updateProfileSchema), async (c) => {
  const merchantId = c.get("merchantId");
  const staffId = c.req.param("id");
  const body = c.get("body") as z.infer<typeof updateProfileSchema>;

  const [existing] = await db
    .select()
    .from(staff)
    .where(and(eq(staff.id, staffId), eq(staff.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Staff member not found" }, 404);
  }

  const [updated] = await db
    .update(staff)
    .set({
      ...(body.bio !== undefined && { bio: body.bio }),
      ...(body.specialty_tags !== undefined && { specialtyTags: body.specialty_tags }),
      ...(body.credentials !== undefined && { credentials: body.credentials }),
      ...(body.is_publicly_visible !== undefined && { isPubliclyVisible: body.is_publicly_visible }),
    })
    .where(eq(staff.id, staffId))
    .returning();

  return c.json({ staff: updated });
});

export { staffRouter };

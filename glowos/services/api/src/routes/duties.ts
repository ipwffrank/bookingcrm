import { Hono } from "hono";
import { eq, and, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { db, staffDuties, staff } from "@glowos/db";
import { requireMerchant, requireAdmin } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";

const dutiesRouter = new Hono<{ Variables: AppVariables }>();

dutiesRouter.use("*", requireMerchant);

const createDutySchema = z.object({
  staff_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM"),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM"),
  duty_type: z.enum(["floor", "treatment", "break", "other"]),
  notes: z.string().optional(),
});

const updateDutySchema = z.object({
  staff_id: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  duty_type: z.enum(["floor", "treatment", "break", "other"]).optional(),
  notes: z.string().optional(),
});

const myDutySchema = createDutySchema.omit({ staff_id: true });

// GET /merchant/duties?from=YYYY-MM-DD&to=YYYY-MM-DD&staff_id=uuid
dutiesRouter.get("/", async (c) => {
  const merchantId = c.get("merchantId")!;
  const userRole = c.get("userRole");
  const contextStaffId = c.get("staffId");
  const fromStr = c.req.query("from");
  const toStr = c.req.query("to");
  const filterStaffId = c.req.query("staff_id");

  if (!fromStr || !toStr) {
    return c.json({ error: "Bad Request", message: "from and to query params required (YYYY-MM-DD)" }, 400);
  }

  const conditions = [
    eq(staffDuties.merchantId, merchantId),
    gte(staffDuties.date, fromStr),
    lte(staffDuties.date, toStr),
  ];

  // Staff can only see their own duties
  if (userRole === "staff" && contextStaffId) {
    conditions.push(eq(staffDuties.staffId, contextStaffId));
  } else if (filterStaffId) {
    conditions.push(eq(staffDuties.staffId, filterStaffId));
  }

  const duties = await db
    .select()
    .from(staffDuties)
    .where(and(...conditions));

  return c.json({ duties });
});

// POST /merchant/duties — admin only
dutiesRouter.post("/", requireAdmin(), zValidator(createDutySchema), async (c) => {
  const merchantId = c.get("merchantId")!;
  const body = c.get("body") as z.infer<typeof createDutySchema>;

  // Verify staff belongs to this merchant
  const [staffMember] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(and(eq(staff.id, body.staff_id), eq(staff.merchantId, merchantId)))
    .limit(1);

  if (!staffMember) {
    return c.json({ error: "Not Found", message: "Staff member not found" }, 404);
  }

  const [duty] = await db
    .insert(staffDuties)
    .values({
      staffId: body.staff_id,
      merchantId,
      date: body.date,
      startTime: body.start_time,
      endTime: body.end_time,
      dutyType: body.duty_type,
      notes: body.notes ?? null,
    })
    .returning();

  return c.json({ duty }, 201);
});

// POST /merchant/duties/my — staff creates their own duty block
dutiesRouter.post("/my", zValidator(myDutySchema), async (c) => {
  const merchantId = c.get("merchantId")!;
  const staffId = c.get("staffId");
  if (!staffId) return c.json({ error: "Forbidden", message: "Staff access required" }, 403);

  const body = c.get("body") as z.infer<typeof myDutySchema>;

  const [duty] = await db
    .insert(staffDuties)
    .values({
      staffId,
      merchantId,
      date: body.date,
      startTime: body.start_time,
      endTime: body.end_time,
      dutyType: body.duty_type,
      notes: body.notes ?? null,
    })
    .returning();

  return c.json({ duty }, 201);
});

// PATCH /merchant/duties/:id — admin or own staff
dutiesRouter.patch("/:id", zValidator(updateDutySchema), async (c) => {
  const merchantId = c.get("merchantId")!;
  const userRole = c.get("userRole");
  const contextStaffId = c.get("staffId");
  const dutyId = c.req.param("id")!;
  const body = c.get("body") as z.infer<typeof updateDutySchema>;

  const [existing] = await db
    .select()
    .from(staffDuties)
    .where(and(eq(staffDuties.id, dutyId), eq(staffDuties.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Not Found", message: "Duty block not found" }, 404);
  }

  // Staff can only edit their own duty blocks
  if (userRole === "staff" && existing.staffId !== contextStaffId) {
    return c.json({ error: "Forbidden", message: "You can only edit your own duty blocks" }, 403);
  }

  const updates: Record<string, unknown> = {};

  // Staff reassignment — admin only
  if (body.staff_id !== undefined) {
    if (userRole === "staff") {
      return c.json({ error: "Forbidden", message: "Staff cannot reassign duty blocks" }, 403);
    }
    const [newStaff] = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.id, body.staff_id), eq(staff.merchantId, merchantId)))
      .limit(1);
    if (!newStaff) {
      return c.json({ error: "Not Found", message: "Target staff member not found" }, 404);
    }
    updates.staffId = body.staff_id;
  }

  if (body.date !== undefined) updates.date = body.date;
  if (body.start_time !== undefined) updates.startTime = body.start_time;
  if (body.end_time !== undefined) updates.endTime = body.end_time;
  if (body.duty_type !== undefined) updates.dutyType = body.duty_type;
  if (body.notes !== undefined) updates.notes = body.notes;
  updates.updatedAt = new Date();

  const [updated] = await db
    .update(staffDuties)
    .set(updates)
    .where(and(eq(staffDuties.id, dutyId!), eq(staffDuties.merchantId, merchantId)))
    .returning();

  return c.json({ duty: updated });
});

// DELETE /merchant/duties/:id — admin only
dutiesRouter.delete("/:id", requireAdmin(), async (c) => {
  const merchantId = c.get("merchantId")!;
  const dutyId = c.req.param("id")!;

  const [existing] = await db
    .select({ id: staffDuties.id })
    .from(staffDuties)
    .where(and(eq(staffDuties.id, dutyId), eq(staffDuties.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Not Found", message: "Duty block not found" }, 404);
  }

  await db.delete(staffDuties).where(eq(staffDuties.id, dutyId));

  return c.json({ success: true });
});

export { dutiesRouter };

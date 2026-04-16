import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db, merchantUsers, staff } from "@glowos/db";
import { requireMerchant, requireAdmin } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";

const staffAuthRouter = new Hono<{ Variables: AppVariables }>();

staffAuthRouter.use("*", requireMerchant);
staffAuthRouter.use("*", requireAdmin());

const createLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// GET /merchant/staff/logins — list which staff have logins
staffAuthRouter.get("/logins", async (c) => {
  const merchantId = c.get("merchantId")!;
  const logins = await db
    .select({ staffId: merchantUsers.staffId, email: merchantUsers.email })
    .from(merchantUsers)
    .where(and(eq(merchantUsers.merchantId, merchantId), eq(merchantUsers.role, "staff")));
  return c.json({ logins: logins.filter(l => l.staffId !== null) });
});

// POST /merchant/staff/:id/create-login
staffAuthRouter.post("/:id/create-login", zValidator(createLoginSchema), async (c) => {
  const merchantId = c.get("merchantId")!;
  const staffId = c.req.param("id");
  const body = c.get("body") as z.infer<typeof createLoginSchema>;

  // Verify staff belongs to merchant
  const [staffMember] = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(and(eq(staff.id, staffId!), eq(staff.merchantId, merchantId)))
    .limit(1);

  if (!staffMember) {
    return c.json({ error: "Not Found", message: "Staff member not found" }, 404);
  }

  // Check login doesn't already exist
  const [existing] = await db
    .select({ id: merchantUsers.id })
    .from(merchantUsers)
    .where(eq(merchantUsers.staffId, staffId!))
    .limit(1);

  if (existing) {
    return c.json({ error: "Conflict", message: "This staff member already has a login" }, 409);
  }

  // Check email not taken
  const [emailTaken] = await db
    .select({ id: merchantUsers.id })
    .from(merchantUsers)
    .where(eq(merchantUsers.email, body.email))
    .limit(1);

  if (emailTaken) {
    return c.json({ error: "Conflict", message: "An account with this email already exists" }, 409);
  }

  const passwordHash = await bcrypt.hash(body.password, 10);

  const [user] = await db
    .insert(merchantUsers)
    .values({
      merchantId,
      staffId: staffId!,
      name: staffMember.name,
      email: body.email,
      passwordHash,
      role: "staff",
      isActive: true,
    })
    .returning({ id: merchantUsers.id, email: merchantUsers.email });

  return c.json({ user }, 201);
});

// POST /merchant/staff/:id/reset-password
staffAuthRouter.post("/:id/reset-password", zValidator(resetPasswordSchema), async (c) => {
  const merchantId = c.get("merchantId")!;
  const staffId = c.req.param("id");
  const body = c.get("body") as z.infer<typeof resetPasswordSchema>;

  const [user] = await db
    .select({ id: merchantUsers.id })
    .from(merchantUsers)
    .where(and(eq(merchantUsers.staffId, staffId!), eq(merchantUsers.merchantId, merchantId)))
    .limit(1);

  if (!user) {
    return c.json({ error: "Not Found", message: "No login found for this staff member" }, 404);
  }

  const passwordHash = await bcrypt.hash(body.password, 10);

  await db
    .update(merchantUsers)
    .set({ passwordHash })
    .where(eq(merchantUsers.id, user.id));

  return c.json({ success: true });
});

export { staffAuthRouter };

import { Hono } from "hono";
import { eq, and, count } from "drizzle-orm";
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

// GET /merchant/staff/logins — list which staff have logins (any non-owner role)
staffAuthRouter.get("/logins", async (c) => {
  const merchantId = c.get("merchantId")!;
  const logins = await db
    .select({
      staffId: merchantUsers.staffId,
      email: merchantUsers.email,
      role: merchantUsers.role,
      secondaryRole: merchantUsers.secondaryRole,
    })
    .from(merchantUsers)
    .where(eq(merchantUsers.merchantId, merchantId));
  return c.json({ logins: logins.filter((l) => l.staffId !== null) });
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

// PATCH /merchant/staff/:id/role — change role among staff/manager/clinician. Owner-only.
// If demoting to staff and the user is a brand admin, the brand-admin claim is
// cascade-cleared (subject to a last-admin guard so the brand can't be orphaned).
// This applies symmetrically whether demoting from manager or clinician.
const updateRoleSchema = z.object({
  role: z.enum(["staff", "manager", "clinician"]),
}).strict();

staffAuthRouter.patch("/:id/role", zValidator(updateRoleSchema), async (c) => {
  const callerRole = c.get("userRole");
  if (callerRole !== "owner") {
    return c.json(
      { error: "Forbidden", message: "Only the owner can change team roles" },
      403,
    );
  }
  const merchantId = c.get("merchantId")!;
  const staffId = c.req.param("id");
  const body = c.get("body") as z.infer<typeof updateRoleSchema>;

  const [user] = await db
    .select({
      id: merchantUsers.id,
      role: merchantUsers.role,
      brandAdminGroupId: merchantUsers.brandAdminGroupId,
    })
    .from(merchantUsers)
    .where(and(eq(merchantUsers.staffId, staffId!), eq(merchantUsers.merchantId, merchantId)))
    .limit(1);

  if (!user) {
    return c.json({ error: "Not Found", message: "No login found for this staff member" }, 404);
  }
  if (user.role === "owner") {
    return c.json(
      { error: "Conflict", message: "Cannot change the owner's role here" },
      409,
    );
  }
  if (user.role === body.role) {
    return c.json({ user: { id: user.id, role: user.role } });
  }

  // Cascade rule: a staff-role user cannot be a brand admin (per the role gate
  // in /group/admins). If we're demoting a manager-with-brand-admin-claim to
  // staff, also drop the claim — but refuse to do so if it would orphan the
  // group with zero brand admins.
  if (body.role === "staff" && user.brandAdminGroupId) {
    const [{ count: adminCount }] = await db
      .select({ count: count(merchantUsers.id) })
      .from(merchantUsers)
      .where(eq(merchantUsers.brandAdminGroupId, user.brandAdminGroupId));
    if (adminCount <= 1) {
      return c.json(
        {
          error: "Conflict",
          message:
            "Cannot demote — they are the last brand admin. Promote another brand admin first, then demote.",
        },
        409,
      );
    }
    await db
      .update(merchantUsers)
      .set({ role: body.role, brandAdminGroupId: null })
      .where(eq(merchantUsers.id, user.id));
  } else {
    await db
      .update(merchantUsers)
      .set({ role: body.role })
      .where(eq(merchantUsers.id, user.id));
  }

  return c.json({ user: { id: user.id, role: body.role } });
});

// PATCH /merchant/staff/:id/secondary-role — set or clear the secondary
// role. Owner-only. The secondary role grants the union of its
// permissions on top of the primary role; a clinician who is also the
// firm's manager passes manager-gated routes via the secondary role
// without losing clinical_records.*.
//
// Pass `secondary_role: null` to clear it.
const updateSecondaryRoleSchema = z.object({
  secondary_role: z.enum(["staff", "manager", "clinician", "owner"]).nullable(),
}).strict();

staffAuthRouter.patch("/:id/secondary-role", zValidator(updateSecondaryRoleSchema), async (c) => {
  const callerRole = c.get("userRole");
  const callerSecondary = c.get("userSecondaryRole");
  // Only the literal owner — primary OR secondary — can edit secondary
  // roles. Mirrors the primary-role gate above.
  if (callerRole !== "owner" && callerSecondary !== "owner") {
    return c.json(
      { error: "Forbidden", message: "Only the owner can change team roles" },
      403,
    );
  }
  const merchantId = c.get("merchantId")!;
  const staffId = c.req.param("id");
  const body = c.get("body") as z.infer<typeof updateSecondaryRoleSchema>;

  const [user] = await db
    .select({
      id: merchantUsers.id,
      role: merchantUsers.role,
    })
    .from(merchantUsers)
    .where(and(eq(merchantUsers.staffId, staffId!), eq(merchantUsers.merchantId, merchantId)))
    .limit(1);

  if (!user) {
    return c.json({ error: "Not Found", message: "No login found for this staff member" }, 404);
  }

  // Reject same-as-primary — the DB CHECK constraint would reject it
  // anyway, but a clean 400 is friendlier than a generic constraint
  // violation surfacing to the UI.
  if (body.secondary_role !== null && body.secondary_role === user.role) {
    return c.json(
      { error: "Bad Request", message: "Secondary role must differ from primary role" },
      400,
    );
  }

  await db
    .update(merchantUsers)
    .set({ secondaryRole: body.secondary_role })
    .where(eq(merchantUsers.id, user.id));

  return c.json({ user: { id: user.id, role: user.role, secondaryRole: body.secondary_role } });
});

export { staffAuthRouter };

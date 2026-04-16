import { Hono } from "hono";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db, merchants, merchantUsers, groupUsers, groups } from "@glowos/db";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, generateGroupAccessToken } from "../lib/jwt.js";
import { generateSlug, ensureUniqueSlug } from "../lib/slug.js";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";

const auth = new Hono<{ Variables: AppVariables }>();

// ─── Schemas ───────────────────────────────────────────────────────────────────

const signupSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(1, "Phone number is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  salon_name: z.string().min(1, "Salon name is required"),
  salon_category: z.enum(["hair_salon", "nail_studio", "spa", "massage", "beauty_centre", "restaurant", "beauty_clinic", "medical_clinic", "other"], {
    errorMap: () => ({
      message:
        "Invalid business category. Must be one of: hair_salon, nail_studio, spa, massage, beauty_centre, restaurant, beauty_clinic, medical_clinic, other",
    }),
  }),
});

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1, "Refresh token is required"),
});

// ─── POST /auth/signup ─────────────────────────────────────────────────────────

auth.post("/signup", zValidator(signupSchema), async (c) => {
  const body = c.get("body") as z.infer<typeof signupSchema>;

  // Check email not already taken
  const [existing] = await db
    .select({ id: merchantUsers.id })
    .from(merchantUsers)
    .where(eq(merchantUsers.email, body.email))
    .limit(1);

  if (existing) {
    return c.json({ error: "Conflict", message: "An account with this email already exists" }, 409);
  }

  // Hash password
  const passwordHash = await bcrypt.hash(body.password, 10);

  // Generate unique slug for the merchant
  const baseSlug = generateSlug(body.salon_name);
  const slug = await ensureUniqueSlug(baseSlug, db);

  // Create merchant
  const [merchant] = await db
    .insert(merchants)
    .values({
      slug,
      name: body.salon_name,
      category: body.salon_category,
      email: body.email,
      phone: body.phone,
    })
    .returning();

  if (!merchant) {
    return c.json({ error: "Internal Server Error", message: "Failed to create merchant" }, 500);
  }

  // Create owner user
  const [user] = await db
    .insert(merchantUsers)
    .values({
      merchantId: merchant.id,
      name: body.name,
      email: body.email,
      phone: body.phone,
      passwordHash,
      role: "owner",
    })
    .returning();

  if (!user) {
    return c.json({ error: "Internal Server Error", message: "Failed to create user" }, 500);
  }

  const accessToken = generateAccessToken({
    userId: user.id,
    merchantId: merchant.id,
    role: user.role,
  });
  const refreshToken = generateRefreshToken({ userId: user.id });

  const { passwordHash: _pw, ...safeUser } = user;

  return c.json(
    {
      user: safeUser,
      merchant,
      access_token: accessToken,
      refresh_token: refreshToken,
    },
    201
  );
});

// ─── POST /auth/login ──────────────────────────────────────────────────────────

auth.post("/login", zValidator(loginSchema), async (c) => {
  const body = c.get("body") as z.infer<typeof loginSchema>;

  // ── Try merchant user first ────────────────────────────────────────────────
  const [row] = await db
    .select({ user: merchantUsers, merchant: merchants })
    .from(merchantUsers)
    .innerJoin(merchants, eq(merchantUsers.merchantId, merchants.id))
    .where(eq(merchantUsers.email, body.email))
    .limit(1);

  if (row) {
    const { user, merchant } = row;

    const passwordValid = await bcrypt.compare(body.password, user.passwordHash);
    if (!passwordValid) {
      return c.json({ error: "Unauthorized", message: "Invalid email or password" }, 401);
    }

    if (!user.isActive) {
      return c.json({ error: "Forbidden", message: "Your account has been deactivated" }, 403);
    }

    await db.update(merchantUsers).set({ lastLoginAt: new Date() }).where(eq(merchantUsers.id, user.id));

    const accessToken = generateAccessToken({
      userId: user.id,
      merchantId: merchant.id,
      role: user.role,
      ...(user.staffId ? { staffId: user.staffId } : {}),
    });
    const refreshToken = generateRefreshToken({ userId: user.id });
    const { passwordHash: _pw, ...safeUser } = user;

    if (user.role === 'staff') {
      return c.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        userType: 'staff',
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        merchant: { id: merchant.id, name: merchant.name, slug: merchant.slug },
      });
    }

    return c.json({ userType: "merchant", user: safeUser, merchant, access_token: accessToken, refresh_token: refreshToken });
  }

  // ── Fall back to group user ────────────────────────────────────────────────
  const [groupRow] = await db
    .select({ groupUser: groupUsers, group: groups })
    .from(groupUsers)
    .innerJoin(groups, eq(groupUsers.groupId, groups.id))
    .where(eq(groupUsers.email, body.email))
    .limit(1);

  if (!groupRow) {
    return c.json({ error: "Unauthorized", message: "Invalid email or password" }, 401);
  }

  const { groupUser, group } = groupRow;

  const passwordValid = await bcrypt.compare(body.password, groupUser.passwordHash);
  if (!passwordValid) {
    return c.json({ error: "Unauthorized", message: "Invalid email or password" }, 401);
  }

  // NOTE: groupUsers has no isActive column in schema v1. When account deactivation
  // is added, add an active check here parallel to the merchant path above.
  const accessToken = generateGroupAccessToken({
    userId: groupUser.id,
    groupId: group.id,
    role: "group_owner",
    userType: "group_admin",
  });

  const { passwordHash: _gpw, ...safeGroupUser } = groupUser;

  return c.json({
    userType: "group_admin",
    user: safeGroupUser,
    group,
    access_token: accessToken,
  });
});

// ─── POST /auth/refresh-token ──────────────────────────────────────────────────

auth.post("/refresh-token", zValidator(refreshSchema), async (c) => {
  const body = c.get("body") as z.infer<typeof refreshSchema>;

  let payload: { userId: string };
  try {
    payload = verifyRefreshToken(body.refresh_token);
  } catch {
    return c.json({ error: "Unauthorized", message: "Invalid or expired refresh token" }, 401);
  }

  // Load user and check still active
  const [row] = await db
    .select({ user: merchantUsers, merchant: merchants })
    .from(merchantUsers)
    .innerJoin(merchants, eq(merchantUsers.merchantId, merchants.id))
    .where(eq(merchantUsers.id, payload.userId))
    .limit(1);

  if (!row || !row.user.isActive) {
    return c.json({ error: "Unauthorized", message: "User account is inactive or not found" }, 401);
  }

  const { user, merchant } = row;

  const accessToken = generateAccessToken({
    userId: user.id,
    merchantId: merchant.id,
    role: user.role,
  });
  const refreshToken = generateRefreshToken({ userId: user.id });

  return c.json({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
});

// ─── POST /auth/logout ─────────────────────────────────────────────────────────

auth.post("/logout", requireMerchant, async (c) => {
  // Token blacklisting via Redis will be added later.
  // For now, acknowledge the logout — clients should discard tokens locally.
  return c.json({ success: true, message: "Logged out successfully" });
});

// ─── GET /auth/me ──────────────────────────────────────────────────────────────

auth.get("/me", requireMerchant, async (c) => {
  const userId = c.get("userId");
  const merchantId = c.get("merchantId")!;

  const [row] = await db
    .select({ user: merchantUsers, merchant: merchants })
    .from(merchantUsers)
    .innerJoin(merchants, eq(merchantUsers.merchantId, merchants.id))
    .where(eq(merchantUsers.id, userId))
    .limit(1);

  if (!row) {
    return c.json({ error: "Not Found", message: "User not found" }, 404);
  }

  const { passwordHash: _pw, ...safeUser } = row.user;

  return c.json({
    user: safeUser,
    merchant: row.merchant,
  });
});

export { auth };

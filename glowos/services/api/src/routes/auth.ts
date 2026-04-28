import { Hono } from "hono";
import { and, eq, gt, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { z } from "zod";
import { db, merchants, merchantUsers, groupUsers, groups, passwordResetTokens, superAdminAuditLog } from "@glowos/db";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, generateGroupAccessToken } from "../lib/jwt.js";
import { generateSlug, ensureUniqueSlug } from "../lib/slug.js";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import { sendEmail, passwordResetEmail } from "../lib/email.js";
import { config, isSuperAdminEmail } from "../lib/config.js";
import type { AppVariables } from "../lib/types.js";

const RESET_TOKEN_TTL_MINUTES = 30;
const RESET_TOKEN_BYTES = 32;

function hashToken(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

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
  // Country drives the auto-default for payment_gateway (MY → ipay88,
  // SG → stripe). Optional on the wire so legacy callers without a country
  // field continue to work — defaults to SG, matching the merchants schema
  // default. New MY signups are expected to send 'MY' explicitly.
  country: z.enum(["SG", "MY"]).optional().default("SG"),
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
  // Auto-default the payment gateway based on country: MY merchants get
  // ipay88 (native FPX / Touch'n Go / DuitNow / GrabPay MY rails); SG and
  // anything else fall through to the schema default of stripe. Mirrors the
  // pattern used in POST /group/branches.
  const paymentGateway: "stripe" | "ipay88" =
    body.country === "MY" ? "ipay88" : "stripe";
  const timezone = body.country === "MY" ? "Asia/Kuala_Lumpur" : "Asia/Singapore";

  const [merchant] = await db
    .insert(merchants)
    .values({
      slug,
      name: body.salon_name,
      category: body.salon_category,
      email: body.email,
      phone: body.phone,
      country: body.country,
      timezone,
      paymentGateway,
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

    const superAdmin = isSuperAdminEmail(user.email);
    const brandAdminGroupId = user.brandAdminGroupId ?? undefined;
    const accessToken = generateAccessToken({
      userId: user.id,
      merchantId: merchant.id,
      role: user.role,
      ...(user.staffId ? { staffId: user.staffId } : {}),
      ...(superAdmin ? { superAdmin: true } : {}),
      ...(brandAdminGroupId ? { brandAdminGroupId } : {}),
    });
    const refreshToken = generateRefreshToken({
      userId: user.id,
      ...(brandAdminGroupId ? { brandAdminGroupId } : {}),
    });
    const { passwordHash: _pw, ...safeUser } = user;

    let group: { id: string; name: string } | null = null;
    if (brandAdminGroupId) {
      const [groupRow] = await db
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .where(eq(groups.id, brandAdminGroupId))
        .limit(1);
      if (groupRow) group = groupRow;
      // Else: brand_admin_group_id points to a missing/deleted group.
      // Don't fail login — just omit `group` from the response. The frontend
      // will not render the Group sidebar item; superadmin can clean up.
    }

    if (user.role === 'staff') {
      return c.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        userType: 'staff',
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        merchant: { id: merchant.id, name: merchant.name, slug: merchant.slug },
        ...(group ? { group } : {}),
        ...(superAdmin ? { superAdmin: true } : {}),
      });
    }

    return c.json({
      userType: "merchant",
      user: safeUser,
      merchant,
      ...(group ? { group } : {}),
      access_token: accessToken,
      refresh_token: refreshToken,
      ...(superAdmin ? { superAdmin: true } : {}),
    });
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

  let payload: ReturnType<typeof verifyRefreshToken>;
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

  const superAdmin = isSuperAdminEmail(user.email);

  // If the refresh token was issued during impersonation, re-validate the
  // actor against the current allowlist (rotating SUPER_ADMIN_EMAILS revokes
  // mid-flight impersonation) and forward the claims to the new access token.
  // Otherwise the access token would silently lose impersonation context after
  // 15 minutes and any subsequent writes would no longer be audited.
  const isImpersonating =
    payload.impersonating === true &&
    typeof payload.actorEmail === "string" &&
    typeof payload.actorUserId === "string" &&
    isSuperAdminEmail(payload.actorEmail);

  // Brand-admin claim survives refresh by re-reading from the live DB (so
  // revoking a user's brand authority takes effect on the next refresh
  // rather than waiting for refresh-token expiry). Falling back to the
  // payload value would let stale grants linger up to 30 days.
  const brandAdminGroupId = user.brandAdminGroupId ?? undefined;

  // View-as-branch claims are forwarded from the existing refresh token so
  // that a brand admin in view-as-branch mode does not silently fall back to
  // home-branch context every 15 minutes when the access token is refreshed.
  const viewingMerchantId = payload.viewingMerchantId;
  const brandViewing = payload.brandViewing;
  const homeMerchantId = payload.homeMerchantId;

  const accessToken = generateAccessToken({
    userId: user.id,
    merchantId: merchant.id,
    role: user.role,
    ...(user.staffId ? { staffId: user.staffId } : {}),
    ...(superAdmin || isImpersonating ? { superAdmin: true } : {}),
    ...(isImpersonating
      ? {
          impersonating: true,
          actorUserId: payload.actorUserId!,
          actorEmail: payload.actorEmail!,
        }
      : {}),
    ...(brandAdminGroupId ? { brandAdminGroupId } : {}),
    ...(viewingMerchantId ? { viewingMerchantId } : {}),
    ...(brandViewing ? { brandViewing: true as const } : {}),
    ...(homeMerchantId ? { homeMerchantId } : {}),
  });
  const refreshToken = generateRefreshToken({
    userId: user.id,
    ...(isImpersonating
      ? {
          impersonating: true,
          actorUserId: payload.actorUserId!,
          actorEmail: payload.actorEmail!,
        }
      : {}),
    ...(brandAdminGroupId ? { brandAdminGroupId } : {}),
    ...(viewingMerchantId ? { viewingMerchantId } : {}),
    ...(brandViewing ? { brandViewing: true as const } : {}),
    ...(homeMerchantId ? { homeMerchantId } : {}),
  });

  return c.json({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
});

// ─── POST /auth/forgot-password ────────────────────────────────────────────────
// Always returns 200 with a generic message, even if the email is unknown,
// to prevent user enumeration. If the email matches a merchant_user or
// group_user, we invalidate any outstanding tokens and email a fresh one.

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

auth.post("/forgot-password", zValidator(forgotPasswordSchema), async (c) => {
  const body = c.get("body") as z.infer<typeof forgotPasswordSchema>;
  const genericResponse = {
    message:
      "If an account exists for that email, we've sent a reset link. Check your inbox and spam folder.",
  };

  type Match = { userType: "merchant_user" | "group_user"; userId: string; name: string; email: string };
  let match: Match | null = null;

  const [mu] = await db
    .select({ id: merchantUsers.id, name: merchantUsers.name, email: merchantUsers.email, isActive: merchantUsers.isActive })
    .from(merchantUsers)
    .where(eq(merchantUsers.email, body.email))
    .limit(1);

  if (mu && mu.isActive) {
    match = { userType: "merchant_user", userId: mu.id, name: mu.name, email: mu.email };
  } else {
    const [gu] = await db
      .select({ id: groupUsers.id, name: groupUsers.name, email: groupUsers.email })
      .from(groupUsers)
      .where(eq(groupUsers.email, body.email))
      .limit(1);
    if (gu) match = { userType: "group_user", userId: gu.id, name: gu.name, email: gu.email };
  }

  if (!match) {
    return c.json(genericResponse);
  }

  // Invalidate any outstanding unused tokens for this user, then issue a fresh one.
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokens.userType, match.userType),
        eq(passwordResetTokens.userId, match.userId),
        isNull(passwordResetTokens.usedAt),
      ),
    );

  const plainToken = randomBytes(RESET_TOKEN_BYTES).toString("base64url");
  const tokenHash = hashToken(plainToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60_000);

  await db.insert(passwordResetTokens).values({
    userType: match.userType,
    userId: match.userId,
    tokenHash,
    expiresAt,
    requestedIp: c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null,
  });

  const resetUrl = `${config.frontendUrl}/reset-password?token=${plainToken}`;
  await sendEmail({
    to: match.email,
    subject: "Reset your GlowOS password",
    html: passwordResetEmail({
      name: match.name,
      resetUrl,
      expiryMinutes: RESET_TOKEN_TTL_MINUTES,
    }),
  });

  return c.json(genericResponse);
});

// ─── POST /auth/reset-password ─────────────────────────────────────────────────
// Validates the token, updates the matching user's password, marks the token used.

const resetPasswordSchema = z.object({
  token: z.string().min(20, "Invalid token"),
  new_password: z.string().min(8, "Password must be at least 8 characters"),
});

auth.post("/reset-password", zValidator(resetPasswordSchema), async (c) => {
  const body = c.get("body") as z.infer<typeof resetPasswordSchema>;
  const tokenHash = hashToken(body.token);

  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row) {
    return c.json(
      { error: "Unauthorized", message: "This reset link is invalid or has expired. Request a new one." },
      401,
    );
  }

  const newHash = await bcrypt.hash(body.new_password, 10);

  if (row.userType === "merchant_user") {
    const [updated] = await db
      .update(merchantUsers)
      .set({ passwordHash: newHash })
      .where(eq(merchantUsers.id, row.userId))
      .returning({ id: merchantUsers.id, isActive: merchantUsers.isActive });

    if (!updated || !updated.isActive) {
      return c.json({ error: "Forbidden", message: "Account is no longer active" }, 403);
    }
  } else {
    const [updated] = await db
      .update(groupUsers)
      .set({ passwordHash: newHash })
      .where(eq(groupUsers.id, row.userId))
      .returning({ id: groupUsers.id });

    if (!updated) {
      return c.json({ error: "Not Found", message: "Account not found" }, 404);
    }
  }

  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, row.id));

  return c.json({ success: true, message: "Password updated. You can now sign in." });
});

// ─── POST /auth/end-impersonation ──────────────────────────────────────────────
// Re-issues a self-mode superadmin token for the original actor. Lives on
// /auth (not /super) because it's the one endpoint that must be callable
// WHILE impersonating — /super/* is locked out during impersonation.

auth.post("/end-impersonation", requireMerchant, async (c) => {
  const actorUserId = c.get("actorUserId");
  const impersonating = c.get("impersonating");
  if (!impersonating || !actorUserId) {
    return c.json({ error: "Conflict", message: "Not currently impersonating" }, 409);
  }

  const [actor] = await db
    .select({
      id: merchantUsers.id,
      email: merchantUsers.email,
      merchantId: merchantUsers.merchantId,
      role: merchantUsers.role,
      staffId: merchantUsers.staffId,
      isActive: merchantUsers.isActive,
      brandAdminGroupId: merchantUsers.brandAdminGroupId,
    })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, actorUserId))
    .limit(1);

  if (!actor || !actor.isActive || !isSuperAdminEmail(actor.email)) {
    return c.json({ error: "Forbidden", message: "Actor account invalid" }, 403);
  }

  const actorBrandAdminGroupId = actor.brandAdminGroupId ?? undefined;
  const accessToken = generateAccessToken({
    userId: actor.id,
    merchantId: actor.merchantId,
    role: actor.role,
    ...(actor.staffId ? { staffId: actor.staffId } : {}),
    superAdmin: true,
    ...(actorBrandAdminGroupId ? { brandAdminGroupId: actorBrandAdminGroupId } : {}),
  });
  const refreshToken = generateRefreshToken({
    userId: actor.id,
    ...(actorBrandAdminGroupId ? { brandAdminGroupId: actorBrandAdminGroupId } : {}),
  });

  await db.insert(superAdminAuditLog).values({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: "impersonate_end",
    targetMerchantId: c.get("merchantId") ?? null,
  });

  return c.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    userType: "merchant",
  });
});

// ─── POST /auth/end-brand-view ─────────────────────────────────────────────────
// Counterpart of /auth/end-impersonation for brand-viewing sessions. Lives on
// /auth so it remains callable while view-as-branch claims are active.
auth.post("/end-brand-view", requireMerchant, async (c) => {
  if (!c.get("brandViewing")) {
    return c.json({ error: "Conflict", message: "Not currently brand-viewing" }, 409);
  }

  const userId = c.get("userId")!;

  const [user] = await db
    .select({
      id: merchantUsers.id,
      email: merchantUsers.email,
      isActive: merchantUsers.isActive,
      merchantId: merchantUsers.merchantId,
      role: merchantUsers.role,
      staffId: merchantUsers.staffId,
      brandAdminGroupId: merchantUsers.brandAdminGroupId,
    })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, userId))
    .limit(1);

  if (!user || !user.isActive) {
    return c.json({ error: "Forbidden", message: "Account inactive" }, 403);
  }

  const superAdmin = isSuperAdminEmail(user.email);
  const accessToken = generateAccessToken({
    userId: user.id,
    merchantId: user.merchantId,
    role: user.role,
    ...(user.staffId ? { staffId: user.staffId } : {}),
    ...(superAdmin ? { superAdmin: true } : {}),
    ...(user.brandAdminGroupId ? { brandAdminGroupId: user.brandAdminGroupId } : {}),
  });
  const refreshToken = generateRefreshToken({
    userId: user.id,
    ...(user.brandAdminGroupId ? { brandAdminGroupId: user.brandAdminGroupId } : {}),
  });

  // Return the home merchant row so the frontend can write it back into
  // localStorage.merchant.
  const [homeMerchant] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.id, user.merchantId))
    .limit(1);

  return c.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    merchant: homeMerchant,
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

import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import {
  db,
  brandInvites,
  groups,
  merchants,
  merchantUsers,
} from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { generateAccessToken, generateRefreshToken } from "../lib/jwt.js";
import { isSuperAdminEmail } from "../lib/config.js";
import type { AppVariables } from "../lib/types.js";

// Recipient-facing brand-invite routes. The GET is public (no auth) so the
// recipient can see invite metadata before deciding to sign in. The POST /accept
// requires an authenticated merchant_user whose email matches the invitee.
//
// Mounted at /brand-invite (see services/api/src/index.ts).

const brandInvitesRouter = new Hono<{ Variables: AppVariables }>();

// GET /brand-invite/:token — public; returns minimal metadata for the recipient
// page. Never reveals group_id, inviter_id, or the token itself in a way that
// could be misused — just the human-friendly display fields plus a validity
// reason.
brandInvitesRouter.get("/:token", async (c) => {
  const token = c.req.param("token")!;

  const [row] = await db
    .select({
      id: brandInvites.id,
      inviteeEmail: brandInvites.inviteeEmail,
      expiresAt: brandInvites.expiresAt,
      acceptedAt: brandInvites.acceptedAt,
      canceledAt: brandInvites.canceledAt,
      groupName: groups.name,
      inviterName: merchantUsers.name,
      inviterEmail: merchantUsers.email,
    })
    .from(brandInvites)
    .leftJoin(groups, eq(brandInvites.groupId, groups.id))
    .leftJoin(merchantUsers, eq(brandInvites.createdByUserId, merchantUsers.id))
    .where(eq(brandInvites.token, token))
    .limit(1);

  if (!row) {
    return c.json({ valid: false, reason: "not_found" });
  }
  if (row.canceledAt) {
    return c.json({ valid: false, reason: "canceled" });
  }
  if (row.acceptedAt) {
    return c.json({ valid: false, reason: "used" });
  }
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    return c.json({ valid: false, reason: "expired" });
  }

  return c.json({
    valid: true,
    reason: null,
    groupName: row.groupName,
    inviterName: row.inviterName,
    inviterEmail: row.inviterEmail,
    inviteeEmail: row.inviteeEmail,
  });
});

// POST /brand-invite/:token/accept — authenticated recipient confirms.
// Single transaction: marks invite accepted, moves merchant into group,
// promotes user to brand admin, returns re-issued tokens.
brandInvitesRouter.post("/:token/accept", requireMerchant, async (c) => {
  const token = c.req.param("token")!;
  const userId = c.get("userId")!;

  if (c.get("impersonating")) {
    return c.json(
      { error: "Forbidden", message: "End impersonation before accepting an invite" },
      403,
    );
  }

  const result = await db.transaction(async (tx) => {
    const [invite] = await tx
      .select({
        id: brandInvites.id,
        groupId: brandInvites.groupId,
        inviteeEmail: brandInvites.inviteeEmail,
        expiresAt: brandInvites.expiresAt,
        acceptedAt: brandInvites.acceptedAt,
        canceledAt: brandInvites.canceledAt,
      })
      .from(brandInvites)
      .where(eq(brandInvites.token, token))
      .limit(1);

    if (!invite) return { error: "not_found" as const };
    if (invite.canceledAt) return { error: "canceled" as const };
    if (invite.acceptedAt) return { error: "used" as const };
    if (new Date(invite.expiresAt).getTime() <= Date.now()) {
      return { error: "expired" as const };
    }

    const [user] = await tx
      .select({
        id: merchantUsers.id,
        email: merchantUsers.email,
        name: merchantUsers.name,
        role: merchantUsers.role,
        staffId: merchantUsers.staffId,
        merchantId: merchantUsers.merchantId,
        brandAdminGroupId: merchantUsers.brandAdminGroupId,
        isActive: merchantUsers.isActive,
      })
      .from(merchantUsers)
      .where(eq(merchantUsers.id, userId))
      .limit(1);

    if (!user || !user.isActive) return { error: "user_inactive" as const };
    if (user.email.toLowerCase() !== invite.inviteeEmail.toLowerCase()) {
      return { error: "wrong_email" as const, expected: invite.inviteeEmail };
    }
    if (user.role === "staff") return { error: "staff_role" as const };
    if (user.brandAdminGroupId) return { error: "already_brand_admin" as const };

    const [merchant] = await tx
      .select()
      .from(merchants)
      .where(eq(merchants.id, user.merchantId))
      .limit(1);

    if (!merchant) return { error: "merchant_missing" as const };
    if (merchant.groupId) return { error: "merchant_in_group" as const };

    const [group] = await tx
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(eq(groups.id, invite.groupId))
      .limit(1);

    if (!group) return { error: "group_missing" as const };

    await tx
      .update(brandInvites)
      .set({ acceptedAt: new Date(), acceptedByUserId: user.id })
      .where(eq(brandInvites.id, invite.id));

    await tx
      .update(merchants)
      .set({ groupId: group.id, updatedAt: new Date() })
      .where(eq(merchants.id, merchant.id));

    await tx
      .update(merchantUsers)
      .set({ brandAdminGroupId: group.id })
      .where(eq(merchantUsers.id, user.id));

    return {
      ok: true as const,
      user,
      merchant: { ...merchant, groupId: group.id },
      group,
    };
  });

  if ("error" in result) {
    switch (result.error) {
      case "not_found":
        return c.json({ error: "Not Found", message: "Invite not found" }, 404);
      case "canceled":
        return c.json({ error: "Conflict", message: "Invite was canceled" }, 409);
      case "used":
        return c.json({ error: "Conflict", message: "Invite already used" }, 409);
      case "expired":
        return c.json({ error: "Gone", message: "Invite has expired" }, 410);
      case "user_inactive":
        return c.json({ error: "Forbidden", message: "Account inactive" }, 403);
      case "wrong_email":
        return c.json(
          {
            error: "Forbidden",
            message: `This invite is for ${result.expected}. Sign in with that email to accept.`,
          },
          403,
        );
      case "already_brand_admin":
        return c.json(
          { error: "Conflict", message: "You are already a brand admin" },
          409,
        );
      case "staff_role":
        return c.json(
          {
            error: "Forbidden",
            message:
              "Staff cannot be brand admins. The branch owner must promote you to manager or owner first.",
          },
          403,
        );
      case "merchant_missing":
        return c.json({ error: "Not Found", message: "Your merchant was not found" }, 404);
      case "merchant_in_group":
        return c.json(
          {
            error: "Conflict",
            message: "Your branch is already part of another brand. Contact support to switch.",
          },
          409,
        );
      case "group_missing":
        return c.json(
          { error: "Not Found", message: "The brand for this invite no longer exists" },
          404,
        );
    }
  }

  const { user, merchant, group } = result;
  const superAdmin = isSuperAdminEmail(user.email);
  const accessToken = generateAccessToken({
    userId: user.id,
    merchantId: user.merchantId,
    role: user.role,
    ...(user.staffId ? { staffId: user.staffId } : {}),
    ...(superAdmin ? { superAdmin: true } : {}),
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
});

export { brandInvitesRouter };

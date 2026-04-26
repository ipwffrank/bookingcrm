import jwt from "jsonwebtoken";
import crypto from "crypto";
import { config } from "./config.js";

export interface AccessTokenPayload {
  userId: string;
  merchantId: string;
  role: string;
  staffId?: string;  // set when role === 'staff'
  // Superadmin elevation — set only when the authenticated user's email is
  // in the SUPER_ADMIN_EMAILS allowlist at login time.
  superAdmin?: boolean;
  // Impersonation — set when superadmin has "viewed as" a merchant. The
  // userId/merchantId/role fields reflect the impersonated merchant; the
  // actor* fields preserve the real caller identity for audit logging.
  impersonating?: boolean;
  actorUserId?: string;
  actorEmail?: string;
  // Brand-admin authority — set when this merchant_user has a
  // brand_admin_group_id. The same JWT lets the user act as a normal branch
  // admin AND as a brand admin over every merchant in the named group.
  brandAdminGroupId?: string;
  // View-as-branch — set when a brand-admin is previewing a specific branch
  // merchant. homeMerchantId preserves the brand-admin's own merchantId so
  // we can restore it when the session ends.
  viewingMerchantId?: string;
  brandViewing?: boolean;
  homeMerchantId?: string;
}

export interface RefreshTokenPayload {
  userId: string;
  // Impersonation claims must round-trip through the refresh token because
  // the access token expires in ~15 min — without these, a silent refresh
  // mid-impersonation would strip the audit trail and downstream writes
  // would no longer be flagged as impersonated.
  impersonating?: boolean;
  actorUserId?: string;
  actorEmail?: string;
  // Same reasoning for brand-admin: needs to survive token refresh so the
  // brand-view UI doesn't silently lose authority partway through a session.
  brandAdminGroupId?: string;
  // View-as-branch claims — same round-trip requirement as impersonation.
  viewingMerchantId?: string;
  brandViewing?: boolean;
  homeMerchantId?: string;
}

export function generateAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiry as jwt.SignOptions["expiresIn"],
  });
}

export function generateRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, config.jwtSecret + "_refresh", {
    expiresIn: config.refreshTokenExpiry as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload & jwt.JwtPayload {
  return jwt.verify(token, config.jwtSecret) as AccessTokenPayload & jwt.JwtPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload & jwt.JwtPayload {
  return jwt.verify(token, config.jwtSecret + "_refresh") as RefreshTokenPayload & jwt.JwtPayload;
}

export interface GroupAccessTokenPayload {
  userId: string;
  groupId: string;
  role: "group_owner";
  userType: "group_admin";
}

export function generateGroupAccessToken(payload: GroupAccessTokenPayload): string {
  return jwt.sign(payload, config.jwtSecret + "_group", { expiresIn: "7d" });
}

export function verifyGroupAccessToken(token: string): GroupAccessTokenPayload & jwt.JwtPayload {
  const decoded = jwt.verify(token, config.jwtSecret + "_group") as GroupAccessTokenPayload & jwt.JwtPayload;
  if (decoded.userType !== "group_admin") {
    throw new Error("Token is not a group admin token");
  }
  return decoded;
}

/**
 * Generates an HMAC-based token for booking cancellation links.
 * Not a JWT — purely a signed token tied to a specific bookingId.
 */
export function generateBookingToken(bookingId: string): string {
  const hmac = crypto.createHmac("sha256", config.bookingTokenSecret);
  hmac.update(bookingId);
  const signature = hmac.digest("hex");
  const payload = Buffer.from(JSON.stringify({ bookingId, sig: signature })).toString("base64url");
  return payload;
}

export function verifyBookingToken(token: string, bookingId: string): boolean {
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as {
      bookingId: string;
      sig: string;
    };
    if (decoded.bookingId !== bookingId) return false;
    const hmac = crypto.createHmac("sha256", config.bookingTokenSecret);
    hmac.update(bookingId);
    const expectedSig = hmac.digest("hex");
    return crypto.timingSafeEqual(Buffer.from(decoded.sig, "hex"), Buffer.from(expectedSig, "hex"));
  } catch {
    return false;
  }
}

// ─── Verification tokens (OTP + Google Sign-in identity proof) ──────────────

export type VerificationPurpose = "login" | "first_timer_verify" | "google_verify";

export interface VerificationTokenPayload {
  phone: string | null;
  email: string | null;
  google_id: string | null;
  purpose: VerificationPurpose;
  verified_at: number;
}

const VERIFY_SECRET_SUFFIX = "_verify";

export function generateVerificationToken(
  payload: VerificationTokenPayload,
  ttlSeconds: number
): string {
  return jwt.sign(payload, config.jwtSecret + VERIFY_SECRET_SUFFIX, {
    expiresIn: ttlSeconds,
  });
}

export function verifyVerificationToken(
  token: string
): (VerificationTokenPayload & jwt.JwtPayload) | null {
  try {
    return jwt.verify(token, config.jwtSecret + VERIFY_SECRET_SUFFIX) as
      VerificationTokenPayload & jwt.JwtPayload;
  } catch {
    return null;
  }
}

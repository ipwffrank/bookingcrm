import jwt from "jsonwebtoken";
import crypto from "crypto";
import { config } from "./config.js";

export interface AccessTokenPayload {
  userId: string;
  merchantId: string;
  role: string;
}

export interface RefreshTokenPayload {
  userId: string;
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
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "7d" });
}

export function verifyGroupAccessToken(token: string): GroupAccessTokenPayload & jwt.JwtPayload {
  const decoded = jwt.verify(token, config.jwtSecret) as GroupAccessTokenPayload & jwt.JwtPayload;
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

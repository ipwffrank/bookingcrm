import { randomBytes } from "node:crypto";

/**
 * Generate an unguessable, URL-safe token used to confirm a booking. Stored
 * on bookings.confirmation_token. The customer-facing /confirm/:token URL
 * looks the token up and flips status pending → confirmed.
 *
 * 32 bytes ≈ 256 bits of entropy, base64url-encoded → 43 chars, well under
 * the column's varchar(64) cap.
 */
export function generateConfirmationToken(): string {
  return randomBytes(32).toString("base64url");
}

// glowos/services/api/src/lib/normalize.ts
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export function normalizePhone(
  raw: string | null | undefined,
  defaultCountry: CountryCode = "SG"
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number; // E.164 format, e.g. "+6591001010"
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return null;
  return trimmed;
}

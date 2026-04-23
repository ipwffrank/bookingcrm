import { eq } from "drizzle-orm";
import { db, clients } from "@glowos/db";
import { normalizePhone, normalizeEmail } from "./normalize.js";

/**
 * Find a client by phone (or email, as a fallback), or create one if not
 * found. Phone is normalized to E.164; email is trimmed + lowercased.
 *
 * Preserve-existing semantics: when we find a client, we DO NOT overwrite
 * their stored name or email with form input. We only fill a field if it's
 * currently null/empty. This fixes the class of bugs where a returning
 * customer books using a slightly different name (nickname, typo, married
 * name) and silently clobbers the record. Profile edits belong in a
 * dedicated profile UI, not as a side effect of a booking form.
 *
 * Throws if the phone cannot be normalized (caller must handle with a 400).
 */
export async function findOrCreateClient(
  rawPhone: string,
  name?: string,
  rawEmail?: string,
  defaultCountry: "SG" | "MY" = "SG"
): Promise<{ id: string }> {
  const phone = normalizePhone(rawPhone, defaultCountry);
  if (!phone) throw new Error("Invalid phone number");
  const email = normalizeEmail(rawEmail);

  // Try phone first, then fall back to email — a customer who switched
  // numbers but kept the same email should still be matched.
  let existing = await db
    .select({ id: clients.id, name: clients.name, email: clients.email })
    .from(clients)
    .where(eq(clients.phone, phone))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!existing && email) {
    existing = await db
      .select({ id: clients.id, name: clients.name, email: clients.email })
      .from(clients)
      .where(eq(clients.email, email))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  if (existing) {
    // Only fill blanks — never overwrite existing values. Separately, if
    // we matched via email, the phone on record may be different from the
    // one just submitted; we keep the stored phone as canonical too.
    const patch: { name?: string; email?: string } = {};
    if (!existing.name && name) patch.name = name;
    if (!existing.email && email) patch.email = email;
    if (Object.keys(patch).length > 0) {
      await db.update(clients).set(patch).where(eq(clients.id, existing.id));
    }
    return { id: existing.id };
  }

  const [created] = await db
    .insert(clients)
    .values({ phone, name, email })
    .returning({ id: clients.id });

  if (!created) throw new Error("Failed to create client");
  return created;
}

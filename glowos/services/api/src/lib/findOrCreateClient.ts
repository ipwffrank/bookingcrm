import { eq } from "drizzle-orm";
import { db, clients } from "@glowos/db";
import { normalizePhone, normalizeEmail } from "./normalize.js";

/**
 * Find a client by phone, or create one if not found.
 * Phone is normalized to E.164; email is trimmed + lowercased.
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

  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.phone, phone))
    .limit(1);

  if (existing) {
    if (name || email) {
      await db
        .update(clients)
        .set({
          ...(name ? { name } : {}),
          ...(email ? { email } : {}),
        })
        .where(eq(clients.id, existing.id));
    }
    return existing;
  }

  const [created] = await db
    .insert(clients)
    .values({ phone, name, email })
    .returning({ id: clients.id });

  if (!created) throw new Error("Failed to create client");
  return created;
}

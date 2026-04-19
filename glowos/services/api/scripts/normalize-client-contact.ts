import { db, clients } from "@glowos/db";
import { eq } from "drizzle-orm";
import { normalizePhone, normalizeEmail } from "../src/lib/normalize.js";

async function main() {
  const all = await db
    .select({
      id: clients.id,
      phone: clients.phone,
      email: clients.email,
    })
    .from(clients);

  const normalized: Array<{
    id: string;
    oldPhone: string | null;
    newPhone: string | null;
    oldEmail: string | null;
    newEmail: string | null;
  }> = [];

  // First pass: compute normalized values
  for (const row of all) {
    // Skip synthetic google_* placeholder phones — leave them alone
    if (row.phone?.startsWith("google_")) continue;
    const newPhone = normalizePhone(row.phone, "SG");
    const newEmail = normalizeEmail(row.email);
    if (newPhone !== row.phone || newEmail !== row.email) {
      normalized.push({
        id: row.id,
        oldPhone: row.phone,
        newPhone,
        oldEmail: row.email,
        newEmail,
      });
    }
  }

  // Detect collisions: two rows that would normalize to the same phone
  const byPhone = new Map<string, string[]>();
  for (const n of normalized) {
    if (!n.newPhone) continue;
    const list = byPhone.get(n.newPhone) ?? [];
    list.push(n.id);
    byPhone.set(n.newPhone, list);
  }
  // Also include rows that are already normalized
  for (const row of all) {
    if (row.phone?.startsWith("google_")) continue;
    const current = normalizePhone(row.phone, "SG");
    if (!current) continue;
    const list = byPhone.get(current) ?? [];
    if (!list.includes(row.id)) list.push(row.id);
    byPhone.set(current, list);
  }

  const collisions = Array.from(byPhone.entries()).filter(([, ids]) => ids.length > 1);
  if (collisions.length > 0) {
    console.warn("[Backfill] COLLISIONS DETECTED — manual review required. Not auto-merging.");
    for (const [phone, ids] of collisions) {
      console.warn(`  ${phone} → client ids: ${ids.join(", ")}`);
    }
  }

  // Apply updates, skipping rows involved in collisions
  const collisionIds = new Set(collisions.flatMap(([, ids]) => ids));
  let updated = 0;
  let skipped = 0;
  for (const n of normalized) {
    if (collisionIds.has(n.id)) {
      skipped++;
      continue;
    }
    const updates: { phone?: string; email?: string | null } = {};
    if (n.newPhone !== n.oldPhone && n.newPhone) updates.phone = n.newPhone;
    if (n.newEmail !== n.oldEmail) updates.email = n.newEmail;
    if (Object.keys(updates).length === 0) continue;
    await db.update(clients).set(updates).where(eq(clients.id, n.id));
    updated++;
  }

  console.log(
    `[Backfill] total=${all.length} updated=${updated} skipped(collisions)=${skipped} collisions=${collisions.length}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

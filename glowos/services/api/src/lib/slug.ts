import { eq, like } from "drizzle-orm";
import { type Database } from "@glowos/db";
import { merchants } from "@glowos/db";

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function ensureUniqueSlug(slug: string, db: Database): Promise<string> {
  // Check if the base slug exists
  const existing = await db
    .select({ slug: merchants.slug })
    .from(merchants)
    .where(like(merchants.slug, `${slug}%`));

  if (existing.length === 0) return slug;

  const slugSet = new Set(existing.map((r) => r.slug));
  if (!slugSet.has(slug)) return slug;

  let counter = 1;
  while (slugSet.has(`${slug}-${counter}`)) {
    counter++;
  }
  return `${slug}-${counter}`;
}

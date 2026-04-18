import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { db, clientNotes, clientProfiles, staff } from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import type { AppVariables } from "../lib/types.js";

const clientNotesRouter = new Hono<{ Variables: AppVariables }>();

/**
 * Resolve a profile ID (client_profiles.id) to the underlying clients.id.
 * The frontend passes the profileId in the URL because that's how client
 * detail pages are keyed. The client_notes table references clients.id.
 */
async function resolveClientId(profileId: string, merchantId: string): Promise<string | null> {
  const [row] = await db
    .select({ clientId: clientProfiles.clientId })
    .from(clientProfiles)
    .where(and(eq(clientProfiles.id, profileId), eq(clientProfiles.merchantId, merchantId)))
    .limit(1);
  return row?.clientId ?? null;
}

// GET /merchant/clients/:clientId/notes — list all notes for a client
clientNotesRouter.get("/:clientId/notes", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const profileId = c.req.param("clientId")!;

  const clientId = await resolveClientId(profileId, merchantId);
  if (!clientId) return c.json({ notes: [] });

  const notes = await db
    .select()
    .from(clientNotes)
    .where(and(eq(clientNotes.merchantId, merchantId), eq(clientNotes.clientId, clientId)))
    .orderBy(desc(clientNotes.createdAt));

  return c.json({ notes });
});

// POST /merchant/clients/:clientId/notes — add a new note
clientNotesRouter.post("/:clientId/notes", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const profileId = c.req.param("clientId")!;
  const staffId = c.get("staffId") as string | undefined;

  const clientId = await resolveClientId(profileId, merchantId);
  if (!clientId) {
    return c.json({ error: "Not Found", message: "Client not found" }, 404);
  }

  const body = await c.req.json<{ content: string }>();
  if (!body.content?.trim()) {
    return c.json({ error: "Bad Request", message: "Content is required" }, 400);
  }

  // Get the staff/user name for denormalization
  let authorName = "Admin";
  if (staffId) {
    const [s] = await db.select({ name: staff.name }).from(staff).where(eq(staff.id, staffId)).limit(1);
    if (s) authorName = s.name;
  }

  const [note] = await db.insert(clientNotes).values({
    merchantId,
    clientId,
    staffId: staffId || null,
    staffName: authorName,
    content: body.content.trim(),
  }).returning();

  return c.json({ note }, 201);
});

// DELETE /merchant/clients/:clientId/notes/:noteId — delete a note
clientNotesRouter.delete("/:clientId/notes/:noteId", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const noteId = c.req.param("noteId")!;

  await db.delete(clientNotes).where(
    and(eq(clientNotes.id, noteId), eq(clientNotes.merchantId, merchantId))
  );

  return c.json({ success: true });
});

export { clientNotesRouter };

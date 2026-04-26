import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { put, del } from "@vercel/blob";
import { randomBytes, createHash } from "node:crypto";
import {
  db,
  clinicalRecords,
  clinicalRecordAccessLog,
  clientProfiles,
  merchantUsers,
} from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";

const clinicalRecordsRouter = new Hono<{ Variables: AppVariables }>();

clinicalRecordsRouter.use("*", requireMerchant);

// Owner + manager only; staff explicitly rejected.
clinicalRecordsRouter.use("*", async (c, next) => {
  const role = c.get("userRole");
  if (role !== "owner" && role !== "manager") {
    return c.json(
      {
        error: "Forbidden",
        message: "Clinical records require owner or manager role.",
      },
      403,
    );
  }
  await next();
});

// All routes are scoped to /merchant/clients/:profileId/clinical-records, where
// profileId is a client_profiles.id. Resolve to clients.id for storage.
async function resolveClientId(
  profileId: string,
  merchantId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ clientId: clientProfiles.clientId })
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.id, profileId),
        eq(clientProfiles.merchantId, merchantId),
      ),
    )
    .limit(1);
  return row?.clientId ?? null;
}

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string | null {
  // Hono on Node behind Railway: trust X-Forwarded-For. Fall back to null.
  const xff = c.req.header("x-forwarded-for") ?? c.req.header("X-Forwarded-For");
  if (!xff) return null;
  const first = xff.split(",")[0]?.trim();
  return first || null;
}

// GET /merchant/clients/:profileId/clinical-records
// Returns the active record set: latest revision per amendment chain.
clinicalRecordsRouter.get("/:profileId/clinical-records", async (c) => {
  const merchantId = c.get("merchantId")!;
  const profileId = c.req.param("profileId")!;
  const userId = c.get("userId")!;
  const userEmail = c.get("actorEmail") ?? "";

  const clientId = await resolveClientId(profileId, merchantId);
  if (!clientId) return c.json({ records: [] });

  const rows = await db
    .select()
    .from(clinicalRecords)
    .where(
      and(
        eq(clinicalRecords.merchantId, merchantId),
        eq(clinicalRecords.clientId, clientId),
      ),
    )
    .orderBy(desc(clinicalRecords.createdAt));

  // Hide rows that have been amended by a newer row. We surface only the
  // latest revision per chain. The full chain is still queryable via
  // /clinical-records/:id/history if we add it later.
  const amendedIds = new Set(
    rows.map((r) => r.amendsId).filter((x): x is string => Boolean(x)),
  );
  const latest = rows.filter((r) => !amendedIds.has(r.id));

  // Audit log: one read row per record returned (low volume, OK).
  const ip = clientIp(c);
  if (latest.length > 0) {
    await db.insert(clinicalRecordAccessLog).values(
      latest.map((r) => ({
        merchantId,
        recordId: r.id,
        clientId,
        userId,
        userEmail,
        action: "read" as const,
        ipAddress: ip,
      })),
    );
  }

  return c.json({ records: latest });
});

// POST /merchant/clients/:profileId/clinical-records — create a new record
const createSchema = z
  .object({
    type: z.enum(["consultation_note", "treatment_log", "prescription"]),
    title: z.string().trim().max(255).optional(),
    body: z.string().trim().min(1),
    serviceId: z.string().uuid().nullable().optional(),
    bookingId: z.string().uuid().nullable().optional(),
  })
  .strict();

clinicalRecordsRouter.post(
  "/:profileId/clinical-records",
  zValidator(createSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const profileId = c.req.param("profileId")!;
    const userId = c.get("userId")!;
    const userEmail = c.get("actorEmail") ?? "";
    const body = c.get("body") as z.infer<typeof createSchema>;

    const clientId = await resolveClientId(profileId, merchantId);
    if (!clientId) {
      return c.json({ error: "Not Found", message: "Client not found" }, 404);
    }

    // Pull the author's display name from the JWT-resolved user row.
    const [user] = await db
      .select({ name: merchantUsers.name, email: merchantUsers.email })
      .from(merchantUsers)
      .where(eq(merchantUsers.id, userId))
      .limit(1);
    const authorName = user?.name ?? user?.email ?? "Admin";
    const authorEmail = user?.email ?? userEmail;

    const [record] = await db
      .insert(clinicalRecords)
      .values({
        merchantId,
        clientId,
        type: body.type,
        title: body.title ?? null,
        body: body.body.trim(),
        serviceId: body.serviceId ?? null,
        bookingId: body.bookingId ?? null,
        recordedByUserId: userId,
        recordedByName: authorName,
        recordedByEmail: authorEmail,
      })
      .returning();

    await db.insert(clinicalRecordAccessLog).values({
      merchantId,
      recordId: record.id,
      clientId,
      userId,
      userEmail: authorEmail,
      action: "write",
      ipAddress: clientIp(c),
    });

    return c.json({ record }, 201);
  },
);

// POST /merchant/clients/:profileId/clinical-records/:recordId/amend
// Creates an amendment row; the new row links to the prior via amendsId.
const amendSchema = z
  .object({
    body: z.string().trim().min(1),
    title: z.string().trim().max(255).optional(),
    amendmentReason: z.string().trim().min(1).max(1000),
  })
  .strict();

clinicalRecordsRouter.post(
  "/:profileId/clinical-records/:recordId/amend",
  zValidator(amendSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const profileId = c.req.param("profileId")!;
    const recordId = c.req.param("recordId")!;
    const userId = c.get("userId")!;
    const userEmail = c.get("actorEmail") ?? "";
    const body = c.get("body") as z.infer<typeof amendSchema>;

    const clientId = await resolveClientId(profileId, merchantId);
    if (!clientId) {
      return c.json({ error: "Not Found", message: "Client not found" }, 404);
    }

    const [prior] = await db
      .select()
      .from(clinicalRecords)
      .where(
        and(
          eq(clinicalRecords.id, recordId),
          eq(clinicalRecords.merchantId, merchantId),
          eq(clinicalRecords.clientId, clientId),
        ),
      )
      .limit(1);
    if (!prior) {
      return c.json(
        { error: "Not Found", message: "Record not found" },
        404,
      );
    }

    const [user] = await db
      .select({ name: merchantUsers.name, email: merchantUsers.email })
      .from(merchantUsers)
      .where(eq(merchantUsers.id, userId))
      .limit(1);
    const authorName = user?.name ?? user?.email ?? "Admin";
    const authorEmail = user?.email ?? userEmail;

    const [amendment] = await db
      .insert(clinicalRecords)
      .values({
        merchantId,
        clientId,
        type: prior.type,
        title: body.title ?? prior.title,
        body: body.body.trim(),
        serviceId: prior.serviceId,
        bookingId: prior.bookingId,
        recordedByUserId: userId,
        recordedByName: authorName,
        recordedByEmail: authorEmail,
        amendsId: prior.id,
        amendmentReason: body.amendmentReason.trim(),
      })
      .returning();

    await db.insert(clinicalRecordAccessLog).values({
      merchantId,
      recordId: amendment.id,
      clientId,
      userId,
      userEmail: authorEmail,
      action: "amend",
      ipAddress: clientIp(c),
    });

    return c.json({ record: amendment }, 201);
  },
);

// ─── Photo attachment types ──────────────────────────────────────────────────

interface Attachment {
  id: string;
  url: string;
  mime: string;
  size: number;
  name: string;
  kind: string;
  uploadedAt: string;
  uploadedByName: string;
}

// POST /merchant/clients/:profileId/clinical-records/:recordId/photos
// Upload a before/after/other photo. Max 10 MB, jpeg/png/webp only.
clinicalRecordsRouter.post(
  "/:profileId/clinical-records/:recordId/photos",
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const profileId = c.req.param("profileId")!;
    const recordId = c.req.param("recordId")!;
    const userId = c.get("userId")!;

    const clientId = await resolveClientId(profileId, merchantId);
    if (!clientId)
      return c.json({ error: "Not Found", message: "Client not found" }, 404);

    const [record] = await db
      .select()
      .from(clinicalRecords)
      .where(
        and(
          eq(clinicalRecords.id, recordId),
          eq(clinicalRecords.merchantId, merchantId),
          eq(clinicalRecords.clientId, clientId),
        ),
      )
      .limit(1);
    if (!record)
      return c.json({ error: "Not Found", message: "Record not found" }, 404);
    if (record.lockedAt)
      return c.json({ error: "Conflict", message: "Record is locked" }, 409);

    const form = await c.req.formData();
    const file = form.get("file");
    const kind = (form.get("kind") as string) ?? "other";

    if (!(file instanceof File))
      return c.json({ error: "Bad Request", message: "Missing file" }, 400);

    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      return c.json(
        { error: "Bad Request", message: "Photo must be jpeg/png/webp" },
        400,
      );
    }
    if (file.size > 10 * 1024 * 1024) {
      return c.json(
        { error: "Bad Request", message: "Photo must be ≤ 10 MB" },
        400,
      );
    }

    const id = randomBytes(8).toString("hex");
    const safeName = file.name
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(-80);
    const blobPath = `clinical/${merchantId}/${recordId}/${id}-${safeName}`;

    const blobResult = await put(blobPath, file, {
      access: "public",
      addRandomSuffix: false,
      contentType: file.type,
    });

    const [user] = await db
      .select({ name: merchantUsers.name, email: merchantUsers.email })
      .from(merchantUsers)
      .where(eq(merchantUsers.id, userId))
      .limit(1);
    const uploaderName = user?.name ?? user?.email ?? "Admin";

    const existingAttachments = (record.attachments as Attachment[] | null) ?? [];
    const newAttachment: Attachment = {
      id,
      url: blobResult.url,
      mime: file.type,
      size: file.size,
      name: safeName,
      kind: ["before", "after", "other"].includes(kind) ? kind : "other",
      uploadedAt: new Date().toISOString(),
      uploadedByName: uploaderName,
    };
    const updatedAttachments = [...existingAttachments, newAttachment];

    await db
      .update(clinicalRecords)
      .set({ attachments: updatedAttachments })
      .where(eq(clinicalRecords.id, recordId));

    await db.insert(clinicalRecordAccessLog).values({
      merchantId,
      recordId,
      clientId,
      userId,
      userEmail: user?.email ?? "",
      action: "amend",
      ipAddress: clientIp(c),
    });

    return c.json({ attachment: newAttachment, attachments: updatedAttachments });
  },
);

// DELETE /merchant/clients/:profileId/clinical-records/:recordId/photos/:photoId
// Remove a photo attachment and delete the blob from Vercel storage.
clinicalRecordsRouter.delete(
  "/:profileId/clinical-records/:recordId/photos/:photoId",
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const profileId = c.req.param("profileId")!;
    const recordId = c.req.param("recordId")!;
    const photoId = c.req.param("photoId")!;
    const userId = c.get("userId")!;

    const clientId = await resolveClientId(profileId, merchantId);
    if (!clientId)
      return c.json({ error: "Not Found", message: "Client not found" }, 404);

    const [record] = await db
      .select()
      .from(clinicalRecords)
      .where(
        and(
          eq(clinicalRecords.id, recordId),
          eq(clinicalRecords.merchantId, merchantId),
          eq(clinicalRecords.clientId, clientId),
        ),
      )
      .limit(1);
    if (!record)
      return c.json({ error: "Not Found", message: "Record not found" }, 404);
    if (record.lockedAt)
      return c.json({ error: "Conflict", message: "Record is locked" }, 409);

    const existing = (record.attachments as Attachment[] | null) ?? [];
    const target = existing.find((a) => a.id === photoId);
    if (!target)
      return c.json({ error: "Not Found", message: "Photo not found" }, 404);

    // Best-effort blob deletion — keep row update consistent even if Blob API fails
    await del(target.url).catch(() => {});

    const updatedAttachments = existing.filter((a) => a.id !== photoId);
    await db
      .update(clinicalRecords)
      .set({ attachments: updatedAttachments })
      .where(eq(clinicalRecords.id, recordId));

    const [user] = await db
      .select({ email: merchantUsers.email })
      .from(merchantUsers)
      .where(eq(merchantUsers.id, userId))
      .limit(1);

    await db.insert(clinicalRecordAccessLog).values({
      merchantId,
      recordId,
      clientId,
      userId,
      userEmail: user?.email ?? "",
      action: "amend",
      ipAddress: clientIp(c),
    });

    return c.json({ attachments: updatedAttachments });
  },
);

// POST /merchant/clients/:profileId/clinical-records/:recordId/consent
// Lock the record and store the signed consent form.
const consentSchema = z
  .object({
    formText: z.string().min(1).max(20000),
    signatureDataUrl: z
      .string()
      .regex(/^data:image\/png;base64,/),
    signerName: z.string().trim().min(1).max(255),
  })
  .strict();

clinicalRecordsRouter.post(
  "/:profileId/clinical-records/:recordId/consent",
  zValidator(consentSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const profileId = c.req.param("profileId")!;
    const recordId = c.req.param("recordId")!;
    const userId = c.get("userId")!;
    const userEmail = c.get("actorEmail") ?? "";
    const body = c.get("body") as z.infer<typeof consentSchema>;

    const clientId = await resolveClientId(profileId, merchantId);
    if (!clientId)
      return c.json({ error: "Not Found", message: "Client not found" }, 404);

    const [record] = await db
      .select()
      .from(clinicalRecords)
      .where(
        and(
          eq(clinicalRecords.id, recordId),
          eq(clinicalRecords.merchantId, merchantId),
          eq(clinicalRecords.clientId, clientId),
        ),
      )
      .limit(1);
    if (!record)
      return c.json({ error: "Not Found", message: "Record not found" }, 404);
    if (record.lockedAt)
      return c.json({ error: "Conflict", message: "Record is already locked" }, 409);

    // Upload signature PNG to Vercel Blob
    const base64Data = body.signatureDataUrl.split(",")[1] ?? "";
    const signatureBuffer = Buffer.from(base64Data, "base64");
    const sigId = randomBytes(8).toString("hex");
    const sigBlobPath = `clinical/${merchantId}/${recordId}/consent-signature-${sigId}.png`;

    const sigBlob = await put(sigBlobPath, signatureBuffer, {
      access: "public",
      contentType: "image/png",
    });

    // Tamper-evidence hash
    const contentHash = createHash("sha256")
      .update(body.formText + body.signatureDataUrl + body.signerName)
      .digest("hex");

    const signedConsent = {
      formText: body.formText,
      signerName: body.signerName,
      signedAt: new Date().toISOString(),
      signerIp: clientIp(c),
      signatureUrl: sigBlob.url,
      contentHash,
    };

    const [updated] = await db
      .update(clinicalRecords)
      .set({
        signedConsent,
        lockedAt: new Date(),
      })
      .where(eq(clinicalRecords.id, recordId))
      .returning();

    await db.insert(clinicalRecordAccessLog).values({
      merchantId,
      recordId,
      clientId,
      userId,
      userEmail,
      action: "amend",
      ipAddress: clientIp(c),
    });

    return c.json({ record: updated });
  },
);

// GET /merchant/clients/:profileId/clinical-records/audit-log
// Cross-record access history for one client (latest 200).
clinicalRecordsRouter.get(
  "/:profileId/clinical-records/audit-log",
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const profileId = c.req.param("profileId")!;

    const clientId = await resolveClientId(profileId, merchantId);
    if (!clientId) return c.json({ entries: [] });

    const entries = await db
      .select()
      .from(clinicalRecordAccessLog)
      .where(
        and(
          eq(clinicalRecordAccessLog.merchantId, merchantId),
          eq(clinicalRecordAccessLog.clientId, clientId),
        ),
      )
      .orderBy(desc(clinicalRecordAccessLog.createdAt))
      .limit(200);

    return c.json({ entries });
  },
);

export { clinicalRecordsRouter };

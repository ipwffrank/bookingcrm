import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { put, del, get } from "@vercel/blob";
import { randomBytes, createHash } from "node:crypto";
import {
  db,
  clinicalRecords,
  clinicalRecordAccessLog,
  clinicalRecordOdontograms,
  clientProfiles,
  merchantUsers,
  clients,
  merchants,
  bookings,
  clientNotes,
  clientPackages,
  packageSessions,
  reviews,
  type OdontogramCharting,
  type PerioProbingChart,
} from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";

const clinicalRecordsRouter = new Hono<{ Variables: AppVariables }>();

clinicalRecordsRouter.use("*", requireMerchant);

// Owner + clinician only; manager and staff explicitly rejected.
clinicalRecordsRouter.use("*", async (c, next) => {
  const role = c.get("userRole");
  if (role !== "owner" && role !== "clinician") {
    return c.json(
      {
        error: "Forbidden",
        message: "Clinical records require owner or clinician role.",
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
  pathname?: string;    // private blob path for proxy reads
  mime: string;
  size: number;
  name: string;
  kind: string;
  uploadedAt: string;
  uploadedByName: string;
  pdpaConsentAck?: boolean;
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
    const pdpaConsentAck = (form.get("pdpaConsent") as string) === "true";

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
      access: "private",
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
      pathname: blobResult.pathname,   // used by proxy endpoint
      mime: file.type,
      size: file.size,
      name: safeName,
      kind: ["before", "after", "other"].includes(kind) ? kind : "other",
      uploadedAt: new Date().toISOString(),
      uploadedByName: uploaderName,
      pdpaConsentAck,
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

    // Best-effort blob deletion — prefer pathname (private blobs), fall back to url for legacy
    await del(target.pathname ?? target.url).catch(() => {});

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
      access: "private",
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
      signaturePathname: sigBlob.pathname,   // used by proxy endpoint
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

// GET /merchant/clients/:profileId/clinical-records/:recordId/photos/:attachmentId
// Streams private blob bytes back through the API after auth + record-membership checks.
// Logs the read to clinical_record_access_log.
clinicalRecordsRouter.get(
  "/:profileId/clinical-records/:recordId/photos/:attachmentId",
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const profileId = c.req.param("profileId")!;
    const recordId = c.req.param("recordId")!;
    const attachmentId = c.req.param("attachmentId")!;
    const userId = c.get("userId")!;
    const userEmail = c.get("actorEmail") ?? "";

    const clientId = await resolveClientId(profileId, merchantId);
    if (!clientId) return c.json({ error: "Not Found", message: "Client not found" }, 404);

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
    if (!record) return c.json({ error: "Not Found", message: "Record not found" }, 404);

    const attachments = (record.attachments as Array<{ id: string; pathname?: string; url?: string; mime?: string; name?: string }> | null) ?? [];
    const target = attachments.find((a) => a.id === attachmentId);
    if (!target) return c.json({ error: "Not Found", message: "Attachment not found" }, 404);

    // Fetch from Vercel Blob (private)
    const pathname = target.pathname ?? target.url;
    if (!pathname) return c.json({ error: "Conflict", message: "Attachment has no storage path" }, 409);

    let blobResult;
    try {
      blobResult = await get(pathname, { access: "private" });
    } catch (err) {
      console.error("[clinical-records] photo proxy fetch failed", { recordId, attachmentId, err });
      return c.json({ error: "Internal Server Error", message: "Failed to fetch photo" }, 500);
    }
    if (!blobResult) {
      return c.json({ error: "Not Found", message: "Photo not found in storage" }, 404);
    }

    // Log the read for audit trail
    await db.insert(clinicalRecordAccessLog).values({
      merchantId,
      recordId,
      clientId,
      userId,
      userEmail,
      action: "read",
      ipAddress: clientIp(c),
    });

    // Stream back. blobResult.headers carries content-type; supplement if needed.
    const headers = new Headers(blobResult.headers ?? {});
    if (target.mime && !headers.get("content-type")) {
      headers.set("content-type", target.mime);
    }
    headers.set("cache-control", "private, max-age=3600"); // browser can cache for an hour

    return new Response(blobResult.stream, { status: 200, headers });
  },
);

// GET /merchant/clients/:profileId/clinical-records/:recordId/consent-signature
// Streams the consent signature PNG through the API. Auth + record-membership checked.
clinicalRecordsRouter.get(
  "/:profileId/clinical-records/:recordId/consent-signature",
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const profileId = c.req.param("profileId")!;
    const recordId = c.req.param("recordId")!;
    const userId = c.get("userId")!;
    const userEmail = c.get("actorEmail") ?? "";

    const clientId = await resolveClientId(profileId, merchantId);
    if (!clientId) return c.json({ error: "Not Found", message: "Client not found" }, 404);

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
    if (!record) return c.json({ error: "Not Found", message: "Record not found" }, 404);

    const consent = record.signedConsent as { signaturePathname?: string; signatureUrl?: string } | null;
    const pathname = consent?.signaturePathname ?? consent?.signatureUrl;
    if (!pathname) return c.json({ error: "Not Found", message: "No signature on record" }, 404);

    let blobResult;
    try {
      blobResult = await get(pathname, { access: "private" });
    } catch (err) {
      console.error("[clinical-records] consent signature proxy fetch failed", { recordId, err });
      return c.json({ error: "Internal Server Error", message: "Failed to fetch signature" }, 500);
    }
    if (!blobResult) {
      return c.json({ error: "Not Found", message: "Signature not found in storage" }, 404);
    }

    await db.insert(clinicalRecordAccessLog).values({
      merchantId,
      recordId,
      clientId,
      userId,
      userEmail,
      action: "read",
      ipAddress: clientIp(c),
    });

    const headers = new Headers(blobResult.headers ?? {});
    headers.set("content-type", "image/png");
    headers.set("cache-control", "private, max-age=3600");
    return new Response(blobResult.stream, { status: 200, headers });
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

// GET /merchant/clients/:profileId/data-export
// PDPA right of access (SG Act 2012 §21, MY Act 2010 §30).
// Returns a JSON dump of the client's full dataset. Owner/manager only.
// Logs each returned clinical record to the access log as a "read" event.
clinicalRecordsRouter.get("/:profileId/data-export", async (c) => {
  const merchantId = c.get("merchantId")!;
  const profileId = c.req.param("profileId")!;
  const userId = c.get("userId")!;
  const userEmail = c.get("actorEmail") ?? "";

  const clientId = await resolveClientId(profileId, merchantId);
  if (!clientId)
    return c.json({ error: "Not Found", message: "Client not found" }, 404);

  // Resolve the actor's role for the export envelope.
  const [actorUser] = await db
    .select({ name: merchantUsers.name, email: merchantUsers.email, role: merchantUsers.role })
    .from(merchantUsers)
    .where(eq(merchantUsers.id, userId))
    .limit(1);

  // Fetch the merchant name for the data_controller field.
  const [merchant] = await db
    .select({ name: merchants.name })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  // Fetch the client + their merchant-scoped profile.
  const [clientRow] = await db
    .select()
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  const [profileRow] = await db
    .select()
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.clientId, clientId),
        eq(clientProfiles.merchantId, merchantId),
      ),
    )
    .limit(1);

  // Fetch all bookings for this client at this merchant.
  const bookingRows = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.clientId, clientId),
        eq(bookings.merchantId, merchantId),
      ),
    )
    .orderBy(desc(bookings.startTime));

  // Fetch all client notes.
  const noteRows = await db
    .select()
    .from(clientNotes)
    .where(
      and(
        eq(clientNotes.clientId, clientId),
        eq(clientNotes.merchantId, merchantId),
      ),
    )
    .orderBy(desc(clientNotes.createdAt));

  // Fetch ALL clinical record revisions (not just latest) for completeness.
  const recordRows = await db
    .select()
    .from(clinicalRecords)
    .where(
      and(
        eq(clinicalRecords.clientId, clientId),
        eq(clinicalRecords.merchantId, merchantId),
      ),
    )
    .orderBy(clinicalRecords.createdAt);

  // Fetch the clinical record access log for this client.
  const accessLogRows = await db
    .select()
    .from(clinicalRecordAccessLog)
    .where(
      and(
        eq(clinicalRecordAccessLog.clientId, clientId),
        eq(clinicalRecordAccessLog.merchantId, merchantId),
      ),
    )
    .orderBy(clinicalRecordAccessLog.createdAt);

  // Fetch client packages + their sessions.
  const pkgRows = await db
    .select()
    .from(clientPackages)
    .where(
      and(
        eq(clientPackages.clientId, clientId),
        eq(clientPackages.merchantId, merchantId),
      ),
    )
    .orderBy(clientPackages.purchasedAt);

  const pkgIds = pkgRows.map((p) => p.id);
  let sessionRows: (typeof packageSessions.$inferSelect)[] = [];
  if (pkgIds.length > 0) {
    // Drizzle's `inArray` would require an import; use a simple forEach approach
    // to avoid adding a new operator import. Typically packages are few per client.
    const sessionPromises = pkgIds.map((pkgId) =>
      db
        .select()
        .from(packageSessions)
        .where(eq(packageSessions.clientPackageId, pkgId))
        .orderBy(packageSessions.sessionNumber),
    );
    const sessionArrays = await Promise.all(sessionPromises);
    sessionRows = sessionArrays.flat();
  }

  // Fetch reviews by this client at this merchant.
  const reviewRows = await db
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.clientId, clientId),
        eq(reviews.merchantId, merchantId),
      ),
    )
    .orderBy(reviews.createdAt);

  // Audit log: log a "read" entry for each clinical record being exported.
  // We mark the ipAddress field with a "pdpa-export:" prefix so auditors can
  // distinguish data-export events from ordinary reads. varchar(64) is large
  // enough for "pdpa-export:" + an IPv6 address.
  const ip = clientIp(c);
  const exportIpMarker = `pdpa-export${ip ? `:${ip}` : ""}`.slice(0, 64);
  if (recordRows.length > 0) {
    await db.insert(clinicalRecordAccessLog).values(
      recordRows.map((r) => ({
        merchantId,
        recordId: r.id,
        clientId,
        userId,
        userEmail: actorUser?.email ?? userEmail,
        action: "read" as const,
        ipAddress: exportIpMarker,
      })),
    );
  }

  const payload = {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    generated_by: {
      user_id: userId,
      email: actorUser?.email ?? userEmail,
      role: actorUser?.role ?? "unknown",
    },
    data_controller: {
      merchant_id: merchantId,
      merchant_name: merchant?.name ?? null,
    },
    subject: {
      client_id: clientId,
      name: clientRow?.name ?? null,
      phone: clientRow?.phone ?? null,
      email: clientRow?.email ?? null,
    },
    client_profile: profileRow ?? null,
    bookings: bookingRows,
    client_notes: noteRows,
    clinical_records: recordRows,
    clinical_record_access_log: accessLogRows,
    client_packages: pkgRows.map((pkg) => ({
      ...pkg,
      sessions: sessionRows.filter((s) => s.clientPackageId === pkg.id),
    })),
    reviews: reviewRows,
  };

  c.header(
    "Content-Disposition",
    `attachment; filename="client-data-export-${clientId}-${Date.now()}.json"`,
  );
  return c.json(payload);
});

// ─── Dental odontogram (MDC 2024) ────────────────────────────────────────
//
// Three endpoints scoped to dental merchants only. Vertical guard rejects
// non-dental merchants with 403 — UI uses that signal to render a
// fallback rather than mounting the chart.
//
//   GET  /merchant/clients/:profileId/odontogram
//        → latest snapshot for this client (across visits) or for a
//          specific recordId via ?recordId=.
//
//   GET  /merchant/clients/:profileId/odontogram/history?limit=N&beforeRecordId=
//        → latest N snapshots in descending chronological order. Used
//          for the cross-visit overlay ("show previous visit" toggle).
//
//   POST /merchant/clients/:profileId/odontogram
//        → upsert a chart tied to a clinical_records row. Locked records
//          are rejected — caller must amend the record first.
//
// Auth: piggybacks on this router's owner/clinician role gate above.

async function assertDentalVertical(merchantId: string): Promise<boolean> {
  const [m] = await db
    .select({ vertical: merchants.vertical })
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);
  return m?.vertical === "dental";
}

const upsertOdontogramSchema = z.object({
  // Optional: when absent, the route auto-creates a stub clinical_records
  // row of type='treatment_log' so the dentist can chart without creating
  // a separate consultation note first. They can amend the auto-stub later
  // to add proper notes if they want.
  clinical_record_id: z.string().uuid().optional(),
  charting: z.record(z.string(), z.object({
    whole: z.string().optional(),
    surfaces: z.record(z.string(), z.array(z.string())).optional(),
    notes: z.string().optional(),
  })),
  charting_notes: z.string().optional().nullable(),
  perio_probing: z.record(z.string(), z.object({
    mesial_buccal: z.number(),
    mid_buccal: z.number(),
    distal_buccal: z.number(),
    mesial_lingual: z.number(),
    mid_lingual: z.number(),
    distal_lingual: z.number(),
    bop: z.record(z.string(), z.boolean()).optional(),
    recession: z.record(z.string(), z.number()).optional(),
  })).optional().nullable(),
});

clinicalRecordsRouter.get("/:profileId/odontogram", async (c) => {
  const merchantId = c.get("merchantId")!;
  const profileId = c.req.param("profileId")!;
  const recordId = c.req.query("recordId");

  if (!(await assertDentalVertical(merchantId))) {
    return c.json(
      { error: "Forbidden", message: "Odontogram is available only for dental clinics." },
      403,
    );
  }

  const clientId = await resolveClientId(profileId, merchantId);
  if (!clientId) {
    return c.json({ error: "Not Found", message: "Client not found." }, 404);
  }

  const baseFilters = [
    eq(clinicalRecordOdontograms.merchantId, merchantId),
    eq(clinicalRecordOdontograms.clientId, clientId),
  ];
  const filters = recordId
    ? [...baseFilters, eq(clinicalRecordOdontograms.clinicalRecordId, recordId)]
    : baseFilters;

  const [row] = await db
    .select()
    .from(clinicalRecordOdontograms)
    .where(and(...filters))
    .orderBy(desc(clinicalRecordOdontograms.createdAt))
    .limit(1);

  if (!row) {
    return c.json(
      { charting: {}, charting_notes: null, perio_probing: null },
      200,
    );
  }

  return c.json({
    id: row.id,
    clinical_record_id: row.clinicalRecordId,
    charting: row.charting,
    charting_notes: row.chartingNotes,
    perio_probing: row.perioProbing,
    recorded_by_name: row.recordedByName,
    recorded_at: row.createdAt,
    updated_at: row.updatedAt,
  });
});

clinicalRecordsRouter.get("/:profileId/odontogram/history", async (c) => {
  const merchantId = c.get("merchantId")!;
  const profileId = c.req.param("profileId")!;
  const limit = Math.min(parseInt(c.req.query("limit") ?? "2", 10), 12);
  const beforeRecordId = c.req.query("beforeRecordId");

  if (!(await assertDentalVertical(merchantId))) {
    return c.json(
      { error: "Forbidden", message: "Odontogram is available only for dental clinics." },
      403,
    );
  }

  const clientId = await resolveClientId(profileId, merchantId);
  if (!clientId) {
    return c.json({ error: "Not Found", message: "Client not found." }, 404);
  }

  // Fetch limit + 1 to allow filtering out beforeRecordId without short-changing N.
  const fetchLimit = beforeRecordId ? limit + 1 : limit;
  let rows = await db
    .select()
    .from(clinicalRecordOdontograms)
    .where(
      and(
        eq(clinicalRecordOdontograms.merchantId, merchantId),
        eq(clinicalRecordOdontograms.clientId, clientId),
      ),
    )
    .orderBy(desc(clinicalRecordOdontograms.createdAt))
    .limit(fetchLimit);

  if (beforeRecordId) {
    rows = rows.filter((r) => r.clinicalRecordId !== beforeRecordId).slice(0, limit);
  }

  return c.json({
    history: rows.map((r) => ({
      id: r.id,
      clinical_record_id: r.clinicalRecordId,
      charting: r.charting,
      charting_notes: r.chartingNotes,
      recorded_by_name: r.recordedByName,
      created_at: r.createdAt,
    })),
  });
});

clinicalRecordsRouter.post(
  "/:profileId/odontogram",
  zValidator(upsertOdontogramSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const userId = c.get("userId")!;
    const profileId = c.req.param("profileId")!;
    const body = c.get("body") as z.infer<typeof upsertOdontogramSchema>;

    if (!(await assertDentalVertical(merchantId))) {
      return c.json(
        { error: "Forbidden", message: "Odontogram is available only for dental clinics." },
        403,
      );
    }

    const clientId = await resolveClientId(profileId, merchantId);
    if (!clientId) {
      return c.json({ error: "Not Found", message: "Client not found." }, 404);
    }

    // Author identity for audit (needed up front for the auto-stub path).
    const [author] = await db
      .select({ name: merchantUsers.name, email: merchantUsers.email })
      .from(merchantUsers)
      .where(eq(merchantUsers.id, userId))
      .limit(1);
    if (!author) {
      return c.json({ error: "Unauthorized", message: "User not found." }, 401);
    }

    // Resolve the parent clinical_records row. Two paths:
    //   1. Caller passed clinical_record_id — verify it belongs to this
    //      merchant+client and isn't locked.
    //   2. Caller omitted it — auto-create a stub treatment_log record so
    //      the dentist can chart without creating a separate note first.
    //      The stub can be amended later (Add notes / change type) — the
    //      audit chain remains intact because we use clinical_records'
    //      existing append-only pattern.
    let resolvedRecordId: string;
    let recordWasAutoCreated = false;

    if (body.clinical_record_id) {
      const [parent] = await db
        .select({ id: clinicalRecords.id, lockedAt: clinicalRecords.lockedAt })
        .from(clinicalRecords)
        .where(
          and(
            eq(clinicalRecords.id, body.clinical_record_id),
            eq(clinicalRecords.merchantId, merchantId),
            eq(clinicalRecords.clientId, clientId),
          ),
        )
        .limit(1);
      if (!parent) {
        return c.json({ error: "Not Found", message: "Clinical record not found." }, 404);
      }
      if (parent.lockedAt) {
        return c.json(
          { error: "Conflict", message: "Clinical record is locked. Create an amendment first." },
          409,
        );
      }
      resolvedRecordId = parent.id;
    } else {
      // Auto-create a stub parent record dated now. type='treatment_log'
      // is more permissive than 'consultation_note' (no implication that
      // a full consultation occurred). Body is intentionally minimal —
      // the dentist can amend it later with a richer narrative.
      const [stub] = await db
        .insert(clinicalRecords)
        .values({
          merchantId,
          clientId,
          type: "treatment_log",
          title: "Dental charting visit",
          body: "Charting recorded via odontogram. Amend this record to add visit notes, diagnosis, or treatment plan.",
          recordedByUserId: userId,
          recordedByName: author.name,
          recordedByEmail: author.email,
        })
        .returning({ id: clinicalRecords.id });
      resolvedRecordId = stub.id;
      recordWasAutoCreated = true;

      // Log the auto-creation of the parent record so the audit trail
      // shows where it came from.
      await db.insert(clinicalRecordAccessLog).values({
        merchantId,
        recordId: stub.id,
        clientId,
        userId,
        userEmail: author.email,
        action: "write",
        ipAddress: clientIp(c),
      });
    }

    // Upsert (one row per clinical_record_id — see unique index)
    const [saved] = await db
      .insert(clinicalRecordOdontograms)
      .values({
        clinicalRecordId: resolvedRecordId,
        merchantId,
        clientId,
        charting: body.charting as OdontogramCharting,
        chartingNotes: body.charting_notes ?? null,
        perioProbing: (body.perio_probing as PerioProbingChart) ?? null,
        recordedByUserId: userId,
        recordedByName: author.name,
        recordedByEmail: author.email,
      })
      .onConflictDoUpdate({
        target: clinicalRecordOdontograms.clinicalRecordId,
        set: {
          charting: body.charting as OdontogramCharting,
          chartingNotes: body.charting_notes ?? null,
          perioProbing: (body.perio_probing as PerioProbingChart) ?? null,
          recordedByUserId: userId,
          recordedByName: author.name,
          recordedByEmail: author.email,
          updatedAt: new Date(),
        },
      })
      .returning();

    // Audit the chart write itself.
    await db.insert(clinicalRecordAccessLog).values({
      merchantId,
      recordId: resolvedRecordId,
      clientId,
      userId,
      userEmail: author.email,
      action: "write",
      ipAddress: clientIp(c),
    });

    return c.json({
      id: saved.id,
      clinical_record_id: saved.clinicalRecordId,
      charting: saved.charting,
      charting_notes: saved.chartingNotes,
      perio_probing: saved.perioProbing,
      recorded_by_name: saved.recordedByName,
      updated_at: saved.updatedAt,
      // Lets the front-end know to refresh its parent clinical_records
      // list (a new record now exists) and to display a friendly
      // "saved as new visit" status to the dentist.
      auto_created_parent_record: recordWasAutoCreated,
    });
  },
);

export { clinicalRecordsRouter };

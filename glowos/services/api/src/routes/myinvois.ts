/**
 * MyInvois (LHDN e-invoicing) routes — MVP scope.
 *
 * Owner-only endpoints for clinic-side configuration + diagnostic checks.
 * Submission / cancel / refund / poll endpoints land in follow-up PRs once
 * the signing pipeline + UBL builder ship.
 *
 * Routes:
 *   GET  /merchant/myinvois/config             — read current config
 *   PUT  /merchant/myinvois/config             — upsert config
 *   POST /merchant/myinvois/test-connection    — fetch a token; surface success/failure
 */

import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  merchantMyinvoisConfigs,
  type MyInvoisEnvironment,
} from "@glowos/db";
import { requireMerchant, requireRole } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import {
  forceRefreshAccessToken,
  loadMyInvoisConfig,
  MyInvoisConfigError,
  MyInvoisError,
} from "../lib/myinvois.js";
import type { AppVariables } from "../lib/types.js";

const myinvoisRouter = new Hono<{ Variables: AppVariables }>();
myinvoisRouter.use("*", requireMerchant);

// ─── GET /merchant/myinvois/config ───────────────────────────────────────

myinvoisRouter.get("/config", async (c) => {
  const merchantId = c.get("merchantId")!;
  const cfg = await loadMyInvoisConfig(merchantId);
  if (!cfg) {
    return c.json({ config: null });
  }
  // Redact secrets — never return them to the client even if the caller
  // is the owner. The settings UI shows "•••• configured" and offers a
  // "Replace" action that overwrites by re-uploading.
  return c.json({
    config: {
      id: cfg.id,
      enabled: cfg.enabled,
      environment: cfg.environment,
      tin: cfg.tin,
      businessRegistrationNumber: cfg.businessRegistrationNumber,
      businessRegistrationType: cfg.businessRegistrationType,
      sstRegistrationNumber: cfg.sstRegistrationNumber,
      tourismTaxRegistrationNumber: cfg.tourismTaxRegistrationNumber,
      msicIndustryCode: cfg.msicIndustryCode,
      businessActivityDescription: cfg.businessActivityDescription,
      hasClientCredentials: !!(cfg.clientId && cfg.clientSecret),
      hasDigitalCertificate: !!cfg.digitalCertificatePfxBase64,
      certSubjectCn: cfg.certSubjectCn,
      certIssuerName: cfg.certIssuerName,
      certExpiresAt: cfg.certExpiresAt,
      tokenExpiresAt: cfg.tokenExpiresAt,
      lastTokenRefreshAt: cfg.lastTokenRefreshAt,
      createdAt: cfg.createdAt,
      updatedAt: cfg.updatedAt,
    },
  });
});

// ─── PUT /merchant/myinvois/config ───────────────────────────────────────

const upsertConfigSchema = z.object({
  enabled: z.boolean().optional(),
  environment: z.enum(["sandbox", "production"]).optional(),
  tin: z.string().trim().min(1).max(20).nullable().optional(),
  business_registration_number: z.string().trim().min(1).max(50).nullable().optional(),
  business_registration_type: z.enum(["BRN", "NRIC", "PASSPORT", "ARMY"]).nullable().optional(),
  sst_registration_number: z.string().trim().max(50).nullable().optional(),
  tourism_tax_registration_number: z.string().trim().max(50).nullable().optional(),
  msic_industry_code: z.string().trim().max(10).nullable().optional(),
  business_activity_description: z.string().trim().max(500).nullable().optional(),
  // Per-clinic ERP creds — optional; absent = use platform-level creds
  // (intermediary mode). Send empty string to clear.
  client_id: z.string().trim().max(255).nullable().optional(),
  client_secret: z.string().trim().max(2048).nullable().optional(),
  // PFX upload — base64-encoded; password sent separately. Server-side
  // could parse the cert to populate cert_subject_cn / issuer / expiry,
  // but cert-parsing isn't wired in MVP. Saturday's onboarding-wizard
  // PR will add `node-forge` and populate these fields automatically.
  digital_certificate_pfx_base64: z.string().nullable().optional(),
  digital_certificate_password: z.string().nullable().optional(),
});

myinvoisRouter.put(
  "/config",
  requireRole("owner"),
  zValidator(upsertConfigSchema),
  async (c) => {
    const merchantId = c.get("merchantId")!;
    const userId = c.get("userId")!;
    const body = c.get("body") as z.infer<typeof upsertConfigSchema>;

    const existing = await loadMyInvoisConfig(merchantId);

    const setValues = {
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.environment !== undefined
        ? { environment: body.environment as MyInvoisEnvironment }
        : {}),
      ...(body.tin !== undefined ? { tin: body.tin } : {}),
      ...(body.business_registration_number !== undefined
        ? { businessRegistrationNumber: body.business_registration_number }
        : {}),
      ...(body.business_registration_type !== undefined
        ? { businessRegistrationType: body.business_registration_type }
        : {}),
      ...(body.sst_registration_number !== undefined
        ? { sstRegistrationNumber: body.sst_registration_number }
        : {}),
      ...(body.tourism_tax_registration_number !== undefined
        ? { tourismTaxRegistrationNumber: body.tourism_tax_registration_number }
        : {}),
      ...(body.msic_industry_code !== undefined
        ? { msicIndustryCode: body.msic_industry_code }
        : {}),
      ...(body.business_activity_description !== undefined
        ? { businessActivityDescription: body.business_activity_description }
        : {}),
      ...(body.client_id !== undefined ? { clientId: body.client_id } : {}),
      ...(body.client_secret !== undefined ? { clientSecret: body.client_secret } : {}),
      ...(body.digital_certificate_pfx_base64 !== undefined
        ? { digitalCertificatePfxBase64: body.digital_certificate_pfx_base64 }
        : {}),
      ...(body.digital_certificate_password !== undefined
        ? { digitalCertificatePassword: body.digital_certificate_password }
        : {}),
      // Invalidate cached token whenever creds or environment change so the
      // next request fetches a fresh one against the right environment.
      ...(body.client_id !== undefined ||
      body.client_secret !== undefined ||
      body.environment !== undefined
        ? { cachedAccessToken: null, tokenExpiresAt: null }
        : {}),
      updatedAt: new Date(),
      updatedByUserId: userId,
    };

    if (existing) {
      const [updated] = await db
        .update(merchantMyinvoisConfigs)
        .set(setValues)
        .where(eq(merchantMyinvoisConfigs.id, existing.id))
        .returning({ id: merchantMyinvoisConfigs.id });
      return c.json({ id: updated.id });
    }

    const [created] = await db
      .insert(merchantMyinvoisConfigs)
      .values({
        merchantId,
        createdByUserId: userId,
        ...setValues,
      })
      .returning({ id: merchantMyinvoisConfigs.id });

    return c.json({ id: created.id });
  },
);

// ─── POST /merchant/myinvois/test-connection ─────────────────────────────
//
// Owner clicks "Test connection" in Settings → forces a fresh token fetch
// against LHDN. Surfaces success / failure with a usable error message
// so the clinic can fix bad creds without contacting support.

myinvoisRouter.post("/test-connection", requireRole("owner"), async (c) => {
  const merchantId = c.get("merchantId")!;
  try {
    const token = await forceRefreshAccessToken(merchantId);
    const cfg = await loadMyInvoisConfig(merchantId);
    return c.json({
      ok: true,
      environment: cfg?.environment ?? "sandbox",
      // Don't return the actual token — just enough to show the UI it worked.
      token_preview: `${token.slice(0, 6)}…${token.slice(-4)}`,
      expires_at: cfg?.tokenExpiresAt,
    });
  } catch (err) {
    if (err instanceof MyInvoisConfigError) {
      return c.json({ ok: false, error: "config", message: err.message }, 400);
    }
    if (err instanceof MyInvoisError) {
      return c.json(
        {
          ok: false,
          error: "lhdn",
          message: err.message,
          status_code: err.statusCode,
          response_body: err.responseBody,
        },
        // Status 200 — the test endpoint always returns 200; the body's
        // `ok` flag is the truth. Keeps front-end error handling simple.
        200,
      );
    }
    return c.json(
      {
        ok: false,
        error: "unexpected",
        message: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});

export { myinvoisRouter };

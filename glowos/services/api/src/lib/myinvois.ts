/**
 * MyInvois (LHDN Malaysia e-invoicing) API client.
 *
 * MVP scope: OAuth2 client_credentials auth + token cache. Submission,
 * cancellation, document fetch, and the signing pipeline are deliberately
 * NOT in this file — they ship in follow-up PRs once a real ERP-credential
 * pair has been registered with LHDN's developer portal and we can do
 * sandbox round-trips against `preprod-api.myinvois.hasil.gov.my`.
 *
 * Auth model (per LHDN SDK):
 *   - OAuth2 client_credentials grant only (no mTLS)
 *   - Token TTL ~60 min; we refresh when within 60 s of expiry
 *   - Tokens cached on `merchant_myinvois_configs` so we don't burn the
 *     LHDN rate limit on every submission
 *   - For intermediary mode (GlowOS submitting on behalf of a clinic),
 *     the platform holds ONE ERP credential pair (env vars); per-clinic
 *     authorization happens via the `onbehalfof` header on submit, not
 *     via separate per-clinic creds. The `merchant_myinvois_configs.client_id`
 *     and `client_secret` columns exist for non-intermediary clinics
 *     (clinics that registered their own ERP — rare but supported).
 *
 * Environments:
 *   - sandbox (preprod): https://preprod-api.myinvois.hasil.gov.my
 *   - production:        https://api.myinvois.hasil.gov.my
 */

import { eq } from "drizzle-orm";
import { db, merchantMyinvoisConfigs, type MyInvoisEnvironment } from "@glowos/db";

// ─── Constants ───────────────────────────────────────────────────────────

const BASE_URLS: Record<MyInvoisEnvironment, string> = {
  sandbox: "https://preprod-api.myinvois.hasil.gov.my",
  production: "https://api.myinvois.hasil.gov.my",
};

/** Refresh tokens 60 s before expiry to avoid mid-submission auth failures. */
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

/** Sentinel TTL when the auth response doesn't include `expires_in` (defensive). */
const FALLBACK_TOKEN_TTL_MS = 50 * 60 * 1000; // 50 min

// ─── Types ───────────────────────────────────────────────────────────────

export interface MyInvoisCredentials {
  clientId: string;
  clientSecret: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string; // typically 'Bearer'
  expires_in: number; // seconds
  scope?: string;
}

// ─── Errors ──────────────────────────────────────────────────────────────

export class MyInvoisError extends Error {
  readonly statusCode: number | null;
  readonly responseBody: unknown;

  constructor(message: string, opts: { statusCode?: number; responseBody?: unknown } = {}) {
    super(message);
    this.name = "MyInvoisError";
    this.statusCode = opts.statusCode ?? null;
    this.responseBody = opts.responseBody;
  }
}

export class MyInvoisConfigError extends MyInvoisError {
  constructor(message: string) {
    super(message);
    this.name = "MyInvoisConfigError";
  }
}

// ─── Platform-level ERP credentials ──────────────────────────────────────
// GlowOS-as-intermediary uses ONE ERP credential pair across all clinics.
// Sandbox + production live in env vars. Per-clinic config rows can also
// hold their own client_id/secret if a clinic operates non-intermediary —
// the resolution function below prefers per-clinic when present, falls
// back to platform.

function platformCredentials(env: MyInvoisEnvironment): MyInvoisCredentials | null {
  const idVar = env === "production" ? "MYINVOIS_PROD_CLIENT_ID" : "MYINVOIS_SANDBOX_CLIENT_ID";
  const secretVar =
    env === "production" ? "MYINVOIS_PROD_CLIENT_SECRET" : "MYINVOIS_SANDBOX_CLIENT_SECRET";
  const clientId = process.env[idVar];
  const clientSecret = process.env[secretVar];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// ─── Config loader ───────────────────────────────────────────────────────

export async function loadMyInvoisConfig(merchantId: string) {
  const [cfg] = await db
    .select()
    .from(merchantMyinvoisConfigs)
    .where(eq(merchantMyinvoisConfigs.merchantId, merchantId))
    .limit(1);
  return cfg ?? null;
}

/**
 * Resolve which (clientId, clientSecret) to use for the OAuth2 token call.
 * Priority:
 *   1. Per-clinic creds on `merchant_myinvois_configs` (clinic registered
 *      its own ERP — rare but supported)
 *   2. Platform-level creds from env (`MYINVOIS_{SANDBOX|PROD}_CLIENT_*`)
 *      — the intermediary mode default
 */
function resolveCredentials(cfg: typeof merchantMyinvoisConfigs.$inferSelect): MyInvoisCredentials {
  if (cfg.clientId && cfg.clientSecret) {
    return { clientId: cfg.clientId, clientSecret: cfg.clientSecret };
  }
  const platform = platformCredentials(cfg.environment);
  if (!platform) {
    throw new MyInvoisConfigError(
      `No MyInvois credentials available for merchant ${cfg.merchantId} (environment=${cfg.environment}). ` +
        `Set MYINVOIS_${cfg.environment.toUpperCase()}_CLIENT_ID and CLIENT_SECRET env vars, ` +
        `or populate merchant_myinvois_configs.client_id / client_secret for this merchant.`,
    );
  }
  return platform;
}

// ─── Token cache + refresh ───────────────────────────────────────────────

/**
 * Get a valid access token for the given merchant. Uses the cached token
 * on `merchant_myinvois_configs` when it's not within the refresh buffer
 * of expiry, otherwise hits LHDN's `/connect/token` and persists the new
 * token + expiry back to the row.
 *
 * Throws `MyInvoisConfigError` when:
 *   - no config row exists for this merchant
 *   - the merchant is not enabled (cfg.enabled = false)
 *   - resolveCredentials can't find a clientId/secret pair
 *
 * Throws `MyInvoisError` when LHDN returns a non-2xx (auth failure, rate
 * limit, etc.) — caller should surface the message to the clinic UI so
 * they can fix their creds without contacting support.
 */
export async function getAccessToken(merchantId: string): Promise<string> {
  const cfg = await loadMyInvoisConfig(merchantId);
  if (!cfg) {
    throw new MyInvoisConfigError(
      `MyInvois not configured for merchant ${merchantId}. Run the onboarding wizard first.`,
    );
  }
  if (!cfg.enabled) {
    throw new MyInvoisConfigError(
      `MyInvois is disabled for merchant ${merchantId}. Enable it in Settings → MyInvois first.`,
    );
  }

  // Cache hit?
  const now = Date.now();
  if (
    cfg.cachedAccessToken &&
    cfg.tokenExpiresAt &&
    cfg.tokenExpiresAt.getTime() - now > TOKEN_REFRESH_BUFFER_MS
  ) {
    return cfg.cachedAccessToken;
  }

  // Refresh
  const creds = resolveCredentials(cfg);
  const url = `${BASE_URLS[cfg.environment]}/connect/token`;
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: "client_credentials",
    scope: "InvoicingAPI",
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    throw new MyInvoisError(
      `Network error calling MyInvois /connect/token: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const responseText = await response.text();
  if (!response.ok) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      parsed = responseText;
    }
    throw new MyInvoisError(
      `MyInvois /connect/token returned ${response.status}: ${responseText.slice(0, 200)}`,
      { statusCode: response.status, responseBody: parsed },
    );
  }

  let parsed: TokenResponse;
  try {
    parsed = JSON.parse(responseText) as TokenResponse;
  } catch {
    throw new MyInvoisError(
      `MyInvois /connect/token returned non-JSON body: ${responseText.slice(0, 200)}`,
      { statusCode: response.status, responseBody: responseText },
    );
  }

  if (!parsed.access_token) {
    throw new MyInvoisError(
      `MyInvois /connect/token response missing access_token field`,
      { statusCode: response.status, responseBody: parsed },
    );
  }

  const ttlMs = (parsed.expires_in ? parsed.expires_in * 1000 : FALLBACK_TOKEN_TTL_MS);
  const expiresAt = new Date(now + ttlMs);

  // Persist to the config row.
  await db
    .update(merchantMyinvoisConfigs)
    .set({
      cachedAccessToken: parsed.access_token,
      tokenExpiresAt: expiresAt,
      lastTokenRefreshAt: new Date(now),
      updatedAt: new Date(now),
    })
    .where(eq(merchantMyinvoisConfigs.id, cfg.id));

  return parsed.access_token;
}

/**
 * Force-refresh the cached token, ignoring the existing one. Useful for
 * the onboarding wizard's "Test connection" button (must always hit the
 * live LHDN endpoint to validate the creds).
 */
export async function forceRefreshAccessToken(merchantId: string): Promise<string> {
  await db
    .update(merchantMyinvoisConfigs)
    .set({
      cachedAccessToken: null,
      tokenExpiresAt: null,
    })
    .where(eq(merchantMyinvoisConfigs.merchantId, merchantId));
  return getAccessToken(merchantId);
}

// ─── Headers helper ──────────────────────────────────────────────────────
//
// Intermediary mode injects `onbehalfof: <clinic-TIN>` so LHDN attributes
// the submission to the clinic, not to GlowOS's platform TIN. Used by all
// protected endpoints in follow-up PRs (submit, cancel, get document,
// search). Pulled out here so we don't sprinkle the header logic across
// each route.

export async function buildAuthHeaders(merchantId: string): Promise<Record<string, string>> {
  const token = await getAccessToken(merchantId);
  const cfg = await loadMyInvoisConfig(merchantId);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  // Only inject `onbehalfof` when running in intermediary mode (i.e. the
  // platform creds are being used, not the clinic's own creds). Detection:
  // if the config row's clientId is null but we have a TIN, it's
  // intermediary mode.
  if (!cfg) return headers;
  const usingPlatformCreds = !cfg.clientId || !cfg.clientSecret;
  if (usingPlatformCreds && cfg.tin) {
    headers.onbehalfof = cfg.tin;
  }
  return headers;
}

// ─── Public-facing portal URL helpers (for QR code) ──────────────────────

export function publicValidationUrl(args: {
  environment: MyInvoisEnvironment;
  uuid: string;
  longId: string;
}): string {
  const portal =
    args.environment === "production"
      ? "https://myinvois.hasil.gov.my"
      : "https://preprod.myinvois.hasil.gov.my";
  return `${portal}/${args.uuid}/share/${args.longId}`;
}

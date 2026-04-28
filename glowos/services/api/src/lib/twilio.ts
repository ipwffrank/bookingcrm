import twilio from "twilio";
import { config } from "./config.js";

// ─── Twilio client ─────────────────────────────────────────────────────────────

export const twilioClient = twilio(config.twilioAccountSid, config.twilioAuthToken);

// ─── Phone normalization ───────────────────────────────────────────────────────

/**
 * Twilio rejects anything that isn't strict E.164 (e.g. `+6596721317`). Seed
 * data, Settings forms, and pasted phones often contain spaces, dashes, or
 * parens (`+65 6733 8801`, `+1 (415) 555-1212`). Be liberal on input — strip
 * everything that isn't a digit or a leading `+`. This avoids the "to: invalid
 * format" rejection at the Twilio edge before the message ever leaves our
 * service.
 */
function normalizePhone(raw: string): string {
  return raw.trim().replace(/[\s\-()]/g, "");
}

// ─── Sandbox allowlist gate ────────────────────────────────────────────────────

// Twilio's well-known WhatsApp Sandbox sender. When `twilioWhatsappFrom`
// equals this, sends to non-joined recipients fail with error 63015 AND
// count toward the sandbox's 50/day account-wide quota — burning budget
// on guaranteed-failed sends. We pre-empt that by skipping the API call
// and recording a clear `notification_log` entry instead.
const TWILIO_WHATSAPP_SANDBOX_FROM = "+14155238886";

function isSandboxModeEnabled(): boolean {
  return config.twilioWhatsappFrom === TWILIO_WHATSAPP_SANDBOX_FROM;
}

/**
 * Returns true when the recipient is allowed in the current Twilio
 * configuration. In production (any `twilioWhatsappFrom` other than the
 * sandbox number) this is always true. In sandbox mode it returns true
 * only if the (normalized) phone is in `SANDBOX_JOINED_PHONES`.
 */
function isSandboxRecipientAllowed(normalized: string): boolean {
  if (!isSandboxModeEnabled()) return true;
  return config.sandboxJoinedPhones.includes(normalized);
}

// ─── Sender result type ────────────────────────────────────────────────────────

export interface SendResult {
  ok: boolean;
  sid?: string;
  error?: string;
}

const SANDBOX_SKIP_REASON =
  "Skipped: Twilio sandbox mode + recipient phone is not in SANDBOX_JOINED_PHONES. " +
  "Either add the phone to the env (after they text 'join <keyword>' to +14155238886), " +
  "or upgrade out of sandbox to a production WhatsApp Business sender.";

// ─── sendWhatsApp ──────────────────────────────────────────────────────────────

/**
 * Send a freeform WhatsApp message via Twilio.
 *
 * IMPORTANT: WhatsApp Business API (Twilio's upstream) has a 24-hour
 * customer-service window — freeform text only delivers if the recipient
 * messaged us in the last 24h. Outside the window, Twilio returns error
 * 63016 and the message is dropped.
 *
 * Use this for freeform within a known open session (e.g. confirmation
 * reply after a client-initiated booking). For anything the business
 * INITIATES (OTP, reminder, cancellation alert, rebook CTA) use
 * `sendWhatsAppTemplate` with an approved Content Template ContentSid.
 *
 * Returns `{ ok, sid?, error? }` so callers can persist the actual Twilio
 * error message into `notification_log.error_message` for debugging.
 */
export async function sendWhatsApp(to: string, body: string): Promise<SendResult> {
  const normalized = normalizePhone(to);
  if (!isSandboxRecipientAllowed(normalized)) {
    console.log("[Twilio] Skipped sandbox WhatsApp (recipient not joined)", { to: normalized });
    return { ok: false, error: SANDBOX_SKIP_REASON };
  }
  try {
    const message = await twilioClient.messages.create({
      from: `whatsapp:${config.twilioWhatsappFrom}`,
      to: `whatsapp:${normalized}`,
      body,
    });
    console.log("[Twilio] WhatsApp sent", { to: normalized, sid: message.sid });
    return { ok: true, sid: message.sid };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[Twilio] Failed to send WhatsApp", { to: normalized, error });
    return { ok: false, error };
  }
}

// ─── sendWhatsAppTemplate ──────────────────────────────────────────────────────

/**
 * Send a pre-approved WhatsApp Content Template. Required for business-
 * initiated messages outside the 24h session window.
 *
 * Twilio takes a ContentSid (HX...) plus contentVariables as a map of
 * positional strings ("1", "2", ...) to values. Create templates in the
 * Twilio Console → Content Template Builder and submit for WhatsApp
 * approval (Authentication category usually approves within hours).
 *
 * Returns `{ ok, sid?, error? }`.
 */
export async function sendWhatsAppTemplate(params: {
  to: string;
  contentSid: string;
  variables: Record<string, string>; // e.g. { "1": "123456" }
}): Promise<SendResult> {
  const normalized = normalizePhone(params.to);
  if (!isSandboxRecipientAllowed(normalized)) {
    console.log("[Twilio] Skipped sandbox WhatsApp template (recipient not joined)", {
      to: normalized,
      contentSid: params.contentSid,
    });
    return { ok: false, error: SANDBOX_SKIP_REASON };
  }
  try {
    const message = await twilioClient.messages.create({
      from: `whatsapp:${config.twilioWhatsappFrom}`,
      to: `whatsapp:${normalized}`,
      contentSid: params.contentSid,
      contentVariables: JSON.stringify(params.variables),
    });
    console.log("[Twilio] WhatsApp template sent", {
      to: normalized,
      contentSid: params.contentSid,
      sid: message.sid,
    });
    return { ok: true, sid: message.sid };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[Twilio] Failed to send WhatsApp template", {
      to: normalized,
      contentSid: params.contentSid,
      error,
    });
    return { ok: false, error };
  }
}

// ─── sendSMS ───────────────────────────────────────────────────────────────────

/**
 * Send a standard SMS via Twilio.
 * Returns `{ ok, sid?, error? }`.
 */
export async function sendSMS(to: string, body: string): Promise<SendResult> {
  const normalized = normalizePhone(to);
  try {
    const message = await twilioClient.messages.create({
      from: config.twilioWhatsappFrom,
      to: normalized,
      body,
    });
    console.log("[Twilio] SMS sent", { to: normalized, sid: message.sid });
    return { ok: true, sid: message.sid };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[Twilio] Failed to send SMS", { to: normalized, error });
    return { ok: false, error };
  }
}

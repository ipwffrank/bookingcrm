import twilio from "twilio";
import { config } from "./config.js";

// ─── Twilio client ─────────────────────────────────────────────────────────────

export const twilioClient = twilio(config.twilioAccountSid, config.twilioAuthToken);

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
 * Returns the message SID on success, or an empty string on error.
 */
export async function sendWhatsApp(to: string, body: string): Promise<string> {
  try {
    const message = await twilioClient.messages.create({
      from: `whatsapp:${config.twilioWhatsappFrom}`,
      to: `whatsapp:${to}`,
      body,
    });
    console.log("[Twilio] WhatsApp sent", { to, sid: message.sid });
    return message.sid;
  } catch (err) {
    console.error("[Twilio] Failed to send WhatsApp", {
      to,
      error: err instanceof Error ? err.message : String(err),
    });
    return "";
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
 * Returns the message SID on success, or an empty string on error.
 */
export async function sendWhatsAppTemplate(params: {
  to: string;
  contentSid: string;
  variables: Record<string, string>; // e.g. { "1": "123456" }
}): Promise<string> {
  try {
    const message = await twilioClient.messages.create({
      from: `whatsapp:${config.twilioWhatsappFrom}`,
      to: `whatsapp:${params.to}`,
      contentSid: params.contentSid,
      contentVariables: JSON.stringify(params.variables),
    });
    console.log("[Twilio] WhatsApp template sent", {
      to: params.to,
      contentSid: params.contentSid,
      sid: message.sid,
    });
    return message.sid;
  } catch (err) {
    console.error("[Twilio] Failed to send WhatsApp template", {
      to: params.to,
      contentSid: params.contentSid,
      error: err instanceof Error ? err.message : String(err),
    });
    return "";
  }
}

// ─── sendSMS ───────────────────────────────────────────────────────────────────

/**
 * Send a standard SMS via Twilio.
 * Returns the message SID on success, or an empty string on error.
 */
export async function sendSMS(to: string, body: string): Promise<string> {
  try {
    const message = await twilioClient.messages.create({
      from: config.twilioWhatsappFrom,
      to,
      body,
    });
    console.log("[Twilio] SMS sent", { to, sid: message.sid });
    return message.sid;
  } catch (err) {
    console.error("[Twilio] Failed to send SMS", {
      to,
      error: err instanceof Error ? err.message : String(err),
    });
    return "";
  }
}

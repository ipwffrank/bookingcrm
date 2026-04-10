import twilio from "twilio";
import { config } from "./config.js";

// ─── Twilio client ─────────────────────────────────────────────────────────────

export const twilioClient = twilio(config.twilioAccountSid, config.twilioAuthToken);

// ─── sendWhatsApp ──────────────────────────────────────────────────────────────

/**
 * Send a WhatsApp message via Twilio.
 * Formats the recipient number with the 'whatsapp:' prefix required by Twilio.
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

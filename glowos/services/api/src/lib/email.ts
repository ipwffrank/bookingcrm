import sgMail from "@sendgrid/mail";
import { config } from "./config.js";

if (config.sendgridApiKey) {
  sgMail.setApiKey(config.sendgridApiKey);
}

/**
 * Send a transactional email via SendGrid.
 * Silently no-ops if SENDGRID_API_KEY is not configured (dev environments).
 * Returns true on success, false on error.
 */
export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  if (!config.sendgridApiKey) {
    console.log("[Email] Skipped — SENDGRID_API_KEY not set", { to: params.to, subject: params.subject });
    return false;
  }

  try {
    await sgMail.send({
      to: params.to,
      from: { email: config.fromEmail, name: config.fromName },
      subject: params.subject,
      html: params.html,
      text: params.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    });
    console.log("[Email] Sent", { to: params.to, subject: params.subject });
    return true;
  } catch (err) {
    console.error("[Email] Failed to send", {
      to: params.to,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ─── HTML style constants ──────────────────────────────────────────────────────

const baseStyle = `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 0;`;
const cardStyle = `max-width: 560px; margin: 32px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08);`;
const headerStyle = `background: #1a1a2e; padding: 28px 32px; text-align: center;`;
const bodyStyle = `padding: 28px 32px; color: #333;`;
const rowStyle = `display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f0f0f0; font-size: 14px;`;
const labelStyle = `color: #888;`;
const valueStyle = `color: #111; font-weight: 500;`;
const btnStyle = `display: inline-block; margin-top: 20px; padding: 12px 24px; background: #c4a778; color: #111 !important; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;`;

export function bookingConfirmationEmail(params: {
  clientName: string;
  merchantName: string;
  serviceName: string;
  staffName: string;
  dateStr: string;
  timeStr: string;
  priceSgd: string;
  cancelUrl: string;
}): string {
  const { clientName, merchantName, serviceName, staffName, dateStr, timeStr, priceSgd, cancelUrl } = params;
  return `<!DOCTYPE html><html><body style="${baseStyle}">
    <div style="${cardStyle}">
      <div style="${headerStyle}">
        <p style="color:#c4a778;font-size:12px;letter-spacing:2px;margin:0 0 4px;text-transform:uppercase">Booking Confirmed</p>
        <h1 style="color:#fff;margin:0;font-size:22px">${merchantName}</h1>
      </div>
      <div style="${bodyStyle}">
        <p style="margin:0 0 20px">Hi ${clientName}, your appointment is confirmed.</p>
        <div style="${rowStyle}"><span style="${labelStyle}">Service</span><span style="${valueStyle}">${serviceName}</span></div>
        <div style="${rowStyle}"><span style="${labelStyle}">Provider</span><span style="${valueStyle}">${staffName}</span></div>
        <div style="${rowStyle}"><span style="${labelStyle}">Date</span><span style="${valueStyle}">${dateStr}</span></div>
        <div style="${rowStyle}"><span style="${labelStyle}">Time</span><span style="${valueStyle}">${timeStr}</span></div>
        <div style="${rowStyle}"><span style="${labelStyle}">Amount</span><span style="${valueStyle}">S$${priceSgd}</span></div>
        <p style="margin-top:20px;font-size:13px;color:#888">Need to cancel or change? <a href="${cancelUrl}" style="color:#c4a778">Manage booking →</a></p>
      </div>
    </div>
  </body></html>`;
}

export function postServiceReceiptEmail(params: {
  clientName: string;
  merchantName: string;
  serviceName: string;
  dateStr: string;
  priceSgd: string;
  bookingUrl: string;
}): string {
  const { clientName, merchantName, serviceName, dateStr, priceSgd, bookingUrl } = params;
  return `<!DOCTYPE html><html><body style="${baseStyle}">
    <div style="${cardStyle}">
      <div style="${headerStyle}">
        <p style="color:#c4a778;font-size:12px;letter-spacing:2px;margin:0 0 4px;text-transform:uppercase">Visit Receipt</p>
        <h1 style="color:#fff;margin:0;font-size:22px">${merchantName}</h1>
      </div>
      <div style="${bodyStyle}">
        <p style="margin:0 0 20px">Hi ${clientName}, thank you for visiting us!</p>
        <div style="${rowStyle}"><span style="${labelStyle}">Service</span><span style="${valueStyle}">${serviceName}</span></div>
        <div style="${rowStyle}"><span style="${labelStyle}">Date</span><span style="${valueStyle}">${dateStr}</span></div>
        <div style="${rowStyle}"><span style="${labelStyle}">Amount</span><span style="${valueStyle}">S$${priceSgd}</span></div>
        <div style="text-align:center"><a href="${bookingUrl}" style="${btnStyle}">Book again →</a></div>
      </div>
    </div>
  </body></html>`;
}

export function rebookCtaEmail(params: {
  clientName: string;
  merchantName: string;
  serviceName: string;
  bookingUrl: string;
}): string {
  const { clientName, merchantName, serviceName, bookingUrl } = params;
  return `<!DOCTYPE html><html><body style="${baseStyle}">
    <div style="${cardStyle}">
      <div style="${headerStyle}">
        <p style="color:#c4a778;font-size:12px;letter-spacing:2px;margin:0 0 4px;text-transform:uppercase">We miss you</p>
        <h1 style="color:#fff;margin:0;font-size:22px">${merchantName}</h1>
      </div>
      <div style="${bodyStyle}">
        <p style="margin:0 0 16px">Hi ${clientName},</p>
        <p style="margin:0 0 20px;color:#555">It's been a couple of days since your <strong>${serviceName}</strong> at ${merchantName}. Ready for your next visit?</p>
        <div style="text-align:center"><a href="${bookingUrl}" style="${btnStyle}">Book your next appointment →</a></div>
      </div>
    </div>
  </body></html>`;
}

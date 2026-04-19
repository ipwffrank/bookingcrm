// glowos/services/api/src/routes/otp.ts
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { db, merchants, clients } from "@glowos/db";
import { redis } from "../lib/redis.js";
import { addJob } from "../lib/queue.js";
import { normalizePhone, normalizeEmail } from "../lib/normalize.js";
import { generateVerificationToken } from "../lib/jwt.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";

const otpRouter = new Hono<{ Variables: AppVariables }>();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const sendSchema = z.object({
  phone: z.string().min(1),
  email: z.string().email().optional(),
  channel: z.enum(["whatsapp", "email"]),
  purpose: z.enum(["login", "first_timer_verify"]),
});

const verifySchema = z.object({
  phone: z.string().min(1),
  code: z.string().length(6),
  purpose: z.enum(["login", "first_timer_verify"]),
});

const lookupSchema = z.object({
  phone: z.string().min(1),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function maskPhone(e164: string): string {
  // e.g. "+6591001010" → "+65••••1010"
  if (e164.length < 7) return e164;
  const head = e164.slice(0, 3);
  const tail = e164.slice(-4);
  return `${head}${"•".repeat(e164.length - 7)}${tail}`;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const maskedLocal = local!.slice(0, 1) + "***";
  return `${maskedLocal}@${domain}`;
}

function otpKey(phone: string, purpose: string): string {
  return `otp:${phone}:${purpose}`;
}

function rateKeyPhone(phone: string): string {
  return `otp:rate:phone:${phone}`;
}

function rateKeyIp(ip: string): string {
  return `otp:rate:ip:${ip}`;
}

// ─── POST /booking/:slug/otp/send ─────────────────────────────────────────────

otpRouter.post("/:slug/otp/send", zValidator(sendSchema), async (c) => {
  const slug = c.req.param("slug")!;
  const body = c.get("body") as z.infer<typeof sendSchema>;

  const [merchant] = await db
    .select({ id: merchants.id })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);
  if (!merchant) {
    return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
  }

  // `merchants.country` is not yet a column on the schema; default to SG.
  // When the column is added, select it above and use it here.
  const defaultCountry: "SG" | "MY" = "SG";
  const phone = normalizePhone(body.phone, defaultCountry);
  if (!phone) {
    return c.json({ error: "Bad Request", message: "Invalid phone number" }, 400);
  }
  const email = body.email ? normalizeEmail(body.email) : null;

  // Rate limits
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";
  const phoneCount = await redis.incr(rateKeyPhone(phone));
  if (phoneCount === 1) await redis.expire(rateKeyPhone(phone), 900); // 15 min
  if (phoneCount > 3) {
    return c.json(
      { error: "Too Many Requests", message: "Too many codes sent. Wait a few minutes." },
      429
    );
  }
  const ipCount = await redis.incr(rateKeyIp(ip));
  if (ipCount === 1) await redis.expire(rateKeyIp(ip), 3600);
  if (ipCount > 10) {
    return c.json(
      { error: "Too Many Requests", message: "Too many codes sent from this network." },
      429
    );
  }

  // Generate + store
  const code = String(crypto.randomInt(100000, 1000000));
  await redis.set(
    otpKey(phone, body.purpose),
    JSON.stringify({ code, email, channel: body.channel, attempts: 0 }),
    "EX",
    600
  );

  // Dispatch
  if (body.channel === "whatsapp") {
    await addJob("notifications", "otp_send", {
      channel: "whatsapp",
      destination: phone,
      code,
    });
    return c.json({
      sent: true,
      channel: "whatsapp",
      masked_destination: maskPhone(phone),
    });
  }

  if (!email) {
    return c.json(
      { error: "Bad Request", message: "Email required for email channel" },
      400
    );
  }
  await addJob("notifications", "otp_send", {
    channel: "email",
    destination: email,
    code,
  });
  return c.json({
    sent: true,
    channel: "email",
    masked_destination: maskEmail(email),
  });
});

export { otpRouter };

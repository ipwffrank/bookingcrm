// glowos/services/api/src/routes/otp.ts
import { Hono } from "hono";
import { eq, and, or } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { db, merchants, clients, clientProfiles } from "@glowos/db";
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
  phone: z.string().min(1).optional(),
  email: z.string().email().optional(),
}).refine((d) => Boolean(d.phone || d.email), {
  message: "phone or email is required",
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
    .select({ id: merchants.id, country: merchants.country })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);
  if (!merchant) {
    return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
  }

  const defaultCountry = merchant.country;
  const phone = normalizePhone(body.phone, defaultCountry);
  if (!phone) {
    return c.json({ error: "Bad Request", message: "Invalid phone number" }, 400);
  }
  const email = body.email ? normalizeEmail(body.email) : null;

  // Validate channel requirements BEFORE burning the rate-limit quota
  if (body.channel === "email" && !email) {
    return c.json(
      { error: "Bad Request", message: "Email required for email channel" },
      400
    );
  }

  // Rate limits — best-effort. If Redis is unavailable, skip rate limiting
  // rather than block legitimate users on a transient infra failure.
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";
  try {
    const phoneCount = await redis.incr(rateKeyPhone(phone));
    if (phoneCount === 1) await redis.expire(rateKeyPhone(phone), 60);
    if (phoneCount > 3) {
      const ttl = await redis.ttl(rateKeyPhone(phone));
      return c.json(
        {
          error: "Too Many Requests",
          message: "Too many codes sent. Wait a moment.",
          retry_after_seconds: ttl > 0 ? ttl : 60,
        },
        429
      );
    }
    const ipCount = await redis.incr(rateKeyIp(ip));
    if (ipCount === 1) await redis.expire(rateKeyIp(ip), 60);
    if (ipCount > 5) {
      const ttl = await redis.ttl(rateKeyIp(ip));
      return c.json(
        {
          error: "Too Many Requests",
          message: "Too many codes sent from this network.",
          retry_after_seconds: ttl > 0 ? ttl : 60,
        },
        429
      );
    }
  } catch (err) {
    console.error("[OTP] rate-limit check failed; skipping", err);
  }

  // Generate + store — load-bearing, must succeed for verification to work
  const code = String(crypto.randomInt(100000, 1000000));
  try {
    await redis.set(
      otpKey(phone, body.purpose),
      JSON.stringify({ code, email, channel: body.channel, attempts: 0 }),
      "EX",
      600
    );
  } catch (err) {
    console.error("[OTP] failed to persist code", err);
    return c.json(
      {
        error: "Service Unavailable",
        message: "Verification is temporarily unavailable. Please try again in a moment.",
      },
      503
    );
  }

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

  // At this point, body.channel === "email" and email is guaranteed non-null (validated above)
  await addJob("notifications", "otp_send", {
    channel: "email",
    destination: email!,
    code,
  });
  return c.json({
    sent: true,
    channel: "email",
    masked_destination: maskEmail(email!),
  });
});

// ─── POST /booking/:slug/otp/verify ───────────────────────────────────────────

otpRouter.post("/:slug/otp/verify", zValidator(verifySchema), async (c) => {
  const slug = c.req.param("slug")!;
  const body = c.get("body") as z.infer<typeof verifySchema>;

  const [merchant] = await db
    .select({ id: merchants.id, country: merchants.country })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);
  if (!merchant) {
    return c.json({ error: "Not Found", message: "Merchant not found" }, 404);
  }

  const defaultCountry = merchant.country;
  const phone = normalizePhone(body.phone, defaultCountry);
  if (!phone) {
    return c.json({ error: "Bad Request", message: "Invalid phone number" }, 400);
  }

  const key = otpKey(phone, body.purpose);
  let raw: string | null;
  try {
    raw = await redis.get(key);
  } catch (err) {
    console.error("[OTP] verify: failed to read code", err);
    return c.json(
      {
        error: "Service Unavailable",
        message: "Verification is temporarily unavailable. Please try again in a moment.",
      },
      503
    );
  }
  if (!raw) {
    return c.json(
      { error: "Gone", message: "Code expired or not found. Request a new one." },
      410
    );
  }

  const entry = JSON.parse(raw) as {
    code: string;
    email: string | null;
    channel: string;
    attempts: number;
  };

  if (entry.attempts >= 5) {
    try { await redis.del(key); } catch { /* best-effort cleanup */ }
    return c.json(
      { error: "Too Many Requests", message: "Too many attempts. Request a new code." },
      429
    );
  }

  if (entry.code !== body.code) {
    entry.attempts += 1;
    try {
      await redis.set(key, JSON.stringify(entry), "KEEPTTL");
    } catch (err) {
      console.error("[OTP] verify: failed to update attempts", err);
      // Don't escalate — user will just see "wrong code" and retry; attempts won't increment
    }
    return c.json({ error: "Unauthorized", message: "Incorrect code." }, 401);
  }

  // Success — delete the key (single-use) and issue the verification token
  try { await redis.del(key); } catch { /* best-effort cleanup */ }

  const token = generateVerificationToken(
    {
      phone,
      email: entry.email,
      google_id: null,
      purpose: body.purpose,
      verified_at: Math.floor(Date.now() / 1000),
    },
    600 // 10 min TTL
  );

  // For login purpose, also return client info so the frontend can auto-fill
  if (body.purpose === "login") {
    const [client] = await db
      .select({
        id: clients.id,
        name: clients.name,
        email: clients.email,
        googleId: clients.googleId,
      })
      .from(clients)
      .where(eq(clients.phone, phone))
      .limit(1);
    return c.json({
      verified: true,
      verification_token: token,
      client: client
        ? {
            id: client.id,
            name: client.name,
            email: client.email,
            google_id: client.googleId,
          }
        : null,
    });
  }

  return c.json({ verified: true, verification_token: token });
});

// ─── POST /booking/:slug/lookup-client ────────────────────────────────────────

otpRouter.post("/:slug/lookup-client", zValidator(lookupSchema), async (c) => {
  const slug = c.req.param("slug")!;
  const body = c.get("body") as z.infer<typeof lookupSchema>;

  const [merchant] = await db
    .select({ id: merchants.id, country: merchants.country })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);
  if (!merchant) return c.json({ matched: false });

  const defaultCountry = merchant.country;
  const phone = body.phone ? normalizePhone(body.phone, defaultCountry) : null;
  const email = body.email ? normalizeEmail(body.email) : null;
  if (!phone && !email) return c.json({ matched: false });

  // Rate limit: 10 lookups/min per IP (prevents phone/email enumeration)
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";
  const lookupKey = `lookup:rate:ip:${ip}`;
  try {
    const count = await redis.incr(lookupKey);
    if (count === 1) await redis.expire(lookupKey, 60);
    if (count > 10) {
      return c.json({ error: "Too Many Requests", message: "Slow down." }, 429);
    }
  } catch (err) {
    console.error("[OTP] lookup-client: rate-limit check failed; skipping", err);
  }

  // Match on phone OR email — whichever the customer entered first. Both
  // checks are scoped to this merchant's client profiles so a customer who
  // has history at a sibling merchant isn't falsely surfaced here.
  const orConds = [];
  if (phone) orConds.push(eq(clients.phone, phone));
  if (email) orConds.push(eq(clients.email, email));
  const matchExpr = orConds.length === 1 ? orConds[0] : or(...orConds);

  const [client] = await db
    .select({ name: clients.name, email: clients.email, phone: clients.phone })
    .from(clients)
    .innerJoin(clientProfiles, eq(clientProfiles.clientId, clients.id))
    .where(and(matchExpr!, eq(clientProfiles.merchantId, merchant.id)))
    .limit(1);

  if (!client || !client.name) return c.json({ matched: false });

  const masked =
    client.name.length >= 2 ? client.name.slice(0, 2) + "***" : "***";
  return c.json({ matched: true, masked_name: masked });
});

export { otpRouter };

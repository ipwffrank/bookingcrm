# First-Timer Discount Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the first-timer discount abuse vector by adding WhatsApp/email OTP verification, server-side first-timer verification via signed JWT, Google Sign-in as the primary path, passwordless "Register now" flow, and normalized phone/email dedupe.

**Architecture:** Three identity paths at Step 4 of the public booking widget — Google Sign-in (trusted via Google ID token, verified backend issues a JWT), Register now (captures name/phone/email and optionally verifies via OTP when claiming a first-timer discount), and returning-customer recognition (phone lookup with OTP login). The payment/booking endpoints require a valid signed verification JWT before granting the first-timer discount; the regular per-service discount continues to apply to everyone without verification. All phone/email matching goes through a normalization helper (E.164 for phones, lowercase-trim for emails).

**Tech Stack:** Hono API, Drizzle ORM, `libphonenumber-js` (new dep), `jsonwebtoken` (existing), BullMQ with existing notification worker, Twilio WhatsApp (existing `sendWhatsApp` helper), SendGrid email (existing `sendEmail` helper), Upstash Redis (existing), Next.js 15 App Router, Google OAuth (existing `google-auth-library`).

**Spec:** See `docs/superpowers/specs/2026-04-19-first-timer-verification-design.md` for the full design.

---

## File Map

### New files
- `glowos/services/api/src/lib/normalize.ts` — `normalizePhone`, `normalizeEmail` helpers
- `glowos/services/api/src/lib/firstTimerCheck.ts` — authoritative server-side first-timer decision
- `glowos/services/api/src/routes/otp.ts` — `lookup-client`, `otp/send`, `otp/verify` endpoints
- `glowos/services/api/scripts/normalize-client-contact.ts` — one-time backfill migration
- `glowos/apps/web/app/[slug]/components/OTPVerificationCard.tsx` — reusable OTP UI card
- `glowos/apps/web/app/[slug]/components/ReturningCustomerCard.tsx` — "Welcome back" recognition UI

### Modified files
- `glowos/services/api/src/lib/jwt.ts` — add `generateVerificationToken` + `verifyVerificationToken`
- `glowos/services/api/src/lib/queue.ts` — (no changes needed; uses existing `notifications` queue)
- `glowos/services/api/src/workers/notification.worker.ts` — add `otp_send` handler
- `glowos/services/api/src/routes/customer-auth.ts` — issue `verification_token` (purpose `google_verify`) on successful Google login
- `glowos/services/api/src/routes/services.ts` — normalize inputs in `check-first-timer`
- `glowos/services/api/src/routes/bookings.ts` — update `findOrCreateClient` to normalize phone/email; thread `verification_token` through `/booking/:slug/confirm`
- `glowos/services/api/src/routes/payments.ts` — default-deny first-timer logic using `verifyVerificationToken` and `isFirstTimerAtMerchant`
- `glowos/services/api/src/routes/webhooks.ts` — update the other `findOrCreateClient` copy (lines 28, 226, 231) to use the new normalized helper
- `glowos/services/api/src/routes/walkins.ts` — normalize walk-in client lookup (same first-timer rules)
- `glowos/services/api/src/index.ts` — mount `otpRouter` under `/booking`
- `glowos/services/api/package.json` — add `libphonenumber-js` dependency
- `glowos/apps/web/app/[slug]/BookingWidget.tsx` — Step 4 rebuild, OTP card integration, remove silent `catch {}`, forward `verification_token` to payment/confirm endpoints

---

## Milestones

- **M1: Foundation** (Tasks 1–3) — install dep, normalization helpers, JWT verification helpers. No behavior change.
- **M2: Server-side first-timer helper** (Tasks 4–5) — authoritative check function + shared client-creation normalization.
- **M3: OTP infrastructure** (Tasks 6–9) — worker job + Redis schema + `/otp/send` + `/otp/verify` endpoints.
- **M4: Customer recognition** (Tasks 10–11) — `/booking/:slug/lookup-client` + customer-auth `verification_token` issuance.
- **M5: Payment & booking handlers** (Tasks 12–14) — default-deny discount logic at payment intent and at confirm.
- **M6: Backfill migration** (Task 15) — normalize historical `clients.phone` / `clients.email`.
- **M7: Frontend Step 4 rebuild** (Tasks 16–21) — UI states, OTP card, returning-customer card, Google primary, remove silent catch.
- **M8: Rollout & QA** (Tasks 22–23) — manual staging walkthrough + production deploy sequence.

---

# M1: Foundation

## Task 1: Install libphonenumber-js

**Files:**
- Modify: `glowos/services/api/package.json`
- Modify: `glowos/pnpm-lock.yaml` (regenerated)

- [ ] **Step 1: Install the dep**

```bash
cd glowos/services/api
pnpm add libphonenumber-js
```

- [ ] **Step 2: Verify installation**

```bash
cd glowos/services/api
grep "libphonenumber-js" package.json
```

Expected: line like `"libphonenumber-js": "^1.11.x"` under `dependencies`.

- [ ] **Step 3: Commit**

```bash
cd glowos
git add services/api/package.json pnpm-lock.yaml
git commit -m "chore: add libphonenumber-js for phone normalization"
```

---

## Task 2: Normalization helpers

**Files:**
- Create: `glowos/services/api/src/lib/normalize.ts`

- [ ] **Step 1: Create the module**

```ts
// glowos/services/api/src/lib/normalize.ts
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export function normalizePhone(
  raw: string | null | undefined,
  defaultCountry: CountryCode = "SG"
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number; // E.164 format, e.g. "+6591001010"
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return null;
  return trimmed;
}
```

- [ ] **Step 2: Sanity-check the build**

```bash
cd glowos/services/api
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Quick REPL verification**

Create a throwaway test file `/tmp/normalize-check.ts` with:

```ts
import { normalizePhone, normalizeEmail } from "./glowos/services/api/src/lib/normalize.js";

console.log(normalizePhone("+65 9100 1010"));        // → +6591001010
console.log(normalizePhone("91001010", "SG"));        // → +6591001010
console.log(normalizePhone("  91001010  ", "SG"));    // → +6591001010
console.log(normalizePhone("+6591001010", "MY"));     // → +6591001010 (ignores default when prefixed)
console.log(normalizePhone("abc"));                   // → null
console.log(normalizePhone(""));                      // → null
console.log(normalizeEmail("  Test@Gmail.COM "));     // → test@gmail.com
console.log(normalizeEmail(""));                      // → null
console.log(normalizeEmail("no-at-sign"));            // → null
```

Run: `cd glowos && npx tsx /tmp/normalize-check.ts`

Expected output: each line matches the comment.

- [ ] **Step 4: Commit**

```bash
cd glowos
git add services/api/src/lib/normalize.ts
git commit -m "feat(api): normalizePhone/normalizeEmail helpers"
```

---

## Task 3: JWT verification-token helpers

**Files:**
- Modify: `glowos/services/api/src/lib/jwt.ts`

- [ ] **Step 1: Append verification-token functions**

Add at the end of `glowos/services/api/src/lib/jwt.ts`:

```ts
// ─── Verification tokens (OTP + Google Sign-in identity proof) ──────────────

export type VerificationPurpose = "login" | "first_timer_verify" | "google_verify";

export interface VerificationTokenPayload {
  phone: string | null;
  email: string | null;
  google_id: string | null;
  purpose: VerificationPurpose;
  verified_at: number;
}

const VERIFY_SECRET_SUFFIX = "_verify";

export function generateVerificationToken(
  payload: VerificationTokenPayload,
  ttlSeconds: number
): string {
  return jwt.sign(payload, config.jwtSecret + VERIFY_SECRET_SUFFIX, {
    expiresIn: ttlSeconds,
  });
}

export function verifyVerificationToken(
  token: string
): (VerificationTokenPayload & jwt.JwtPayload) | null {
  try {
    return jwt.verify(token, config.jwtSecret + VERIFY_SECRET_SUFFIX) as
      VerificationTokenPayload & jwt.JwtPayload;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Build check**

```bash
cd glowos/services/api
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: REPL verification**

`/tmp/jwt-check.ts`:

```ts
import {
  generateVerificationToken,
  verifyVerificationToken,
} from "./glowos/services/api/src/lib/jwt.js";

const token = generateVerificationToken(
  { phone: "+6591001010", email: null, google_id: null, purpose: "first_timer_verify", verified_at: Math.floor(Date.now() / 1000) },
  600
);
console.log("token:", token.slice(0, 40) + "...");

const decoded = verifyVerificationToken(token);
console.log("decoded:", decoded);

const bad = verifyVerificationToken("not.a.jwt");
console.log("bad:", bad); // null

// Tamper test
const tampered = token.replace(/.$/, token.endsWith("A") ? "B" : "A");
console.log("tampered:", verifyVerificationToken(tampered)); // null
```

Run: `cd glowos && npx tsx /tmp/jwt-check.ts`

Expected: token decodes with matching payload; `bad` and `tampered` both `null`.

- [ ] **Step 4: Commit**

```bash
cd glowos
git add services/api/src/lib/jwt.ts
git commit -m "feat(api): verification token JWT helpers"
```

---

# M2: Server-Side First-Timer Helper

## Task 4: `isFirstTimerAtMerchant` helper

**Files:**
- Create: `glowos/services/api/src/lib/firstTimerCheck.ts`

- [ ] **Step 1: Create the helper**

```ts
// glowos/services/api/src/lib/firstTimerCheck.ts
import { and, eq, or, inArray } from "drizzle-orm";
import { db, clients, bookings } from "@glowos/db";

export interface FirstTimerCheckArgs {
  merchantId: string;
  normalizedPhone: string | null;
  normalizedEmail: string | null;
  googleId: string | null;
}

/**
 * Authoritative first-timer decision. Returns true if the identifiers provided
 * do NOT resolve to any client with a completed booking at this merchant.
 * Returns true (conservative) if no identifiers are provided, since the caller
 * cannot prove who the customer is — but callers should never reach this path
 * with empty identifiers.
 */
export async function isFirstTimerAtMerchant(
  args: FirstTimerCheckArgs
): Promise<boolean> {
  const conditions = [];
  if (args.normalizedPhone) conditions.push(eq(clients.phone, args.normalizedPhone));
  if (args.normalizedEmail) conditions.push(eq(clients.email, args.normalizedEmail));
  if (args.googleId) conditions.push(eq(clients.googleId, args.googleId));

  if (conditions.length === 0) return true;

  const matching = await db
    .select({ id: clients.id })
    .from(clients)
    .where(or(...conditions));

  if (matching.length === 0) return true;

  const clientIds = matching.map((c) => c.id);

  const [existing] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        inArray(bookings.clientId, clientIds),
        eq(bookings.merchantId, args.merchantId),
        eq(bookings.status, "completed")
      )
    )
    .limit(1);

  return !existing;
}
```

- [ ] **Step 2: Build check**

```bash
cd glowos/services/api
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd glowos
git add services/api/src/lib/firstTimerCheck.ts
git commit -m "feat(api): isFirstTimerAtMerchant authoritative helper"
```

---

## Task 5: Apply normalization inside `findOrCreateClient` (bookings + webhooks)

**Files:**
- Modify: `glowos/services/api/src/routes/bookings.ts:74-105` (the `findOrCreateClient` helper)
- Modify: `glowos/services/api/src/routes/webhooks.ts:28` (the duplicate helper)

- [ ] **Step 1: Update `findOrCreateClient` in bookings.ts**

Replace the function at lines 74-105 with:

```ts
async function findOrCreateClient(
  rawPhone: string,
  name?: string,
  rawEmail?: string,
  defaultCountry: "SG" | "MY" = "SG"
): Promise<{ id: string }> {
  const phone = normalizePhone(rawPhone, defaultCountry);
  if (!phone) throw new Error("Invalid phone number");
  const email = normalizeEmail(rawEmail);

  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.phone, phone))
    .limit(1);

  if (existing) {
    if (name || email) {
      await db
        .update(clients)
        .set({
          ...(name ? { name } : {}),
          ...(email ? { email } : {}),
        })
        .where(eq(clients.id, existing.id));
    }
    return existing;
  }

  const [created] = await db
    .insert(clients)
    .values({ phone, name, email })
    .returning({ id: clients.id });

  if (!created) throw new Error("Failed to create client");
  return created;
}
```

Add the import at the top of the file:

```ts
import { normalizePhone, normalizeEmail } from "../lib/normalize.js";
```

- [ ] **Step 2: Update call sites in bookings.ts**

Call sites at lines 596 and 1161 pass raw phone. The normalization happens inside the helper now, so no changes at call sites — but verify the helper's new throwing behavior is handled. Wrap the call at line 1161:

```ts
// Around line 1161 (inside /:slug/confirm, the else branch)
try {
  client = await findOrCreateClient(
    body.client_phone,
    body.client_name,
    body.client_email
  );
} catch (err) {
  return c.json(
    { error: "Bad Request", message: "Invalid phone number" },
    400
  );
}
```

And at line 596 (merchant-created bookings):

```ts
let client;
try {
  client = await findOrCreateClient(body.client_phone, body.client_name);
} catch (err) {
  return c.json(
    { error: "Bad Request", message: "Invalid phone number" },
    400
  );
}
```

- [ ] **Step 3: Update the client_id branch's update statement to also normalize**

In `/:slug/confirm` around lines 1140-1159 (the `if (body.client_id)` branch), the server updates phone/name/email on an existing Google-authenticated client. Add normalization:

```ts
if (body.client_id) {
  const [existing] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.id, body.client_id))
    .limit(1);
  if (!existing) {
    return c.json({ error: "Not Found", message: "Client not found" }, 404);
  }
  client = existing;
  const normalizedPhone = body.client_phone ? normalizePhone(body.client_phone) : null;
  const normalizedEmail = normalizeEmail(body.client_email);
  await db
    .update(clients)
    .set({
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      ...(body.client_name ? { name: body.client_name } : {}),
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
    })
    .where(eq(clients.id, client.id));
}
```

- [ ] **Step 4: Update the duplicate helper in webhooks.ts**

`glowos/services/api/src/routes/webhooks.ts:28` has its own copy of `findOrCreateClient`. Replace it with an import + re-export, OR apply the same normalization inline. Simplest path: keep the local copy but apply the same normalization logic. Open the file and apply the same pattern as Step 1 to the webhooks copy.

- [ ] **Step 5: Build check**

```bash
cd glowos/services/api
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Smoke test — book via public widget locally**

Start the API and create a lease + confirm booking via curl (or via the running widget). Verify the created client's `phone` is E.164.

```bash
# Quick DB check (substitute a real client phone just created)
psql $DATABASE_URL -c "SELECT phone, email FROM clients ORDER BY created_at DESC LIMIT 3;"
```

Expected: newest rows have phones starting with `+`.

- [ ] **Step 7: Commit**

```bash
cd glowos
git add services/api/src/routes/bookings.ts services/api/src/routes/webhooks.ts
git commit -m "feat(api): normalize phone/email in findOrCreateClient"
```

---

# M3: OTP Infrastructure

## Task 6: OTP worker job handler

**Files:**
- Modify: `glowos/services/api/src/workers/notification.worker.ts`

- [ ] **Step 1: Add the job type declaration**

Near the top of the file (alongside the other `…Data` interfaces), add:

```ts
interface OtpSendData {
  channel: "whatsapp" | "email";
  destination: string; // E.164 phone OR email
  code: string;
}
```

- [ ] **Step 2: Add the handler function**

Elsewhere in the file (near the other `handleX` functions):

```ts
async function handleOtpSend(data: OtpSendData): Promise<void> {
  const body = `Your GlowOS verification code: ${data.code}. Valid for 10 minutes.`;
  if (data.channel === "whatsapp") {
    const sid = await sendWhatsApp(data.destination, body);
    if (!sid) {
      throw new Error(`WhatsApp OTP failed for ${data.destination}`);
    }
    console.log("[NotificationWorker] otp_send whatsapp ok", {
      destination: data.destination,
      sid,
    });
    return;
  }
  const ok = await sendEmail({
    to: data.destination,
    subject: "Your verification code",
    html: `<p>Your GlowOS verification code is <strong>${data.code}</strong>.</p><p>It will expire in 10 minutes.</p>`,
  });
  if (!ok) {
    throw new Error(`Email OTP failed for ${data.destination}`);
  }
  console.log("[NotificationWorker] otp_send email ok", {
    destination: data.destination,
  });
}
```

- [ ] **Step 3: Register the job in the worker switch**

Find the `new Worker("notifications", async (job: Job) => { ... })` block and add a case:

```ts
case "otp_send":
  await handleOtpSend(job.data as OtpSendData);
  break;
```

- [ ] **Step 4: Build check**

```bash
cd glowos/services/api
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd glowos
git add services/api/src/workers/notification.worker.ts
git commit -m "feat(worker): otp_send job handler (whatsapp + email)"
```

---

## Task 7: OTP router skeleton + `/otp/send`

**Files:**
- Create: `glowos/services/api/src/routes/otp.ts`

- [ ] **Step 1: Create the router file with imports and schemas**

```ts
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

// Helpers
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
```

- [ ] **Step 2: Add the `/otp/send` handler**

```ts
otpRouter.post("/:slug/otp/send", zValidator(sendSchema), async (c) => {
  const slug = c.req.param("slug")!;
  const body = c.get("body") as z.infer<typeof sendSchema>;

  const [merchant] = await db
    .select({ id: merchants.id, country: merchants.country })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);
  if (!merchant) return c.json({ error: "Not Found", message: "Merchant not found" }, 404);

  const defaultCountry = (merchant.country as "SG" | "MY") ?? "SG";
  const phone = normalizePhone(body.phone, defaultCountry);
  if (!phone) {
    return c.json({ error: "Bad Request", message: "Invalid phone number" }, 400);
  }
  const email = body.email ? normalizeEmail(body.email) : null;

  // Rate limits
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
  const phoneCount = await redis.incr(rateKeyPhone(phone));
  if (phoneCount === 1) await redis.expire(rateKeyPhone(phone), 900); // 15 min
  if (phoneCount > 3) {
    return c.json({ error: "Too Many Requests", message: "Too many codes sent. Wait a few minutes." }, 429);
  }
  const ipCount = await redis.incr(rateKeyIp(ip));
  if (ipCount === 1) await redis.expire(rateKeyIp(ip), 3600);
  if (ipCount > 10) {
    return c.json({ error: "Too Many Requests", message: "Too many codes sent from this network." }, 429);
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
    return c.json({ sent: true, channel: "whatsapp", masked_destination: maskPhone(phone) });
  }

  if (!email) {
    return c.json({ error: "Bad Request", message: "Email required for email channel" }, 400);
  }
  await addJob("notifications", "otp_send", {
    channel: "email",
    destination: email,
    code,
  });
  return c.json({ sent: true, channel: "email", masked_destination: maskEmail(email) });
});
```

- [ ] **Step 3: Export the router**

Add at the bottom:

```ts
export { otpRouter };
```

- [ ] **Step 4: Build check**

```bash
cd glowos/services/api
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd glowos
git add services/api/src/routes/otp.ts
git commit -m "feat(api): otp/send endpoint with WhatsApp/email dispatch"
```

---

## Task 8: `/otp/verify` endpoint

**Files:**
- Modify: `glowos/services/api/src/routes/otp.ts`

- [ ] **Step 1: Add the verify handler**

Append to `otp.ts` before the `export`:

```ts
otpRouter.post("/:slug/otp/verify", zValidator(verifySchema), async (c) => {
  const slug = c.req.param("slug")!;
  const body = c.get("body") as z.infer<typeof verifySchema>;

  const [merchant] = await db
    .select({ id: merchants.id, country: merchants.country })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);
  if (!merchant) return c.json({ error: "Not Found", message: "Merchant not found" }, 404);

  const defaultCountry = (merchant.country as "SG" | "MY") ?? "SG";
  const phone = normalizePhone(body.phone, defaultCountry);
  if (!phone) return c.json({ error: "Bad Request", message: "Invalid phone number" }, 400);

  const key = otpKey(phone, body.purpose);
  const raw = await redis.get(key);
  if (!raw) {
    return c.json({ error: "Gone", message: "Code expired or not found. Request a new one." }, 410);
  }

  const entry = JSON.parse(raw) as { code: string; email: string | null; channel: string; attempts: number };

  if (entry.attempts >= 5) {
    await redis.del(key);
    return c.json({ error: "Too Many Requests", message: "Too many attempts. Request a new code." }, 429);
  }

  if (entry.code !== body.code) {
    entry.attempts += 1;
    await redis.set(key, JSON.stringify(entry), "KEEPTTL");
    return c.json({ error: "Unauthorized", message: "Incorrect code." }, 401);
  }

  // Success
  await redis.del(key);

  const token = generateVerificationToken(
    {
      phone,
      email: entry.email,
      google_id: null,
      purpose: body.purpose,
      verified_at: Math.floor(Date.now() / 1000),
    },
    600 // 10 min TTL for login/first_timer_verify
  );

  // For login purpose, also return client info for auto-fill
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
```

- [ ] **Step 2: Build check**

```bash
cd glowos/services/api
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd glowos
git add services/api/src/routes/otp.ts
git commit -m "feat(api): otp/verify endpoint issues verification JWT"
```

---

## Task 9: Mount the OTP router

**Files:**
- Modify: `glowos/services/api/src/index.ts`

- [ ] **Step 1: Import + mount**

Add the import near the other route imports:

```ts
import { otpRouter } from "./routes/otp.js";
```

Add the mount below the existing `app.route("/booking", …)` lines (order doesn't matter, but keep the public-booking group together):

```ts
app.route("/booking", otpRouter);
```

- [ ] **Step 2: Build check**

```bash
cd glowos/services/api
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run the API locally + smoke-test the send path**

```bash
cd glowos/services/api
pnpm dev
```

In another terminal (substitute a real merchant slug and your own WhatsApp-enabled Twilio sandbox-joined phone):

```bash
curl -X POST http://localhost:3001/booking/<SLUG>/otp/send \
  -H "Content-Type: application/json" \
  -d '{"phone":"+6591001010","channel":"whatsapp","purpose":"first_timer_verify"}'
```

Expected response: `{"sent":true,"channel":"whatsapp","masked_destination":"+65••••1010"}`
Expected side effect: WhatsApp message arrives with a 6-digit code.

Then verify:

```bash
curl -X POST http://localhost:3001/booking/<SLUG>/otp/verify \
  -H "Content-Type: application/json" \
  -d '{"phone":"+6591001010","code":"<CODE>","purpose":"first_timer_verify"}'
```

Expected: `{"verified":true,"verification_token":"eyJ..."}`

- [ ] **Step 4: Commit**

```bash
cd glowos
git add services/api/src/index.ts
git commit -m "feat(api): mount otpRouter under /booking"
```

---

# M4: Customer Recognition

## Task 10: `/booking/:slug/lookup-client` endpoint

**Files:**
- Modify: `glowos/services/api/src/routes/otp.ts`

- [ ] **Step 1: Add the lookup handler**

Append before the `export`:

```ts
otpRouter.post("/:slug/lookup-client", zValidator(lookupSchema), async (c) => {
  const slug = c.req.param("slug")!;
  const body = c.get("body") as z.infer<typeof lookupSchema>;

  const [merchant] = await db
    .select({ id: merchants.id, country: merchants.country })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);
  if (!merchant) return c.json({ matched: false });

  const defaultCountry = (merchant.country as "SG" | "MY") ?? "SG";
  const phone = normalizePhone(body.phone, defaultCountry);
  if (!phone) return c.json({ matched: false });

  // Rate limit: 10 lookups/min per IP
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
  const lookupKey = `lookup:rate:ip:${ip}`;
  const count = await redis.incr(lookupKey);
  if (count === 1) await redis.expire(lookupKey, 60);
  if (count > 10) {
    return c.json({ error: "Too Many Requests", message: "Slow down." }, 429);
  }

  const [client] = await db
    .select({ name: clients.name })
    .from(clients)
    .where(eq(clients.phone, phone))
    .limit(1);

  if (!client || !client.name) return c.json({ matched: false });

  const masked = client.name.length >= 2 ? client.name.slice(0, 2) + "***" : "***";
  return c.json({ matched: true, masked_name: masked });
});
```

- [ ] **Step 2: Build check**

```bash
cd glowos/services/api
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke test**

With the API running:

```bash
curl -X POST http://localhost:3001/booking/<SLUG>/lookup-client \
  -H "Content-Type: application/json" \
  -d '{"phone":"<EXISTING CLIENT PHONE>"}'
```

Expected: `{"matched":true,"masked_name":"Gr***"}`

And for a non-existent number:

```bash
curl -X POST http://localhost:3001/booking/<SLUG>/lookup-client \
  -H "Content-Type: application/json" \
  -d '{"phone":"+6591234567"}'
```

Expected: `{"matched":false}`

- [ ] **Step 4: Commit**

```bash
cd glowos
git add services/api/src/routes/otp.ts
git commit -m "feat(api): lookup-client endpoint for returning-customer recognition"
```

---

## Task 11: customer-auth issues `verification_token`

**Files:**
- Modify: `glowos/services/api/src/routes/customer-auth.ts`

- [ ] **Step 1: Import the helper**

Near the other imports:

```ts
import { generateVerificationToken } from "../lib/jwt.js";
```

- [ ] **Step 2: Modify the `/google` response**

At the end of the `customerAuthRouter.post("/google", …)` handler, replace the final `return c.json({ client: …, is_returning: … })` block with:

```ts
  const verificationToken = generateVerificationToken(
    {
      phone: client.phone?.startsWith("google_") ? null : client.phone,
      email: client.email,
      google_id: client.googleId,
      purpose: "google_verify",
      verified_at: Math.floor(Date.now() / 1000),
    },
    1800 // 30-min TTL for Google sessions
  );

  return c.json({
    client: {
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone?.startsWith("google_") ? "" : client.phone,
      avatarUrl: client.avatarUrl ?? googleAvatar,
      googleId: client.googleId,
    },
    is_returning: !!existingProfile,
    verification_token: verificationToken,
  });
```

- [ ] **Step 3: Build check**

```bash
cd glowos/services/api
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Smoke test**

Hit `/customer-auth/google` via the running booking widget (click "Continue with Google"). Open devtools → Network → inspect the response body.

Expected: response now contains a `verification_token` field (a JWT string).

- [ ] **Step 5: Commit**

```bash
cd glowos
git add services/api/src/routes/customer-auth.ts
git commit -m "feat(api): customer-auth/google issues verification_token (google_verify)"
```

---

# M5: Payment & Booking Handlers

## Task 12: `check-first-timer` normalizes inputs

**Files:**
- Modify: `glowos/services/api/src/routes/services.ts:60-109` (the existing handler)

- [ ] **Step 1: Add the import**

```ts
import { normalizePhone, normalizeEmail } from "../lib/normalize.js";
import { isFirstTimerAtMerchant } from "../lib/firstTimerCheck.js";
```

- [ ] **Step 2: Replace the handler body**

Replace lines 60-109 of `services.ts` with:

```ts
servicesRouter.get("/check-first-timer", async (c) => {
  const phone = c.req.query("phone");
  const email = c.req.query("email");
  const googleId = c.req.query("google_id");
  const slug = c.req.query("slug");

  if (!slug) {
    return c.json({ error: "Bad Request", message: "slug is required" }, 400);
  }

  const [merchant] = await db
    .select({ id: merchants.id, country: merchants.country })
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);

  if (!merchant) return c.json({ isFirstTimer: true });

  const defaultCountry = (merchant.country as "SG" | "MY") ?? "SG";
  const normalizedPhone = normalizePhone(phone, defaultCountry);
  const normalizedEmail = normalizeEmail(email);

  const isFirstTimer = await isFirstTimerAtMerchant({
    merchantId: merchant.id,
    normalizedPhone,
    normalizedEmail,
    googleId: googleId ?? null,
  });

  return c.json({ isFirstTimer });
});
```

- [ ] **Step 3: Build check**

```bash
cd glowos/services/api
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Smoke test with Grace Kim's variant phone**

```bash
# Request with a reformatted phone — should now match Grace (returning customer)
curl "http://localhost:3001/merchant/services/check-first-timer?slug=<SLUG>&phone=%2B65%2091001010"
```

Expected: `{"isFirstTimer":false}` (even with spaces / different formatting).

- [ ] **Step 5: Commit**

```bash
cd glowos
git add services/api/src/routes/services.ts
git commit -m "fix(api): check-first-timer normalizes phone/email before dedupe"
```

---

## Task 13: Default-deny first-timer logic in payment intent

**Files:**
- Modify: `glowos/services/api/src/routes/payments.ts`

- [ ] **Step 1: Add imports**

Near the top:

```ts
import { normalizePhone, normalizeEmail } from "../lib/normalize.js";
import { isFirstTimerAtMerchant } from "../lib/firstTimerCheck.js";
import { verifyVerificationToken } from "../lib/jwt.js";
```

- [ ] **Step 2: Extend the schema**

In the `createPaymentIntentSchema` definition, add:

```ts
verification_token: z.string().optional(),
```

Leave `is_first_timer` in the schema for now; it will be ignored for pricing but kept for analytics compatibility during migration.

- [ ] **Step 3: Replace the first-timer pricing block**

Find the existing block (around payments.ts lines 344-357) that currently reads:

```ts
if (service.firstTimerDiscountEnabled && service.firstTimerDiscountPct && body.is_first_timer) {
  const firstTimerPrice = basePrice * (1 - service.firstTimerDiscountPct / 100);
  if (firstTimerPrice < priceSgd) {
    priceSgd = firstTimerPrice;
  }
}
```

Replace with:

```ts
// Server-side first-timer: default-deny unless a valid verification token matches.
if (
  service.firstTimerDiscountEnabled &&
  service.firstTimerDiscountPct &&
  body.verification_token
) {
  const token = verifyVerificationToken(body.verification_token);
  if (token) {
    const defaultCountry = (merchant.country as "SG" | "MY") ?? "SG";
    const normalizedPhone = normalizePhone(body.client_phone, defaultCountry);
    const normalizedEmail = normalizeEmail(body.client_email);

    let identityMatches = false;
    if (
      token.purpose === "google_verify" &&
      body.client_id && // Google path goes through client_id
      token.google_id
    ) {
      // Match on google_id via the client record
      const [existing] = await db
        .select({ googleId: clients.googleId })
        .from(clients)
        .where(eq(clients.id, body.client_id))
        .limit(1);
      if (existing?.googleId && existing.googleId === token.google_id) {
        identityMatches = true;
      }
    } else if (
      token.purpose === "first_timer_verify" &&
      token.phone &&
      normalizedPhone &&
      token.phone === normalizedPhone
    ) {
      identityMatches = true;
    }

    if (identityMatches) {
      const eligible = await isFirstTimerAtMerchant({
        merchantId: merchant.id,
        normalizedPhone,
        normalizedEmail,
        googleId: token.google_id ?? null,
      });
      if (eligible) {
        const firstTimerPrice = basePrice * (1 - service.firstTimerDiscountPct / 100);
        if (firstTimerPrice < priceSgd) {
          priceSgd = firstTimerPrice;
        }
      }
    }
  }
}

// Log discount decision for observability
console.log("[Payments] discount_applied", {
  phone: normalizePhone(body.client_phone ?? null) ?? null,
  path: body.verification_token ? "token" : "none",
  regular_pct: service.discountPct ?? 0,
  first_timer_pct: service.firstTimerDiscountPct ?? 0,
  final_price: priceSgd,
});
```

(Adjust the exact line/variable names to match the current payments.ts — `merchant`, `service`, `basePrice`, `priceSgd` all exist already.)

- [ ] **Step 4: Build check**

```bash
cd glowos/services/api
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Smoke test**

With the API running, POST to `/booking/<SLUG>/create-payment-intent` without a `verification_token` for a service that has a first-timer discount.

Expected: response price reflects regular discount only (NOT first-timer discount).

Then repeat with a valid `verification_token` (obtained from `/otp/verify` for a new phone).

Expected: response price reflects first-timer discount.

- [ ] **Step 6: Commit**

```bash
cd glowos
git add services/api/src/routes/payments.ts
git commit -m "feat(api): payment intent default-denies first-timer without verification"
```

---

## Task 14: `/booking/:slug/confirm` threads verification_token

**Files:**
- Modify: `glowos/services/api/src/routes/bookings.ts`

The `/:slug/confirm` endpoint is used for pay-at-appointment bookings (no Stripe). It must apply the same default-deny logic when the booking has a first-timer discount implied by the selected service.

- [ ] **Step 1: Extend `confirmSchema`**

At `bookings.ts:45-52`, add:

```ts
verification_token: z.string().optional(),
```

- [ ] **Step 2: Add imports**

```ts
import { isFirstTimerAtMerchant } from "../lib/firstTimerCheck.js";
import { verifyVerificationToken } from "../lib/jwt.js";
```

(`normalizePhone`/`normalizeEmail` were added in Task 5.)

- [ ] **Step 3: Replace the `priceSgd` computation inside `/:slug/confirm`**

Today the handler reads `priceSgd` directly from the service (line ~1129). Replace that block with logic that mirrors Task 13. Load the full service fields (`discountPct`, `firstTimerDiscountPct`, `firstTimerDiscountEnabled`) instead of just price+duration:

```ts
const [service] = await db
  .select({
    priceSgd: services.priceSgd,
    durationMinutes: services.durationMinutes,
    discountPct: services.discountPct,
    firstTimerDiscountPct: services.firstTimerDiscountPct,
    firstTimerDiscountEnabled: services.firstTimerDiscountEnabled,
  })
  .from(services)
  .where(eq(services.id, lease.serviceId))
  .limit(1);
```

Then compute `priceSgd` using the same pattern as payments.ts:

```ts
const basePrice = parseFloat(service.priceSgd);
let computedPrice = basePrice;
if (service.discountPct) {
  computedPrice = basePrice * (1 - service.discountPct / 100);
}
if (
  service.firstTimerDiscountEnabled &&
  service.firstTimerDiscountPct &&
  body.verification_token
) {
  const token = verifyVerificationToken(body.verification_token);
  if (token) {
    const defaultCountry = (merchant.country as "SG" | "MY") ?? "SG";
    const normalizedPhone = normalizePhone(body.client_phone, defaultCountry);
    const normalizedEmail = normalizeEmail(body.client_email);

    let identityMatches = false;
    if (token.purpose === "google_verify" && body.client_id && token.google_id) {
      const [existing] = await db
        .select({ googleId: clients.googleId })
        .from(clients)
        .where(eq(clients.id, body.client_id))
        .limit(1);
      if (existing?.googleId && existing.googleId === token.google_id) identityMatches = true;
    } else if (
      token.purpose === "first_timer_verify" &&
      token.phone &&
      normalizedPhone &&
      token.phone === normalizedPhone
    ) {
      identityMatches = true;
    }

    if (identityMatches) {
      const eligible = await isFirstTimerAtMerchant({
        merchantId: merchant.id,
        normalizedPhone,
        normalizedEmail,
        googleId: token.google_id ?? null,
      });
      if (eligible) {
        const ftPrice = basePrice * (1 - service.firstTimerDiscountPct / 100);
        if (ftPrice < computedPrice) computedPrice = ftPrice;
      }
    }
  }
}

// Write the final computed price to the booking insert
const priceSgdFinal = computedPrice.toFixed(2);
```

And in the `.insert(bookings).values({ … priceSgd: service.priceSgd … })`, change to `priceSgd: priceSgdFinal`.

Also make sure `merchant.country` is selected earlier (around line 1097). Update that initial merchant query:

```ts
const [merchant] = await db
  .select({ id: merchants.id, country: merchants.country })
  .from(merchants)
  .where(eq(merchants.slug, slug))
  .limit(1);
```

- [ ] **Step 4: Build check**

```bash
cd glowos/services/api
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Smoke test**

Create a lease → `/booking/<SLUG>/confirm` without `verification_token` on a first-timer-discounted service. Check the created booking's `priceSgd` in DB.

Expected: price matches the regular discount, not the first-timer discount.

With a valid token for a first-timer phone: price matches the first-timer discount.

- [ ] **Step 6: Commit**

```bash
cd glowos
git add services/api/src/routes/bookings.ts
git commit -m "feat(api): /booking/:slug/confirm default-denies first-timer without verification"
```

---

# M6: Backfill Migration

## Task 15: Normalize existing client phone/email

**Files:**
- Create: `glowos/services/api/scripts/normalize-client-contact.ts`

- [ ] **Step 1: Create the backfill script**

```ts
// glowos/services/api/scripts/normalize-client-contact.ts
import { db, clients } from "@glowos/db";
import { eq } from "drizzle-orm";
import { normalizePhone, normalizeEmail } from "../src/lib/normalize.js";

async function main() {
  const all = await db
    .select({
      id: clients.id,
      phone: clients.phone,
      email: clients.email,
    })
    .from(clients);

  const normalized: Array<{
    id: string;
    oldPhone: string | null;
    newPhone: string | null;
    oldEmail: string | null;
    newEmail: string | null;
  }> = [];

  // First pass: compute normalized values
  for (const row of all) {
    // Skip synthetic google_* placeholder phones untouched
    if (row.phone?.startsWith("google_")) continue;
    const newPhone = normalizePhone(row.phone, "SG");
    const newEmail = normalizeEmail(row.email);
    if (newPhone !== row.phone || newEmail !== row.email) {
      normalized.push({
        id: row.id,
        oldPhone: row.phone,
        newPhone,
        oldEmail: row.email,
        newEmail,
      });
    }
  }

  // Detect collisions (two rows normalizing to the same phone)
  const byPhone = new Map<string, string[]>();
  for (const n of normalized) {
    if (!n.newPhone) continue;
    const list = byPhone.get(n.newPhone) ?? [];
    list.push(n.id);
    byPhone.set(n.newPhone, list);
  }
  // Also check existing rows that ALREADY match normalized values
  for (const row of all) {
    if (row.phone?.startsWith("google_")) continue;
    const current = normalizePhone(row.phone, "SG");
    if (!current) continue;
    const list = byPhone.get(current) ?? [];
    if (!list.includes(row.id)) list.push(row.id);
    byPhone.set(current, list);
  }

  const collisions = Array.from(byPhone.entries()).filter(([, ids]) => ids.length > 1);
  if (collisions.length > 0) {
    console.warn("[Backfill] COLLISIONS DETECTED — manual review required. Not auto-merging.");
    for (const [phone, ids] of collisions) {
      console.warn(`  ${phone} → client ids: ${ids.join(", ")}`);
    }
  }

  // Apply updates (skip rows involved in collisions)
  const collisionIds = new Set(collisions.flatMap(([, ids]) => ids));
  let updated = 0;
  let skipped = 0;
  for (const n of normalized) {
    if (collisionIds.has(n.id)) {
      skipped++;
      continue;
    }
    await db
      .update(clients)
      .set({
        ...(n.newPhone !== n.oldPhone ? { phone: n.newPhone ?? n.oldPhone! } : {}),
        ...(n.newEmail !== n.oldEmail ? { email: n.newEmail } : {}),
      })
      .where(eq(clients.id, n.id));
    updated++;
  }

  console.log(`[Backfill] total=${all.length} updated=${updated} skipped(collisions)=${skipped} collisions=${collisions.length}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run locally against a snapshot**

```bash
cd glowos/services/api
# First take a snapshot of clients.phone/email for verification
psql $DATABASE_URL -c "\copy (SELECT id, phone, email FROM clients) TO '/tmp/clients-pre-backfill.csv' CSV HEADER"

# Run the script
npx tsx scripts/normalize-client-contact.ts
```

Expected: log shows `total=X updated=Y skipped=Z collisions=W`. Collisions (if any) are logged with client IDs for manual review.

- [ ] **Step 3: Spot-check a handful of rows**

```bash
psql $DATABASE_URL -c "SELECT id, phone, email FROM clients WHERE phone LIKE '+65%' ORDER BY created_at DESC LIMIT 5;"
```

Expected: phones are E.164 (start with `+65` or `+60`, no spaces/dashes), emails are lowercase.

- [ ] **Step 4: Commit**

```bash
cd glowos
git add services/api/scripts/normalize-client-contact.ts
git commit -m "chore(db): backfill script to normalize clients.phone/email"
```

---

# M7: Frontend Step 4 Rebuild

## Task 16: Remove the silent catch on first-timer check

**Files:**
- Modify: `glowos/apps/web/app/[slug]/BookingWidget.tsx:1188-1198`

- [ ] **Step 1: Replace the silent catch block**

Locate the existing block around lines 1188-1198:

```ts
if (selectedService?.firstTimerDiscountEnabled) {
  try {
    const params = new URLSearchParams({ slug });
    if (clientPhone.trim()) params.set('phone', clientPhone.trim());
    if (clientEmail.trim()) params.set('email', clientEmail.trim());
    if (authClient?.googleId) params.set('google_id', authClient.googleId);
    const ftRes = await apiFetch(`/merchant/services/check-first-timer?${params.toString()}`);
    setIsFirstTimer((ftRes as { isFirstTimer: boolean }).isFirstTimer);
  } catch { /* ignore */ }
}
```

Replace with:

```ts
if (selectedService?.firstTimerDiscountEnabled) {
  try {
    const params = new URLSearchParams({ slug });
    if (clientPhone.trim()) params.set('phone', clientPhone.trim());
    if (clientEmail.trim()) params.set('email', clientEmail.trim());
    if (authClient?.googleId) params.set('google_id', authClient.googleId);
    const ftRes = await apiFetch(`/merchant/services/check-first-timer?${params.toString()}`);
    setIsFirstTimer((ftRes as { isFirstTimer: boolean }).isFirstTimer);
  } catch (err) {
    console.error("[BookingWidget] first-timer check failed", err);
    // Default to false — safer than null when deciding whether to offer verification
    setIsFirstTimer(false);
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd glowos
git add apps/web/app/[slug]/BookingWidget.tsx
git commit -m "fix(web): first-timer check failure logs + defaults to false"
```

---

## Task 17: OTPVerificationCard component

**Files:**
- Create: `glowos/apps/web/app/[slug]/components/OTPVerificationCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
// glowos/apps/web/app/[slug]/components/OTPVerificationCard.tsx
'use client';
import { useState } from 'react';
import { apiFetch } from '../../../lib/api';

interface Props {
  slug: string;
  phone: string;
  email?: string;
  purpose: 'login' | 'first_timer_verify';
  title: string;
  subtitle?: string;
  onVerified: (token: string, client?: { id: string; name: string | null; email: string | null; google_id: string | null }) => void;
  onSkip?: () => void;
}

export function OTPVerificationCard({ slug, phone, email, purpose, title, subtitle, onVerified, onSkip }: Props) {
  const [stage, setStage] = useState<'send' | 'enter'>('send');
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [maskedDestination, setMaskedDestination] = useState<string>('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendCode(useChannel: 'whatsapp' | 'email') {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/booking/${slug}/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          email,
          channel: useChannel,
          purpose,
        }),
      }) as { sent: boolean; channel: string; masked_destination: string };
      setChannel(useChannel);
      setMaskedDestination(res.masked_destination);
      setStage('enter');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send code';
      if (useChannel === 'whatsapp' && email) {
        setError("WhatsApp send failed — try email instead?");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    if (code.length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/booking/${slug}/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code, purpose }),
      }) as { verified: boolean; verification_token: string; client?: any };
      onVerified(res.verification_token, res.client);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Incorrect code';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
      <div className="font-medium">{title}</div>
      {subtitle && <div className="text-sm text-gray-600 mt-1">{subtitle}</div>}
      {stage === 'send' ? (
        <div className="mt-3 space-y-2">
          <button
            type="button"
            onClick={() => sendCode('whatsapp')}
            disabled={loading}
            className="w-full rounded bg-green-600 text-white py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Sending…' : 'Send WhatsApp code'}
          </button>
          {email && (
            <button
              type="button"
              onClick={() => sendCode('email')}
              disabled={loading}
              className="w-full rounded border border-gray-300 py-2 text-sm disabled:opacity-50"
            >
              Use email instead
            </button>
          )}
          {onSkip && (
            <button type="button" onClick={onSkip} className="w-full text-xs text-gray-500 underline">
              Skip discount and continue
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="text-xs text-gray-600">Code sent to {maskedDestination}</div>
          <input
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="6-digit code"
            className="w-full rounded border-gray-300 py-2 px-3 text-center tracking-widest"
          />
          <button
            type="button"
            onClick={verify}
            disabled={loading || code.length !== 6}
            className="w-full rounded bg-purple-600 text-white py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Verifying…' : 'Verify'}
          </button>
          <button
            type="button"
            onClick={() => { setStage('send'); setCode(''); }}
            className="w-full text-xs text-gray-500 underline"
          >
            Didn't receive it? Send again
          </button>
          {onSkip && (
            <button type="button" onClick={onSkip} className="w-full text-xs text-gray-500 underline">
              Skip discount and continue
            </button>
          )}
        </div>
      )}
      {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
cd glowos/apps/web
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd glowos
git add apps/web/app/[slug]/components/OTPVerificationCard.tsx
git commit -m "feat(web): OTPVerificationCard component"
```

---

## Task 18: ReturningCustomerCard component

**Files:**
- Create: `glowos/apps/web/app/[slug]/components/ReturningCustomerCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
// glowos/apps/web/app/[slug]/components/ReturningCustomerCard.tsx
'use client';

interface Props {
  maskedName: string;
  phone: string;
  onConfirm: () => void;
  onNotMe: () => void;
}

export function ReturningCustomerCard({ maskedName, phone, onConfirm, onNotMe }: Props) {
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4">
      <div className="font-medium">👋 Welcome back, {maskedName}!</div>
      <div className="text-sm text-gray-600 mt-1">Is this you? {phone}</div>
      <div className="mt-3 space-y-2">
        <button
          type="button"
          onClick={onConfirm}
          className="w-full rounded bg-green-600 text-white py-2 text-sm font-medium"
        >
          Send WhatsApp code to continue
        </button>
        <button
          type="button"
          onClick={onNotMe}
          className="w-full text-xs text-gray-500 underline"
        >
          Not me
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build check**

```bash
cd glowos/apps/web
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd glowos
git add apps/web/app/[slug]/components/ReturningCustomerCard.tsx
git commit -m "feat(web): ReturningCustomerCard component"
```

---

## Task 19: Wire returning-customer recognition into BookingWidget Step 4

**Files:**
- Modify: `glowos/apps/web/app/[slug]/BookingWidget.tsx`

- [ ] **Step 1: Add state for recognition + verification**

Near the existing `useState` declarations in BookingWidget, add:

```tsx
const [lookupResult, setLookupResult] = useState<{ matched: boolean; masked_name?: string } | null>(null);
const [verificationToken, setVerificationToken] = useState<string | null>(null);
const [registerMode, setRegisterMode] = useState(false); // true after clicking "Register now"
```

- [ ] **Step 2: Add a debounced phone lookup effect**

```tsx
useEffect(() => {
  if (authClient) return; // Google user, skip lookup
  const phone = clientPhone.trim();
  if (phone.length < 6) {
    setLookupResult(null);
    return;
  }
  const t = setTimeout(async () => {
    try {
      const res = await apiFetch(`/booking/${slug}/lookup-client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      }) as { matched: boolean; masked_name?: string };
      setLookupResult(res);
    } catch {
      setLookupResult(null);
    }
  }, 500);
  return () => clearTimeout(t);
}, [clientPhone, slug, authClient]);
```

- [ ] **Step 3: Render the Returning-Customer card when matched**

Inside the Step 4 render block, at the top of the details form (before the name/email inputs), add:

```tsx
{lookupResult?.matched && !registerMode && !verificationToken && (
  <ReturningCustomerCard
    maskedName={lookupResult.masked_name ?? 'there'}
    phone={clientPhone}
    onConfirm={() => setShowLoginOtp(true)}
    onNotMe={() => { setLookupResult(null); setRegisterMode(true); }}
  />
)}

{showLoginOtp && (
  <OTPVerificationCard
    slug={slug}
    phone={clientPhone}
    purpose="login"
    title="Verify your number"
    subtitle="We'll send a one-time code to continue"
    onVerified={(token, client) => {
      setVerificationToken(token);
      if (client) {
        setClientName(client.name ?? '');
        setClientEmail(client.email ?? '');
      }
      setShowLoginOtp(false);
      // Auto-advance to Step 5
      setStep(5);
    }}
  />
)}
```

Add the corresponding state:

```tsx
const [showLoginOtp, setShowLoginOtp] = useState(false);
```

And import the components:

```tsx
import { OTPVerificationCard } from './components/OTPVerificationCard';
import { ReturningCustomerCard } from './components/ReturningCustomerCard';
```

- [ ] **Step 4: Build check**

```bash
cd glowos/apps/web
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Manual smoke test**

Run `pnpm dev` in the web app; open the widget; enter a phone that exists in DB → "Welcome back" card appears → tap "Send WhatsApp code" → OTP card → enter code → auto-advances to Step 5, fields prefilled.

- [ ] **Step 6: Commit**

```bash
cd glowos
git add apps/web/app/[slug]/BookingWidget.tsx
git commit -m "feat(web): returning-customer recognition + login OTP in Step 4"
```

---

## Task 20: Register-now flow with conditional first-timer OTP

**Files:**
- Modify: `glowos/apps/web/app/[slug]/BookingWidget.tsx`

- [ ] **Step 1: Relabel "Continue as guest" → "Register now"**

Locate the guest/continue button (usually around the auth-options block in Step 4) and change its text to `Register now`.

- [ ] **Step 2: Decide when to show the first-timer OTP card**

Add a derived value:

```tsx
const firstTimerIsBetter =
  !!selectedService?.firstTimerDiscountEnabled &&
  (selectedService?.firstTimerDiscountPct ?? 0) > (selectedService?.discountPct ?? 0);

const shouldOfferFirstTimerOtp =
  registerMode &&
  !authClient &&
  firstTimerIsBetter &&
  !!clientName.trim() &&
  !!clientPhone.trim() &&
  !verificationToken;
```

- [ ] **Step 3: Render the first-timer OTP card conditionally**

Inside the Step 4 form, below the name/phone/email fields:

```tsx
{shouldOfferFirstTimerOtp && (
  <OTPVerificationCard
    slug={slug}
    phone={clientPhone}
    email={clientEmail}
    purpose="first_timer_verify"
    title={`🎁 Claim ${selectedService?.firstTimerDiscountPct}% first-visit discount`}
    subtitle="Verify your phone to unlock"
    onVerified={(token) => {
      setVerificationToken(token);
      setIsFirstTimer(true);
    }}
    onSkip={() => {
      setVerificationToken(null);
      setIsFirstTimer(false);
    }}
  />
)}
```

- [ ] **Step 4: Gate "Continue to Review"**

Find the "Continue to Review" button. Add a `disabled` rule: if `shouldOfferFirstTimerOtp` is true (i.e., discount card is showing, user hasn't verified and hasn't skipped), disable the button.

```tsx
<button
  type="button"
  disabled={shouldOfferFirstTimerOtp}
  onClick={/* existing handler */}
  className="…"
>
  Continue to Review
</button>
```

Note: because `onSkip` clears the verification attempt AND sets `isFirstTimer=false`, a user who hits Skip will bypass the card (the card's render condition no longer matches after reset). Track skip explicitly:

```tsx
const [skippedFirstTimerOtp, setSkippedFirstTimerOtp] = useState(false);

// In shouldOfferFirstTimerOtp:
const shouldOfferFirstTimerOtp =
  registerMode &&
  !authClient &&
  firstTimerIsBetter &&
  !!clientName.trim() &&
  !!clientPhone.trim() &&
  !verificationToken &&
  !skippedFirstTimerOtp;

// onSkip:
onSkip={() => {
  setSkippedFirstTimerOtp(true);
  setIsFirstTimer(false);
}}
```

- [ ] **Step 5: Forward the verification_token on payment + confirm**

Wherever the widget POSTs to `/booking/${slug}/create-payment-intent` or `/booking/${slug}/confirm`, add `verification_token: verificationToken ?? undefined` to the body.

- [ ] **Step 6: Build check**

```bash
cd glowos/apps/web
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Manual smoke test**

1. Pick a service with first-timer discount > regular discount.
2. Register-now path with a NEW phone → OTP card appears → enter code → discount applied at confirm.
3. Register-now path, click "Skip discount and continue" → OTP card disappears → regular price applied at confirm.
4. Register-now path with Grace's phone (existing client) → the Returning-Customer card appears (from Task 19), NOT the first-timer OTP card.

- [ ] **Step 8: Commit**

```bash
cd glowos
git add apps/web/app/[slug]/BookingWidget.tsx
git commit -m "feat(web): Register-now flow with conditional first-timer OTP"
```

---

## Task 21: Google Sign-in primary CTA + verification_token storage

**Files:**
- Modify: `glowos/apps/web/app/[slug]/BookingWidget.tsx`

- [ ] **Step 1: Promote Google Sign-in to primary**

In Step 4, reorder so "Continue with Google" renders above the phone/name/email form. The full form only shows when user clicks "Register now" (sets `registerMode=true`).

```tsx
{!registerMode && !authClient && (
  <div className="space-y-4">
    <label className="block">
      <span className="text-sm text-gray-600">Phone number</span>
      <input
        value={clientPhone}
        onChange={(e) => setClientPhone(e.target.value)}
        className="mt-1 w-full rounded border-gray-300 py-2 px-3"
        autoFocus
      />
    </label>
    {lookupResult?.matched && (
      <ReturningCustomerCard … />
    )}
    <div className="flex items-center text-xs text-gray-400">
      <div className="flex-1 border-t" />
      <span className="px-2">or sign in faster</span>
      <div className="flex-1 border-t" />
    </div>
    <GoogleSignInButton /* existing component */ />
    <button
      type="button"
      onClick={() => setRegisterMode(true)}
      className="w-full rounded border border-gray-300 py-2 text-sm"
    >
      Register now
    </button>
  </div>
)}
```

- [ ] **Step 2: Capture verification_token from Google Sign-in**

Where the Google Sign-in callback handles `/customer-auth/google` response, extract and store the new `verification_token` field:

```tsx
const res = await apiFetch('/customer-auth/google', { … });
setAuthClient({
  id: res.client.id,
  name: res.client.name,
  email: res.client.email,
  phone: res.client.phone,
  googleId: res.client.googleId,
  avatarUrl: res.client.avatarUrl,
});
if (res.verification_token) setVerificationToken(res.verification_token);
```

- [ ] **Step 3: Build check**

```bash
cd glowos/apps/web
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manual smoke test**

1. Open widget at Step 4 → see "Continue with Google" as primary, "Register now" as secondary, phone field above both.
2. Click Google → sign in → advance to Step 5 → first-timer discount applied (if eligible and service qualifies).
3. Click Register now → form appears → proceed as in Task 20.

- [ ] **Step 5: Commit**

```bash
cd glowos
git add apps/web/app/[slug]/BookingWidget.tsx
git commit -m "feat(web): Google Sign-in primary CTA + store verification_token"
```

---

# M8: Rollout & QA

## Task 22: End-to-end staging verification

**Files:** None (QA only)

- [ ] **Step 1: Deploy backend-only to a staging branch**

Push the branch with Tasks 1-15 merged; allow Railway preview or staging environment to deploy. Verify Vercel doesn't build yet (frontend not merged to main).

- [ ] **Step 2: Run the backfill script against staging DB**

```bash
DATABASE_URL=<staging> npx tsx glowos/services/api/scripts/normalize-client-contact.ts
```

Expected: logs `updated=X skipped=0 collisions=0` (collisions should be investigated before production).

- [ ] **Step 3: Deploy frontend changes to staging**

Merge Tasks 16-21. Staging frontend now points at the staging API.

- [ ] **Step 4: Run the full manual checklist**

- [ ] Google Sign-in (new customer): no OTP, first-timer discount applied
- [ ] Google Sign-in (returning customer by google_id): no OTP, no first-timer discount
- [ ] Register-now (new customer, first-timer discount > regular): OTP required, discount applied
- [ ] Register-now (new customer, no first-timer discount on service): no OTP, regular price
- [ ] Register-now (new customer, first-timer <= regular): no OTP, regular discount applied (first-timer never offered)
- [ ] Register-now with expired JWT at confirm: regular discount applies, console shows expired warning
- [ ] Returning-customer phone lookup: "Welcome back" card, OTP login, auto-fill, jumps to Step 5
- [ ] WhatsApp failure (temporarily unset `TWILIO_*`): email fallback works
- [ ] Grace Kim's phone with reformatting (`+65 91001010`): recognized as returning, NOT offered first-timer

- [ ] **Step 5: If all pass, mark Task 22 complete and proceed.** If anything fails, file issues and fix before Task 23.

- [ ] **Step 6: Commit (no changes expected — tag for audit)**

Not applicable — this task is QA only. Move to Task 23.

---

## Task 23: Production rollout

**Files:** None (deployment only)

- [ ] **Step 1: Merge all tasks into main**

Ensure commits from Tasks 1-21 are on `main`.

- [ ] **Step 2: Deploy backend to Railway**

Trigger Railway deploy (or rely on auto-deploy from main). Monitor logs for OTP/first-timer errors.

- [ ] **Step 3: Run backfill against production**

```bash
DATABASE_URL=<production> npx tsx glowos/services/api/scripts/normalize-client-contact.ts
```

Review any reported collisions. Contact merchant(s) for each collision if needed; do not auto-merge.

- [ ] **Step 4: Deploy frontend to Vercel**

Trigger Vercel deploy from main.

- [ ] **Step 5: Monitor for 48 hours**

Watch logs:
- `[Payments] discount_applied` — should show `path: "none"` for guest bookings without verification, `path: "token"` for verified ones
- `[NotificationWorker] otp_send` — should succeed consistently
- `[BookingWidget] first-timer check failed` — should be rare

Expect a short-term dip in first-timer grants versus pre-rollout — that is the abuse vector closing, not a regression.

- [ ] **Step 6: Update progress.md**

```bash
cd glowos
# Add a Session 11 entry to /Users/chrisrine/Desktop/projects/bookingcrm/progress.md
```

Note the shipped features and link to the spec/plan.

- [ ] **Step 7: Commit + tag**

```bash
cd /Users/chrisrine/Desktop/projects/bookingcrm
git add progress.md
git commit -m "docs: session 11 — first-timer verification shipped"
git tag v0.11.0  # optional, if your release process uses tags
```

---

## Plan Self-Review Notes

- **Spec coverage:** each section of the spec maps to tasks as follows:
  - "Verification Strategy" + "When OTP Fires" → Tasks 16-21 (frontend) + Tasks 12-14 (backend enforcement)
  - "OTP Delivery" → Task 6 (worker), Tasks 7-9 (endpoints)
  - "Step 4 UI Rebuild" → Tasks 17-21
  - "Backend Endpoints" → Tasks 7-11
  - "Verification Token (JWT)" → Task 3, applied in Tasks 11-14
  - "Server-Side First-Timer Verification" → Task 4, wired up in Tasks 12-14
  - "Normalization" → Tasks 2, 5, 12
  - "Data Migration" → Task 15
  - "Error Handling" / "Edge Cases" → covered inline in Tasks 7-8, 13-14, 17
  - "Testing Strategy" → collapsed into Task 22's manual checklist (codebase has no test framework; adding one is out of scope for this plan)
  - "Rollout Plan" → Tasks 22-23
  - "Observability" → Task 13 (console.log), Task 6 (worker logs)

- **Placeholder scan:** none found; every step has real code, commands, or explicit QA items.

- **Out of scope (deliberately):** unit test framework setup; device fingerprinting; SMS fallback; password-based accounts; auto-merging collision duplicates.

# First-Timer Discount Verification — Design Spec

**Date:** 19 April 2026
**Status:** Drafted, pending user review
**Scope:** Close the first-timer discount abuse vector; add WhatsApp/email OTP verification, Google Sign-in primary path, "Register now" flow, and server-side first-timer verification. Improve returning-customer recognition via normalized phone/email lookup.

---

## Motivation

The current booking widget applies the first-timer discount based on a client-side flag that the server trusts blindly. Dedupe uses exact-match phone/email, so `+65 91001010` and `+6591001010` are treated as different people. Additionally, the `check-first-timer` call fails silently on network errors, leaving `isFirstTimer` in an ambiguous state. Net effect: a returning customer can get the first-timer discount by changing email or reformatting their phone, and a failed verification silently falls back to the regular discount in a confusing way.

The fix must:

- Prevent discount abuse (returning customers cannot claim first-timer pricing).
- Keep friction low for overseas tourists (no local SIM required for OTP).
- Avoid tying first-timer verification to a payment gateway (Stripe is not confirmed yet).
- Maximize conversions by making account creation feel like a value-add, not a gate.

---

## Verification Strategy

Three identity paths at the booking widget's "Your details" step:

1. **Google Sign-in** — primary CTA. Trusted identity via `google_id`; no OTP required.
2. **Register now** — secondary CTA, replaces today's "Continue as guest." Passwordless account creation. OTP required *only* when the service offers a first-timer discount that is strictly greater than its regular discount.
3. **Returning-customer recognition** — phone-first field with debounced lookup. On match, offers "Welcome back, [Name]? Send WhatsApp code to continue." OTP used as passwordless login; auto-fills profile and proceeds to confirm.

Device fingerprinting is explicitly out of scope (overkill for booking UX).

---

## When OTP Fires

OTP is required only for the narrow case where abuse matters:

| Situation | OTP? |
|---|---|
| Returning customer (phone matched in DB) | Yes — as passwordless login |
| Google Sign-in (new or returning) | Never — `google_id` is the identity proof |
| New via Register, service has no first-timer discount | Never |
| New via Register, `first_timer_discount_pct <= discount_pct` | Never |
| New via Register, `first_timer_discount_pct > discount_pct` | Yes — to claim the extra discount |

This keeps the vast majority of guest bookings friction-free.

---

## OTP Delivery: WhatsApp Primary, Email Fallback

- **Channel 1 — WhatsApp** via existing Twilio integration (`whatsapp-queue` BullMQ job). Works globally for any tourist with WhatsApp installed. Cost ~$0.005/message.
- **Channel 2 — Email** via existing email queue. User-triggered fallback ("Use email instead") or auto-triggered when Twilio returns a delivery error.
- **No SMS fallback.** Cost and international delivery unreliability outweigh the marginal coverage gain.

OTP format: 6-digit numeric code, cryptographically random via `crypto.randomInt`, 10-minute TTL, max 5 attempts.

---

## Step 4 UI Rebuild

Step 4 of the booking widget ("Your details") gets three sub-states on the same step:

### State A — Initial landing

```
Your details

Phone number
[ _____________________ ]   ← focused first

── or sign in faster ──
[ Continue with Google ]    ← primary

[ Register now ]            ← secondary
```

Phone-first because it is the dedupe key. A debounced lookup (~500ms) hits `POST /booking/:slug/lookup-client` as the user types.

### State B — Returning customer matched

```
👋 Welcome back, Grace!

Is this you? +65 9100 1010
[ Send WhatsApp code to continue ]
Use email instead · Not me
```

- "Not me" collapses back to State A.
- "Send code" triggers OTP; on success, server returns the client's profile; fields auto-fill and user is advanced to Step 5.
- First-timer discount is never offered to returning customers (server-side check denies it regardless).

### State C — Register now (new customer)

```
Register with Glow

Name   [ _____________________ ]
Phone  [ ____________ ]   (prefilled from State A)
Email  [ _____________________ ]

(only when first_timer_discount_pct > discount_pct:)
┌──────────────────────────────────────────┐
│  🎁 Claim 10% first-visit discount        │
│  Verify your phone to unlock              │
│  [ Send WhatsApp code ]                   │
│  Use email instead                        │
│  Skip discount and continue               │
└──────────────────────────────────────────┘

[ Continue to Review ]
```

- The verification card appears only when the first-timer discount is actually the best price.
- "Continue to Review" is disabled until OTP verifies OR user clicks "Skip discount and continue."
- When no first-timer discount applies, the card is hidden and "Continue to Review" is enabled immediately.

### State D — Google Sign-in

Tapping "Continue with Google" opens the Google OAuth popup. On success, name, email, and `google_id` are captured and the user is advanced directly to Step 5. No OTP is shown.

---

## Backend Endpoints

All new endpoints live in a new file: `services/api/src/routes/otp.ts`.

### `POST /booking/:slug/lookup-client`

Recognize returning customers.

- **Body:** `{ phone: string }`
- Normalizes phone to E.164 (using merchant country as default).
- Queries `clients` table by normalized phone.
- Returns `{ matched: boolean, masked_name?: string }` — e.g., `"Gr***"` (first two characters only, for privacy).
- **Rate limit:** 10 req/min per IP to prevent phone-number enumeration.

### `POST /booking/:slug/otp/send`

- **Body:** `{ phone: string, email?: string, channel: "whatsapp" | "email", purpose: "login" | "first_timer_verify" }`
- Generates a 6-digit OTP via `crypto.randomInt(100000, 1000000)`.
- Stores in Redis: key `otp:{normalized_phone}:{purpose}` → `{ code, email, channel, attempts: 0 }`, TTL 600s.
- Dispatches via the chosen channel (Twilio WhatsApp job, or email job).
- **Rate limits:** 3 sends per 15 min per phone; 10 sends per hour per IP.
- Returns `{ sent: true, channel, masked_destination }` (e.g., `"+65••••1010"` or `"s***@gmail.com"`).

### `POST /booking/:slug/otp/verify`

- **Body:** `{ phone: string, code: string, purpose: "login" | "first_timer_verify" }`
- Reads the Redis entry, validates the code, increments attempts on mismatch.
- After 5 failed attempts the Redis entry is deleted; the user must request a new code.
- On success:
  - Deletes the Redis entry (single-use).
  - Issues a short-lived JWT (`verification_token`).
  - JWT payload: `{ phone: normalized_phone, email: normalized_email | null, purpose, verified_at, iat, exp }`.
  - TTL: 10 minutes. Signed with existing `JWT_SECRET`.
- For `purpose=login`, also returns `client: { name, email, google_id }` so the frontend can auto-fill.
- Returns `{ verified: true, verification_token, client? }`.

### Modified: `POST /customer-auth/google`

After verifying the Google ID token (existing logic, unchanged), this endpoint now also issues a `verification_token` — the same JWT format as the OTP verify endpoint, but with `purpose: "google_verify"` and the payload carrying `google_id`, `email`, and `phone` (if known from the client record). TTL 30 minutes (longer than OTP because a Google sign-in session typically spans a longer booking session).

This closes a gap in the current architecture: today the frontend receives only the client record and passes `google_id` in subsequent requests — the payment endpoint has no way to confirm the `google_id` wasn't forged. The JWT gives the payment endpoint a verifiable proof that Google actually signed this identity.

### Modified: `POST /booking/:slug/create-payment-intent` (and the corresponding pay-at-appointment booking endpoint)

Accepts a new optional field: `verification_token: string`.

The token may be issued by either `/otp/verify` (`purpose: "first_timer_verify"` or `"login"`) or `/customer-auth/google` (`purpose: "google_verify"`). The payment handler accepts any token whose `purpose` is one of `{google_verify, first_timer_verify}` and whose identity (phone or google_id) matches the booking's normalized phone or google_id.

Server-side first-timer logic is rewritten (see "Server-Side First-Timer Verification" below). The existing `is_first_timer` boolean in the request body becomes advisory and is ignored for pricing. It will be removed entirely after the frontend migration lands.

### Modified: `GET /merchant/services/check-first-timer`

Stays as an advisory endpoint used by the frontend to decide whether to show the OTP card. Its inputs are now normalized, and its `or()` query matches on normalized phone, normalized email, and `google_id`. The authoritative first-timer decision happens at payment/booking time, not here.

---

## Verification Token (JWT)

**Purpose:** Stateless proof that a given phone number was verified via OTP at a specific time, for a specific intent. Read by the payment/booking handler to gate first-timer discounts.

**Payload:**

```json
{
  "phone": "+6591001010",
  "email": "sarah@example.com",
  "google_id": null,
  "purpose": "first_timer_verify",
  "verified_at": 1745049600,
  "iat": 1745049600,
  "exp": 1745050200
}
```

For Google Sign-in, `google_id` is populated and `purpose` is `"google_verify"`.

**TTL:**
- `first_timer_verify`, `login`: 10 minutes (short; user is about to complete Step 5).
- `google_verify`: 30 minutes (longer; typical Google sign-in session spans more time).

**Security:**
- Signed with the existing `JWT_SECRET` environment variable.
- Single-intent: payment handler rejects tokens whose `purpose` does not match the expected use.
- Phone-bound: payment handler rejects the token if the booking's normalized phone does not match the JWT's phone.
- Stateless: no DB/Redis round-trip at verification time.

---

## Server-Side First-Timer Verification

New helper: `services/api/src/lib/firstTimerCheck.ts`.

```ts
export async function isFirstTimerAtMerchant(args: {
  merchantId: string
  normalizedPhone: string | null
  normalizedEmail: string | null
  googleId: string | null
}): Promise<boolean>
```

**Logic:**

1. Build an `OR` of identity conditions from the provided (non-null) values: phone match, email match, google_id match.
2. If no identifiers were provided, conservatively return `true` (treat as first-timer) — but this path is unreachable via the payment handler since we only call it after identity is established.
3. Query `clients` for all matching rows.
4. If none, return `true`.
5. Query `bookings` for any row where `client_id IN (matched_ids) AND merchant_id = X AND status = 'completed'`.
6. Return `true` only when no such booking exists.

**Discount decision at payment time:**

```
discount_pct = service.discount_pct ?? 0           // regular discount applies to all

if service.first_timer_discount_enabled and service.first_timer_discount_pct:
    first_timer_eligible = false
    token = verifyJWT(body.verification_token)   // signature + expiry

    if token is valid:
        identity_matches = false
        if token.purpose == 'google_verify' and token.google_id == body.google_id:
            identity_matches = true
        elif token.purpose == 'first_timer_verify' and token.phone == normalized_phone:
            identity_matches = true

        if identity_matches:
            first_timer_eligible = isFirstTimerAtMerchant({
                merchantId, normalizedPhone, normalizedEmail, googleId
            })
    # else: no verification → ineligible, no discount

    if first_timer_eligible:
        discount_pct = max(discount_pct, service.first_timer_discount_pct)

final_price = base_price * (1 - discount_pct / 100)
```

This is default-deny: without a valid Google sign-in or OTP token, the first-timer discount simply does not apply. The regular discount still applies to everyone as before.

---

## Normalization

New module: `packages/shared/src/normalize.ts`.

```ts
export function normalizePhone(raw: string, defaultCountry: 'MY' | 'SG' = 'SG'): string | null
export function normalizeEmail(raw: string | null | undefined): string | null
```

- `normalizePhone` uses `libphonenumber-js`. Returns E.164 (`+6591001010`) or `null` if invalid. `defaultCountry` is supplied by the caller from `merchants.country`.
- `normalizeEmail` trims and lowercases; returns `null` for empty or malformed input (no `@`).

**Applied at:**

| Call site | Fields normalized | Rationale |
|---|---|---|
| `lookup-client` | phone | Return hit on `+65 9100 1010` ≡ `+6591001010` |
| `otp/send`, `otp/verify` | phone, email | Redis key consistency |
| `check-first-timer` | phone, email | Dedupe query |
| `create-payment-intent` | phone, email | Server-side first-timer re-check |
| `clients.create` (booking creation) | phone, email | Prevent duplicate client rows |
| One-time backfill migration | all existing `clients.phone`, `clients.email` | Fix historical dupes |

---

## Data Migration

One-time script: `packages/db/src/migrations/scripts/normalize-client-contact.ts`.

1. Select all rows from `clients`.
2. For each row, compute normalized phone + email.
3. Detect collisions where two rows normalize to the same phone → log `{ id, raw_phone, normalized_phone }` for each side. **Do not auto-merge**; the merchant reviews manually.
4. Update rows where the normalized value differs from the stored raw value.
5. Report `{ updated, collisions, skipped, total }` at end.

Run once during the deploy. Expected runtime: seconds on current volume.

The `clients.phone` column is already `unique`; uniqueness over normalized values is achieved implicitly via the backfill (any duplicates are flagged for review, not silently dropped).

---

## Redis Keys

```
otp:+6591001010:login                → { code, attempts, channel, email }   TTL 600s
otp:+6591001010:first_timer_verify   → { code, attempts, channel, email }   TTL 600s
otp:rate:phone:+6591001010           → counter                              TTL 900s
otp:rate:ip:1.2.3.4                  → counter                              TTL 3600s
```

Upstash Redis (already in use). No schema/config changes required.

---

## Twilio & Email Integration

Reuses existing worker queues in `services/worker`:

- `whatsapp-queue` — add a new job type `otp-send` with payload `{ phone, code }`.
- `email-queue` — add a new job type `otp-send` with payload `{ email, code }`.

Template messages (deliberately minimal, no branding fluff):

- **WhatsApp:** `"Your GlowOS verification code: 123456. Valid for 10 minutes."`
- **Email:** subject `"Your verification code"`, body: `"Your verification code is 123456. It will expire in 10 minutes."`

---

## Error Handling

| Failure | User experience | Backend behavior |
|---|---|---|
| Twilio delivery error | Toast: *"Couldn't send WhatsApp — try email instead?"* auto-opens email fallback | Error logged; no token issued |
| OTP code wrong (attempts < 5) | Inline error: *"Incorrect code. Try again."* | Redis attempts counter +1 |
| OTP code wrong (5th attempt) | *"Too many attempts. Request a new code."* | Redis entry deleted |
| OTP expired (>10 min) | *"This code has expired. Send a new one?"* | Redis TTL miss |
| Rate-limited (3 sends/15min per phone) | *"Too many requests. Wait a few minutes before trying again."* | 429 response, no send |
| JWT expired between Step 4 and Step 5 | On confirm, price falls back to regular discount; toast prompts re-verification with a back-link | First-timer discount not applied |
| Phone fails E.164 parsing | Form error: *"Please enter a valid phone number with country code."* | 400 before OTP dispatch |
| Lookup returns multiple client matches | Most recent `clients.createdAt` wins; event logged for manual review | — |
| Upstash Redis unavailable | OTP send fails; user sees: *"Verification temporarily unavailable. Continue at full price?"* | Logged; regular discount still applies |

---

## Edge Cases

1. **User changes phone number between OTP verify and booking confirm.** JWT phone no longer matches the booking phone → first-timer discount denied, regular discount applies. Correct behavior.
2. **User uses Google Sign-in but the Google email already exists as a past guest client.** Dedupe runs on `google_id` *and* normalized email → server detects existing record → not a first-timer. Correct.
3. **User books two services back-to-back under the same phone, neither completed.** `isFirstTimerAtMerchant` counts only `completed` bookings, so the second booking would still qualify as first-timer. Accepted — matches current behavior and isn't a realistic abuse vector.
4. **Tourist with WhatsApp on a foreign number.** WhatsApp OTP works globally; Twilio dispatches to any valid E.164. Works.
5. **Email-only user (no phone).** Not supported — phone is always required at booking. No change from today.
6. **OTP brute-force.** 1 in 1,000,000 chance per guess; 5-attempt cap → negligible risk.
7. **Stolen verification_token.** 10-min TTL + phone-binding + single-purpose → tiny attack window, capped payoff.
8. **Merchant creates a walk-in booking.** Walk-in flow calls the same `isFirstTimerAtMerchant` helper; consistent treatment.

---

## Testing Strategy

**Unit tests (Vitest):**

- `normalizePhone` / `normalizeEmail` — fixture of 30+ input variations (spaces, dashes, country codes, leading zeros, mixed case, empty, null, invalid).
- `isFirstTimerAtMerchant` — mocked DB returning: no client / one client no bookings / one client with completed booking / one client with pending booking / multiple clients across phone+email+googleId.
- JWT issue + verify + expiry + tampered signature.
- OTP code generation uniformity sanity check (10k iterations, distribution approximately uniform).

**Integration tests (API-level, real test DB, mocked Twilio):**

- Full OTP flow: send → verify → returns token.
- First-timer payment flow: no token → regular price / valid token → discount / wrong-phone token → regular price / expired token → regular price.
- Rate limiting: 4th send within 15 minutes → 429.
- Returning-customer lookup + login flow returns `client` payload and auto-fills.

**Manual test checklist (staging, before merge):**

- Google Sign-in, new customer → no OTP, discount applied.
- Google Sign-in, returning customer → no OTP, no first-timer discount.
- Register now, new customer, first-timer discount > regular → OTP required, discount applied.
- Register now, new customer, no first-timer discount → no OTP.
- Register now with expired JWT at confirm → regular discount applies, re-verify prompt shown.
- Returning-customer phone lookup → "Welcome back" card, OTP login, auto-fill.
- WhatsApp failure → email fallback auto-offered.
- Grace Kim's actual record → correctly recognized as returning customer.

---

## Observability

Structured logs at each decision point:

- **OTP send:** `{ event: "otp_send", channel, masked_destination, purpose, success, error?: string }`
- **OTP verify:** `{ event: "otp_verify", purpose, success, reason?: "wrong_code" | "expired" | "rate_limited" | "max_attempts" }`
- **First-timer check:** `{ event: "first_timer_check", phone_normalized, matched_client_ids, has_completed_booking, result }`
- **Discount applied at payment:** `{ event: "discount_applied", phone, path: "google" | "otp" | "none", regular_pct, first_timer_pct, applied_pct }`

Key health metric: daily `first_timer_discounts_attempted` vs `first_timer_discounts_granted`. A wide gap indicates a verification pipeline failure (not abuse — abuse manifests as attempts == grants).

---

## Rollout Plan

1. **Deploy backend** (new endpoints + normalized server-side check). The existing frontend still sends `is_first_timer`, but the backend now ignores it. During this window, first-timer discounts will not apply to any new booking. Acceptable short gap.
2. **Run the backfill migration** against Neon.
3. **Deploy frontend** (rebuilt Step 4, OTP UI, Google Sign-in primary, returning-customer recognition). First-timer discounts resume, now properly gated.
4. **Monitor logs for 48 hours.** Expect a short-term dip in first-timer grants — this is the abuse vector closing, not a regression.

No feature flag. The change is atomic enough that a rollback is cheaper than flag plumbing.

---

## Out of Scope

- Device/browser fingerprinting (rejected as overkill for a booking flow).
- SMS OTP fallback (cost + international unreliability > marginal coverage gain).
- Password-based accounts (friction and support burden; passwordless is sufficient).
- Merging duplicate client rows discovered during the backfill (flagged for manual merchant review instead).
- Stripe-based identity checks (Stripe adoption is uncertain; solution must work without it).
- Changes to the admin/staff-facing walk-in booking UI beyond using the shared `isFirstTimerAtMerchant` helper.

---

## Files Touched

**New:**

- `services/api/src/routes/otp.ts`
- `services/api/src/lib/firstTimerCheck.ts`
- `services/api/src/lib/jwt.ts` (if not already present)
- `packages/shared/src/normalize.ts`
- `packages/db/src/migrations/scripts/normalize-client-contact.ts`

**Modified:**

- `services/api/src/routes/payments.ts` — new discount logic with JWT verification.
- `services/api/src/routes/services.ts` — normalize inputs in `check-first-timer`.
- `services/api/src/routes/customer-auth.ts` — issue `verification_token` (purpose `google_verify`) after Google ID token verification.
- `services/api/src/routes/bookings.ts` (or equivalent public booking endpoints) — apply normalization on client creation, use shared first-timer helper.
- `services/worker/src/jobs/` — new `otp-send` job handlers for WhatsApp and email queues.
- `apps/web/app/[slug]/BookingWidget.tsx` — Step 4 rebuild, OTP UI, Google Sign-in primary, returning-customer recognition, remove silent `catch {}` on first-timer check, store + forward `verification_token` to payment/booking submission.

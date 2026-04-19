# GlowOS MVP — Progress Tracker
**Last updated: 20 April 2026 (Session 13)**

---

## What's Completed (Session 13 — 20 April 2026)

### Walk-in group bookings, packages, and editable bookings ✅
Replaced the single-service walk-in modal with a shared `BookingForm` that supports multiple services per visit with a single payment, in-modal package sell + redeem, and general-purpose edit for any booking status except `cancelled` — including `completed`, so staff can fix data-entry mistakes after the fact. Every field-level change writes to a `booking_edits` audit log.

- **Data model (additive):** new `booking_groups` table (parent that owns the payment + total for a walk-in), new `booking_edits` audit-log table, nullable `bookings.group_id` column. Reused the existing `package_sessions.booking_id` + `status` lifecycle for redemptions instead of introducing a separate junction table. Migration `0010_brave_bloodstorm.sql`.
- **API (merchant-scoped, Hono + Zod):**
  - `POST /merchant/bookings/group` — create a walk-in group with N services, optional `use_package` per row, optional `sell_package` for upsell. Services without `start_time` pack back-to-back. Transactional.
  - `GET /merchant/bookings/:id/edit-context` — single call returns booking + group + siblings + client's active packages + services + staff + last edit.
  - `PATCH /merchant/bookings/group/:groupId` — full group edit: diffs submitted services against current child bookings, inserts/updates/deletes, recomputes total, audits every field change, credits/debits package sessions on redemption toggle.
  - `PATCH /merchant/bookings/:id` — general single-booking edit for pre-existing and online bookings. Same audit + conflict-check behaviour, narrower surface.
  - `GET /merchant/bookings/:id/edits` — audit trail, returns both booking-level and group-level edits.
  - `GET /merchant/clients/lookup?phone=X` — used by the create modal to autofill name and surface active-package info after phone blur.
- **Frontend:** new `app/dashboard/bookings/{BookingForm,ServiceRow,EditHistoryPanel,types}` component tree. Dashboard's old inline `WalkInModal` deleted; `page.tsx` now uses `BookingForm` for create and adds a per-card **Edit** button. Calendar page double-click on a slot opens the same form in edit mode. A completed-booking banner warns staff that edits won't re-send review requests or recalculate commissions. A "View history" panel inside the modal expands the audit trail on demand.
- **Key rules locked in:** commission is frozen at the moment a booking is completed (edits never touch `commission_rate`/`commission_sgd`); review-request and no-show re-engagement jobs do NOT re-fire on edits to completed bookings; cancelled bookings cannot be edited (409); staff ownership is validated on every PATCH, including the new group endpoint; all edits run inside a DB transaction and audit rows roll back with the edit on failure.
- **Verified live:** POST group (1 service, 2 services back-to-back), GET edit-context, PATCH single, GET edits, plus a full browser walk-through of create, edit-confirmed, edit-completed, remove-a-sibling-from-group, calendar double-click, and view-history.
- **Known minor items (not blocking):** (1) POST group doesn't do a staff-conflict check (by design in the plan — only PATCH does); (2) `durationMinutes` appears as an asymmetric field in one audit-diff snapshot (cosmetic audit-log noise); (3) Neon's `drizzle.__drizzle_migrations` tracking table is empty — migration 0010 was applied via a direct `pg` script and future `drizzle-kit migrate` runs will need a backfill before they work.

Design doc: [docs/superpowers/specs/2026-04-20-walkin-group-booking-and-edit-design.md](docs/superpowers/specs/2026-04-20-walkin-group-booking-and-edit-design.md)
Implementation plan: [docs/superpowers/plans/2026-04-20-walkin-group-booking-and-edit.md](docs/superpowers/plans/2026-04-20-walkin-group-booking-and-edit.md)
Merge commit: `b2530e6` on `main` (30 feature commits + 7 post-review fixes).

### Next up (Session 14 — 21 April 2026)
- Backfill `drizzle.__drizzle_migrations` on Neon so `pnpm db:migrate` becomes usable again (it currently errors because tracking is empty but migrations 0000–0010 are all applied).
- Decide whether POST group should gain a staff-conflict check (symmetric with PATCH).
- Optional: fix the `durationMinutes` audit-log asymmetry.

---

## What's Completed (Session 12 — 20 April 2026)

### Embed booking widget ✅
Merchants can now drop an `<iframe>` snippet into their own websites (Wix / Squarespace / WordPress / Shopify) to host the booking widget inline — closing the biggest distribution gap from the Session 10 roadmap.

- New public route `/embed/[slug]` — reuses the existing `BookingWidget` component with an `embedded` prop that tightens layout and overrides `booking_source` to `embedded_widget`. No merchant header, transparent background, plain "Powered by GlowOS" footer.
- Next.js middleware allows iframe embedding on `/embed/*` only (`Content-Security-Policy: frame-ancestors *`). Admin and direct-booking routes retain default framing protection.
- `public/robots.txt` disallows crawling of `/embed/*` so embedded views don't compete with `/{slug}` in search results. Page also emits `<meta name="robots" content="noindex, nofollow">` as belt-and-braces.
- Missing-slug handling renders a small inline "Booking is temporarily unavailable." instead of the full 404 page (so a mistyped slug doesn't break the merchant's surrounding page layout).
- `embedded_widget` added to the `booking_source` enum in both `createPaymentIntentSchema` and `confirmSchema`. `/booking/:slug/confirm` now accepts the field and defaults to `direct_widget` when omitted — fully backwards compatible.
- Admin Settings → Booking Page tab gets an "Embed on your website" section with the iframe snippet (slug pre-filled), a Copy button with 2-second "Copied!" confirmation, a Preview in new tab link, and a short tip about site-builder compatibility.

Design doc: [docs/superpowers/specs/2026-04-19-embed-booking-widget-design.md](docs/superpowers/specs/2026-04-19-embed-booking-widget-design.md)
Implementation plan: [docs/superpowers/plans/2026-04-19-embed-booking-widget.md](docs/superpowers/plans/2026-04-19-embed-booking-widget.md)

### Commits (Session 12 so far)
| Hash | Description |
|---|---|
| `1d160ec` | feat(api): add embedded_widget to payment intent booking_source enum |
| `40df590` | feat(api): accept booking_source in /confirm; default direct_widget |
| `893ebdf` | feat(web): allow framing on /embed/* and disallow crawling |
| `479396f` | feat(web): /embed/[slug] route — minimal iframe-friendly booking view |
| `94b1983` | feat(web): BookingWidget embedded prop + booking_source wiring |
| `0f9610e` | feat(web): 'Embed on your website' section in Booking Page tab |
| `abcb8d4` | Merge feature/embed-widget |

### Production verification
- `/embed/abc` returns 200 with `content-security-policy: frame-ancestors *` header
- `/abc` direct route unchanged (no CSP override — middleware scoped correctly)
- Third-party iframe test (http://localhost served file) successfully loads the widget, booking completes
- DB: embed booking correctly tagged `booking_source = 'embedded_widget'`; regression booking via `/abc` correctly tagged `direct_widget`
- `public/robots.txt` serves static file (no longer shadowed by dynamic `[slug]` route)
- Noindex meta tag emitted on embed page HTML

### merchants.country + hardcode removal ✅
- New `merchants.country varchar(2) not null default 'SG'` column (migration `0009 → 0008`, see files). Existing merchants auto-fill as SG.
- Replaced all 8 hardcoded `defaultCountry: "SG"` fallbacks across `services.ts`, `otp.ts` (×3 handlers), `payments.ts`, `bookings.ts` (×2), and `webhooks.ts`. Each hardcode now reads `merchant.country` from a SELECT that was updated to include the new column.
- Admin onboarding of MY merchants now works correctly: local-format numbers like `012 345 6789` parse to `+60123456789` instead of failing. To onboard a MY merchant: `UPDATE merchants SET country='MY' WHERE id='<id>'`.
- Dedup gap from Session 11 review (I3) addressed: `findOrCreateClient` helper extracted to `services/api/src/lib/findOrCreateClient.ts`. Both `bookings.ts` and `webhooks.ts` now import from the shared module. The previously-drifted-once duplicate is gone.

### First-Timer Discount ROI Analytics ✅
Answers the business question "is my first-timer discount making me money?" Surfaces as one new section at the bottom of the merchant analytics page.

- New `bookings.first_timer_discount_applied boolean not null default false` column. Flag is set to `true` ONLY when the first-timer price actually wins the comparison (not just when eligibility passes but the regular discount is still cheaper).
- Flag threading: Stripe payment flow uses payment-intent metadata as the transport channel (discount decision happens sync in `payments.ts`, booking insert happens async in `webhooks.ts` on `payment_intent.succeeded`). Pay-at-appointment flow (`/:slug/confirm`) tags directly at insert.
- New endpoint `GET /merchant/analytics/first-timer-roi?period=7d|30d|90d|365d|all` returns: `first_timers_count`, `discount_given_sgd`, `mature_first_timers_count`, `returned_count`, `return_rate_pct`, `return_revenue_sgd`, `net_roi_sgd`.
- Return rate uses a **mature cohort** (≥30 days since first booking) to avoid artificially depressing the conversion metric with recent first-timers who haven't had time to return. Returns `null` (rendered as `—`) when the mature cohort is empty.
- New dashboard section: "First-Timer Discount Performance" — prominent Net ROI hero (green if ≥0, orange if negative) + 4 stat cards (First-timers, Discount given, Return rate, Revenue from returns). Loading/empty/edge states all handled.
- Caveat (documented in spec): `service.price_sgd` is read live, so merchants editing a service's base price later will shift historical `discount_given_sgd`. Accepted for v1; price-snapshot-at-booking-time is a future follow-up.

Design doc: [docs/superpowers/specs/2026-04-20-first-timer-roi-analytics-design.md](docs/superpowers/specs/2026-04-20-first-timer-roi-analytics-design.md)
Implementation plan: [docs/superpowers/plans/2026-04-20-first-timer-roi-analytics.md](docs/superpowers/plans/2026-04-20-first-timer-roi-analytics.md)

### Commits (Session 12, E/F/G)
| Hash | Description |
|---|---|
| `9d1b94d` | feat(db): add merchants.country column (SG default) |
| `981fcbf` | refactor(api): use merchants.country instead of hardcoded SG fallback |
| `ae7d6cb` | refactor(api): extract findOrCreateClient to shared lib/ helper |
| `e96dc4b` | Merge feature/country-dedup |
| `7af3a9c` | feat(db): add bookings.first_timer_discount_applied column to schema |
| `c46a621` | feat(db): migration for bookings.first_timer_discount_applied column |
| `d5cfffd` | feat(api): tag Stripe bookings with first_timer_discount_applied (via PI metadata) |
| `23ae6ba` | feat(api): tag /:slug/confirm bookings with first_timer_discount_applied flag |
| `da14a37` | feat(api): /first-timer-roi analytics endpoint |
| `45faa80` | feat(web): First-Timer Discount Performance section in analytics |
| `518c0ca` | Merge feature/first-timer-roi |

### Production verification (E+F+G)
- `merchants.country` migration applied (column: boolean, default SG, all 5+ existing merchants populated)
- `bookings.first_timer_discount_applied` migration applied (column: boolean, default false)
- `check-first-timer` with reformatted phone + SG merchant still returns `isFirstTimer: false` for Grace (regression passes)
- `/merchant/analytics/first-timer-roi` returns 401 (registered + auth-protected); 404 baseline from non-existent endpoints confirms the deploy picked up the new route
- Existing `/abc`, `/embed/abc`, and 11 other analytics endpoints unchanged

### Still outstanding (Session 13+)
- Client CSV export (H) — admin-side "download all clients" button
- Online package purchase
- SMS fallback for failed WhatsApp OTP delivery
- Price-at-booking-time snapshot (improves analytics accuracy across service price changes)
- MY-merchant admin UI for flipping `merchants.country` without SQL

---

## Deployment URLs

| Service | URL | Provider |
|---|---|---|
| Website (frontend) | https://glowos-nine.vercel.app | Vercel |
| API Server | https://bookingcrm-production.up.railway.app | Railway |
| Database | Neon PostgreSQL (21 tables, US East) | Neon |
| Cache / Queue | Upstash Redis | Upstash |
| Source Code | https://github.com/ipwffrank/bookingcrm | GitHub |

### Accounts
- **Vercel:** ipwffrank (team: glowos)
- **Railway:** ipwffrank@gmail.com (project: alert-truth)
- **Neon:** ep-quiet-hall-ambckxnr-pooler
- **Upstash:** ultimate-chimp-84494
- **Twilio:** ipwffrank@gmail.com — ✅ fully configured (sandbox joined, credentials in local .env + Railway, sandbox keyword: east-written)
- **Stripe:** ✅ Test mode configured (sk_test_..., webhook endpoint registered on platform account)
- **GitHub:** ipwffrank/bookingcrm

---

## What's Completed (Session 11 — 19 April 2026)

### First-Timer Discount Verification ✅
Closed an abuse vector where returning customers could claim the "first-visit" discount by reformatting their phone or changing email. Discount is now default-deny: requires proof of identity via Google Sign-in or phone OTP, plus a server-side DB check.

**New backend endpoints (all mounted under `/booking/:slug/`):**
- `POST /lookup-client` — phone-first debounced recognition, merchant-scoped, returns masked name ("Gr***")
- `POST /otp/send` — issues a 6-digit code via WhatsApp (primary) or email (fallback); 3-send/15-min/phone + 10-send/hour/IP rate limits
- `POST /otp/verify` — validates code, issues signed JWT (`verification_token`) with 10-min TTL; max 5 attempts per code

**Identity proof / JWT system:**
- Three purposes: `login`, `first_timer_verify` (OTP), `google_verify` (from `/customer-auth/google`, 30-min TTL)
- Payment-intent and `/booking/:slug/confirm` handlers now require a valid token matching the booking's normalized phone (or google_id) before granting the first-timer discount
- Explicit purpose whitelist — only `google_verify` + googleId match or `first_timer_verify` + phone match grants eligibility; any other purpose logged and rejected
- Regular `discountPct` continues to apply to everyone with no verification required

**Normalization:**
- New `normalizePhone` (E.164 via libphonenumber-js) + `normalizeEmail` (trim + lowercase) helpers in `services/api/src/lib/normalize.ts`
- Applied at: `findOrCreateClient` (bookings.ts + webhooks.ts), `check-first-timer`, `create-payment-intent`, `/booking/:slug/confirm`, `lookup-client`, `otp/send`, `otp/verify`
- One-time backfill script at `services/api/scripts/normalize-client-contact.ts` — ran against production, 19 clients total / 8 normalized / 0 collisions

**Frontend rebuild (Step 4 of booking widget):**
- Phone-first input with 500ms debounced lookup → "Welcome back, Gr***" card when a returning client is found
- Login OTP flow: passwordless return-visit log-in with auto-fill, jumps to Step 5 on success
- Google Sign-in promoted to primary CTA; "Register now" (renamed from "Continue as guest") as secondary
- First-timer OTP card appears conditionally — only when `firstTimerDiscountPct > discountPct` (no friction for users who wouldn't benefit)
- `verification_token` stored in widget state and forwarded to both `/create-payment-intent` and `/confirm`; cleared automatically when the user edits their phone after verifying (prevents silent server-side rejection at checkout)
- Silent `catch {}` on the advisory first-timer check removed — errors now log and default `isFirstTimer` to `false`

**New components:** `OTPVerificationCard.tsx` (reusable for login + first-timer paths, email-fallback link), `ReturningCustomerCard.tsx` (masked-name recognition card)

**Server-side first-timer helper:** `services/api/src/lib/firstTimerCheck.ts` — single source of truth, used by `check-first-timer`, payment intent, and `/confirm`

**Rollout hardening (post-review fixes):**
- `lookup-client` scoped to merchant via `clientProfiles` join — prevents cross-tenant name leaks
- `check-first-timer` returns 404 when merchant not found (was silently returning `isFirstTimer: true`)
- Rate-limit counter increments moved AFTER channel validation so malformed requests don't burn legitimate users' quotas
- Redis cold-start resilience: all direct `redis.incr`/`.set`/`.get`/`.del` calls in OTP endpoints wrapped in try/catch matching the existing `getCache`/`setCache` defensive pattern — rate-limit failures skip gracefully, OTP storage/read failures return 503 with a user-visible "temporarily unavailable" message instead of a generic 500
- Removed dead `is_first_timer: boolean` flag from payment-intent schema + widget POST body (replaced by `verification_token`)

**Verification:**
- Backfill: ran cleanly against production — 19 total / 8 updated / 0 collisions
- End-to-end smoke test: 16/16 PASS on production including normalization, tenant scoping, default-deny, rate limits, error codes, cold-start resilience
- Manual QA of Step 4 UI: Google path, Register-now path with and without first-timer discount, returning-customer recognition, phone-edit token invalidation

**Known gaps (deferred follow-ups, non-blocking):**
- `merchants.country` column doesn't exist in schema; all handlers default to `"SG"` for libphonenumber-js — MY merchants with local-format numbers (no `+60` prefix) would fail to normalize. Add column + migration when MY merchants are onboarded.
- `findOrCreateClient` still duplicated between `bookings.ts` and `webhooks.ts` — extract to shared helper
- `check-first-timer` mounted at `/merchant/services/...` despite being public — move to `/booking/:slug/...` for consistency
- Observability: `discount_applied` log could include `merchant_id`, `service_id`, and identity-match outcome for better "pipeline failure" diagnostics

### Commits (Session 11)
| Hash | Description |
|---|---|
| `ee34898` | chore: add libphonenumber-js for phone normalization |
| `b9e034c` | feat(api): normalizePhone/normalizeEmail helpers |
| `2274241` | feat(api): verification token JWT helpers |
| `83b4995` | feat(api): isFirstTimerAtMerchant authoritative helper |
| `407f67a` | feat(api): normalize phone/email in findOrCreateClient |
| `f3221c1` | fix(api): normalize phone/email in webhook meta.client_id update branch |
| `c114f6d` | feat(worker): otp_send job handler (whatsapp + email) |
| `239f60b` | feat(api): otp/send endpoint with WhatsApp/email dispatch |
| `bf562af` | feat(api): otp/verify endpoint issues verification JWT |
| `90f6f42` | feat(api): mount otpRouter under /booking |
| `af99a0c` | feat(api): lookup-client endpoint for returning-customer recognition |
| `48157ef` | feat(api): customer-auth/google issues verification_token (google_verify) |
| `cb7aac4` | fix(api): check-first-timer normalizes phone/email before dedupe |
| `f4a0bcb` | feat(api): payment intent default-denies first-timer without verification |
| `138b554` | feat(api): /booking/:slug/confirm default-denies first-timer without verification |
| `12d09ce` | chore(db): backfill script to normalize clients.phone/email |
| `1e02777` | fix(web): first-timer check failure logs + defaults to false |
| `80cc077` | feat(web): OTPVerificationCard component |
| `5762673` | feat(web): ReturningCustomerCard component |
| `50f1fa0` | feat(web): returning-customer recognition + login OTP in Step 4 |
| `62ba578` | feat(web): Register-now flow with conditional first-timer OTP |
| `6215365` | feat(web): Google Sign-in primary CTA + store verification_token |
| `363ebfe` | fix(api): explicit purpose whitelist for first-timer discount eligibility |
| `6a74d1c` | fix(api): scope lookup-client to merchant to prevent cross-tenant name leak |
| `846de4c` | fix(web): clear verificationToken when phone changes |
| `5429dcc` | refactor: remove dead is_first_timer field (replaced by verification_token) |
| `ca9b024` | fix(api): validate OTP channel requirements before burning rate-limit quota |
| `070639f` | fix(api): check-first-timer returns 404 when merchant not found |
| `7cc9372` | Merge feature/first-timer-verification |
| `2296a8b` | chore: smoke-test script for first-timer verification endpoints |
| `24bcb91` | fix(api): handle Redis unavailability gracefully in OTP endpoints |

### Design + Plan docs
- Spec: [docs/superpowers/specs/2026-04-19-first-timer-verification-design.md](docs/superpowers/specs/2026-04-19-first-timer-verification-design.md)
- Implementation plan: [docs/superpowers/plans/2026-04-19-first-timer-verification.md](docs/superpowers/plans/2026-04-19-first-timer-verification.md)

---

## What's Completed (Session 10 — 18-19 April 2026)

### Client Reviews Feature ✅
- Public review submission page at `/review/[bookingId]` — star rating + optional comment + staff attribution
- Review API: public GET/POST for submission, merchant GET list/stats with filters
- Low-rating alert: WhatsApp to merchant for reviews ≤3 stars (via BullMQ worker)
- Reviews dashboard tab with 4 stat cards, filters (rating/staff/period), review list with red highlights for bad reviews
- Client profile integration — real review history replacing placeholder
- Analytics: rating distribution horizontal bar chart + average rating over time line chart
- Review request timing changed from 30 minutes to 24 hours post-completion

### Service Discounts ✅
- Per-service discount percentage (0-100%) with admin toggle for online visibility
- First-timer discount: separate percentage for new customers, auto-detected by phone/email/Google ID
- Booking widget shows strikethrough prices + discount badges + first-timer badges
- First-timer check API: searches clients table by phone/email/google_id against completed bookings
- Stripe payment uses discounted price; first-timer discount overrides regular if higher

### Service Packages & Multi-Session Tracking ✅
- 3 new tables: `service_packages` (templates), `client_packages` (purchased), `package_sessions` (individual sessions)
- Admin Packages page: create package templates with multi-service picker, pricing, validity period
- Assign packages to clients with payment tracking and auto-generated session rows
- Session progress tracking: pending → booked → completed, with "Mark Done" button on admin + staff + drawer
- Package progress bar + session list visible on all client views (admin profile, admin popup, staff profile)
- Auto-complete: when all sessions done, package status changes to "completed"
- Booking widget: shows available packages for purchase, detects active packages for returning clients, "Use Package Session" option (free booking) vs "Pay Normally"
- Public API: `GET /booking/:slug/packages` + `GET /booking/:slug/client-packages` + `POST /booking/:slug/use-package-session`

### Treatment Log (replaces simple notes) ✅
- New `client_notes` table with staff attribution + timestamps
- API: GET/POST/DELETE for timestamped log entries
- Chronological timeline UI with author name, date/time, content
- Available on admin profile, admin popup, staff profile — all views can add entries
- Legacy notes preserved as amber block when treatment log is empty

### Operating Hours ✅
- New `operating_hours` jsonb column on merchants table (migration 0006)
- Operating Hours tab in Settings: 7-day grid with open/close toggles + time pickers
- Availability engine blocks closed days before checking staff hours
- Booking widget greys out closed day-of-week dates

### Calendar Improvements ✅
- Admin calendar: Month / Week / Day toggle (hybrid — FullCalendar for month/week, custom grid for day)
- Month/week views load full date range of bookings, duties, and closures
- Staff calendar: holiday closures shown as red background events, blocks duty creation on closed dates
- Staff calendar font/style alignment with admin (Manrope, consistent sizing)

### Walk-in Client Lookup ✅
- Autocomplete search by name, phone, or email when registering walk-ins
- Selects existing client to auto-fill fields; new clients created on registration

### Staff Access to Client Profiles ✅
- Clients nav item added to staff portal sidebar
- Staff clients list page with search
- Staff client profile now matches admin: VIP tier, churn risk, service history, reviews, treatment log, packages

### Bug Fixes & Polish ✅
- Logo URL + cover photo URL now save via merchant settings (Zod schema fix)
- VIP tier counts use total count query, not page-limited count
- Timezone-aware slot generation — staff hours interpreted in merchant timezone (was UTC)
- Root layout `<link>` tag precedence fix (React 19 warning)
- Staff list response shape fix in reviews dashboard
- Client notes: persistent amber display box + prominent in booking detail panel

### Landing Page Refresh ✅
- Copy broadened from "clinics" to all self-care verticals (hair, facial, fitness, dental, spa, etc.)
- Mobile responsiveness: reduced padding, responsive pricing text, touch targets, scroll-padding
- Nav: shorter CTA on mobile, icon touch targets
- Hero: responsive padding, video height, CTA sizing

### Next Available Date ✅
- API: `GET /booking/:slug/next-available` — searches up to 30 days forward for first date with slots
- Booking widget: when selected staff has no availability, shows "Next available with [staff]" card with date, slot count, and "Jump to" button

### Commits (Session 10)
| Hash | Description |
|---|---|
| `87236e6` | feat: review API — public submission + merchant list/stats endpoints |
| `ecc74c2` | fix: guard review API against race conditions and malformed input |
| `eb61c87` | feat: low-rating alert — WhatsApp notification to merchant for reviews ≤3 stars |
| `a9d89ec` | feat: review submission page — star rating + comment for clients |
| `f44e56b` | feat: merchant reviews dashboard — stats, filters, review list |
| `344c4b0` | feat: client profile shows real review history |
| `e313f45` | feat: analytics — rating distribution + rating trend charts |
| `ad52ec1` | fix: staff list response shape, root layout link tag precedence |
| `7fcd223` | fix: allow logoUrl and coverPhotoUrl to be saved via merchant settings |
| `fc55c16` | feat: walk-in client lookup |
| `d7b5209` | feat: staff calendar shows holiday closures |
| `e6fb654` | feat: admin calendar month/week views |
| `4cb93c7` | fix: client notes prominent in booking detail panel |
| `a780b29` | fix: admin calendar month/week views load full date range |
| `6a30016` | fix: client notes save correctly |
| `fb9d3e1` | fix: client notes persistent display box |
| `776a0d8` | feat: next-available API endpoint |
| `3b853b3` | feat: booking widget shows next available date |
| `07b9af0` | refactor: landing page copy + mobile responsiveness |
| `1b3a704` | feat: merchant operating hours |
| `0a6ceb2` | fix: timezone-aware slot generation |
| `8e430aa` | fix: VIP tier counts use total count query |
| `32de481` | fix: review request sent 24 hours after treatment |
| `c821d29` | feat: client_notes table + treatment log API |
| `0baba09` | feat: treatment log replaces simple notes in client profile |
| `29ed969` | feat: staff portal clients section with treatment log |
| Various | feat: service discounts, packages, package booking flow, mark done |

### Database Changes (Session 10)
- Added `operating_hours` (jsonb) to `merchants` table — migration 0006
- Added `client_notes` table — migration 0007
- Added `service_packages`, `client_packages`, `package_sessions` tables — migration 0008
- Added `discount_pct`, `discount_show_online`, `first_timer_discount_pct`, `first_timer_discount_enabled` to `services` table

---

## What's Completed (Session 9 — 17 April 2026)

### Stripe Payment Fixes

#### Confirm page shows "Pay at appointment" even after paying online ✅
- **Root cause:** BookingWidget hardcoded `booking_id=payment` and never passed `paid=true` to the confirm page.
- **Fix:** `onSuccess` now passes the Stripe `paymentIntentId` as `ref=` param. Confirm page shows "Payment received" (green) for online payments, "Pay at your appointment" (indigo) for cash.

#### GrabPay redirect loses booking state ✅
- **Root cause:** `return_url` was `window.location.href` (the booking page). After GrabPay redirect, the booking wizard resets to step 1 — customer never sees confirmation.
- **Fix:** `return_url` now points to the confirm page with all booking details baked in. Confirm page also reads Stripe's `redirect_status` and `payment_intent` params.

#### PayNow "processing" status silently dropped ✅
- **Root cause:** After QR scan, PaymentIntent may return `processing` (not `succeeded`). Code only handled `succeeded`, resetting the spinner with no feedback.
- **Fix:** `processing` status now also triggers `onSuccess` redirect to confirm page.

#### PayNow/GrabPay confirm page missing booking details ✅
- **Root cause:** Redirect-based payment methods can lose custom URL query params.
- **Fix:** Booking details stored in `sessionStorage` before payment. Confirm page (converted to client component) reads sessionStorage as fallback. Consistent display across card, PayNow, GrabPay, and cash.

#### PayNow/GrabPay show no payment description ✅
- **Root cause:** PaymentIntent had no `description`. PayNow QR code and GrabPay redirect showed blank context.
- **Fix:** Added `description` ("Service at Merchant") and `statement_descriptor_suffix` to PaymentIntent.

### Per-Client Card Isolation (Stripe Customer) ✅
- Each client now gets a Stripe Customer object. Saved cards are scoped per-customer, not shared.
- Google Sign-In users linked by `client_id`; guest checkouts create anonymous Stripe Customers.
- Added `stripe_customer_id` column to `clients` table (DB migration applied).
- Frontend passes `client_id`, `client_name`, `client_email`, `client_phone` to `create-payment-intent`.

### Cancellation & Refund Workflow ✅

#### Client cancel now triggers Stripe refund ✅
- **Root cause:** `POST /booking/cancel/:token` only set `status=cancelled` — never called `processRefund()`. Client's money was silently kept.
- **Fix:** Cancel endpoint now loads merchant cancellation policy, calculates refund type (full/partial/none based on hours until appointment), and calls `processRefund()` with the correct percentage.

#### Partial refund uses merchant's configured percentage ✅
- **Root cause:** `processRefund()` hardcoded 50% for partial refunds. Merchant could set 20% in settings, but the actual Stripe refund was always 50%.
- **Fix:** `processRefund()` now accepts `refundPercentage` parameter. Uses merchant's `late_cancellation_refund_pct` setting.

#### Cancel link token missing HMAC signature ✅
- **Root cause:** Notification worker generated tokens as plain `base64url({ bookingId })` without HMAC. But `verifyBookingToken()` expects `{ bookingId, sig }`. Every cancel link showed "Invalid cancellation link".
- **Fix:** Uses `generateBookingToken()` from jwt.ts which includes HMAC signature.

### Client Self-Service Reschedule ✅
- New `POST /booking/reschedule/:token` endpoint — moves booking to a new slot, keeps Stripe payment intact.
- Cancel page (`/cancel/[token]`) now shows two options: "Reschedule Instead (Keep Payment)" and "Cancel & Get Refund".
- Reschedule flow has full date/time picker with 5-minute slot lease, same as booking widget.
- WhatsApp notification sent after reschedule with updated date/time.
- Merchant also notified of the reschedule.

### Webhook & Notification Fixes

#### Stripe webhook not receiving events ✅
- **Root cause:** Webhook endpoint was registered for "Connected and v2 accounts" events. With destination charges, `payment_intent.succeeded` fires on the platform account. Webhook was filtering it out.
- **Fix:** Created new webhook endpoint listening to "Events on your account" with correct events (`payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `account.updated`).

#### WhatsApp/email not arriving after card payment ✅
- **Root cause:** Booking created by `payment_intent.succeeded` webhook. Webhook got client phone from Stripe billing_details (often empty for card/PayNow/GrabPay). Client got placeholder phone `pi_xxx`, WhatsApp failed silently.
- **Fix:** Client name/email/phone/id from booking form now included in PaymentIntent metadata. Webhook reads metadata first, falls back to billing_details.

#### Reschedule WhatsApp notification ✅
- Added `reschedule_confirmation` notification type to worker.
- Client receives WhatsApp with updated date/time. Merchant also notified.

### Copy & UX Fixes
- Cancel link wording: "Need to cancel?" → "Reschedule or cancel?"
- Refund timeline: "5–10 business days" → "3–5 business days" (matches Stripe and cancel page)

### Commits (Session 9)
| Hash | Description |
|---|---|
| `5f2485b` | fix: Stripe payment confirmation, GrabPay/PayNow support, per-client card isolation |
| `9d69225` | fix: wire cancellation refund to Stripe, add client self-service reschedule |
| `87674f1` | fix: pass client details in PaymentIntent metadata for webhook notifications |
| `a495a59` | fix: cancel link token missing HMAC signature |
| `0cc9a30` | fix: add payment description for PayNow/GrabPay visibility |
| `ddeec93` | chore: change cancel link wording to "Reschedule or cancel" |
| `f1399ab` | fix: align refund timeline to 3–5 business days |
| `8a4e488` | fix: consistent confirm page across payment types, add reschedule notification |

### Database Changes (Session 9)
- Added `stripe_customer_id` (varchar 255, unique) to `clients` table
- Migration: `0005_white_johnny_storm.sql`

---

## What's Completed (Session 8 — 16 April 2026)

### Bug Fixes & Polish

#### ProductShowcase tab pills invisible on light background ✅
- **Root cause:** Inactive tab pills used `text-white/30 border-white/10` — white-transparent colors that disappear against the cream/beige landing page background.
- **Fix:** Changed inactive pill styles to `text-gray-400 border-gray-300 hover:text-gray-600 hover:border-gray-400` in `apps/web/app/components/ProductShowcase.tsx`.

### Commits (Session 8)
| Hash | Description |
|---|---|
| `dc236f9` | fix: make ProductShowcase tab pills visible on light background |

---

## What's Completed (Session 7 — 16 April 2026)

### Bug Fixes & Polish

#### Duty block save "invalid, invalid" error ✅
- **Root cause:** PostgreSQL `time` columns return `"HH:MM:SS"` (with seconds) but Zod regex only accepted `"HH:MM"`. When editing an existing duty, the form sent the raw DB value → two regex failures → "Invalid, Invalid".
- **Fix:** Frontend strips seconds with `.slice(0, 5)` when populating edit forms (both admin calendar + staff bookings). API regex now accepts `HH:MM` or `HH:MM:SS`. New `toHHMM()` helper normalizes to `HH:MM` before DB writes. Custom error messages on all duty schema validators.

#### Admin calendar grid lines ✅
- Hour lines: `border-gray-200` → `border-gray-300`
- Half-hour sub-lines: `border-dashed border-gray-100` → `border-dashed border-gray-200`
- `:30` gutter labels: `text-gray-300` → `text-gray-400`

#### Walk-in page redesign ✅
- Complete redesign from dark theme to light theme matching dashboard
- White `rounded-xl border border-gray-200` cards, `font-manrope`
- Proper font colors, consistent button styles

#### Staff "All Bookings" empty calendar ✅
- Removed `normaliseBookings()` that expected nested structure; API returns flat rows

### New Features

#### Analytics — 4 new sections ✅
- **API:** 4 new endpoints in `services/api/src/routes/analytics.ts`:
  - `GET /merchant/analytics/cancellation-rate` — completed/cancelled/no-show rates
  - `GET /merchant/analytics/peak-hours` — hour × day-of-week booking counts (Singapore TZ)
  - `GET /merchant/analytics/client-retention` — new vs returning clients
  - `GET /merchant/analytics/revenue-by-dow` — 7-day revenue + booking count array
- **Frontend:** 4 new components in analytics page:
  - `CancellationRates` — horizontal progress bars
  - `ClientRetention` — segmented bar (indigo=new, violet=returning)
  - `RevByDow` — purple bar chart with hover tooltips
  - `PeakHoursHeatmap` — 13h × 7d grid (8am–8pm), GitHub-style heat legend

#### Staff portal — merged My Schedule into All Bookings ✅
- Removed separate "My Schedule" tab; duty block management now inside "All Bookings"
- Staff can see firm-wide bookings (colored by staff) alongside their own duty blocks (dark green)
- Drag/drop duties, click to add/edit, delete future blocks only
- FullCalendar with `interactionPlugin` for drag/resize
- Legend: "Dark blocks = your schedule · Coloured = firm bookings"

#### Staff duty self-management ✅
- Staff can delete their own **future** duty blocks (not past)
- Backend: DELETE endpoint checks `staffId` ownership + date >= today
- Frontend: Delete button only visible for future blocks; "Past blocks cannot be edited or deleted" hint

#### Responsive layout + collapsible sidebar ✅
- **Desktop sidebar collapse:** Toggle button at bottom of sidebar shrinks to icon-only mode (`w-14`). State persists in `localStorage`. Smooth CSS transition on width + content margin.
- **Staff portal mobile:** Added mobile top bar with hamburger menu + slide-out sidebar overlay (was desktop-only before).
- **Content pages:** Calendar shows amber hint on small screens; campaigns stat grid responsive; walk-in form stacks on xs; main content `min-w-0` prevents overflow.

#### Rich client profile snippet in calendar ✅
- **API:** `/merchant/clients/for-client/:clientId` now returns service history (last 10 bookings with service name, staff, date, price) alongside existing profile data.
- **Frontend:** Booking detail panel now shows:
  - Client name, phone, email
  - Visit count, revenue, last visit date (stat cards)
  - VIP tier badge + marketing opt-in status badge
  - Internal notes (amber box)
  - Past services list (scrollable, last 10 — service, staff, date, price)
  - Reviews placeholder ("coming soon")

### Commits (Session 7)
| Hash | Description |
|---|---|
| `7c5d3d9` | feat: booking reschedule, client profiles, clearer time grid |
| `1a47490` | feat: cross-day reschedule, staff delete duty, clearer grid lines |
| `25c5608` | redesign: walkins page to match dashboard light theme |
| `5c13417` | fix: staff All Bookings calendar was always empty |
| `71044e3` | feat: merge My Schedule into All Bookings for staff portal |
| `7611823` | feat: analytics metrics, admin calendar grid clarity |
| `a9daec4` | fix: add descriptive error messages to duty PATCH schema |
| `5aa3966` | feat: responsive layout + collapsible sidebar |
| `c0ce325` | fix: duty edit/save fails due to DB time format with seconds |
| `7d235b7` | feat: rich client profile snippet in calendar booking panel |

---

## Feature Completion Status

### Fully Built ✅
| Feature | Notes |
|---|---|
| Analytics/Reports | 11 sections: summary, revenue, staff perf, top services, booking sources, cancellation rate, peak hours heatmap, client retention, revenue by DOW, **rating distribution, rating trend** |
| Online booking page | 5-step wizard with slot leasing, staff selection, date/time picker, **discount display, first-timer detection, package redemption, next-available suggestion** |
| Appointment reminders | WhatsApp + email via BullMQ (24h reminder, **24h review request**, no-show re-engagement, rebook CTA) |
| Client reviews | **Full system**: public review page, star rating + comment, low-rating WhatsApp alert, reviews dashboard tab, analytics charts |
| Services management UI | Full CRUD with consult/treatment slot types, **discount %, first-timer discount, show-online toggle** |
| Service packages | **Package templates, client assignment, multi-session tracking, progress bars, Mark Done, online package redemption** |
| Staff management UI | Full CRUD with profiles, working hours, specialty tags |
| Settings page | **7 tabs**: profile, **operating hours**, cancellation policy, holidays & closures, payments (Stripe Connect), booking page (QR), account |
| Client CRM | VIP tiers, churn risk, search/filters, rich profile snippet, **treatment log (timestamped), package progress** |
| Treatment log | **Timestamped entries by staff, replaces simple notes, visible on admin + staff + popup** |
| Campaigns | Email/WhatsApp/SMS blasts with audience filtering |
| CSV import | Client import with preview + validation |
| Walk-in bookings | Light-theme form, service/staff/payment selection, **client search/autocomplete** |
| Calendar (admin) | Custom resource grid, drag/drop duties, density toggle, **month/week/day toggle** |
| Calendar (staff) | FullCalendar with duty management, **holiday closures displayed, font alignment** |
| Staff portal | All Bookings, My Bookings, **Clients section with full profile + treatment log + packages** |
| Operating hours | **Business open/closed days with time ranges, blocks availability + booking widget** |
| Responsive layout | Mobile-friendly nav, collapsible sidebar, **landing page responsive overhaul** |
| Landing page | **Copy broadened to all self-care verticals, mobile responsiveness fixes** |

### Remaining Gaps
| Feature | Priority | Notes |
|---|---|---|
| Client CSV export | **Medium** | Admin-side "download all clients" button — deferred from Session 12 |
| SMS fallback | **Medium** | Twilio infrastructure exists; add SMS when WhatsApp delivery fails |
| Package purchase via booking page | **Medium** | Currently packages are admin-assigned; allow customers to buy packages online |
| MY-merchant admin UI | **Low** | Flip `merchants.country` to MY via dashboard (currently SQL-only) |
| Price-at-booking-time snapshot | **Low** | Improves first-timer analytics accuracy when service prices change |
| Drizzle migration reconciliation | **Low** | Pre-Session-9 schema drift means `db:generate` still emits spurious deltas |
| Notification preferences | **Low** | Let merchant toggle which reminders fire + customize templates |
| Custom domain mapping | **Low** | Custom booking URLs instead of `/{slug}` |
| Push notifications | **Low** | Mobile/web push for real-time booking alerts |
| Campaign testing | **Low** | Verify end-to-end campaign delivery |

### Shipped this Session 12 (removed from gaps)
- ✅ Embed booking widget (A)
- ✅ merchants.country column + hardcode removal (E)
- ✅ findOrCreateClient dedup (F)
- ✅ First-timer discount ROI analytics (G)

---

## Resume Checklist (Next Session)

```
1. cd ~/Desktop/Projects/Bookingcrm
2. Read progress.md (focus on Session 12's E/F/G and "Remaining Gaps")
3. git log --oneline -5  →  should see 5a0ca8e as latest (or 5a0ca8e's successor if progress.md updated further)
4. Pick next feature from "Remaining Gaps" table above
5. Recommended order:
   a. Client CSV export (H — quick, user-requested, deferred from S12)
   b. Online package purchase (conversion — biggest revenue lever left)
   c. SMS fallback (reliability)
   d. MY-merchant admin UI (unblocks MY onboarding)
```

---

## What's Completed (Session 6 — 15 April 2026)

### Phase 1 — Clinical Credibility (ALL 14 Tasks COMPLETE ✅)

**Branch:** `feature/phase1-clinical-credibility` — pushed to GitHub, ready for PR/merge
**16 commits** from Task 5 through Task 14 (typecheck fix)

#### Task 5 ✅ — Staff profile cards in BookingWidget (commits `775f5d3`)
- `StaffMember` interface extended with `bio`, `specialtyTags`, `isAnyAvailable`
- Staff cards in booking widget show bio (line-clamp-2) + specialty tag pills
- Service description rendering confirmed present in service selection step
- `page.tsx` `SalonData.staff` type kept in sync

#### Task 6 ✅ — Consult slot type API (commits `fbe9d03`, `b27dafa`)
- `createServiceSchema` / `updateServiceSchema` extended with `slot_type`, `requires_consult_first`, `consult_service_id`
- POST/PUT service handlers save new fields
- `POST /merchant/services/consult-outcomes` + `GET /merchant/services/consult-outcomes/:bookingId` added
- Security fix: booking ownership checks + duplicate prevention on consult outcome endpoints

#### Task 7 ✅ — Consult slot type admin UI + widget gating (commits `404c205`, `bde27cf`)
- Services admin page: "Booking Type" select (standard/consult/treatment), conditional "Requires Consult First" checkbox + consult service picker (excludes self from picker)
- BookingWidget: amber "Book a consultation first" banner on treatment services with `requiresConsultFirst: true`
- Modal styles fixed to match light-mode design system

#### Task 8 ✅ — Walk-in registration + payment recording API (commits `3f76973`, `ba6ca3b`, `8276a90`)
- Created `walkins.ts`: `POST /register`, `POST /bookings/:id/record-payment`, `GET /today`
- Mounted at `/merchant/walkins` in index.ts
- Security: service + staff ownership checks; merchantId on UPDATE; payment idempotency guard; availability cache invalidation; leftJoin for staff

#### Task 9 ✅ — Walk-in panel UI (commit `33c3076`)
- Created `app/dashboard/walkins/page.tsx`: client info, service/staff selectors, cash/OTC/Stripe payment toggle, notes
- Walk-ins nav item added to sidebar

#### Task 10 ✅ — Post-service comms scheduler + worker (commit `80375de`)
- `schedulePostServiceSequence(bookingId)`: queues `post_service_receipt` (1s delay) + `post_service_rebook` (48h delay)
- `handlePostServiceReceipt`: WhatsApp receipt with service/amount/date
- `handlePostServiceRebook`: WhatsApp rebook CTA with booking URL
- Triggered in `PUT /merchant/bookings/:id/complete`

#### Task 11 ✅ — SendGrid email setup (commits `45a39f5`, `ced3d1f`)
- `@sendgrid/mail` installed; `config.ts` extended with `sendgridApiKey`, `fromEmail`, `fromName`
- `email.ts` created: `sendEmail()` + 3 HTML templates (booking confirmation, receipt, rebook CTA)
- Silent no-op when `SENDGRID_API_KEY` not set (safe for dev)
- Email added to: `handleBookingConfirmation`, `handlePostServiceReceipt`, `handlePostServiceRebook`
- All email sends logged to `notification_log` with `channel: "email"`

#### Task 12 ✅ — CSV import API (commits `c0bfba1`, `352cfa1`)
- `POST /merchant/clients/import`: accepts up to 500 records, find-or-create client+profile, returns `{ created, skipped, errors[] }`
- Counter logic fixed: tracks merchant-client profiles, not raw client rows

#### Task 13 ✅ — CSV import UI (commit `726df9b`)
- Created `app/dashboard/import/page.tsx`: file picker, `parseCSV()` client-side parser, preview table (50 rows), import button, results panel
- "Import Clients" nav item added to sidebar

#### Task 14 ✅ — Final integration check + deploy (commit `d1b5496`)
- Typecheck: 0 errors across all packages (`pnpm turbo typecheck` 6/6 tasks)
- API starts clean: server + 3 workers start successfully
- Fixed: `c.req.param()` non-null assertion in `services.ts` + `walkins.ts`
- Branch pushed to GitHub: `feature/phase1-clinical-credibility`

---

## What's Completed (Session 5 — 12 April 2026)

### Phase 1 — Clinical Credibility (Tasks 1–4 of 14 complete)

**Branch:** `feature/phase1-clinical-credibility`
**Worktree:** `.worktrees/phase1-clinical-credibility`
**Plan file:** `docs/superpowers/plans/2026-04-12-phase1-clinical-credibility.md`
**Spec file:** `docs/superpowers/specs/2026-04-12-glowos-clinic-platform-design.md`

#### Task 1 ✅ — Schema extensions (commit `cd73535`)
#### Task 2 ✅ — New schema tables + DB migration pushed
#### Task 3 ✅ — Staff profile API
#### Task 4 ✅ — Staff profile admin UI

---

## What's Completed (Session 4 — 11 April 2026)

### Booking Widget — Availability Endpoint Fixed
- OOM crash fixed (time format "HH:MM:SS" → infinite loop in slot generator)
- `slotLeases` crash fixed (table not created yet)
- BullMQ worker crash fixed (missing error handlers)
- Worker startup fixed (was gated behind NODE_ENV !== "production")
- WhatsApp notifications end-to-end confirmed working

---

## What's Completed (Session 3 — 11 April 2026)
- Industry-agnostic rebranding (9 business categories)
- Interactive UI (parallax, testimonials, micro-interactions)
- Critical bug fixes (route ordering, cancellation, JWT refresh, API URL)
- Client spending aggregation fixed
- Seed script (3 branches, 39 bookings, 8 clients)

## What's Completed (Session 2 — 11 April 2026)
- Landing page redesign (SevenRooms-inspired, 2 passes)
- Typography (Cormorant Garamond + Outfit)
- Film grain, animated dividers, scroll animations

## What's Completed (Session 1 — 10 April 2026)
- Full backend (15 tables, auth, booking engine, payments, notifications, analytics, campaigns)
- Full frontend (landing, signup, login, onboarding, dashboard, booking widget, cancellation)
- Infrastructure (Turborepo, Vercel, Railway, Neon, Upstash, Docker)

---

## Architecture Quick Reference

```
Bookingcrm/
├── glowos/
│   ├── apps/web/              → Next.js 15 (all frontend: marketing, dashboard, booking)
│   │   ├── app/page.tsx       → Landing page (SevenRooms-inspired)
│   │   ├── app/signup/        → Signup
│   │   ├── app/login/         → Login
│   │   ├── app/onboarding/    → 5-step onboarding wizard
│   │   ├── app/dashboard/     → Dashboard with sidebar (bookings, services, staff, clients, analytics, campaigns, settings)
│   │   ├── app/staff/         → Staff portal (All Bookings + My Bookings)
│   │   ├── app/[slug]/        → Public booking page (SSR + client widget)
│   │   └── app/cancel/        → Cancellation page
│   ├── packages/db/           → Drizzle ORM (15 tables)
│   ├── packages/types/        → Shared TypeScript types
│   ├── services/api/          → Hono API server + BullMQ workers
│   │   ├── src/routes/        → auth, merchant, services, staff, bookings, clients, payments, webhooks, analytics, campaigns, duties
│   │   ├── src/workers/       → notification, CRM, VIP scoring
│   │   └── src/lib/           → config, redis, stripe, twilio, queue, scheduler, availability, refunds, jwt, slug
│   └── docker-compose.yml     → Postgres 16 + Redis 7 (local dev)
├── Dockerfile                 → Railway deployment (tsx runtime)
└── progress.md                → This file
```

### Key Files to Know
- **API entry + route mounting:** `glowos/services/api/src/index.ts`
- **DB schema (all tables):** `glowos/packages/db/src/schema/`
- **Landing page:** `glowos/apps/web/app/page.tsx`
- **Dashboard layout + sidebar:** `glowos/apps/web/app/dashboard/layout.tsx`
- **Staff layout + sidebar:** `glowos/apps/web/app/staff/layout.tsx`
- **Booking widget:** `glowos/apps/web/app/[slug]/BookingWidget.tsx`
- **Admin calendar:** `glowos/apps/web/app/dashboard/calendar/page.tsx`
- **Staff calendar:** `glowos/apps/web/app/staff/bookings/page.tsx`
- **Analytics:** `glowos/apps/web/app/dashboard/analytics/page.tsx` + `glowos/services/api/src/routes/analytics.ts`
- **Environment (local):** `glowos/.env`
- **Environment (production):** Railway dashboard → bookingcrm service → Variables tab

### How to Deploy
- **Frontend (Vercel):** auto-deploys on git push to main
- **API (Railway):** auto-deploys on git push to main
- **Local dev:** `cd glowos/services/api && npx tsx src/index.ts`

---

## Known Technical Debt
- `slot_leases` table not yet created — availability falls back to booking-only conflict detection (no hold during checkout)
- Stripe Connect onboarded in settings but checkout flow doesn't collect payment yet
- Client reviews: placeholder exists, no infrastructure

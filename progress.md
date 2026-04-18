# GlowOS MVP — Progress Tracker
**Last updated: 17 April 2026 (Session 9)**

---

## Deployment URLs

| Service | URL | Provider |
|---|---|---|
| Website (frontend) | https://glowos-nine.vercel.app | Vercel |
| API Server | https://bookingcrm-production.up.railway.app | Railway |
| Database | Neon PostgreSQL (15 tables, US East) | Neon |
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
| Analytics/Reports | 9 sections: summary, revenue, staff perf, top services, booking sources, cancellation rate, peak hours heatmap, client retention, revenue by DOW |
| Online booking page | 5-step wizard at `/{slug}` with slot leasing, staff selection, date/time picker |
| Appointment reminders | WhatsApp + email via BullMQ (24h reminder, 30min review, no-show re-engagement, rebook CTA) |
| Services management UI | Full CRUD with consult/treatment slot types |
| Staff management UI | Full CRUD with profiles, working hours, specialty tags |
| Settings page | 5 tabs: profile, cancellation policy, payments (Stripe Connect), booking page (QR), account |
| Client CRM | VIP tiers, churn risk, search/filters, rich profile snippet |
| Campaigns | Email/WhatsApp/SMS blasts with audience filtering |
| CSV import | Client import with preview + validation |
| Walk-in bookings | Light-theme form, service/staff/payment selection |
| Calendar (admin) | Custom resource grid, drag/drop duties + booking reschedule, density toggle |
| Calendar (staff) | FullCalendar with duty management merged into All Bookings |
| Responsive layout | Mobile hamburger, collapsible desktop sidebar, responsive grids |

### Remaining Gaps
| Feature | Priority | Notes |
|---|---|---|
| Stripe payment in booking checkout | **High** | Connect is wired in settings but checkout doesn't collect payment |
| Holiday/closure management | **High** | No way to block out dates (CNY, Deepavali etc.) — slots still show |
| Client reviews | **Medium** | Placeholder in profile snippet; needs collection flow + display |
| Embed booking widget | **Medium** | Generate `<iframe>` or `<script>` snippet for merchant websites |
| SMS fallback | **Medium** | Twilio infrastructure exists; add SMS when WhatsApp delivery fails |
| Notification preferences | **Low** | Let merchant toggle which reminders fire + customize templates |
| Custom domain mapping | **Low** | Custom booking URLs instead of `/{slug}` |
| Push notifications | **Low** | Mobile/web push for real-time booking alerts |

---

## Resume Checklist (Next Session)

```
1. cd ~/Desktop/Projects/Bookingcrm/glowos
2. Read progress.md
3. git log --oneline -5  →  should see dc236f9 as latest
4. Pick next feature from "Remaining Gaps" table above
5. Recommended order:
   a. Stripe payment in booking checkout (highest user friction)
   b. Holiday/closure management (prevents incorrect availability)
   c. Client reviews infrastructure (post-service flow)
   d. Embed widget (distribution channel)
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

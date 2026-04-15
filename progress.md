# GlowOS MVP — Progress Tracker
**Last updated: 15 April 2026 (Session 6)**

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
- **Stripe:** NOT yet signed up
- **GitHub:** ipwffrank/bookingcrm

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

### Resume Checklist (Next Session — Phase 1 merge + Phase 2 planning)

```
1. cd ~/Desktop/Projects/Bookingcrm
2. Read this progress.md
3. Merge feature/phase1-clinical-credibility → main (PR or direct)
4. Deploy: git push → Railway auto-deploys API; vercel --prod for frontend
5. Set env vars in Railway: SENDGRID_API_KEY, FROM_EMAIL, FROM_NAME
6. Verify production: glowos-nine.vercel.app/dashboard/staff, /walkins, /import
7. Sign up for Stripe (still pending from Session 5 TODO list)
8. Begin Phase 2 planning (group admin UI, promotions, subscription tiers, staff calendar)
```

---

## What's Completed (Session 5 — 12 April 2026)

### Phase 1 — Clinical Credibility (Tasks 1–4 of 14 complete)

**Branch:** `feature/phase1-clinical-credibility`
**Worktree:** `.worktrees/phase1-clinical-credibility`
**Plan file:** `docs/superpowers/plans/2026-04-12-phase1-clinical-credibility.md`
**Spec file:** `docs/superpowers/specs/2026-04-12-glowos-clinic-platform-design.md`

#### Task 1 ✅ — Schema extensions (commit `cd73535`)
- `staff`: added `bio`, `specialtyTags` (text[]), `credentials`, `isPubliclyVisible`
- `services`: added `slotType` (standard/consult/treatment), `requiresConsultFirst`, `consultServiceId`
- `clients`: added `acquisitionSource` (online_booking/walkin/import/social), `preferredContactChannel` (email/whatsapp)
- `merchants`: added `groupId` (bare UUID, no FK — circular import prevention documented in comment)

#### Task 2 ✅ — New schema tables + DB migration pushed (commits `4c97dfc`, `83f6497`, `a509619`)
- New file `glowos/packages/db/src/schema/groups.ts`: `groups`, `groupSettings`, `groupUsers`, `staffMerchants` tables
  - `profileSharingLevel` is a 4-level enum (none/identity_only/selective/full_history) — NOT a boolean
  - `groupUsers` is a separate auth table from `merchant_users`
  - `staffMerchants` composite PK — home branch stays in `staff.merchantId`, this lists additional branches only
- New file `glowos/packages/db/src/schema/consult.ts`: `consultOutcomes` table
- New file `glowos/packages/db/src/schema/post-service.ts`: `postServiceSequences` table
- Migration `0001_lush_ken_ellis.sql` generated + pushed to Neon ✅ (all 6 new tables live in DB)

#### Task 3 ✅ — Staff profile API (commits `031ab43`, `947338a`)
- `PATCH /merchant/staff/:id/profile` — authenticated partial update with empty-body guard, merchantId scope on UPDATE
- `GET /booking/:slug/staff` — public endpoint for booking widget, returns 9-column projection (no sensitive fields), filters `isActive=true AND isPubliclyVisible=true`

#### Task 4 ✅ — Staff profile admin UI (commits `aa81e42`, `43969ac`)
- `glowos/apps/web/app/dashboard/staff/page.tsx`: bio textarea, specialty tags (comma-string), credentials, publicly-visible checkbox
- Profile PATCH called after main staff save; always sends `is_publicly_visible`; sends bio/credentials/specialty_tags unconditionally (|| undefined to omit when blank)
- Fixed: POST response shape correctly cast as `{ staff: { id } }` not `{ id }`

#### Remaining Tasks (5–14 — next session picks up here)

| Task | Description | Status |
|---|---|---|
| 5 | Staff profile cards in BookingWidget (bio, specialty tags, service descriptions) | ⏳ next |
| 6 | Consult slot type API (extend services PATCH + consult outcome endpoints) | pending |
| 7 | Consult slot type admin UI + widget gating | pending |
| 8 | Walk-in registration + payment recording API | pending |
| 9 | Walk-in panel UI | pending |
| 10 | Post-service comms scheduler + worker | pending |
| 11 | SendGrid email setup (new lib + dual-channel notifications) | pending |
| 12 | CSV import API | pending |
| 13 | CSV import UI | pending |
| 14 | Final integration check + deploy | pending |

### Resume Checklist (Next Session — Phase 1 continued)

```
1. cd ~/Desktop/Projects/bookingcrm
2. Read this progress.md
3. git worktree list  →  should show .worktrees/phase1-clinical-credibility on branch feature/phase1-clinical-credibility
4. Read docs/superpowers/plans/2026-04-12-phase1-clinical-credibility.md  →  Task 5 is next
5. Continue subagent-driven development from Task 5
   - Task 5: BookingWidget staff cards (bio, specialty tags, service descriptions)
   - All tasks follow spec compliance review → code quality review → mark complete → next task
```

---

## What's Completed (Session 4 — 11 April 2026)

### Booking Widget — Availability Endpoint Fixed
- [x] **OOM crash fixed** — Drizzle returns PostgreSQL `time` columns as `"HH:MM:SS"` not `"HH:MM"`; `combineDateAndTime` was appending `:00` producing invalid ISO `"T09:00:00:00"` → `parseISO` returned `Invalid Date` → `generateTimeSlots` looped forever → Node heap exhausted (~477 MB) → process crash
- [x] Fix: split on `:` and take only HH + MM parts, handles both `"HH:MM"` and `"HH:MM:SS"` from DB
- [x] Safety guard added to `generateTimeSlots`: NaN/range checks + `MAX_SLOTS=500` cap to prevent any future infinite loop
- [x] **`slotLeases` crash fixed** — `slot_leases` table never created; importing it from `@glowos/db` returned `undefined`; accessing `slotLeases.staffId` threw `TypeError` at query build time; replaced with empty array (slot leasing to be implemented when table is created)
- [x] Try/catch added to availability route handler for belt-and-suspenders error containment

### Workers / WhatsApp Notifications Fixed
- [x] **BullMQ worker crash fixed** — all 3 workers (notification, crm, vip) had no `.on("error")` handler; IORedis connection failure emitted unhandled EventEmitter error → process crash; added error handlers to all workers
- [x] **Worker startup logic fixed** — was guarded by `process.env.NODE_ENV !== "production"`, so workers never ran in Railway even with Upstash Redis configured; changed to start when `REDIS_URL` is present regardless of environment
- [x] **WhatsApp notifications confirmed working** — end-to-end tested: booking → BullMQ job → notification worker → Twilio WhatsApp → message received ✅

### Infrastructure
- [x] `NODE_ENV=production` confirmed set in Railway variables
- [x] `REDIS_URL` (Upstash) confirmed set in Railway variables — workers start on deploy
- [x] Vercel auto-deploy via GitHub: confirmed connected (source shows GitHub commit, not CLI)

---

## What's Completed (Session 3 — 11 April 2026)

### Industry-Agnostic Rebranding
- [x] All website copy rewritten across 12 files — serves restaurants, salons, clinics, spas, barbershops
- [x] Business categories expanded from 5 beauty-only to 9 multi-industry (restaurant, beauty_clinic, medical_clinic, other added)
- [x] Backend category validation updated to accept all 9 categories (auth.ts, merchant.ts, merchants schema)
- [x] Service categories expanded with Dining/F&B and Medical/Clinical

### Interactive UI — SevenRooms-inspired (Chris)
- [x] 4 new components: FloatingCTA, TestimonialCarousel (auto-advancing), ParallaxSection, ButtonRipple
- [x] Parallax hero orbs, animated ambient depth layers
- [x] Micro-interactions: card-hover-lift, glow-dot icons, shimmer overlay, button ripples
- [x] How It Works: scale-up staggered animations with glow ring hover
- [x] Testimonials upgraded from static quote to full carousel (3 testimonials, directional slides)
- [x] NavBar sticky CTA glow after scroll, all touch targets ≥ 44px (WCAG 2.1 AA)
- [x] prefers-reduced-motion support across all animations

### Critical Bug Fixes (E2E Audit)
- [x] Route ordering bug fixed — `/merchant` routes now precede `/:slug` wildcard
- [x] Cancellation refund logic fixed — correct field names, dynamic refund % displayed
- [x] Server-component API URL fixed — `getApiUrl()` with runtime env fallback chain for Vercel
- [x] JWT token refresh flow implemented — ApiError class, auto-refresh on 401, refresh lock
- [x] 23 brittle `msg.includes('401')` checks replaced with `err instanceof ApiError && err.status === 401` across 7 dashboard pages
- [x] "Business not found" replaces "Salon not found" in public booking page

### Client Portal Fixes
- [x] Client spending aggregation fixed — totalSpendSgd/totalVisits/lastVisitAt computed from completed bookings
- [x] Slug guard added — reserved words (merchant, cancel, health) return 404 instead of "Salon not found"

### Test Data
- [x] Seed script created (`packages/db/src/seed.ts`)
- [x] 3 branches seeded: ABC Salon - Orchard, Tampines, Jurong
- [x] 10 today's bookings + 22 past completed + 7 future bookings for ABC Salon
- [x] 8 test clients with profiles and spending history
- [x] 3 bookings per branch for today

### Infrastructure
- [x] Twilio WhatsApp sandbox joined (keyword: east-written, number: +14155238886)
- [x] Twilio credentials added to Railway env vars
- [x] Vercel env vars set: API_URL + NEXT_PUBLIC_API_URL pointing to Railway
- [x] All changes deployed — GitHub `a910d23`, Vercel production live

---

## What's Completed (Session 2 — 11 April 2026)

### Landing Page Redesign — SevenRooms-Inspired (2 passes)

**Pass 1 — Initial redesign:**
- [x] Complete visual overhaul — dark premium aesthetic with warm champagne gold (#c4a778) accent palette
- [x] Scroll-triggered animations — new `AnimateOnScroll` component using IntersectionObserver (fade-up, slide-in-left/right, scale-in)
- [x] NavBar redesign — cleaner minimal style, gold accents
- [x] Fixed hero layout overlap — switched from absolute positioning to proper CSS grid
- [x] Deployed to Vercel production

**Pass 2 — Frontend-design skill refinement:**
- [x] Typography upgrade — Cormorant Garamond (serif display) + Outfit (geometric sans body), replacing generic Inter/Playfair
- [x] Film grain overlay — subtle SVG noise texture across entire page for editorial depth
- [x] Hero editorial treatment — italic "booking software", `clamp()` fluid typography, orchestrated `hero-load` animation sequence
- [x] Animated gold divider lines between all sections
- [x] Centered section labels with flanking gold lines
- [x] NavBar animated underline on hover + animated hamburger icon (lines rotate to X)
- [x] CSS variables system (`--gold`, `--surface`, `--surface-raised`) for consistency
- [x] Dashboard mockup gentle float animation (`animate-subtle-float`)
- [x] CTA buttons: dark text on gold (better contrast), lift + shadow bloom on hover
- [x] Deeper hover states with longer transitions (500–700ms)
- [x] Custom scrollbar, focus-visible styles, selection color
- [x] Deployed to Vercel production

### New Files
- `apps/web/app/components/AnimateOnScroll.tsx` — reusable scroll-triggered animation wrapper (IntersectionObserver)

### Modified Files
- `apps/web/app/page.tsx` — full landing page redesign (2 passes)
- `apps/web/app/components/NavBar.tsx` — refined styling, animated hamburger, gold palette
- `apps/web/app/layout.tsx` — Cormorant Garamond + Outfit fonts, CSS variable setup
- `apps/web/app/globals.css` — animation keyframes, grain overlay, CSS variables, divider lines, custom scrollbar

---

## What's Completed (Session 1 — 10 April 2026)

### Backend (services/api/) — 100% for MVP
- [x] Database schema — 15 PostgreSQL tables via Drizzle ORM
- [x] Authentication — JWT signup/login/refresh, RBAC (owner/manager/staff), tenant isolation
- [x] Booking Engine — Redis-cached availability, 5-min slot leasing, full booking lifecycle
- [x] Payments API — Stripe Connect onboarding, payment intents, webhook handler, refunds
- [x] Notifications API — BullMQ queues, Twilio WhatsApp integration, 7 notification types
- [x] Workers — CRM profile updates, VIP scoring (RFM), churn detection
- [x] Analytics API — revenue, staff performance, top services, booking sources
- [x] Campaigns API — CRUD, audience filtering, message personalization, send/results
- [x] Cancellation policy endpoint

### Frontend (apps/web/) — 95% for MVP
- [x] Landing page — premium dark design inspired by SevenRooms (redesigned in Session 2)
- [x] Navbar — sticky with smooth scroll, mobile hamburger, logo links to home
- [x] Signup page — creates salon + owner, stores tokens
- [x] Login page — JWT auth with token storage
- [x] Onboarding wizard — 5-step (Profile, Services, Staff, Payments, Policy)
- [x] Dashboard layout — sidebar navigation (Dashboard, Analytics, Services, Staff, Clients, Campaigns, Settings)
- [x] Dashboard — today's bookings with check-in/complete/no-show/walk-in
- [x] Services CRUD — add/edit/deactivate with validation
- [x] Staff CRUD — service assignment + 7-day working hours grid
- [x] Client CRM — VIP summary, search, filters, detail drawer with notes
- [x] Analytics — revenue chart, staff performance, top services, booking sources
- [x] Campaigns — create, audience filter, message templates, send, results
- [x] Settings — 5 tabs (profile, cancellation policy, payments, booking page, account)
- [x] Booking page — full 5-step wizard (service → staff → date/time → details → confirm)
- [x] Confirmation page — booking summary with WhatsApp notice
- [x] Cancellation page — refund eligibility + execution
- [x] All logos link back to landing page (/)

### Infrastructure
- [x] Turborepo + pnpm monorepo
- [x] Deployed on Vercel (frontend) + Railway (API)
- [x] Neon PostgreSQL + Upstash Redis connected
- [x] Dockerfile for Railway deployment
- [x] Docker Compose for local dev (Postgres 16 + Redis 7)
- [x] GitHub repo with CI pushes

### Test Data (ABC Salon — ipwffrank@gmail.com)
- [x] Merchant profile updated (address, description, cancellation policy)
- [x] 8 services (Classic Manicure, Gel Manicure, Gel Pedicure, Nail Art, Acrylic Extensions, Nail Removal, Express Facial, Back Massage)
- [x] 5 staff (Sarah Lim, Wei Lin, Priya Nair, Michelle Tan, Any Available)
- [x] 20 bookings across Apr 3–10 (13 completed, 5 confirmed, 2 no-show)
- [x] 10 clients with varied booking histories
- [x] Walk-in bookings included

### Bug Fixes Applied
- [x] Signup now stores auth tokens in localStorage
- [x] apiFetch header merging fixed (Content-Type was being overwritten)
- [x] Onboarding staff step logic fixed
- [x] CORS configured for all origins
- [x] Lazy DB connection for Neon (dotenv load order)
- [x] ESM module resolution for Node 24 (`"type": "module"` on db package)
- [x] force-dynamic on SSR pages to prevent build-time API calls
- [x] Suspense boundary for useSearchParams in settings page
- [x] Removed onClick from server component (landing page)
- [x] scroll-smooth on html element for anchor navigation

---

## What's NOT Done Yet

### Priority 1 — Do FIRST When Resuming (Next Session)

1. **Stripe Connect — Sign Up** *(all payment code written, just needs keys)*
   - Sign up at https://stripe.com (needs SG business entity or sole proprietorship)
   - Enable Connect (Platform/Marketplace mode)
   - Get: STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY
   - Set up webhook: https://bookingcrm-production.up.railway.app/webhooks/stripe → get STRIPE_WEBHOOK_SECRET
   - Update Railway env vars

2. **Add Real Images to Landing Page**
   - Feature section visuals show icons — replace with hospitality photography
   - Use Unsplash (restaurants, salons, clinics, spas)
   - Add images to `glowos/apps/web/public/images/`

3. **Full Production E2E Test**
   - signup → onboarding → add services/staff → share booking link → client books → dashboard shows booking → check-in → complete
   - Test on mobile (responsive)

### Priority 2 — Before Pilot Launch

4. **Custom Domain**
   - Register glowos.sg
   - Point to Vercel (frontend): Vercel dashboard → Domains → Add
   - Set up api.glowos.sg → Railway: Railway dashboard → Settings → Custom Domain

### Priority 3 — Phase 2

7. **Google Actions Center** — "Book" button on Google Maps (needs working Stripe + partner application)
8. **AI Agents (Claude API)** — campaign composer, business insights (needs ANTHROPIC_API_KEY)
9. **HitPay** — PayNow/GrabPay for Singapore local payments

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
│   │   ├── app/[slug]/        → Public booking page (SSR + client widget)
│   │   └── app/cancel/        → Cancellation page
│   ├── packages/db/           → Drizzle ORM (15 tables)
│   ├── packages/types/        → Shared TypeScript types
│   ├── services/api/          → Hono API server + BullMQ workers
│   │   ├── src/routes/        → auth, merchant, services, staff, bookings, clients, payments, webhooks, analytics, campaigns
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
- **Booking widget:** `glowos/apps/web/app/[slug]/BookingWidget.tsx`
- **Environment (local):** `glowos/.env`
- **Environment (production):** Railway dashboard → bookingcrm service → Variables tab

### How to Deploy
- **Frontend (Vercel):** `cd glowos && vercel --prod` (must run from glowos/ dir, not root)
- **API (Railway):** auto-deploys on git push to main
- **Local dev:** `cd glowos/services/api && npx tsx src/index.ts`

---

## Resume Checklist (Next Session)

```
1. cd ~/Desktop/Projects/Bookingcrm
2. Read this progress.md
3. Ask user about Stripe signup status → set up STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET in Railway
4. Add real images to landing page (Unsplash hospitality photography)
5. Run full E2E test: signup → onboarding → booking → check-in → complete
6. Custom domain setup (glowos.sg) if registered
```

## Known Technical Debt
- `slot_leases` table not yet created — availability falls back to booking-only conflict detection (no hold during checkout). Will need: schema file, migration, update availability.ts to re-enable leases.
- Vercel deploy source shows both GitHub and CLI entries — going forward all deploys should be via git push only.

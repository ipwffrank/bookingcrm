# GlowOS MVP — Progress Tracker
**Last updated: 11 April 2026**

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
- **Twilio:** ipwffrank@gmail.com — account created, credentials added to local .env (sandbox number +14155238886)
- **Stripe:** NOT yet signed up
- **GitHub:** ipwffrank/bookingcrm

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

### Priority 1 — Do FIRST When Resuming (12 April)

1. **Twilio WhatsApp — Credentials Added (Local)**
   - [x] Twilio credentials added to local `.env` (Account SID, Auth Token, WhatsApp sandbox number +14155238886)
   - [ ] Update Railway env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM (deploy to production)
   - [ ] Join WhatsApp sandbox: recipient must text "join <sandbox-keyword>" to +14155238886 before receiving messages
   - [ ] Test: create a booking → WhatsApp confirmation should be received
   - Note: sandbox uses free-form `body` messages (not content templates) — code is compatible

2. **Fix Route Ordering Bug (Critical)**
   - `/booking/:slug` wildcard catches `/booking/merchant` — "merchant" is treated as a slug
   - Fix: in `services/api/src/index.ts`, mount merchant booking routes BEFORE the public `/:slug` routes
   - Or rename to `/merchant/bookings` to avoid collision entirely
   - This affects: dashboard today's bookings list, walk-in creation

3. **Stripe Connect — Sign Up**
   - Sign up at https://stripe.com (needs SG business entity or sole proprietorship)
   - Enable Connect (Platform/Marketplace mode)
   - Get: STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY
   - Set up webhook: https://bookingcrm-production.up.railway.app/webhooks/stripe → get STRIPE_WEBHOOK_SECRET
   - Update Railway env vars
   - All payment code is already written — just needs keys

### Priority 1.5 — Landing Page Imagery

4. **Add Real Images to Landing Page**
   - Feature section visual placeholders currently show icons — replace with salon/hospitality photography
   - Options: export assets from Figma (Figma MCP available in Claude Desktop only, NOT Claude Code), or use high-quality stock photos (Unsplash)
   - Add images to `glowos/apps/web/public/images/`
   - Note: Figma MCP requires Claude Desktop app + Figma Desktop with Dev Mode enabled

### Priority 2 — Before Pilot Launch

4. **End-to-End Flow Testing**
   - Full production test: signup → onboarding → add services/staff → share booking link → client books → dashboard shows booking → check-in → complete
   - Test on mobile (responsive)
   - Fix any remaining API path mismatches

5. **Custom Domain**
   - Register glowos.sg
   - Point to Vercel (frontend): Vercel dashboard → Domains → Add
   - Set up api.glowos.sg → Railway: Railway dashboard → Settings → Custom Domain

6. **Vercel + GitHub Auto-Deploy**
   - Connect Vercel project to GitHub repo for automatic deploys on push
   - Currently deploying via `vercel --prod` CLI manually
   - Vercel dashboard → Git → Connect Repository → select ipwffrank/bookingcrm → Root Directory: glowos

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

## Resume Checklist (for 11 April)

```
1. cd ~/Desktop/Projects/Bookingcrm
2. Read this progress.md
3. Ask user for Twilio credentials (Account SID + Auth Token from console.twilio.com)
4. Fix the route ordering bug in services/api/src/index.ts (#2 above)
5. Update Railway env vars with Twilio credentials
6. Test WhatsApp notifications end-to-end
7. Ask user about Stripe signup status
```

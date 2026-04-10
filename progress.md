# GlowOS MVP — Progress Tracker
**Last updated: 10 April 2026**

---

## Deployment URLs

| Service | URL | Provider |
|---|---|---|
| Website (frontend) | https://glowos-nine.vercel.app | Vercel |
| API Server | https://bookingcrm-production.up.railway.app | Railway |
| Database | Neon PostgreSQL (15 tables, US East) | Neon |
| Cache / Queue | Upstash Redis | Upstash |
| Source Code | https://github.com/ipwffrank/bookingcrm | GitHub |

---

## What's Completed

### Backend (services/api/) — 100% for MVP
- [x] Database schema — 15 PostgreSQL tables via Drizzle ORM
- [x] Authentication — JWT signup/login/refresh, RBAC (owner/manager/staff), tenant isolation
- [x] Booking Engine — Redis-cached availability, 5-min slot leasing, full booking lifecycle
- [x] Payments — Stripe Connect onboarding, payment intents, webhook handler, refunds
- [x] Notifications — BullMQ queues, Twilio WhatsApp integration, 7 notification types
- [x] Workers — CRM profile updates, VIP scoring (RFM), churn detection
- [x] Analytics API — revenue, staff performance, top services, booking sources
- [x] Campaigns API — CRUD, audience filtering, message personalization, send/results
- [x] Cancellation policy endpoint

### Frontend (apps/web/) — 90% for MVP
- [x] Landing page — premium dark design inspired by SevenRooms
- [x] Signup page — creates salon + owner, stores tokens
- [x] Login page — JWT auth with token storage
- [x] Onboarding wizard — 5-step (Profile, Services, Staff, Payments, Policy)
- [x] Dashboard — today's bookings with check-in/complete/no-show/walk-in
- [x] Services CRUD — add/edit/deactivate with validation
- [x] Staff CRUD — service assignment + 7-day working hours grid
- [x] Client CRM — VIP summary, search, filters, detail drawer with notes
- [x] Analytics — revenue chart, staff performance, top services, booking sources
- [x] Campaigns — create, audience filter, message templates, send, results
- [x] Settings — profile, cancellation policy, payments, booking page, account
- [x] Booking page — full wizard (service → staff → date → details → confirm)
- [x] Cancellation page — refund eligibility + execution
- [x] All logos link back to landing page

### Infrastructure
- [x] Turborepo + pnpm monorepo
- [x] Deployed on Vercel (frontend) + Railway (API)
- [x] Neon PostgreSQL + Upstash Redis
- [x] Docker Compose for local dev
- [x] GitHub repo with auto-deploy on push

### Test Data (ABC Salon)
- [x] 8 services (nails, face, massage)
- [x] 5 staff with working hours
- [x] 20 bookings (completed, confirmed, no-show, walk-in)
- [x] 10 clients with varied booking histories

### Bug Fixes Applied
- [x] Signup now stores auth tokens in localStorage
- [x] apiFetch header merging fixed (Content-Type was being overwritten)
- [x] Onboarding staff step logic fixed
- [x] CORS configured for all origins
- [x] Lazy DB connection for Neon (dotenv load order)
- [x] ESM module resolution for Node 24

---

## What's NOT Done Yet

### Priority 1 — Do First When Resuming

1. **Twilio WhatsApp Setup**
   - User has a Twilio account (ipwffrank@gmail.com)
   - Need: Account SID, Auth Token, WhatsApp number
   - Update Railway env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
   - Workers are already coded — just need credentials to activate
   - Test: signup → booking → WhatsApp confirmation received

2. **Stripe Connect Setup**
   - Need: Stripe account with Connect enabled (SG business entity required)
   - Update Railway env vars: STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET
   - Set up Stripe webhook endpoint: https://bookingcrm-production.up.railway.app/webhooks/stripe
   - Test: booking → card payment → commission split → merchant payout

3. **Fix Route Ordering Bug (Critical)**
   - The `/booking/:slug` wildcard route catches `/booking/merchant` — "merchant" is treated as a slug
   - Fix: reorder routes in services/api/src/index.ts so merchant routes are registered before public booking routes
   - Or rename merchant booking routes to avoid collision

### Priority 2 — Before Pilot Launch

4. **End-to-End Flow Testing**
   - Test full flow on production: signup → onboarding → add services → add staff → share booking link → client books → dashboard shows booking
   - Fix any remaining API path mismatches between frontend and backend
   - Test on mobile (responsive)

5. **Custom Domain**
   - Register glowos.sg
   - Point to Vercel (frontend)
   - Set up api.glowos.sg subdomain → Railway

6. **Vercel + GitHub Auto-Deploy**
   - Connect Vercel to GitHub repo for automatic deploys on push
   - Currently deploying via CLI

### Priority 3 — Phase 2

7. **Google Actions Center Integration**
   - Merchant/service feeds
   - Real-time availability API (already built, needs Google partner application)
   - Booking creation from Google

8. **AI Agents (Claude API)**
   - Campaign Composer Agent — auto-generate re-engagement messages
   - Business Insights Agent — conversational analytics
   - Need: ANTHROPIC_API_KEY in Railway env vars

9. **HitPay Integration**
   - PayNow / GrabPay support for Singapore
   - Alternative to Stripe for local payment methods

---

## Architecture Quick Reference

```
Bookingcrm/
├── glowos/
│   ├── apps/web/          → Next.js 15 (marketing + dashboard + booking pages)
│   ├── packages/db/       → Drizzle ORM (15 tables)
│   ├── packages/types/    → Shared TypeScript types
│   ├── services/api/      → Hono API server + BullMQ workers
│   └── docker-compose.yml → Postgres 16 + Redis 7 (local dev)
├── Dockerfile             → Railway deployment
└── progress.md            → This file
```

### Key Files
- **API entry:** `glowos/services/api/src/index.ts`
- **DB schema:** `glowos/packages/db/src/schema/`
- **Landing page:** `glowos/apps/web/app/page.tsx`
- **Dashboard:** `glowos/apps/web/app/dashboard/`
- **Booking page:** `glowos/apps/web/app/[slug]/`
- **Environment:** `glowos/.env` (local), Railway dashboard (production)

### Credentials Location
- **Neon DB:** Railway env vars + glowos/.env
- **Upstash Redis:** Railway env vars + glowos/.env
- **Twilio:** Twilio console (ipwffrank@gmail.com) — NOT YET in env vars
- **Stripe:** NOT YET configured
- **Vercel:** CLI authenticated as ipwffrank

---

## Resume Checklist

When starting a new session:

1. `cd ~/Desktop/Projects/Bookingcrm/glowos`
2. Read this file for context
3. Check what's first in "Priority 1" above
4. Ask user for any pending credentials (Twilio SID/token, Stripe keys)
5. Fix the route ordering bug (#3 above) before anything else

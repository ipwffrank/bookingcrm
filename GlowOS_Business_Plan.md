# GlowOS — Business Plan
### VIP Intelligence & Booking Platform for Malaysian Wellness Businesses
**Draft v1.0 — April 2026**

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Market Opportunity](#3-market-opportunity)
4. [Competitive Landscape](#4-competitive-landscape)
5. [Solution Overview](#5-solution-overview)
6. [Product Architecture](#6-product-architecture)
7. [Booking Workflow](#7-booking-workflow)
8. [Google Integration Strategy](#8-google-integration-strategy)
9. [Payment & Transaction Model](#9-payment--transaction-model)
10. [Cancellation & Refund Policy](#10-cancellation--refund-policy)
11. [AI Agents](#11-ai-agents)
12. [Pricing & Revenue Model](#12-pricing--revenue-model)
13. [Product Roadmap](#13-product-roadmap)
14. [Technology Stack](#14-technology-stack)
15. [Go-to-Market Strategy](#15-go-to-market-strategy)
16. [Financial Projections](#16-financial-projections)
17. [Risks & Mitigations](#17-risks--mitigations)
18. [Immediate Next Steps](#18-immediate-next-steps)

---

## 1. Executive Summary

**GlowOS** is a SaaS platform purpose-built for Malaysian salons, beauty centres, spas, and massage businesses. It combines a smart online booking system with a CRM-powered VIP intelligence engine — enabling wellness business owners to identify their highest-value clients, reduce no-shows, automate marketing, and acquire new customers directly through Google Search and Maps.

The platform is inspired by two proven models:

- **Chope** (acquired by Grab, 2024) — Asia's leading dining reservation platform, which built a consumer-facing discovery and booking marketplace generating revenue through per-diner fees.
- **SevenRooms** — A hospitality CRM and operations platform serving 15,000+ restaurants globally, focused on guest data ownership, VIP identification, and automated marketing.

GlowOS adapts the best of both models for the underserved Malaysian wellness vertical — a sector with thousands of small and medium businesses that currently manage bookings manually, have no structured client data, and rely entirely on word-of-mouth for retention.

**Core value proposition to salon owners:**
> "We bring new customers to you through Google, and help you identify and keep your best ones — automatically."

---

## 2. Problem Statement

Malaysian salons, spas, and massage centres face three persistent operational problems:

### Problem 1 — No-Shows & Manual Booking
The majority of wellness businesses in Malaysia still manage appointments via phone calls, WhatsApp messages, or handwritten diaries. This leads to double bookings, forgotten appointments, high no-show rates, and staff time wasted on coordination rather than service.

### Problem 2 — No Client Intelligence
Owners have no structured data on their clients. They cannot answer basic questions like: Who are my top 10 spenders? Which clients haven't returned in 6 weeks? Which therapist retains the most customers? Without this data, marketing is guesswork and VIP clients receive no special treatment.

### Problem 3 — New Customer Acquisition
Most small wellness businesses have no digital acquisition channel beyond Instagram. They are invisible to the millions of people searching for services on Google every day, and they have no way to convert that search intent into a confirmed, paid booking.

---

## 3. Market Opportunity

### Target Businesses
- Hair salons
- Beauty centres (facial, skincare)
- Nail salons
- Massage and wellness centres
- Waxing studios
- Brow and lash studios

### Market Size (Malaysia)
- Estimated 25,000–40,000 registered wellness businesses in Malaysia
- Klang Valley alone has 5,000–8,000 SME wellness outlets
- Average monthly revenue per salon: RM 15,000–RM 80,000
- Sector growing ~8–12% annually driven by rising middle-class spending and wellness awareness

### Regional Expansion Potential
After establishing Malaysia dominance, the same model applies to:
- Singapore (Reserve with Google already live)
- Thailand, Indonesia, Philippines (rapidly growing wellness sectors)

---

## 4. Competitive Landscape

| Platform | Focus | Region | Wellness? | VIP Engine? | Google Integration? |
|---|---|---|---|---|---|
| **Chope** (Grab) | Restaurant booking marketplace | SG, TH, ID | ❌ | ❌ | ❌ |
| **SevenRooms** | Restaurant CRM & operations | Global (enterprise) | ❌ | ✅ | ❌ |
| **Vagaro** | Salon booking software | US-focused | ✅ | Limited | Limited |
| **Treatwell** | Wellness marketplace | Europe | ✅ | ❌ | ❌ |
| **Fresha** | Salon booking + marketplace | Global | ✅ | ❌ | Limited |
| **GlowOS** | VIP intelligence + Google booking | Malaysia-first | ✅ | ✅ | ✅ |

**Key differentiator:** No competitor in Malaysia specifically combines Google-native booking acquisition with a VIP intelligence engine for the wellness vertical. GlowOS owns this positioning.

---

## 5. Solution Overview

GlowOS operates as a **B2B SaaS platform** sold to wellness business owners. It is invisible to end clients — who simply see a clean, professional booking experience branded to the salon.

### What Salon Owners Get
- A hosted booking page (e.g., `glow.my/luxe-salon-pj`) requiring zero website setup
- A "Book Now" button appearing on their Google Business Profile
- A dashboard to manage appointments, staff, and availability in real-time
- A CRM that automatically builds a profile on every client
- AI-powered VIP scoring that identifies their most valuable customers
- Automated WhatsApp/SMS notifications for confirmations and reminders
- Marketing automation tools for retention campaigns
- Full transaction management with automatic commission splitting

### What Clients (End Users) Experience
- Find the salon on Google → click "Book" → choose service, stylist, date and time
- Pay securely online (DuitNow, FPX, card)
- Receive instant confirmation
- Receive automated reminder before appointment
- Option to cancel or reschedule within policy window

### What GlowOS Does NOT Require from Salon Owners
- No website changes
- No new hardware
- No payment gateway setup
- No technical knowledge
- No change to their existing client relationships

---

## 6. Product Architecture

```
┌────────────────────────────────────────────────────────────┐
│                        GLOWOS PLATFORM                     │
├────────────────┬───────────────────────┬───────────────────┤
│  BOOKING       │   CRM & VIP ENGINE    │   MARKETING       │
│  ENGINE        │                       │   AUTOMATION      │
│                │  Client 360 Profile   │                   │
│  Slot Mgmt     │  VIP Scoring (RFM)    │  Birthday Promos  │
│  Staff Assign  │  Churn Prediction     │  Win-back Msgs    │
│  Calendar Sync │  Visit History        │  Review Requests  │
│  Waitlist      │  Spend Tracking       │  Campaign Builder │
├────────────────┴───────────────────────┴───────────────────┤
│                    PAYMENT LAYER                           │
│         Stripe Connect / Curlec Marketplace                │
│    Auto-split: Commission held + Salon payout              │
├────────────────────────────────────────────────────────────┤
│                  NOTIFICATION LAYER                        │
│          WhatsApp · SMS · Email · Push                     │
├────────────────────────────────────────────────────────────┤
│                  GOOGLE INTEGRATION                        │
│    GBP Appointment Link → Place Action Link → Reserve      │
└────────────────────────────────────────────────────────────┘
```

---

## 7. Booking Workflow

### End-to-End Flow (Google-Originated Booking)

```
1. Client searches "facial near me Bangsar" on Google
         ↓
2. Partner salon's Google Business Profile appears
         ↓
3. Client clicks "Book" button (powered by GlowOS)
         ↓
4. GlowOS hosted booking page loads (branded as the salon)
         ↓
5. Client selects: Service → Therapist → Date/Time
         ↓
6. Cancellation policy displayed clearly at checkout
         ↓
7. Client pays via DuitNow / FPX / Card
         ↓
8. Payment processor (Stripe/Curlec) confirms payment via webhook
         ↓
9. GlowOS records: booking_source = "google", transaction = RM 150
         ↓
10. Salon receives instant WhatsApp notification + dashboard update
         ↓
11. Client receives confirmation message with booking details
         ↓
12. 24hr before appointment: automated reminder sent to client
         ↓
13. After appointment: review request sent automatically
```

### Booking Sources & Commission Logic

| Source | How it arrives | Commission applied? |
|---|---|---|
| Google (Reserve / Place Action) | Client finds salon on Google | ✅ Yes — 8–12% |
| Direct widget (salon's own site) | Client already knows the salon | ❌ No — covered by SaaS fee |
| Instagram / WhatsApp link | Salon shares booking link | ❌ No — covered by SaaS fee |
| Walk-in (manual entry) | Staff enters manually | ❌ No |

### No-Show Handling

If a client does not show up and has not cancelled:

1. Staff marks booking as "No-Show" in dashboard
2. Policy enforced: no refund (agreed at checkout)
3. Salon keeps their cut, GlowOS keeps commission
4. Churn Prevention Agent automatically sends a re-engagement message 24 hours later

---

## 8. Google Integration Strategy

### Three Tiers of Google Presence

GlowOS deploys a progressive Google integration strategy, starting with what is available immediately and building toward the highest-value integration.

#### Tier 1 — Appointment Link (Available Now, Day 1)
- A booking URL (`glow.my/salon-name`) is added to the salon's Google Business Profile under the "Appointment" attribute
- Appears as a clickable link on the GBP listing
- Setup time: under 30 minutes per salon
- No API required — manual GBP dashboard configuration
- Available in Malaysia immediately

#### Tier 2 — Place Action Link (Available Now, Higher Prominence)
- A dedicated booking button added via the GBP dashboard
- More prominent than a plain link — appears as a call-to-action button
- Redirects to GlowOS booking page
- Available in Malaysia immediately

#### Tier 3 — Reserve with Google (End-to-End Integration, Future)
- Native "Book" button embedded directly inside Google Search and Maps
- Client sees available slots and completes booking without leaving Google
- Requires GlowOS to be an approved Google Actions Center partner
- Feeds real-time availability directly from GlowOS into Google's interface
- Malaysia currently on Google's "coming soon" list — expected to go live given Google's significant investment in Malaysian infrastructure
- **Action:** Submit partner interest form at `developers.google.com/actions-center` immediately — approval takes several months

#### Eligibility Requirements for Reserve with Google Partner Status
- GlowOS must have a direct contractual relationship with all merchant partners
- Merchant list must match Google Maps locations exactly
- Services must conform to Google's standard service definition
- GlowOS must maintain technical capacity to implement the Actions Center API

### Why Malaysia Timing Works in GlowOS's Favour
By the time Reserve with Google officially launches in Malaysia, GlowOS aims to already have 200+ wellness venues on the platform — making it the natural and obvious first-mover partner for Google to certify.

---

## 9. Payment & Transaction Model

### Model: GlowOS as Merchant of Record

GlowOS owns the payment flow entirely for all Google-diverted bookings. The client pays GlowOS's payment infrastructure, and the platform automatically splits and pays out the salon's share.

```
Client pays RM 150
        ↓
Funds land in GlowOS's Stripe/Curlec account
        ↓
Automatic split:
  → RM 15 (10%) retained by GlowOS as commission
  → RM 135 (90%) queued for salon payout
        ↓
Salon receives payout to their registered bank account
(daily / weekly / monthly — configurable per salon tier)
```

### Why This Model

- **No chasing:** Commission is captured automatically at transaction time — no invoicing, no disputes
- **Full data ownership:** GlowOS captures the full transaction value, enabling accurate VIP scoring
- **Source tagging:** Every transaction is tagged with its booking source, making commission calculation transparent and auditable
- **Salon trust:** Salon can see in their dashboard exactly which bookings generated a commission and why

### Payment Processors

| Processor | Strengths | Use Case |
|---|---|---|
| **Stripe Connect** | Marketplace split payments, global reliability, strong API | Primary processor — handles card, international |
| **Curlec** (by Razorpay) | DuitNow, FPX, Malaysian bank support, local brand trust | Local payment methods |
| **iPay88** | Widely recognised by Malaysian SMEs | Fallback / salon preference |

### Salon Onboarding for Payments
- Salon registers bank account details during onboarding
- GlowOS verifies account via micro-deposit or instant verification
- Salon does **not** need to set up their own payment gateway
- Salon does **not** need a merchant account
- Salon simply receives payouts — GlowOS handles all payment complexity

### Real-Time Payment Confirmation for Salons
Salons confirm payments through the GlowOS dashboard, not through their bank account (which has T+1 to T+3 settlement delay).

**Three confirmation channels (all triggered by Stripe/Curlec webhook within seconds of payment):**

1. **WhatsApp notification** — instant alert to salon owner/staff phone
2. **Live dashboard update** — booking status changes to 💚 Paid in real-time
3. **Optional tablet/TV display** — front desk display showing today's confirmed paid bookings

### Processing Fees on Refunds
Payment processor fees (typically 2–3% of transaction) are non-refundable by Stripe/Curlec. Per GlowOS merchant agreement, the salon absorbs processing fees on refunded transactions. This is disclosed clearly during merchant onboarding.

---

## 10. Cancellation & Refund Policy

### Default Cancellation Policy (Configurable by Salon)

| Cancellation Timing | Refund to Client |
|---|---|
| 24+ hours before appointment | Full refund (100%) |
| 12–24 hours before appointment | Partial refund (50%) |
| Less than 12 hours before appointment | No refund |
| No-show (never cancelled) | No refund |
| **Salon cancels on client** | Full refund — salon absorbs processing fee |

Each salon can configure stricter or more lenient policies within limits set by GlowOS. The active policy is displayed clearly at the checkout screen before the client pays.

### Refund Flow

```
Client requests cancellation (self-service link in confirmation message)
        ↓
GlowOS checks: does policy allow refund?
        ├── Full refund eligible → Stripe/Curlec processes full reversal
        ├── Partial refund eligible → Partial amount returned
        └── No refund → Client notified, booking marked no-show
        ↓
Client notified via WhatsApp: "Your refund of RM X is on its way (5–10 business days)"
        ↓
Salon notified: "Booking cancelled — slot reopened automatically"
```

### Three Refund Triggers

1. **Client self-service** — via cancellation link in their confirmation message. Fully automated, no human needed.
2. **Salon initiates** — salon can cancel and refund from dashboard (e.g., staff sick, overbooking).
3. **GlowOS admin override** — force-refund any booking for dispute resolution. Last resort.

### Commission on Refunds

| Scenario | GlowOS Commission |
|---|---|
| Full refund (within policy) | Commission reversed — GlowOS keeps nothing |
| Partial refund | Proportional commission retained |
| No refund (no-show / late cancel) | Full commission retained |
| Salon-initiated cancellation | Commission reversed — salon absorbs processing fee |

---

## 11. AI Agents

GlowOS is powered by seven AI agents. Each agent is an autonomous background process that monitors data and takes action without manual intervention by salon staff.

### Agent 1 — VIP Identification Agent
**Priority: Build first**

Continuously scores every client using the RFM framework:
- **Recency** — How recently did they visit?
- **Frequency** — How often do they come?
- **Monetary** — How much do they spend per visit and in total?

Additional signals: referrals made, packages purchased, therapist loyalty, service breadth.

Auto-assigns VIP tiers (Bronze → Silver → Gold → Platinum) and updates in real-time on every booking or payment event. Alerts staff when a Platinum client has a booking today — "Puan Rohani arriving at 3pm — your highest spender this year, prefers Therapist Siti."

### Agent 2 — Booking Concierge Agent
**Priority: Build first**

Handles inbound booking requests conversationally via chat widget or WhatsApp integration. Understands natural language requests, checks real-time availability, confirms bookings, and handles rescheduling. Eliminates the need for salon staff to manually manage booking messages.

### Agent 3 — Churn Prevention Agent
**Priority: Build second**

Monitors every client against their personal visit cadence (calculated from history). When a client goes overdue beyond their typical cycle, the agent drafts a personalised win-back message and either queues it for owner approval or auto-sends it.

Example: "Sarah usually visits every 3 weeks. It has been 6 weeks. Sending re-engagement message."

Also fires 24 hours after a no-show: "Hi Sarah, we missed you yesterday! Your usual slot is open again this week — shall we rebook?"

### Agent 4 — Campaign Composer Agent

Owner describes a campaign goal in plain language: "I want to run a promotion for clients who haven't visited in 2 months." The agent identifies all matching clients, drafts personalised messages in Bahasa Malaysia or English, and schedules delivery. Owner reviews and approves before sending.

### Agent 5 — Business Insights Agent

Conversational analytics interface. Salon owner asks questions in plain language:
- "Who are my top 10 clients this quarter?"
- "Which service has the lowest rebooking rate?"
- "How much revenue did Therapist Lily generate last month?"
- "Which day of the week has the most no-shows?"

Agent queries the database and returns a clear, plain-language answer with supporting numbers.

### Agent 6 — Review & Reputation Agent

After every completed appointment, automatically sends a review request to the client. If the client leaves a rating below 4 stars, the agent immediately alerts the salon owner for service recovery — before the client has a chance to post publicly on Google. Positive reviews are channelled toward the salon's Google Business Profile.

### Agent 7 — Staff Coaching Agent *(Phase 3)*

Analyses which staff members have the best VIP retention rates, rebooking rates, and upsell rates. Surfaces weekly coaching insights to owners: "Therapist Amirah's clients rebook at 70% — her technique of recommending a follow-up date at checkout is working. 3 of her regulars are overdue this week."

---

## 12. Pricing & Revenue Model

### Revenue Stream 1 — SaaS Monthly Subscription

Charged to the salon owner for platform access, CRM, and all operational tools. Applied regardless of booking source.

| Tier | Price (RM/month) | Included |
|---|---|---|
| **Starter** | RM 79 | 1 staff, booking widget, basic client CRM, WhatsApp reminders |
| **Pro** | RM 199 | Up to 5 staff, VIP scoring, Google integration, analytics |
| **Business** | RM 449 | Unlimited staff, all AI agents, marketing automation, campaign tools |
| **Chain** | RM 999+ | Multi-branch, white-label option, dedicated support, API access |

### Revenue Stream 2 — Transaction Commission (Google-Diverted Bookings Only)

Charged only on bookings that originate from Google Search or Maps — i.e., new customers that GlowOS's platform directly acquired for the salon. This framing is critical: owners pay commission only when GlowOS delivers a customer they would not have had otherwise.

| Client Type | Commission Rate |
|---|---|
| First-time client from Google | 10–12% of transaction value |
| Returning client (in CRM already) re-acquired via Google | 3–5% of transaction value |
| Booking from direct widget / salon's own channels | 0% — covered by SaaS fee |
| Walk-in cash payment | 0% — no digital transaction |

### Unit Economics Example (Pro Tier Salon, 100 bookings/month)

| Item | Value |
|---|---|
| SaaS fee | RM 199/month |
| Google-diverted bookings (30% of total = 30 bookings) | — |
| Average booking value | RM 120 |
| Total Google-diverted revenue | RM 3,600 |
| GlowOS commission (10%) | RM 360/month |
| **Total GlowOS revenue per salon** | **RM 559/month** |

At 500 active salons: ~RM 280,000/month gross revenue.

---

## 13. Product Roadmap

### Phase 1 — Foundation (Months 1–4)
**Goal: 15–20 pilot salons, validate core workflow**

- Core booking engine (slot management, staff assignment, service catalogue)
- Client CRM with auto-profile creation on every booking
- Hosted booking page per salon (`glow.my/salon-name`) — no website setup required for owner
- Google Business Profile integration (Tier 1 & 2 — Appointment Link + Place Action Link)
- Payment processing via Stripe Connect + Curlec (DuitNow, FPX, card)
- Real-time webhook-based payment confirmation
- WhatsApp/SMS notifications (confirmations, reminders, cancellations)
- Basic salon dashboard (today's bookings, payment status, calendar view)
- Manual walk-in booking entry for cash transactions
- Cancellation policy configuration + self-service cancellation flow for clients
- Refund processing (full and partial)

### Phase 2 — VIP Intelligence Engine (Months 4–8)
**Goal: Make the product sticky — data becomes the moat**

- VIP Scoring Agent (RFM model, automated tier assignment)
- Client 360 profile (full service history, spend, therapist preference, notes)
- Churn Prediction Agent (visit cadence monitoring, overdue alerts)
- VIP arrival alerts for front desk
- Staff performance dashboard (retention rate, rebooking rate, revenue per staff)
- Submit Reserve with Google Partner Interest Form
- Basic analytics dashboard

### Phase 3 — Revenue & Retention Automation (Months 8–14)
**Goal: Drive measurable revenue for salon owners — justify pricing upgrade**

- Campaign Composer Agent (birthday promos, win-back, seasonal campaigns)
- Review & Reputation Agent (post-visit review requests, negative review alerts)
- Package and prepaid voucher system (sell session bundles in-app)
- Loyalty points / digital stamp card
- Business Insights Agent (conversational analytics)
- Staff Coaching Agent
- Upsell prompts at checkout ("This client usually adds a scalp treatment")
- Transaction commission billing infrastructure (automated split payments live)

### Phase 4 — Network & Scale (Months 14–24)
**Goal: Become the dominant wellness platform in Malaysia**

- Reserve with Google End-to-End integration (go live when Malaysia approved)
- Multi-branch management for chains
- Consumer-facing directory (`glow.my` as a discovery platform for clients)
- Expand to Johor Bahru, Penang, Kuching, Kota Kinabalu
- Singapore expansion (Reserve with Google already live there)
- API for POS system integration
- White-label offering for franchise chains

---

## 14. Technology Stack

### Recommended Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend (Web App)** | React / Next.js | Fast, SEO-friendly, great for booking pages |
| **Mobile** | React Native | Single codebase for iOS and Android |
| **Backend API** | Node.js + Express or Python FastAPI | Fast development, good ecosystem |
| **Database** | PostgreSQL | Relational data for bookings, CRM |
| **Real-time updates** | WebSockets / Supabase Realtime | Live dashboard updates |
| **Payment (Primary)** | Stripe Connect | Marketplace split payments |
| **Payment (Local)** | Curlec / iPay88 | DuitNow, FPX support |
| **Notifications** | Twilio (WhatsApp + SMS) | Proven, reliable, used by Chope |
| **AI Agents** | Anthropic Claude API | Powers all 7 agents |
| **Hosting** | AWS / Google Cloud (MY region) | Latency, compliance |
| **Booking source tracking** | Custom UTM + webhook tagging | Commission calculation accuracy |

### Critical Infrastructure: Webhook Architecture

Every payment event from Stripe/Curlec triggers an instant webhook to GlowOS servers, which:
1. Updates booking status in the database
2. Pushes real-time notification to salon dashboard
3. Sends WhatsApp confirmation to salon and client
4. Tags transaction with booking source for commission calculation
5. Creates or enriches client profile in CRM

---

## 15. Go-to-Market Strategy

### Phase 1 GTM — Klang Valley Focus

**Target:** Independent salons and beauty centres in Petaling Jaya, Subang Jaya, Bangsar, Mont Kiara, Cheras with 2–15 staff and RM 15,000–RM 60,000 monthly revenue.

**Acquisition channels:**

1. **Direct sales (feet on ground)** — Visit salons in person. Show a live demo of their salon's Google Business Profile with a booking button already set up. The demo *is* the pitch.

2. **WhatsApp group infiltration** — Malaysian salon owners have strong community groups on WhatsApp and Facebook. Offer value (tips, resources) before pitching.

3. **Instagram targeting** — Run ads targeting salon owners and beauty entrepreneurs in Klang Valley.

4. **Beauty supplier partnerships** — Partner with Caring Pharmacy, professional beauty product distributors, and supplier communities to reach salon owners at point of supply.

5. **Free pilot offer** — First 3 months free for pilot salons in exchange for feedback and a case study. Removes all purchase risk.

### Onboarding Experience
Complete onboarding in under 30 minutes:
1. Owner signs up online
2. Enters salon details, services, staff, and pricing
3. GlowOS auto-sets up their hosted booking page
4. GlowOS provides step-by-step guide to add booking link to their GBP
5. First booking can happen within the hour

---

## 16. Financial Projections

### Conservative Growth Scenario

| Period | Active Salons | Monthly Revenue (RM) | Annual Revenue (RM) |
|---|---|---|---|
| Month 6 | 30 | 16,770 | — |
| Month 12 | 100 | 55,900 | ~500,000 |
| Month 18 | 250 | 139,750 | — |
| Month 24 | 500 | 279,500 | ~2,500,000 |
| Year 3 | 1,500 | 838,500 | ~10,000,000 |

*Based on average RM 559/salon/month (SaaS + commission blended)*

### Cost Structure (Early Stage)

| Cost Item | Estimated Monthly (RM) |
|---|---|
| Engineering (2 developers) | 18,000 |
| Infrastructure (AWS/GCP) | 2,000 |
| Twilio (WhatsApp/SMS) | 1,500 |
| Stripe/Curlec fees (~2.5%) | Variable |
| Sales & Marketing | 8,000 |
| Admin & Legal | 3,000 |
| **Total Fixed Costs** | **~32,500** |

Break-even at approximately 60–70 paying salons on Pro or Business tier.

---

## 17. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Reserve with Google delayed for Malaysia | Medium | Medium | Tier 1 & 2 integration provides value on Day 1; Google delay does not block launch |
| Salons reluctant to let platform own payment | Medium | High | Transparent dashboard showing every split; start with smaller commission (5%) to build trust |
| Fresha or Vagaro entering Malaysia aggressively | Low–Medium | High | Move fast on Google integration — this is defensible moat; build local community |
| Client data privacy concerns (PDPA Malaysia) | Low | High | Ensure full PDPA compliance from Day 1; data stays in Malaysian data centres |
| High refund/dispute rate early on | Medium | Medium | Clear cancellation policy at checkout; strong salon onboarding to set expectations |
| Salon owner payment default on SaaS fee | Low | Low | Charge SaaS fee by card on file; suspend access if payment fails |

---

## 18. Immediate Next Steps

### Week 1–2
- [ ] Register company (Sdn Bhd) and trademark GlowOS brand name
- [ ] Open Stripe Malaysia account and begin Curlec merchant application
- [ ] Submit Reserve with Google Partner Interest Form at `developers.google.com/actions-center`
- [ ] Identify and approach 10 pilot salons in Petaling Jaya / Subang Jaya

### Month 1
- [ ] Begin Phase 1 MVP development (booking engine + CRM + GBP integration)
- [ ] Onboard first 5 pilot salons on free tier with Tier 1 GBP integration live
- [ ] Set up legal merchant agreement template for salon onboarding
- [ ] Establish WhatsApp notification infrastructure via Twilio

### Month 2–3
- [ ] Complete MVP — booking engine, payment processing, dashboard, notifications
- [ ] Onboard 15–20 pilot salons
- [ ] Begin collecting data to train VIP scoring model
- [ ] Iterate based on pilot salon feedback

### Month 4
- [ ] Launch paid tiers (Starter and Pro)
- [ ] Begin Phase 2 development (VIP Intelligence Engine)
- [ ] First case study published: "How [Salon Name] increased repeat visits by X% with GlowOS"

---

## Appendix A — Key Terminology

| Term | Definition |
|---|---|
| **GBP** | Google Business Profile — the free business listing that appears in Google Search and Maps |
| **Reserve with Google** | Google's native booking integration allowing clients to book without leaving Google |
| **Place Action Link** | A booking button on GBP that redirects to an external booking page |
| **RFM** | Recency, Frequency, Monetary — a scoring model for identifying VIP customers |
| **Merchant of Record** | The entity that legally processes the payment and owns the transaction |
| **Webhook** | An instant notification from a payment processor to a server when a transaction event occurs |
| **Split Payment** | A payment automatically divided between two parties (GlowOS and salon) at transaction time |
| **Booking Source Tagging** | Recording where a booking originated (Google, direct, walk-in) for commission calculation |
| **Churn** | When a client stops returning to a business |

---

## Appendix B — Cancellation Policy Reference

### Client-Facing Checkout Display (Required)

```
CANCELLATION POLICY
✅ Free cancellation before [24hrs prior to appointment]
⚠️  50% refund after that
❌  No refund within 12 hours of appointment
```

### Refund Processing Times
- Card payments: 5–10 business days to client's account
- FPX / DuitNow: 3–7 business days

---

*Document prepared April 2026. Confidential — for internal use and investor review only.*

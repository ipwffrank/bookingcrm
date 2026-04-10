# GlowOS — Product & Technical Specification
### User Journeys + Full Stack Build Guide
**Version 1.0 — April 2026**
**Audience: Product Owner + Full Stack Engineering Team**

---

## Table of Contents

### Part 1 — User Journeys (What Users Experience)
1. [Platform Actors](#1-platform-actors)
2. [Journey A — Salon Owner Onboarding](#2-journey-a--salon-owner-onboarding)
3. [Journey B — End Client Books via Google](#3-journey-b--end-client-books-via-google)
4. [Journey C — End Client Books via Direct Link](#4-journey-c--end-client-books-via-direct-link)
5. [Journey D — Salon Staff Manages the Day](#5-journey-d--salon-staff-manages-the-day)
6. [Journey E — Client Cancels a Booking](#6-journey-e--client-cancels-a-booking)
7. [Journey F — Salon Owner Reviews VIP Intelligence](#7-journey-f--salon-owner-reviews-vip-intelligence)
8. [Journey G — Salon Owner Runs a Campaign](#8-journey-g--salon-owner-runs-a-campaign)

### Part 2 — Technical Build Specification (How We Build It)
9. [System Architecture Overview](#9-system-architecture-overview)
10. [Database Schema](#10-database-schema)
11. [Backend API Specification](#11-backend-api-specification)
12. [Payment Integration — Stripe Connect + HitPay](#12-payment-integration--stripe-connect--hitpay)
13. [Google Actions Center Integration](#13-google-actions-center-integration)
14. [Notification System](#14-notification-system)
15. [AI Agent Architecture](#15-ai-agent-architecture)
16. [Frontend Application Structure](#16-frontend-application-structure)
17. [Webhook Processing Pipeline](#17-webhook-processing-pipeline)
18. [Authentication & Multi-Tenancy](#18-authentication--multi-tenancy)
19. [Infrastructure & Deployment](#19-infrastructure--deployment)
20. [Development Phases & Task Breakdown](#20-development-phases--task-breakdown)

---

# PART 1 — USER JOURNEYS

---

## 1. Platform Actors

There are three distinct types of users on GlowOS. Every screen, API endpoint, and data rule is built around serving one of these actors.

```
┌─────────────────────────────────────────────────────────┐
│                   GLOWOS PLATFORM                       │
├─────────────────┬───────────────────┬───────────────────┤
│  SALON OWNER    │   SALON STAFF     │   END CLIENT      │
│                 │                   │                   │
│  Manages the    │  Operates the     │  Books and pays   │
│  business.      │  day-to-day.      │  for services.    │
│  Sees all data, │  Sees today's     │  Sees only their  │
│  billing,       │  bookings, checks │  own bookings and │
│  analytics,     │  in clients,      │  profile.         │
│  VIP intel,     │  marks no-shows.  │                   │
│  campaigns.     │                   │                   │
└─────────────────┴───────────────────┴───────────────────┘
```

Additionally, GlowOS (us) has a fourth actor:

- **Platform Admin** — internal dashboard to manage all merchants, view platform-wide analytics, force refunds, manage Google Actions Center feeds, and handle support cases.

---

## 2. Journey A — Salon Owner Onboarding

**Actor:** Salon Owner
**Entry point:** `glowos.sg/signup` or referral link
**Goal:** Get the salon live on Google with a working booking button

### Step-by-Step Flow

```
Step 1 — Sign Up
  Owner visits glowos.sg/signup
  Enters: Full name, email, mobile number, password
  Receives: OTP via SMS to verify mobile number
  On verify: Account created, redirected to onboarding wizard

Step 2 — Business Profile Setup
  Wizard screen 1 of 5
  Fields:
    - Salon name (as it appears on Google Business Profile — must match exactly)
    - Business address (unit number, street, postal code)
    - Business phone number (must match GBP)
    - Business category (Hair Salon / Nail Studio / Spa / Massage / Beauty Centre / Other)
    - Profile photo (logo or salon photo)
    - Short description (shown on booking page)
    - Operating hours (per day, with option to set lunch breaks)
  Validation:
    - Name and address checked for completeness
    - A warning is shown: "Make sure this matches your Google Business Profile exactly"

Step 3 — Add Services
  Wizard screen 2 of 5
  Owner adds services one by one:
    - Service name (e.g. "Signature Facial", "Gel Manicure Full Set")
    - Category (Hair / Nails / Face / Body / Massage / Other)
    - Duration in minutes (e.g. 60)
    - Price in SGD (required — $0 not accepted)
    - Description (required for Google integration)
    - Buffer time after service (e.g. 15 min for room turnover)
  Can add unlimited services
  Can duplicate a service and edit it

Step 4 — Add Staff
  Wizard screen 3 of 5
  Owner adds each staff member:
    - Name
    - Role / title (e.g. "Senior Stylist", "Therapist")
    - Photo (optional but recommended)
    - Which services they perform (multi-select from the services list)
    - Working days and hours (can differ from salon hours)
  One staff member auto-created as "Any Available" 
  (for clients who don't have a preference)

Step 5 — Payment Setup
  Wizard screen 4 of 5
  Owner connects their payout bank account:
    - Via Stripe Connect onboarding (embedded iframe)
    - Or HitPay merchant setup (for PayNow/GrabPay)
  Owner selects preferred payout frequency: 
    Weekly (default for Starter/Pro) or Daily (Business tier)
  Owner accepts Merchant Agreement (GlowOS terms, commission policy, cancellation rules)

Step 6 — Cancellation Policy
  Wizard screen 5 of 5
  Owner selects their cancellation policy:
    - Free cancellation window: 24h / 48h / 72h before appointment
    - Late cancellation refund: 50% / 0%
    - No-show fee: Full charge / Partial / No fee
  Default policy pre-filled (24h free cancellation, 50% after, no refund on no-show)
  Policy preview shown exactly as clients will see it at checkout

Step 7 — Booking Page Ready
  GlowOS generates the hosted booking page:
    glowos.sg/[salon-slug]  (auto-generated from salon name, editable)
  Owner sees a preview of their booking page
  Owner shown a 5-step guide to add the booking link to their Google Business Profile:
    1. Go to business.google.com
    2. Click "Edit profile"
    3. Under "Contact" → "Appointment links" → paste glowos.sg/[salon-slug]
    4. Under "More" → "Bookings" → add as Place Action Link
    5. Save changes (takes up to 24 hours to appear)

Step 8 — Dashboard Access
  Owner lands on their main dashboard
  Dashboard shows:
    - Today's appointments (empty initially)
    - Setup completion checklist with remaining items
    - "Your booking link is live" confirmation banner
    - Link to share on Instagram, WhatsApp, anywhere
```

### What GlowOS Does Automatically at Onboarding
- Creates a `merchant` record in the database
- Generates a unique `salon-slug` (checked for uniqueness)
- Creates a Stripe Connect Express account for the merchant
- Sets up HitPay submerchant (if applicable)
- Registers the merchant in the Google Actions Center queue (background job, triggers once payout account is verified)
- Sends a welcome WhatsApp message to the owner with their booking link

---

## 3. Journey B — End Client Books via Google

**Actor:** End Client
**Entry point:** Google Search or Google Maps
**Goal:** Book and pay for a service without leaving Google (Tier 3) or with minimal friction (Tier 1/2)

### Tier 3 — Full Reserve with Google (Target State)

```
Step 1 — Discovery
  Client searches "facial near me" or "gel nails Tanjong Pagar" on Google
  Partner salon appears in Google Maps panel or search results
  Client sees: salon name, rating, photos, hours, and a "Book" button

Step 2 — Service Selection (inside Google)
  Client clicks "Book"
  Google displays a list of services pulled from GlowOS's Availability Feed:
    - Service name
    - Duration
    - Price in SGD
    - Description
  Client selects a service

Step 3 — Staff Selection (inside Google)
  Google displays available staff for that service
  Client selects a specific therapist or "Any Available"

Step 4 — Date and Time Selection (inside Google)
  Google displays a calendar with available slots
  Slots are pulled in real-time from GlowOS's Availability API (< 1 second response)
  Client selects a date and time
  GlowOS places a 5-minute "lease" on the selected slot
  (prevents double booking while client completes checkout)

Step 5 — Contact Details
  Client enters: name, email, mobile number
  Google may pre-fill from their Google account

Step 6 — Cancellation Policy Shown
  GlowOS's cancellation policy displayed clearly:
  "Free cancellation before [date/time]. 50% refund after. No refund within 12 hours."
  Client must acknowledge before proceeding

Step 7 — Payment (inside Google)
  Client pays via: Google Pay, card (Visa/MC/Amex)
  Payment processed via GlowOS's Stripe account
  GlowOS retains commission, queues salon payout

Step 8 — Confirmation
  Google shows a booking confirmation screen
  GlowOS simultaneously:
    → Sends WhatsApp/SMS confirmation to client
    → Sends WhatsApp alert to salon owner/staff
    → Updates salon dashboard in real-time (💚 Paid)
    → Creates or updates client CRM profile
    → Tags booking: source = "google_reserve"
    → Schedules 24h reminder job
    → Schedules post-visit review request job
```

### Tier 1/2 — Redirect to GlowOS Booking Page

```
Step 1–2: Same as above — client finds salon on Google, clicks booking link
Step 3: Redirected to glowos.sg/[salon-slug]
Step 4–8: Booking and payment completed on GlowOS booking page
  (Same flow as above but hosted on GlowOS frontend, not inside Google)
```

### The GlowOS Client Booking Page (Tier 1/2 Experience)

The hosted booking page at `glowos.sg/[salon-slug]` is a clean, mobile-first page branded with the salon's name, photo, and description.

```
Page layout:
  ┌────────────────────────────────────┐
  │  [Salon Logo / Photo]              │
  │  Luxe Hair Salon                   │
  │  ⭐ 4.8 · Orchard Road             │
  │  "Singapore's premier hair studio" │
  ├────────────────────────────────────┤
  │  SELECT A SERVICE                  │
  │  ○ Haircut & Blow Dry — 60min $80  │
  │  ○ Colour Treatment — 90min $150   │
  │  ○ Keratin Treatment — 120min $220 │
  ├────────────────────────────────────┤
  │  SELECT YOUR STYLIST               │
  │  ○ Sarah (Senior Stylist)          │
  │  ○ Wei Lin (Stylist)               │
  │  ○ Any Available                   │
  ├────────────────────────────────────┤
  │  SELECT DATE & TIME                │
  │  [Calendar — available dates only] │
  │  [Time slots for selected date]    │
  ├────────────────────────────────────┤
  │  YOUR DETAILS                      │
  │  Name: ________________            │
  │  Mobile: _______________           │
  │  Email: ________________           │
  ├────────────────────────────────────┤
  │  CANCELLATION POLICY               │
  │  ✅ Free before [date/time]        │
  │  ⚠️  50% after that               │
  │  ❌ No refund within 12 hours      │
  ├────────────────────────────────────┤
  │  [Confirm & Pay — SGD 80]          │
  │  PayNow  |  GrabPay  |  Card       │
  └────────────────────────────────────┘
```

---

## 4. Journey C — End Client Books via Direct Link

**Actor:** End Client
**Entry point:** Instagram bio, WhatsApp message, salon's website, QR code at counter
**Goal:** Book without having to call or message the salon

This journey is functionally identical to the Tier 1/2 booking page experience in Journey B. The difference is the entry source tag:

- From Instagram bio link → `booking_source = "instagram"`
- From salon's own website widget → `booking_source = "direct_widget"`
- From QR code scan at counter → `booking_source = "qr_walkin"`

No commission is charged on any of these sources. They are covered by the monthly SaaS fee.

### Returning Client Experience

If the client has booked before and enters the same mobile number:
- Their name is pre-filled
- Their service history is shown: "You last booked: Gel Manicure on 15 Mar"
- Their preferred therapist is pre-selected
- A personalised greeting shown: "Welcome back, Priya!"

This is powered by the CRM — the client profile is looked up by mobile number.

---

## 5. Journey D — Salon Staff Manages the Day

**Actor:** Salon Owner or Staff Member
**Entry point:** `app.glowos.sg` (web browser or mobile)
**Goal:** See today's appointments, check in clients, manage walk-ins, mark no-shows

### Dashboard — Today View

```
┌─────────────────────────────────────────────────────┐
│  TODAY — Tuesday 22 April 2026                      │
│  Luxe Hair Salon · 8 bookings today                 │
├─────────────────────────────────────────────────────┤
│  10:00  Sarah Tan       Haircut & Blow Dry  💚 Paid │
│         → Stylist: Wei Lin  · 60 min                │
│         [Check In] [Notes] [No-Show]                │
├─────────────────────────────────────────────────────┤
│  11:00  Priya Nair  ⭐ GOLD VIP  Colour Treatment   │
│         → Stylist: Sarah  · 90 min  💚 Paid         │
│         ⚡ Priya usually adds a Toner — suggest it  │
│         [Check In] [Notes] [No-Show]                │
├─────────────────────────────────────────────────────┤
│  12:30  [Walk-in slot — available]                  │
│         [+ Add Walk-in Booking]                     │
├─────────────────────────────────────────────────────┤
│  14:00  Michelle Lim    Gel Manicure     💚 Paid    │
│         → Any Available  · 60 min                   │
│         [Check In] [Notes] [No-Show]                │
└─────────────────────────────────────────────────────┘
```

### Key Staff Actions

**Check In:**
- Staff clicks "Check In" when client arrives
- Booking status changes from "Confirmed" → "In Progress"
- Timer starts for the service duration
- Staff can add notes: "Client requested lighter colour than last time"

**Mark No-Show:**
- If client hasn't arrived 15 minutes past appointment time
- Staff clicks "No-Show"
- Booking status → "No-Show"
- Refund policy enforced automatically (no refund for no-shows)
- Churn Prevention Agent queues re-engagement message for 24h later
- Slot is freed in availability feed (pushed to Google immediately via RTU)

**Add Walk-in Booking:**
- Staff clicks "+ Add Walk-in Booking"
- Selects service, staff, and duration
- Enters client name and mobile (optional)
- Selects payment method: Cash / PayNow QR / Card
- For cash: marks as "Paid — Cash" manually
- Walk-in booking created, source = "walkin_manual"
- No commission charged (no digital transaction through GlowOS)

**Complete Appointment:**
- Staff marks booking "Completed" when service finishes
- Review request job triggered (sends WhatsApp to client 30 min later)
- Booking status → "Completed"
- Client profile updated with service and spend data

### Staff-Specific View (Limited Permissions)

Staff members (non-owners) see:
- Their own bookings only for the day
- Client name and service (not spend data or VIP score)
- Check-in, notes, and no-show buttons

Staff members cannot see:
- Revenue data
- VIP tier details
- Campaign tools
- Billing settings

---

## 6. Journey E — Client Cancels a Booking

**Actor:** End Client
**Entry point:** WhatsApp confirmation message → "Cancel booking" link

### Self-Service Cancellation Flow

```
Step 1
  Client receives their confirmation WhatsApp:
  "Hi Sarah! Your booking at Luxe Hair Salon is confirmed.
   📅 Wednesday 23 April at 2:00 PM
   ✂️ Haircut & Blow Dry with Wei Lin
   💳 SGD 80 paid
   Need to cancel? → glowos.sg/cancel/[booking_token]"

Step 2
  Client clicks the cancellation link
  Page loads showing booking summary

Step 3
  GlowOS checks the cancellation policy rule against current time:
  
  CASE A: Within free cancellation window
    Page shows: "You are eligible for a full refund of SGD 80"
    Button: [Confirm Cancellation & Refund]
  
  CASE B: Partial refund window
    Page shows: "A 50% refund of SGD 40 will be returned.
                 The remaining SGD 40 is non-refundable per the
                 salon's cancellation policy."
    Button: [Confirm Cancellation]
  
  CASE C: No refund window
    Page shows: "This booking is outside the cancellation window.
                 No refund will be issued per the salon's policy."
    Button: [Cancel Booking Anyway] (no money returned)

Step 4 — Client Confirms
  GlowOS executes:
    → Stripe/HitPay refund (full or partial)
    → Booking status → "Cancelled"
    → Slot freed in calendar (RTU pushed to Google)
    → Commission adjusted (reversed for full refund)
    → Salon owner notified via WhatsApp:
      "Booking cancelled: Sarah Tan (Wed 23 Apr 2pm)
       Slot is now available."
    → Client receives refund confirmation WhatsApp

Step 5 — Rebooking Prompt
  30 minutes after cancellation, client receives:
  "No worries! Want to rebook at a different time?
   → glowos.sg/luxe-hair-salon"
```

---

## 7. Journey F — Salon Owner Reviews VIP Intelligence

**Actor:** Salon Owner
**Entry point:** GlowOS dashboard → "Clients" tab
**Goal:** Identify top clients, spot churning clients, take action

### Clients Page

```
┌──────────────────────────────────────────────────────────┐
│  CLIENTS                            [+ Import] [Filter]  │
├──────────────┬──────────────────────────────────────────┤
│  VIP SUMMARY │  Total clients: 312  ·  Active: 241      │
│  💎 Platinum: 12  ·  🥇 Gold: 28   │                    │
│  🥈 Silver: 67    ·  🥉 Bronze: 134│                    │
├──────────────┴──────────────────────────────────────────┤
│  ATTENTION NEEDED                                        │
│  🔴 8 clients overdue (haven't visited in 2x their      │
│     normal cycle) — [View & Message]                    │
│  🟡 14 clients approaching overdue — [View]             │
├─────────────────────────────────────────────────────────┤
│  CLIENT LIST                                            │
│                                                          │
│  [Search by name or phone]  [Filter: All VIP Tiers ▼]  │
│                                                          │
│  Priya Nair          💎 Platinum  Last: 3 days ago      │
│  Total spend: SGD 2,840  ·  23 visits  ·  Pref: Sarah   │
│  Next predicted visit: ~14 Apr                          │
│                                          [View Profile] │
│                                                          │
│  Michelle Lim        🥇 Gold      Last: 18 days ago     │
│  Total spend: SGD 1,420  ·  14 visits  ·  Pref: Wei Lin │
│  Status: 🟡 Approaching overdue                         │
│                                          [View Profile] │
│                                                          │
│  Sarah Tan           🥉 Bronze    Last: 45 days ago     │
│  Total spend: SGD 310  ·  4 visits                      │
│  Status: 🔴 Overdue — last cycle was every 3 weeks      │
│                                          [View Profile] │
└─────────────────────────────────────────────────────────┘
```

### Client 360 Profile Page

```
┌──────────────────────────────────────────────────────────┐
│  PRIYA NAIR  💎 Platinum VIP                             │
│  +65 9123 4567  ·  priya@email.com                       │
│  Birthday: 15 March  🎂 (reminder set)                   │
├──────────────────────────────────────────────────────────┤
│  LIFETIME VALUE                                          │
│  Total Spent: SGD 2,840   ·  23 Visits  ·  Since: Jan 24│
│  Avg per visit: SGD 123   ·  Visit cadence: every 14 days│
│  Predicted next visit: 22 April 2026                    │
├──────────────────────────────────────────────────────────┤
│  PREFERENCES                                             │
│  Preferred stylist: Sarah  ·  Preferred service: Colour  │
│  Usual add-ons: Toner, Deep Conditioning                 │
│  Special notes: "Sensitive scalp. Use ammonia-free dye." │
│  [Edit notes]                                            │
├──────────────────────────────────────────────────────────┤
│  VISIT HISTORY                                           │
│  09 Apr 2026  Colour Treatment + Toner  SGD 165  ✅      │
│  26 Mar 2026  Haircut & Blow Dry         SGD 80   ✅      │
│  12 Mar 2026  Keratin Treatment          SGD 220  ✅      │
│  ...                                                     │
├──────────────────────────────────────────────────────────┤
│  BOOKING SOURCE HISTORY                                  │
│  Google: 14 bookings  ·  Direct: 9 bookings             │
├──────────────────────────────────────────────────────────┤
│  ACTIONS                                                 │
│  [Send Message]  [Book for Client]  [Add Note]           │
└──────────────────────────────────────────────────────────┘
```

---

## 8. Journey G — Salon Owner Runs a Campaign

**Actor:** Salon Owner
**Entry point:** GlowOS dashboard → "Marketing" tab
**Goal:** Send a targeted campaign to a segment of clients

### Campaign Creation Flow

```
Step 1 — Choose Campaign Type
  Owner selects from templates:
  ○ Win-back campaign (clients overdue by 2+ weeks)
  ○ Birthday offer (clients with birthday this month)
  ○ Seasonal promotion (custom — all clients or filtered)
  ○ VIP appreciation (Gold and Platinum tier only)
  ○ New service announcement (all active clients)
  ○ Custom (owner writes from scratch)

Step 2 — Define Audience (auto-filtered by Campaign Composer Agent)
  For "Win-back" selection, system automatically shows:
  "24 clients match this criteria:
   Last visit was 21–60 days ago, based on their personal visit cadence"
  Owner can preview the list, remove individuals if needed

Step 3 — Message Draft (AI Agent)
  Owner clicks "Generate Message"
  Campaign Composer Agent drafts a personalised message template:
  
  "Hi {first_name}! We miss you at Luxe Hair Salon 💇‍♀️
   It's been a while since your last visit — your hair
   deserves some love! Book this week and enjoy 10% off
   your next {last_service}.
   → glowos.sg/luxe-hair-salon?promo=WINBACK10
   Valid until 30 Apr. [Unsubscribe]"
  
  Each message is personalised with the client's name and last service.
  Owner can edit the message template.
  Owner sets the promotion (optional) — a discount code or just a reminder.

Step 4 — Schedule and Send
  Owner selects:
    Send now / Schedule for [date and time]
  Preview shown: "Sending to 24 clients via WhatsApp"
  Owner confirms

Step 5 — Results Tracking
  Campaign dashboard shows:
  - Sent: 24
  - Delivered: 23
  - Clicked booking link: 11 (47%)
  - Converted to booking: 7 (29%)
  - Revenue attributed: SGD 840
```

---

# PART 2 — TECHNICAL BUILD SPECIFICATION

---

## 9. System Architecture Overview

GlowOS is a multi-tenant SaaS platform. Every merchant (salon) has their own isolated data partition, but shares the same application infrastructure.

### High-Level Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                        CLIENTS (BROWSERS / MOBILE)             │
│     glowos.sg (marketing)  ·  app.glowos.sg (salon dashboard)  │
│     glowos.sg/[slug] (booking pages)  ·  Google (Reserve)      │
└──────────────────────────┬─────────────────────────────────────┘
                           │ HTTPS
┌──────────────────────────▼─────────────────────────────────────┐
│                       LOAD BALANCER (AWS ALB)                  │
└──────────────────────────┬─────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌────────────────┐ ┌───────────────┐ ┌──────────────────┐
│   NEXT.JS APP  │ │   API SERVER  │ │  WORKER SERVICES │
│  (Frontend +   │ │  (Node.js /   │ │  (Background      │
│   SSR Booking  │ │   Express or  │ │   Jobs, Agents,  │
│   Pages)       │ │   FastAPI)    │ │   Notifications) │
└────────────────┘ └───────┬───────┘ └──────────┬───────┘
                           │                    │
         ┌─────────────────┼────────────────────┼──────┐
         ▼                 ▼                    ▼      ▼
┌──────────────┐ ┌──────────────┐ ┌──────────┐ ┌─────────────┐
│  POSTGRESQL  │ │    REDIS     │ │  S3 /    │ │  EXTERNAL   │
│  (Primary DB)│ │  (Cache +    │ │  STORAGE │ │  SERVICES   │
│              │ │   Job Queue) │ │  (Media) │ │  (Stripe,   │
│              │ │              │ │          │ │  HitPay,    │
│              │ │              │ │          │ │  Twilio,    │
│              │ │              │ │          │ │  Google,    │
│              │ │              │ │          │ │  Claude AI) │
└──────────────┘ └──────────────┘ └──────────┘ └─────────────┘
```

### Key Architectural Decisions

**Multi-tenancy approach: Row-level tenant isolation**
Every table that contains merchant-specific data has a `merchant_id` column. All queries are scoped to the authenticated merchant's `merchant_id`. This is simpler than schema-per-tenant and sufficient for the scale we need.

**Availability caching in Redis**
Slot availability is pre-computed and stored in Redis. When a booking is created or cancelled, the slot cache is updated immediately. Google's availability queries hit Redis, not PostgreSQL — this is what enables sub-1-second response times.

**Background workers for agent logic**
All AI agent logic (VIP scoring, churn detection, campaign generation) runs as background workers using Bull (Redis-based job queue). This means agent logic never blocks the main API response and can be retried if it fails.

**Event-driven notifications**
All notifications (WhatsApp, SMS, email) are dispatched via the job queue, not directly in the API request handler. This ensures API responses remain fast even if Twilio has a momentary delay.

---

## 10. Database Schema

### Core Tables

```sql
-- MERCHANTS (Salon owners / businesses)
CREATE TABLE merchants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            VARCHAR(100) UNIQUE NOT NULL,  -- "luxe-hair-salon-orchard"
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  address_line1   VARCHAR(255),
  address_line2   VARCHAR(100),
  postal_code     VARCHAR(20),
  phone           VARCHAR(30),
  email           VARCHAR(255),
  category        VARCHAR(50),  -- hair_salon, nail_studio, spa, massage, beauty_centre
  logo_url        TEXT,
  cover_photo_url TEXT,
  timezone        VARCHAR(50) DEFAULT 'Asia/Singapore',
  gbp_place_id    VARCHAR(100),  -- Google Business Profile Place ID
  stripe_account_id     VARCHAR(100),  -- Stripe Connect Express account
  hitpay_merchant_id    VARCHAR(100),
  subscription_tier     VARCHAR(20) DEFAULT 'starter',  -- starter, pro, business, chain
  subscription_status   VARCHAR(20) DEFAULT 'trial',    -- trial, active, suspended
  subscription_expires_at TIMESTAMPTZ,
  payout_frequency  VARCHAR(20) DEFAULT 'weekly',  -- daily, weekly, monthly
  google_actions_status VARCHAR(30) DEFAULT 'pending',  -- pending, submitted, approved, live
  cancellation_policy   JSONB,  -- {free_window_hours: 24, late_refund_pct: 50, noshow_refund_pct: 0}
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- MERCHANT USERS (Owner + staff accounts)
CREATE TABLE merchant_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   UUID REFERENCES merchants(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  phone         VARCHAR(30),
  password_hash VARCHAR(255),
  role          VARCHAR(20) NOT NULL,  -- owner, manager, staff
  photo_url     TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- SERVICES
CREATE TABLE services (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID REFERENCES merchants(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  description     TEXT NOT NULL,  -- required for Google Actions Center
  category        VARCHAR(50),    -- hair, nails, face, body, massage, other
  duration_minutes INTEGER NOT NULL,
  buffer_minutes  INTEGER DEFAULT 0,  -- cleanup/turnover time
  price_sgd       NUMERIC(10,2) NOT NULL CHECK (price_sgd > 0),
  is_active       BOOLEAN DEFAULT TRUE,
  display_order   INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- STAFF (Therapists / Stylists)
CREATE TABLE staff (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   UUID REFERENCES merchants(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  title         VARCHAR(100),  -- "Senior Stylist", "Therapist"
  photo_url     TEXT,
  is_active     BOOLEAN DEFAULT TRUE,
  is_any_available BOOLEAN DEFAULT FALSE,  -- the "Any Available" pseudo-staff
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- STAFF SERVICE CAPABILITIES (many-to-many)
CREATE TABLE staff_services (
  staff_id    UUID REFERENCES staff(id) ON DELETE CASCADE,
  service_id  UUID REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);

-- STAFF WORKING HOURS
CREATE TABLE staff_hours (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     UUID REFERENCES staff(id) ON DELETE CASCADE,
  day_of_week  INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sun
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  is_working   BOOLEAN DEFAULT TRUE
);

-- CLIENTS (End customers — shared across merchants with separate profiles)
CREATE TABLE clients (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        VARCHAR(30) UNIQUE NOT NULL,  -- primary identifier
  email        VARCHAR(255),
  name         VARCHAR(255),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- CLIENT PROFILES (per-merchant client data — all CRM data lives here)
CREATE TABLE client_profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   UUID REFERENCES merchants(id) ON DELETE CASCADE,
  client_id     UUID REFERENCES clients(id),
  
  -- CRM data
  notes         TEXT,
  birthday      DATE,
  preferred_staff_id UUID REFERENCES staff(id),
  
  -- VIP scoring
  vip_tier      VARCHAR(20) DEFAULT 'bronze',  -- bronze, silver, gold, platinum
  vip_score     NUMERIC(8,2) DEFAULT 0,
  rfm_recency   INTEGER,   -- days since last visit
  rfm_frequency INTEGER,   -- total visit count
  rfm_monetary  NUMERIC(10,2),  -- total lifetime spend
  
  -- Visit cadence (computed by Churn Agent)
  avg_visit_cadence_days  INTEGER,  -- avg days between visits
  last_visit_date         DATE,
  next_predicted_visit    DATE,
  churn_risk              VARCHAR(20) DEFAULT 'low',  -- low, medium, high
  
  -- Marketing
  marketing_opt_in  BOOLEAN DEFAULT TRUE,
  
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(merchant_id, client_id)
);

-- BOOKINGS
CREATE TABLE bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID REFERENCES merchants(id),
  client_id       UUID REFERENCES clients(id),
  service_id      UUID REFERENCES services(id),
  staff_id        UUID REFERENCES staff(id),
  
  -- Timing
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  
  -- Status
  status          VARCHAR(30) DEFAULT 'confirmed',
  -- confirmed, in_progress, completed, cancelled, no_show
  
  -- Payment
  price_sgd       NUMERIC(10,2) NOT NULL,
  payment_status  VARCHAR(20) DEFAULT 'pending',
  -- pending, paid, partially_refunded, refunded, waived
  payment_method  VARCHAR(30),  -- paynow, grabpay, card, cash, apple_pay, google_pay
  
  -- Commission & splits
  booking_source  VARCHAR(30) NOT NULL,
  -- google_reserve, google_gbp_link, direct_widget, walkin_manual,
  -- instagram, qr_walkin, returning_google
  commission_rate NUMERIC(5,4) DEFAULT 0,  -- 0.10 = 10%
  commission_sgd  NUMERIC(10,2) DEFAULT 0,
  merchant_payout_sgd NUMERIC(10,2),
  payout_status   VARCHAR(20) DEFAULT 'pending',  -- pending, paid
  
  -- Payment processor references
  stripe_payment_intent_id  VARCHAR(100),
  stripe_charge_id          VARCHAR(100),
  hitpay_payment_id         VARCHAR(100),
  
  -- Google Actions Center reference
  google_booking_id   VARCHAR(100),
  google_lease_id     VARCHAR(100),
  
  -- Cancellation
  cancelled_at        TIMESTAMPTZ,
  cancelled_by        VARCHAR(20),  -- client, merchant, admin
  cancellation_reason TEXT,
  refund_amount_sgd   NUMERIC(10,2) DEFAULT 0,
  stripe_refund_id    VARCHAR(100),
  
  -- Lifecycle timestamps
  checked_in_at   TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  no_show_at      TIMESTAMPTZ,
  
  -- Internal
  client_notes    TEXT,
  staff_notes     TEXT,
  
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- SLOT LEASES (temporary holds during checkout — prevents double booking)
CREATE TABLE slot_leases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID REFERENCES merchants(id),
  staff_id        UUID REFERENCES staff(id),
  service_id      UUID REFERENCES services(id),
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,  -- 5 minutes from creation
  session_token   VARCHAR(100),
  google_lease_id VARCHAR(100),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- PAYOUTS (settlement records to merchants)
CREATE TABLE payouts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     UUID REFERENCES merchants(id),
  amount_sgd      NUMERIC(10,2) NOT NULL,
  booking_ids     UUID[],  -- bookings included in this payout
  stripe_transfer_id VARCHAR(100),
  status          VARCHAR(20) DEFAULT 'pending',  -- pending, processing, paid, failed
  payout_date     DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- CAMPAIGNS
CREATE TABLE campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   UUID REFERENCES merchants(id),
  name          VARCHAR(255),
  type          VARCHAR(50),  -- winback, birthday, seasonal, vip, custom
  status        VARCHAR(20) DEFAULT 'draft',  -- draft, scheduled, sent, completed
  audience_filter JSONB,  -- {"vip_tiers": ["gold","platinum"], "overdue_days": 14}
  message_template TEXT,
  promo_code    VARCHAR(50),
  scheduled_at  TIMESTAMPTZ,
  sent_at       TIMESTAMPTZ,
  
  -- Results
  recipients_count  INTEGER DEFAULT 0,
  delivered_count   INTEGER DEFAULT 0,
  clicked_count     INTEGER DEFAULT 0,
  converted_count   INTEGER DEFAULT 0,
  revenue_attributed_sgd NUMERIC(10,2) DEFAULT 0,
  
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- CAMPAIGN MESSAGES (individual send records)
CREATE TABLE campaign_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID REFERENCES campaigns(id),
  client_id     UUID REFERENCES clients(id),
  message_body  TEXT NOT NULL,
  status        VARCHAR(20) DEFAULT 'pending',
  twilio_sid    VARCHAR(100),
  sent_at       TIMESTAMPTZ,
  delivered_at  TIMESTAMPTZ,
  clicked_at    TIMESTAMPTZ,
  converted_at  TIMESTAMPTZ,
  converted_booking_id UUID REFERENCES bookings(id)
);

-- REVIEWS
CREATE TABLE reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   UUID REFERENCES merchants(id),
  client_id     UUID REFERENCES clients(id),
  booking_id    UUID REFERENCES bookings(id),
  rating        INTEGER CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  is_alert_sent BOOLEAN DEFAULT FALSE,  -- true if owner was alerted for low rating
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- NOTIFICATIONS LOG
CREATE TABLE notification_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id   UUID REFERENCES merchants(id),
  client_id     UUID REFERENCES clients(id),
  booking_id    UUID REFERENCES bookings(id),
  type          VARCHAR(50),
  -- booking_confirmation, booking_reminder, cancellation_confirm,
  -- refund_confirm, review_request, vip_alert, campaign_message
  channel       VARCHAR(20),  -- whatsapp, sms, email
  recipient     VARCHAR(100),
  message_body  TEXT,
  status        VARCHAR(20),  -- sent, delivered, failed
  twilio_sid    VARCHAR(100),
  sent_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_bookings_merchant_date ON bookings(merchant_id, start_time);
CREATE INDEX idx_bookings_client ON bookings(client_id);
CREATE INDEX idx_bookings_staff_date ON bookings(staff_id, start_time);
CREATE INDEX idx_client_profiles_merchant ON client_profiles(merchant_id);
CREATE INDEX idx_client_profiles_vip ON client_profiles(merchant_id, vip_tier);
CREATE INDEX idx_client_profiles_churn ON client_profiles(merchant_id, churn_risk);
CREATE INDEX idx_slot_leases_expiry ON slot_leases(expires_at);
```

---

## 11. Backend API Specification

### API Structure

```
Base URL: api.glowos.sg/v1

Authentication:
  POST /auth/signup
  POST /auth/login
  POST /auth/verify-otp
  POST /auth/refresh-token
  POST /auth/logout

Merchant (Salon Owner)
  GET    /merchant/me
  PUT    /merchant/me
  POST   /merchant/onboarding/complete

Services
  GET    /merchant/services
  POST   /merchant/services
  PUT    /merchant/services/:id
  DELETE /merchant/services/:id

Staff
  GET    /merchant/staff
  POST   /merchant/staff
  PUT    /merchant/staff/:id
  DELETE /merchant/staff/:id

Bookings (Merchant View)
  GET    /merchant/bookings?date=2026-04-22&status=confirmed
  GET    /merchant/bookings/:id
  POST   /merchant/bookings           (create manual/walk-in booking)
  PUT    /merchant/bookings/:id/check-in
  PUT    /merchant/bookings/:id/complete
  PUT    /merchant/bookings/:id/no-show
  POST   /merchant/bookings/:id/refund

Clients (CRM)
  GET    /merchant/clients?tier=platinum&search=priya
  GET    /merchant/clients/:id
  PUT    /merchant/clients/:id/notes
  GET    /merchant/clients/:id/bookings

Analytics
  GET    /merchant/analytics/summary?period=30d
  GET    /merchant/analytics/revenue?from=2026-01-01&to=2026-04-01
  GET    /merchant/analytics/vip-breakdown
  GET    /merchant/analytics/staff-performance

Campaigns
  GET    /merchant/campaigns
  POST   /merchant/campaigns
  POST   /merchant/campaigns/:id/send
  GET    /merchant/campaigns/:id/results

Payouts
  GET    /merchant/payouts
  GET    /merchant/payouts/:id

Settings
  GET    /merchant/settings
  PUT    /merchant/settings/cancellation-policy
  PUT    /merchant/settings/payout-frequency

Public Booking API (used by booking pages and Google Actions Center)
  GET    /booking/:slug                          (salon info for booking page)
  GET    /booking/:slug/availability?service_id=&staff_id=&date=2026-04-22
  POST   /booking/:slug/lease                   (hold a slot for 5 min)
  DELETE /booking/:slug/lease/:lease_id         (release a slot)
  POST   /booking/:slug/confirm                 (create booking + process payment)
  GET    /booking/cancel/:booking_token         (cancellation page data)
  POST   /booking/cancel/:booking_token         (execute cancellation)

Google Actions Center API (separate base URL for Google)
  GET    /google/v1/merchants                   (merchant feed)
  GET    /google/v1/services                    (services feed)
  GET    /google/v1/availability                (real-time slot availability)
  POST   /google/v1/bookings                    (create booking from Google)
  PATCH  /google/v1/bookings/:id                (update booking)
  DELETE /google/v1/bookings/:id                (cancel booking)

Webhooks (inbound from payment processors)
  POST   /webhooks/stripe
  POST   /webhooks/hitpay

Admin API (internal use only)
  GET    /admin/merchants
  GET    /admin/merchants/:id
  POST   /admin/bookings/:id/force-refund
  GET    /admin/platform-analytics
```

### Key API Logic: Availability Endpoint

This is the most performance-critical endpoint. Google calls it every time a user interacts with the booking flow.

```javascript
// GET /booking/:slug/availability?service_id=&staff_id=&date=2026-04-22
// Must respond in < 1 second

async function getAvailability(req, res) {
  const { slug, service_id, staff_id, date } = req.query;
  
  // 1. Check Redis cache first
  const cacheKey = `avail:${slug}:${service_id}:${staff_id}:${date}`;
  const cached = await redis.get(cacheKey);
  if (cached) return res.json(JSON.parse(cached));
  
  // 2. Load service duration and buffer
  const service = await db.services.findOne({ id: service_id });
  const totalDuration = service.duration_minutes + service.buffer_minutes;
  
  // 3. Load staff working hours for the day
  const staffList = staff_id === 'any'
    ? await db.staff.findAll({ merchant_slug: slug, is_active: true })
    : [await db.staff.findOne({ id: staff_id })];
    
  // 4. For each staff member, compute free slots
  const availableSlots = [];
  
  for (const staffMember of staffList) {
    const workingHours = await getWorkingHours(staffMember.id, date);
    if (!workingHours.is_working) continue;
    
    // 5. Load existing bookings and active leases for this staff on this date
    const existingBookings = await db.bookings.findAll({
      staff_id: staffMember.id,
      date: date,
      status: ['confirmed', 'in_progress']
    });
    
    const activeLeases = await db.slot_leases.findAll({
      staff_id: staffMember.id,
      start_time: { gte: startOfDay(date), lte: endOfDay(date) },
      expires_at: { gte: new Date() }  // only non-expired leases
    });
    
    // 6. Generate candidate slots (every 30 min within working hours)
    const slots = generateSlots(
      workingHours.start_time,
      workingHours.end_time,
      totalDuration,
      30  // slot interval in minutes
    );
    
    // 7. Filter out slots that overlap with existing bookings or leases
    const freeSlots = slots.filter(slot =>
      !overlapsWithBookings(slot, totalDuration, existingBookings) &&
      !overlapsWithLeases(slot, totalDuration, activeLeases)
    );
    
    availableSlots.push(...freeSlots.map(slot => ({
      start_time: slot,
      end_time: addMinutes(slot, totalDuration),
      staff_id: staffMember.id,
      staff_name: staffMember.name
    })));
  }
  
  // 8. Cache for 30 seconds (short TTL — availability changes frequently)
  await redis.setex(cacheKey, 30, JSON.stringify(availableSlots));
  
  return res.json({ slots: availableSlots });
}
```

---

## 12. Payment Integration — Stripe Connect + HitPay

### Stripe Connect Architecture

GlowOS uses **Stripe Connect Express** — the marketplace model where GlowOS is the platform account and each salon is a connected Express account.

```
SETUP (once per merchant, at onboarding):
  1. GlowOS creates a Stripe Connect Express account for the merchant
  2. Merchant completes KYC via Stripe's hosted onboarding
  3. GlowOS stores the merchant's stripe_account_id

PAYMENT FLOW (per booking):
  1. Client pays via Stripe Checkout / Stripe.js on the booking page
  2. Payment Intent created with application_fee_amount set to commission
     Example: booking = SGD 120, commission = SGD 12 (10%)
     → charge: SGD 120
     → application_fee_amount: 1200 (in cents)
     → transfer_data: { destination: merchant.stripe_account_id }
  3. Stripe charges client, takes the application_fee for GlowOS,
     and transfers the remainder to the merchant's Stripe account
  4. Merchant's payout from Stripe to their bank account on configured schedule
```

```javascript
// Create Payment Intent for a booking
async function createPaymentIntent(booking, merchant) {
  const amountCents = Math.round(booking.price_sgd * 100);
  const commissionCents = Math.round(amountCents * booking.commission_rate);
  
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'sgd',
    application_fee_amount: commissionCents,
    transfer_data: {
      destination: merchant.stripe_account_id,
    },
    payment_method_types: ['card', 'paynow'],
    metadata: {
      booking_id: booking.id,
      merchant_id: merchant.id,
      booking_source: booking.booking_source,
    }
  });
  
  return paymentIntent;
}

// Handle Stripe webhook — payment succeeded
async function handlePaymentSuccess(event) {
  const paymentIntent = event.data.object;
  const bookingId = paymentIntent.metadata.booking_id;
  
  await db.bookings.update(bookingId, {
    payment_status: 'paid',
    stripe_payment_intent_id: paymentIntent.id,
    stripe_charge_id: paymentIntent.latest_charge,
    commission_sgd: paymentIntent.application_fee_amount / 100,
    merchant_payout_sgd: (paymentIntent.amount - paymentIntent.application_fee_amount) / 100,
    status: 'confirmed'
  });
  
  // Invalidate availability cache
  await invalidateAvailabilityCache(bookingId);
  
  // Push RTU to Google if Google booking
  if (paymentIntent.metadata.booking_source === 'google_reserve') {
    await pushRealTimeUpdate(bookingId, 'BOOKING_CONFIRMED');
  }
  
  // Queue notifications
  await notificationQueue.add('booking_confirmation', { booking_id: bookingId });
  
  // Update client CRM profile
  await crmQueue.add('update_client_profile', { booking_id: bookingId });
  
  // Schedule reminder
  await scheduleReminder(bookingId);
}
```

### Refund Logic

```javascript
async function processRefund(bookingId, refundType) {
  // refundType: 'full' | 'partial' | 'none'
  
  const booking = await db.bookings.findOne(bookingId);
  if (booking.payment_method === 'cash') {
    // Cash refund — manual process, just update status
    await db.bookings.update(bookingId, { 
      status: 'cancelled', 
      payment_status: 'waived',
      cancelled_at: new Date() 
    });
    return;
  }
  
  let refundAmountCents = 0;
  if (refundType === 'full') refundAmountCents = Math.round(booking.price_sgd * 100);
  if (refundType === 'partial') refundAmountCents = Math.round(booking.price_sgd * 50); // 50%
  
  if (refundAmountCents > 0) {
    const refund = await stripe.refunds.create({
      charge: booking.stripe_charge_id,
      amount: refundAmountCents,
      // Note: refund_application_fee is false by default
      // Commission is only reversed if it's a full refund
      refund_application_fee: refundType === 'full',
      reverse_transfer: refundType === 'full',
    });
    
    await db.bookings.update(bookingId, {
      status: 'cancelled',
      payment_status: refundType === 'full' ? 'refunded' : 'partially_refunded',
      refund_amount_sgd: refundAmountCents / 100,
      stripe_refund_id: refund.id,
      commission_sgd: refundType === 'full' ? 0 : booking.commission_sgd,
      cancelled_at: new Date()
    });
  }
  
  // Free the slot
  await invalidateAvailabilityCache(bookingId);
  await pushRealTimeUpdate(bookingId, 'BOOKING_CANCELLED');
  
  // Notify client and salon
  await notificationQueue.add('cancellation_notification', { booking_id: bookingId });
}
```

---

## 13. Google Actions Center Integration

### Integration Overview

GlowOS must implement three feeds and one booking API to become a certified Google Reserve partner.

```
WHAT GOOGLE NEEDS FROM US:

1. Merchant Feed (push, updated daily or on change)
   → Which salons are on our platform and where they are

2. Services Feed (push, updated on any service change)
   → What services each salon offers, with pricing and descriptions

3. Availability API (pull, real-time, < 1 second response)
   → Google asks: "What slots are available at Luxe Salon on 22 Apr for Haircut?"
   → We respond with available times

4. Booking API (push from Google to us, real-time)
   → Google tells us: "Client booked slot at 2pm on 22 Apr"
   → We confirm the booking and return a booking ID
```

### Merchant Feed Format

```json
{
  "merchant": {
    "merchant_id": "luxe-hair-salon-orchard",
    "name": "Luxe Hair Salon",
    "telephone": "+6562221234",
    "url": "https://glowos.sg/luxe-hair-salon-orchard",
    "geo": {
      "latitude": 1.3048,
      "longitude": 103.8318,
      "address": {
        "country": "SG",
        "locality": "Singapore",
        "region": "Singapore",
        "postal_code": "238859",
        "street_address": "391B Orchard Road #14-04"
      }
    },
    "category": "Beauty Salon",
    "payment_option": [
      { "payment_option_type": "PAYMENT_OPTION_ONLINE" }
    ]
  }
}
```

### Services Feed Format

```json
{
  "services": [{
    "service_id": "service-uuid-haircut",
    "merchant_id": "luxe-hair-salon-orchard",
    "name": "Haircut & Blow Dry",
    "description": "Precision haircut with blow dry and style finish. Suitable for all hair types.",
    "price": {
      "currency_code": "SGD",
      "units": 80,
      "nanos": 0
    },
    "duration_sec": 3600,
    "scheduling_rules": {
      "min_advance_booking_sec": 3600,
      "max_advance_booking_sec": 2592000
    }
  }]
}
```

### Availability API Response

```javascript
// Google calls: GET /google/v1/availability
// Request body includes: merchant_id, service_id, start_time_range, end_time_range

async function handleGoogleAvailabilityRequest(req, res) {
  const { merchant_id, service_id, start_time_min, start_time_max } = req.body;
  
  // Must respond in < 1 second — use Redis cache
  const slots = await getAvailabilityCached(merchant_id, service_id, 
                                            start_time_min, start_time_max);
  
  const response = {
    slots: slots.map(slot => ({
      merchant_id,
      service_id,
      start_sec: Math.floor(new Date(slot.start_time).getTime() / 1000),
      duration_sec: slot.duration_seconds,
      availability_tag: slot.staff_id,  // used to identify which staff
      spots_total: 1,
      spots_open: 1
    }))
  };
  
  return res.json(response);
}
```

### Booking Creation from Google

```javascript
// Google calls: POST /google/v1/bookings
async function handleGoogleBookingCreate(req, res) {
  const { merchant_id, service_id, slot, user_information, payment_info } = req.body;
  
  // 1. Verify the slot is still available (double-check against DB)
  const isAvailable = await verifySlotAvailable(
    merchant_id, service_id, slot.start_sec, slot.availability_tag
  );
  
  if (!isAvailable) {
    return res.status(409).json({
      booking_failure: { cause: 'SLOT_UNAVAILABLE' }
    });
  }
  
  // 2. Create or find client
  const client = await findOrCreateClient({
    phone: user_information.telephone,
    name: user_information.given_name + ' ' + user_information.family_name,
    email: user_information.email
  });
  
  // 3. Create booking in our DB
  const booking = await db.bookings.create({
    merchant_id,
    client_id: client.id,
    service_id,
    staff_id: slot.availability_tag,
    start_time: new Date(slot.start_sec * 1000),
    booking_source: 'google_reserve',
    commission_rate: 0.10,
    google_booking_id: req.body.booking_id,
    // Payment handled by Google — different flow
    payment_status: 'paid',
    price_sgd: service.price_sgd,
    commission_sgd: service.price_sgd * 0.10,
    merchant_payout_sgd: service.price_sgd * 0.90
  });
  
  // 4. Invalidate availability cache
  await invalidateAvailabilityCache(booking.id);
  
  // 5. Queue notifications
  await notificationQueue.add('booking_confirmation', { booking_id: booking.id });
  
  // 6. Return confirmation to Google
  return res.json({
    booking_id: booking.id,
    booking_status: { status: 'CONFIRMED' },
    user_payment_option: payment_info
  });
}
```

### Real-Time Updates (RTU) to Google

Whenever a slot changes (booking created, cancelled, no-show), GlowOS must notify Google immediately so their availability display stays accurate.

```javascript
async function pushRealTimeUpdate(bookingId, eventType) {
  const booking = await db.bookings.findOne(bookingId);
  
  const rtuPayload = {
    merchant_id: booking.merchant_id,
    service_id: booking.service_id,
    slots: [{
      start_sec: Math.floor(booking.start_time.getTime() / 1000),
      duration_sec: booking.duration_minutes * 60,
      availability_tag: booking.staff_id,
      spots_total: 1,
      spots_open: eventType === 'BOOKING_CANCELLED' ? 1 : 0
    }]
  };
  
  await googleActionsCenter.pushAvailabilityUpdate(rtuPayload);
  
  // Also invalidate our local cache
  await redis.del(`avail:*:${booking.merchant_id}:*`);
}
```

---

## 14. Notification System

### Notification Types and Triggers

| Notification | Trigger | Recipient | Channel | Timing |
|---|---|---|---|---|
| Booking confirmation | Payment webhook received | Client | WhatsApp + SMS | Immediate |
| New booking alert | Payment webhook received | Salon staff | WhatsApp | Immediate |
| Appointment reminder | Scheduled job | Client | WhatsApp | 24h before |
| Cancellation confirmation | Booking cancelled | Client | WhatsApp | Immediate |
| Cancellation alert | Booking cancelled | Salon | WhatsApp | Immediate |
| Refund confirmation | Refund processed | Client | WhatsApp | Immediate |
| Review request | Booking completed | Client | WhatsApp | 30 min after |
| VIP arrival alert | VIP booking today | Salon staff | WhatsApp | 1h before |
| Churn re-engagement | Overdue client detected | Client | WhatsApp | Configurable |
| No-show re-engagement | No-show marked | Client | WhatsApp | 24h after |
| Campaign message | Campaign sent | Client | WhatsApp | Scheduled |

### Twilio WhatsApp Business API Setup

```javascript
// Send a WhatsApp message via Twilio
async function sendWhatsApp(to, templateSid, variables) {
  const message = await twilio.messages.create({
    from: 'whatsapp:+6531591234',  // GlowOS Singapore WhatsApp Business number
    to: `whatsapp:${to}`,
    contentSid: templateSid,  // Pre-approved Twilio content template
    contentVariables: JSON.stringify(variables)
  });
  
  return message.sid;
}

// Example: booking confirmation template
await sendWhatsApp(client.phone, 'HX...booking_confirmation', {
  "1": client.name,            // Hi {1}!
  "2": merchant.name,          // Your booking at {2} is confirmed
  "3": "Haircut & Blow Dry",   // Service: {3}
  "4": "Wed 23 Apr at 2:00 PM",// Date: {4}
  "5": "Wei Lin",              // With: {5}
  "6": "SGD 80",               // Amount paid: {6}
  "7": cancelUrl               // Cancel: {7}
});
```

### Notification Job Queue (Bull + Redis)

```javascript
// Worker processes notification jobs asynchronously
notificationWorker.process('booking_confirmation', async (job) => {
  const { booking_id } = job.data;
  const booking = await db.bookings.findOne(booking_id, { 
    include: ['client', 'merchant', 'service', 'staff'] 
  });
  
  // Send to client
  const clientMsgSid = await sendWhatsApp(
    booking.client.phone,
    TEMPLATES.BOOKING_CONFIRMATION_CLIENT,
    buildClientConfirmationVariables(booking)
  );
  
  // Send to merchant/staff
  const merchantMsgSid = await sendWhatsApp(
    booking.merchant.phone,
    TEMPLATES.BOOKING_CONFIRMATION_MERCHANT,
    buildMerchantAlertVariables(booking)
  );
  
  // Log both
  await db.notification_log.create([
    { booking_id, type: 'booking_confirmation', channel: 'whatsapp', 
      recipient: booking.client.phone, twilio_sid: clientMsgSid },
    { booking_id, type: 'booking_alert_merchant', channel: 'whatsapp',
      recipient: booking.merchant.phone, twilio_sid: merchantMsgSid }
  ]);
});

// Schedule reminders at booking creation time
async function scheduleReminder(bookingId) {
  const booking = await db.bookings.findOne(bookingId);
  const reminderTime = new Date(booking.start_time.getTime() - 24 * 60 * 60 * 1000);
  
  await notificationQueue.add(
    'appointment_reminder',
    { booking_id: bookingId },
    { delay: reminderTime - Date.now(), attempts: 3, backoff: 5000 }
  );
}
```

---

## 15. AI Agent Architecture

All AI agents use the Anthropic Claude API. Each agent is a background worker triggered by specific events or on a schedule.

### Agent 1 — VIP Scoring Agent

```
Trigger: After every completed booking (via job queue)
Also runs: Full rescore daily at 2am for all merchants

Logic:
  1. Load all bookings for the client at this merchant
  2. Compute RFM scores:
     - Recency: days since last visit (lower = better)
     - Frequency: total visit count
     - Monetary: total spend + average per visit
  3. Normalise each score to 1–5 scale relative to all clients at this merchant
  4. Compute composite VIP score: weighted sum (R=0.3, F=0.35, M=0.35)
  5. Assign tier: Platinum (>4.2), Gold (>3.5), Silver (>2.5), Bronze (rest)
  6. Update client_profiles table
```

```javascript
async function runVipScoring(merchantId, clientId) {
  const bookings = await db.bookings.findAll({
    merchant_id: merchantId,
    client_id: clientId,
    status: 'completed',
    payment_status: 'paid'
  });
  
  if (bookings.length === 0) return;
  
  const lastVisit = bookings[0].start_time;
  const recencyDays = Math.floor((Date.now() - lastVisit) / (1000 * 60 * 60 * 24));
  const frequency = bookings.length;
  const monetary = bookings.reduce((sum, b) => sum + parseFloat(b.price_sgd), 0);
  const avgPerVisit = monetary / frequency;
  const avgCadence = computeAverageCadenceDays(bookings);
  
  // Normalise against all clients at this merchant
  const allProfiles = await db.client_profiles.findAll({ merchant_id: merchantId });
  const recencyScore = normalise(recencyDays, allProfiles.map(p => p.rfm_recency), true);
  const frequencyScore = normalise(frequency, allProfiles.map(p => p.rfm_frequency), false);
  const monetaryScore = normalise(monetary, allProfiles.map(p => p.rfm_monetary), false);
  
  const vipScore = (recencyScore * 0.3) + (frequencyScore * 0.35) + (monetaryScore * 0.35);
  const tier = vipScore >= 4.2 ? 'platinum'
             : vipScore >= 3.5 ? 'gold'
             : vipScore >= 2.5 ? 'silver'
             : 'bronze';
  
  await db.client_profiles.update(
    { merchant_id: merchantId, client_id: clientId },
    {
      vip_tier: tier,
      vip_score: vipScore,
      rfm_recency: recencyDays,
      rfm_frequency: frequency,
      rfm_monetary: monetary,
      avg_visit_cadence_days: avgCadence,
      last_visit_date: lastVisit,
      next_predicted_visit: addDays(lastVisit, avgCadence)
    }
  );
}
```

### Agent 3 — Churn Prevention Agent

```
Trigger: Daily cron job at 9am Singapore time
Logic:
  1. Load all client profiles for all merchants
  2. For each profile, check: days since last visit vs avg cadence
  3. If overdue ratio > 1.5x cadence → churn_risk = 'high', queue re-engagement
  4. If overdue ratio > 1.2x → churn_risk = 'medium', alert owner
  5. Generate personalised re-engagement message using Claude API
```

```javascript
async function runChurnDetection() {
  const overdueProfiles = await db.client_profiles.findAll({
    where: db.raw(`
      last_visit_date < NOW() - (avg_visit_cadence_days * 1.5 || ' days')::interval
      AND avg_visit_cadence_days IS NOT NULL
      AND churn_risk != 'high'
    `)
  });
  
  for (const profile of overdueProfiles) {
    // Update churn risk
    await db.client_profiles.update(profile.id, { churn_risk: 'high' });
    
    // Generate personalised message via Claude
    const client = await db.clients.findOne(profile.client_id);
    const lastBooking = await db.bookings.findLast({
      merchant_id: profile.merchant_id,
      client_id: profile.client_id
    });
    const merchant = await db.merchants.findOne(profile.merchant_id);
    
    const message = await generateReengagementMessage({
      clientName: client.name,
      merchantName: merchant.name,
      lastService: lastBooking.service.name,
      daysSinceVisit: profile.rfm_recency,
      bookingUrl: `glowos.sg/${merchant.slug}`
    });
    
    // Queue the message for owner approval or auto-send (based on merchant settings)
    await churnQueue.add('send_reengagement', {
      merchant_id: profile.merchant_id,
      client_id: profile.client_id,
      message: message
    });
  }
}

async function generateReengagementMessage(data) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `Generate a warm, friendly WhatsApp re-engagement message for a beauty salon client.
      
      Client name: ${data.clientName}
      Salon name: ${data.merchantName}
      Last service: ${data.lastService}
      Days since last visit: ${data.daysSinceVisit}
      Booking URL: ${data.bookingUrl}
      
      Requirements:
      - Under 160 characters
      - Warm and personal, not salesy
      - Include their first name
      - Reference their last service
      - Include the booking link
      - End with an unsubscribe note: "(Reply STOP to unsubscribe)"
      
      Return only the message text, nothing else.`
    }]
  });
  
  return response.content[0].text;
}
```

### Agent 5 — Business Insights Agent

```javascript
// Conversational analytics — owner asks a question, Claude queries and answers
async function answerInsightQuery(merchantId, question) {
  // Load relevant aggregate data from DB
  const context = await loadMerchantContext(merchantId);
  
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: `You are a business analytics assistant for a beauty salon.
    You have access to the following salon data for ${context.merchant.name}:
    
    Period: Last 90 days
    Total bookings: ${context.totalBookings}
    Total revenue: SGD ${context.totalRevenue}
    Active clients: ${context.activeClients}
    
    Top services by revenue:
    ${context.topServices.map(s => `- ${s.name}: SGD ${s.revenue} (${s.count} bookings)`).join('\n')}
    
    Top clients by spend:
    ${context.topClients.map(c => `- ${c.name}: SGD ${c.spend} (${c.visits} visits, ${c.tier} tier)`).join('\n')}
    
    Staff performance:
    ${context.staffPerformance.map(s => `- ${s.name}: SGD ${s.revenue}, ${s.bookings} bookings, ${s.retentionRate}% retention`).join('\n')}
    
    Answer the owner's question clearly, concisely, and in plain English.
    If the answer involves numbers, highlight the most important figure first.
    Keep responses under 3 sentences unless a list is more appropriate.`,
    
    messages: [{ role: 'user', content: question }]
  });
  
  return response.content[0].text;
}
```

---

## 16. Frontend Application Structure

### Repository Structure

```
glowos/
├── apps/
│   ├── web/                    # Next.js — marketing site + booking pages
│   │   ├── app/
│   │   │   ├── page.tsx        # glowos.sg — marketing homepage
│   │   │   ├── signup/         # glowos.sg/signup
│   │   │   ├── [slug]/         # glowos.sg/[salon-slug] — public booking pages
│   │   │   │   ├── page.tsx    # Booking page (SSR for SEO)
│   │   │   │   └── confirm/    # Post-booking confirmation
│   │   │   └── cancel/
│   │   │       └── [token]/    # Cancellation page
│   │
│   └── dashboard/              # Next.js — salon owner dashboard
│       ├── app/
│       │   ├── dashboard/      # app.glowos.sg/dashboard
│       │   ├── bookings/       # Calendar + today view
│       │   ├── clients/        # CRM + VIP view
│       │   ├── analytics/      # Revenue + performance
│       │   ├── marketing/      # Campaigns
│       │   ├── settings/       # Salon settings
│       │   └── onboarding/     # 5-step onboarding wizard
│
├── packages/
│   ├── api-client/             # Shared typed API client (auto-generated from OpenAPI)
│   ├── ui/                     # Shared component library
│   └── types/                  # Shared TypeScript types
│
├── services/
│   ├── api/                    # Node.js / Express API server
│   │   ├── routes/
│   │   ├── middleware/
│   │   ├── workers/            # Bull job workers
│   │   └── agents/             # AI agent logic
│   └── google-actions/         # Separate service for Google Actions Center API
│
└── infrastructure/
    ├── terraform/              # AWS infrastructure as code
    └── docker/                 # Docker configs
```

### Key Frontend Pages

**Public Booking Page (`/[slug]`)**
- Server-side rendered for SEO and performance
- Hydrates to interactive React app for booking flow
- State managed locally (no Redux needed — wizard-style single-page flow)
- Stripe.js and HitPay.js embedded for payment

**Dashboard — Today View (`/dashboard`)**
- Real-time updates via WebSocket or Supabase Realtime
- Booking cards with status indicators
- VIP badge shown prominently for Gold/Platinum clients
- Quick actions: Check In, Complete, No-Show

**Client Profile (`/clients/[id]`)**
- Full 360 view of client
- Visit history timeline
- VIP score visualisation
- Direct message button

**Onboarding Wizard (`/onboarding`)**
- 5-step wizard with progress indicator
- Each step auto-saves to backend
- Can abandon and resume
- Step 7 shows "Go Live" checklist

---

## 17. Webhook Processing Pipeline

### Stripe Webhook Handler

```javascript
// POST /webhooks/stripe
// Stripe sends events here for every payment action

app.post('/webhooks/stripe', 
  express.raw({ type: 'application/json' }),  // raw body for signature verification
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    
    try {
      event = stripe.webhooks.constructEvent(
        req.body, sig, process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // Respond to Stripe immediately (< 5 seconds required)
    res.json({ received: true });
    
    // Process asynchronously via job queue
    await webhookQueue.add(event.type, { event });
  }
);

// Worker processes webhook events
webhookWorker.process('payment_intent.succeeded', async (job) => {
  await handlePaymentSuccess(job.data.event.data.object);
});

webhookWorker.process('charge.refunded', async (job) => {
  await handleRefundCompleted(job.data.event.data.object);
});

webhookWorker.process('payment_intent.payment_failed', async (job) => {
  await handlePaymentFailed(job.data.event.data.object);
});
```

### Full Event Flow Diagram

```
CLIENT PAYS
    │
    ▼
Stripe processes payment
    │
    ▼
Stripe fires: payment_intent.succeeded webhook → POST /webhooks/stripe
    │
    ▼ (respond 200 immediately, then process async)
webhookQueue.add('payment_intent.succeeded')
    │
    ▼
Worker picks up job:
    ├── 1. Update booking.payment_status = 'paid'
    ├── 2. Update booking.status = 'confirmed'
    ├── 3. Compute commission_sgd and merchant_payout_sgd
    ├── 4. Invalidate Redis availability cache for this slot
    ├── 5. Push RTU to Google Actions Center (if google booking)
    ├── 6. notificationQueue.add('booking_confirmation')
    ├── 7. crmQueue.add('update_client_profile')
    ├── 8. vipQueue.add('rescore_client')
    └── 9. scheduleQueue.add('appointment_reminder', { delay: 24h })

Parallel workers handle:
    notification worker → sends WhatsApp to client + merchant
    crm worker → creates/updates client_profiles record
    vip worker → recomputes VIP score for this client
```

---

## 18. Authentication & Multi-Tenancy

### Authentication Strategy

**Merchant Users (Dashboard Access)**
- JWT-based authentication
- Access token: 15-minute expiry
- Refresh token: 30-day expiry, stored in HTTP-only cookie
- All API routes protected by `authenticateMerchant` middleware
- Middleware extracts `merchant_id` from JWT and attaches to `req`

**End Clients (Booking Page)**
- No account required to book
- Identified by mobile phone number + OTP verification for returning clients
- Booking confirmation uses a signed token (not JWT) for cancellation links
- Token format: `HMAC(booking_id + secret)` — no database lookup needed to validate

**Tenant Isolation**

```javascript
// Every merchant API route uses this middleware
function requireMerchant(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const payload = verifyJWT(token);
  
  req.merchantId = payload.merchant_id;
  req.userId = payload.user_id;
  req.userRole = payload.role;
  
  next();
}

// All DB queries automatically scoped to merchant
// Example: listing clients
app.get('/merchant/clients', requireMerchant, async (req, res) => {
  const clients = await db.client_profiles.findAll({
    where: { merchant_id: req.merchantId },  // ALWAYS include this
    // ...
  });
  res.json(clients);
});
```

### Role-Based Access Control

```javascript
const PERMISSIONS = {
  owner: ['*'],  // all permissions
  manager: ['bookings.*', 'clients.read', 'clients.notes', 'analytics.read'],
  staff: ['bookings.read_own', 'bookings.checkin', 'bookings.complete', 
          'bookings.noshow', 'bookings.create_walkin']
};

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Example: only owners can view analytics
app.get('/merchant/analytics/*', requireMerchant, requireRole('owner', 'manager'), handler);
```

---

## 19. Infrastructure & Deployment

### AWS Architecture (Singapore Region — ap-southeast-1)

```
┌────────────────────────────────────────────────────────────────┐
│                         AWS ap-southeast-1                     │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                      VPC                                │  │
│  │                                                         │  │
│  │  ┌──────────────┐    ┌──────────────┐                  │  │
│  │  │ Public Subnet│    │Private Subnet│                  │  │
│  │  │              │    │              │                  │  │
│  │  │  ALB (HTTPS) │    │  ECS Tasks   │                  │  │
│  │  │  CloudFront  │    │  (API + Web) │                  │  │
│  │  │              │    │              │                  │  │
│  │  └──────────────┘    │  Worker ECS  │                  │  │
│  │                      │  Tasks       │                  │  │
│  │                      │              │                  │  │
│  │                      │  RDS Postgres│                  │  │
│  │                      │  (Multi-AZ)  │                  │  │
│  │                      │              │                  │  │
│  │                      │  ElastiCache │                  │  │
│  │                      │  Redis       │                  │  │
│  │                      │              │                  │  │
│  │                      │  S3 (media)  │                  │  │
│  │                      └──────────────┘                  │  │
│  └─────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### Services

| Component | Service | Spec (Starting) |
|---|---|---|
| Web + Dashboard | AWS ECS Fargate | 0.5 vCPU, 1GB RAM (auto-scales) |
| API Server | AWS ECS Fargate | 1 vCPU, 2GB RAM (auto-scales) |
| Worker Service | AWS ECS Fargate | 0.5 vCPU, 1GB RAM |
| Database | AWS RDS PostgreSQL 16 | db.t3.medium, Multi-AZ |
| Cache / Queue | AWS ElastiCache Redis | cache.t3.micro |
| Media Storage | AWS S3 | Standard, SG region |
| CDN | AWS CloudFront | Edge distribution |
| DNS | AWS Route53 | glowos.sg |
| SSL | AWS ACM | Auto-renew |
| Logs | AWS CloudWatch | 30-day retention |
| Secrets | AWS Secrets Manager | API keys, DB passwords |

### CI/CD Pipeline

```
Developer pushes to main branch
        ↓
GitHub Actions triggered:
  1. Run test suite
  2. Build Docker images
  3. Push to AWS ECR
  4. Deploy to ECS (rolling update — zero downtime)
  5. Run database migrations (via migration job container)
  6. Smoke tests against staging
  7. Slack notification: deployment complete
```

### Environment Configuration

```
Environments: development → staging → production

Staging: staging.glowos.sg (auto-deployed on every main branch push)
Production: glowos.sg (manual approval trigger)

All secrets in AWS Secrets Manager:
  - DATABASE_URL
  - REDIS_URL
  - STRIPE_SECRET_KEY
  - STRIPE_WEBHOOK_SECRET
  - HITPAY_API_KEY
  - TWILIO_ACCOUNT_SID
  - TWILIO_AUTH_TOKEN
  - ANTHROPIC_API_KEY
  - GOOGLE_ACTIONS_CENTER_KEY
  - JWT_SECRET
```

---

## 20. Development Phases & Task Breakdown

### Phase 1 — MVP (Months 1–4)
**Milestone: 20 salons live, bookable from Google via Tier 1/2**

```
Sprint 1–2 (Weeks 1–4): Foundation
  BE: Database schema setup and migrations
  BE: Authentication (signup, login, OTP, JWT)
  BE: Merchant onboarding API (5 steps)
  BE: Services CRUD API
  BE: Staff CRUD API
  FE: Marketing site (glowos.sg)
  FE: Signup and onboarding wizard (5 steps)
  FE: Dashboard shell with navigation

Sprint 3–4 (Weeks 5–8): Booking Engine
  BE: Availability computation + Redis caching
  BE: Slot lease API (5-minute holds)
  BE: Public booking confirmation API
  BE: Booking management API (create, list, get)
  FE: Public booking page (glowos.sg/[slug])
  FE: Service selection → staff → date/time → checkout flow
  FE: Mobile-responsive booking page

Sprint 5–6 (Weeks 9–12): Payments
  BE: Stripe Connect integration (merchant onboarding + payment intents)
  BE: HitPay integration (PayNow, GrabPay)
  BE: Stripe webhook handler + event queue
  BE: Automatic commission split logic
  BE: Refund processing (full + partial)
  FE: Payment UI (Stripe Elements + PayNow QR)
  FE: Booking confirmation page
  FE: Cancellation page

Sprint 7–8 (Weeks 13–16): Operations + Notifications
  BE: Dashboard APIs (today's bookings, check-in, complete, no-show)
  BE: Walk-in booking creation
  BE: Twilio WhatsApp integration
  BE: All notification types + job queue
  BE: Reminder scheduling
  FE: Dashboard — today's bookings view
  FE: Salon settings (cancellation policy, payout config)
  INFRA: AWS setup, CI/CD pipeline, staging environment

Phase 1 Milestone: First 5 pilot salons onboarded and live
```

```
Phase 2 — VIP Intelligence (Months 4–8)
  BE: VIP Scoring Agent (RFM algorithm + Claude API)
  BE: Churn Detection Agent (cadence monitoring + re-engagement)
  BE: Client profiles API (360 view, notes, visit history)
  BE: Staff performance analytics API
  BE: Google Actions Center API integration (Merchant + Services feeds)
  BE: Availability API for Google (sub-1s, Redis-backed)
  BE: Booking creation API for Google
  BE: Real-Time Updates (RTU) to Google
  FE: Clients list page with VIP tiers and filters
  FE: Client 360 profile page
  FE: VIP arrival alert on dashboard
  FE: Staff performance view
  GOOGLE: Submit Actions Center application + complete integration build

Phase 2 Milestone: Google partner approval, Reserve button live
```

```
Phase 3 — Marketing Automation (Months 8–14)
  BE: Campaign Composer Agent (Claude API + audience filter)
  BE: Campaign scheduling and delivery
  BE: Campaign results tracking (click + conversion)
  BE: Review collection and alert system
  BE: Package / voucher system
  BE: Business Insights Agent (conversational Claude API)
  FE: Marketing / campaigns page
  FE: Review management dashboard
  FE: Business insights chat interface
  FE: Package management UI

Phase 3 Milestone: Full AI agent suite live, Business tier launched
```

### Priority Order for Single Engineer Starting Alone

If starting with one developer, build in this exact order — each step unlocks real usability:

1. Database + auth + merchant onboarding
2. Booking page (public-facing) + availability API
3. Stripe payment processing + webhook
4. Notifications (WhatsApp confirmation)
5. Salon dashboard (today view + check-in)
6. Cancellation + refund flow
7. VIP scoring + client list
8. Google Actions Center API
9. Campaign tools + AI agents

---

## Appendix — Key Environment Variables

```bash
# Application
NODE_ENV=production
APP_URL=https://api.glowos.sg
FRONTEND_URL=https://glowos.sg
DASHBOARD_URL=https://app.glowos.sg

# Database
DATABASE_URL=postgresql://user:pass@rds-host:5432/glowos

# Cache / Queue
REDIS_URL=redis://elasticache-host:6379

# Payments
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
HITPAY_API_KEY=...
HITPAY_SALT=...

# Notifications
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=+6531591234

# AI
ANTHROPIC_API_KEY=sk-ant-...

# Google
GOOGLE_ACTIONS_CENTER_PARTNER_ID=...
GOOGLE_ACTIONS_CENTER_API_KEY=...
GOOGLE_SERVICE_ACCOUNT_JSON=...

# Security
JWT_SECRET=...
JWT_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=30d
BOOKING_TOKEN_SECRET=...  # for cancellation link signing
```

---

*Document prepared April 2026 — GlowOS Pte Ltd (Proposed)*
*For internal engineering use only. Do not distribute.*

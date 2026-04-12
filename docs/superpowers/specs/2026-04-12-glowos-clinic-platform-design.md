# GlowOS Clinic Platform — Product Design Spec
**Date:** 2026-04-12
**Author:** Elowen (Requirements Analyst) via GlowOS founding session
**Status:** Approved by founder — ready for implementation planning

---

## Overview

GlowOS is expanding from a generic booking CRM into a full **Clinic Operating System** targeting dermatologist and beauty clinic chains across APAC. This spec captures the 9 product modules derived from the founder's ideas, plus CRM migration strategy and team structure guidance.

---

## Executive Summary

The 9 modules cluster into 4 capability domains:

| Domain | Modules |
|---|---|
| Identity & Profiles | 1 (Staff Profiles), 5 (Social Login + Retention), 7 (Walk-in Capture) |
| Structure & Hierarchy | 2 (Group Management), 8 (HR / Scheduling) |
| Commerce & Retention | 3 (Promotions & Credits), 4 (Service Descriptions + Consult), 6 (CRM Migration) |
| Packaging & Team | 9 (Product Tiers / POS) |

**Most critical pre-work:** The shared vs. segregated customer profile model (Module 2) must be resolved architecturally before any feature development begins. Every other module is affected by it.

---

## Module 1 — Staff / Practitioner Profiles

**What it is:** Enriched staff profiles for clinic-style businesses — each therapist or doctor has a publicly visible bio, specialty tags, credentials, and profile photo.

**DB Changes:**
- Extend `staff`: add `bio TEXT`, `specialty_tags TEXT[]`, `credentials TEXT`, `profile_photo_url TEXT`, `display_title VARCHAR`, `is_publicly_visible BOOLEAN`

**New API Endpoints:**
- `GET /staff/:id/profile` — public profile fetch
- `PATCH /staff/:id/profile` — update profile (manager/owner only)
- `GET /branches/:id/staff/profiles` — list visible staff for a branch

**New Frontend:**
- Staff profile modal (admin): edit bio, specialty, photo upload, visibility toggle
- Staff profile card (public booking widget): photo, name, specialty, "Book with" CTA

**Dependencies:** None
**Complexity:** Low
**Phase:** 1

---

## Module 2 — Multi-Outlet Group Management

**What it is:** A company-level group layer above branches. Group admins control data sharing policy across outlets: whether customer profiles, marketing, and HR are shared or branch-independent.

**Confirmed hierarchy:** Group → Merchants (each `merchants` record = one branch). No intermediate level.

**DB Changes:**
- New table: `groups` — `id, name, created_at`
- New table: `group_settings` — `group_id FK, profile_sharing_level ENUM('none','identity_only','selective','full_history') DEFAULT 'none', shared_marketing BOOLEAN DEFAULT false, shared_hr BOOLEAN DEFAULT false, cross_branch_staff BOOLEAN DEFAULT false`
- Extend `merchants`: add `group_id UUID FK` (nullable — single-outlet merchants unaffected)
- New table: `group_users` — `id, group_id FK, email, password_hash, name, role ENUM('group_owner'), created_at` — **separate auth from merchant_users**
- New table: `staff_merchants` — `staff_id FK, merchant_id FK, PRIMARY KEY (staff_id, merchant_id)` — enables cross-branch staff when `cross_branch_staff` is ON

**Profile Sharing Levels (enforced in query service layer, never raw joins):**
- `none` — branches fully isolated; Branch B sees nothing about Branch A clients
- `identity_only` — Branch B sees name/phone/email only
- `selective` — identity + visit dates + total spend; `clientProfiles.notes` stays branch-private
- `full_history` — complete visit history, treatment notes, spend across all group branches

**New API Endpoints:**
- `POST /groups` — create group
- `GET /groups/:id` — fetch group + merchants + settings
- `PATCH /groups/:id/settings` — update profile_sharing_level and other flags
- `GET /groups/:id/merchants` — list all branch merchants
- `POST /groups/:id/merchants/:merchant_id` — attach branch to group
- `GET /groups/:id/analytics` — group-level analytics roll-up
- `POST /auth/group/signup` — create group admin account
- `POST /auth/group/login` — group admin login (returns group-scoped JWT)
- `POST /auth/group/refresh` — refresh group admin token
- `POST /merchant/staff/:id/branches` — assign staff to additional branch (requires `cross_branch_staff` ON)

**New Frontend:**
- Group admin login page (separate from merchant login)
- Group admin dashboard: branch switcher, settings panel
- Settings panel: profile sharing level selector (4 options, not a simple toggle), marketing toggle, HR toggle, cross-branch staff toggle
- Branch directory (public): outlet list with addresses, hours, practitioners
- Booking widget: "you are booking at [Branch Name]" confirmation banner

**Dependencies:** None upstream — this is a foundational module
**Complexity:** High
**Phase:** 1 (schema + group_users auth) / 2 (full admin UI)

**Architecture notes:**
- `group` is a coordination layer, not a new tenancy root. Each merchant retains its own data isolation boundary.
- Every client lookup must go through a `resolveClientVisibility(clientId, merchantId, groupId, profileSharingLevel)` service function — never raw cross-merchant joins.
- Cross-branch availability: when `cross_branch_staff` is ON, `availability.ts` must check `staff_merchants` for all branches a staff member is assigned to before opening a slot.
- Group admin JWT carries `{ groupId, role: 'group_owner' }` — a different shape from merchant JWT `{ merchantId, role }`. The `requireGroupAdmin` middleware enforces this.

---

## Module 3 — Promotions & Credits System

**What it is:** Merchant-configurable promotions engine — credit top-up packages and promoted services — with usage tracking scoped to branch or group depending on Module 2 sharing policy.

**DB Changes:**
- New table: `promotions` — `id, branch_id (nullable), group_id (nullable), type ENUM(credit_topup, service_discount, package), name, description, value DECIMAL, max_uses_per_customer INT, total_max_uses INT, starts_at, expires_at, scope ENUM(branch, group), status`
- New table: `client_promotions` — `id, client_id, promotion_id, branch_id, used_at, amount_credited`
- New table: `client_credits` — `id, client_id, group_id (nullable), branch_id (nullable), balance DECIMAL, currency, last_updated`
- Extend `payments`: add `promotion_id FK`, `credit_applied DECIMAL`

**New API Endpoints:**
- `POST /promotions` — create promotion
- `GET /promotions` — list active promotions (branch/group scoped)
- `PATCH /promotions/:id` — update/expire
- `POST /clients/:id/credits/topup` — apply credit
- `GET /clients/:id/credits` — fetch balance (scope-aware)
- `POST /bookings/:id/apply-promotion` — apply at checkout
- `GET /promotions/:id/usage` — usage stats

**New Frontend:**
- Promotions management page: create/edit/archive, usage stats
- Client profile: credit balance, promotion history
- Booking checkout: promotion code input, credit offset
- Group admin: promotions across branches, group-wide vs. branch toggle

**Dependencies:** Module 2 (scope model), Module 5 (balance notification), Module 7 (credit offset in payment)
**Complexity:** Medium-High
**Phase:** 2

---

## Module 4 — Service Descriptions + "Consult Doctor" Slot Type

**What it is:** Two additive enhancements — (a) description field on every service for the booking widget, and (b) a `consult` slot type that gates certain treatments behind a consultation booking.

**DB Changes:**
- Extend `services`: add `description TEXT`, `slot_type ENUM(standard, consult, treatment)`, `requires_consult_first BOOLEAN`, `consult_service_id FK` (self-referential)
- New table: `consult_outcomes` — `id, booking_id, recommended_service_id, notes TEXT, follow_up_booking_id FK (nullable), created_by_staff_id, created_at`

**New API Endpoints:**
- `PATCH /services/:id` — extend to accept description and slot_type
- `POST /bookings/:id/consult-outcome` — staff logs consult outcome
- `GET /clients/:id/consult-history` — past consults and outcomes

**New Frontend:**
- Service form (admin): description textarea, slot type selector, "requires consultation" toggle
- Service card (public widget): description display, "Book Consultation First" banner for gated services
- Consult outcome form (staff dashboard): post-appointment modal, recommended treatment, optional follow-on booking
- Client timeline (CRM): consult → treatment linkage

**Dependencies:** Module 1 (soft — consult is booked with a specific doctor)
**Complexity:** Low-Medium
**Phase:** 1

---

## Module 5 — Customer Identity, Social Login + Post-Service Retention Loop

**What it is:** Social auth for end-customers (Google, Facebook, Apple, WhatsApp-linked identity) plus a structured post-service communication sequence: receipt, credit balance notification, and rebooking CTA.

**DB Changes:**
- New table: `client_identities` — `id, client_id FK, provider ENUM(google, facebook, apple, whatsapp, email), provider_uid TEXT UNIQUE, linked_at`
- Extend `clients`: add `preferred_contact_channel ENUM(email, whatsapp)`, `marketing_opt_in BOOLEAN`, `last_social_login_at`
- New table: `post_service_sequences` — `id, booking_id FK, status ENUM(pending, sent, completed), receipt_sent_at, balance_notif_sent_at, rebook_cta_sent_at`

**New API Endpoints:**
- `POST /auth/social/:provider` — initiate OAuth
- `GET /auth/social/:provider/callback` — handle callback, create/link identity
- `POST /auth/whatsapp/link` — link WhatsApp to client profile
- `GET /clients/:id/identities` — list linked accounts
- `DELETE /clients/:id/identities/:identity_id` — unlink provider
- `POST /bookings/:id/trigger-post-service` — trigger post-service sequence (or auto on `completed` status)

**New Frontend:**
- Social login buttons on public booking widget (Google, Facebook, Apple, WhatsApp)
- "Link accounts" section in customer profile
- Post-service email template: receipt + balance + rebook CTA
- Post-service WhatsApp template (Meta pre-approval required)
- Merchant settings: configure post-service sequence delays

**Dependencies:** Module 3 (balance notification), existing BullMQ notification system
**Complexity:** Medium-High
**Phase:** 1 (post-service comms only) / 2 (social login)

**Social auth priority order:** Google → Apple → Facebook (Meta App Review: 4–6 weeks) → WhatsApp (additional Meta approval, market-dependent)

**Deduplication policy:** Use phone number as the canonical deduplication key. Build a staff-facing "merge clients" tool in Phase 2. Flag duplicates automatically when a new identity matches an existing phone number.

---

## Module 6 — CRM Migration Strategy

**What it is:** Tooling and process to help clinic operators migrate their existing customer data into GlowOS with minimal friction.

### Five Approaches (ranked by implementation effort):

**1. Structured CSV Import (Phase 1 — build first)**
GlowOS import template covering: client name, phone, email, visit history, service history, outstanding credits. Server-side validation, duplicate detection, conflict resolution. Works with any source system.

**2. Guided Onboarding Concierge (immediate GTM)**
For group accounts, offer white-glove migration as paid or included service. People process, not product. GlowOS ops team handles data mapping. Refines import template quality over time.

**3. Direct API Connectors (Phase 2)**
Survey first 50 prospects on current CRM tool. Build connectors for top 2 (likely Fresha, Mindbody, Phorest). High value once built; high effort per connector.

**4. Zapier / Make.com Webhook Bridge (Phase 2)**
Publish GlowOS as a Zapier target. Low engineering cost. Good for tech-savvy merchants. Not suitable for non-technical clinic operators.

**5. Historical Archive Strategy (recommended default pitch)**
Migrate only: active client profiles, outstanding credits, last 12 months of visits. Older data remains in source system. Fastest path to live, clean GlowOS installation. Counter objections by framing GlowOS as system of record going forward.

**Complexity:** Medium (CSV) / High (API connectors)
**Phase:** 1 (CSV + concierge) / 2 (API connectors + Zapier)

---

## Module 7 — Universal Payment Capture (Walk-in + OTC)

**What it is:** Extend the payment system to capture 100% of transactions — including walk-ins and cash/OTC payments — ensuring every customer interaction creates a CRM record regardless of whether GlowOS processes the money.

**DB Changes:**
- Extend `payments`: add `payment_method ENUM(stripe, cash, otc, credit, split)`, `recorded_by_staff_id FK`, `is_gateway_processed BOOLEAN DEFAULT true`
- New table: `walkin_registrations` — `id, branch_id, client_id FK, service_id FK, staff_id FK (optional), checked_in_at, source ENUM(walkin, phone, referral)`
- Extend `clients`: add `acquisition_source ENUM(online_booking, walkin, import, social)`, `first_visit_branch_id FK`

**New API Endpoints:**
- `POST /walkins/register` — quick walk-in registration (name + phone minimum, creates client + booking in one call)
- `POST /bookings/:id/payment/cash` — record cash payment
- `POST /bookings/:id/payment/otc` — record OTC/external payment with amount + note
- `GET /branches/:id/walkins/today` — live walk-in queue for front desk

**New Frontend:**
- Walk-in registration panel (front desk, speed-optimized): name, phone, service, staff, payment method — submit in under 30 seconds
- Payment method selector at checkout: Stripe / Cash / OTC
- Walk-in queue widget (branch dashboard): live list with status
- Cash/OTC confirmation modal: audit trail with amount + staff who recorded

**Dependencies:** None upstream. Stripe keys must be configured (founder action) before online payments work.
**Complexity:** Medium
**Phase:** 1

---

## Module 8 — Smart HR / Staff Scheduling System

**What it is:** Staff availability, calendar management, and idle-time optimization engine. Practitioners self-manage calendars. System models multi-stage procedures to expose genuine idle windows. Revenue contribution tracked per staff member.

**DB Changes:**
- New table: `staff_schedules` — `id, staff_id FK, branch_id FK, date, shift_start TIME, shift_end TIME, schedule_type ENUM(regular, leave, training, blocked)`
- New table: `procedure_stages` — `id, service_id FK, stage_name, duration_minutes INT, requires_staff BOOLEAN, staff_role ENUM(doctor, therapist, any), sequence_order INT`
- New table: `stage_assignments` — `id, booking_id FK, stage_id FK, assigned_staff_id FK, scheduled_start, actual_start, actual_end`
- Extend `working_hours`: add `is_blocked BOOLEAN`, `block_reason TEXT`
- New table: `staff_revenue_ledger` — `id, staff_id FK, booking_id FK, service_revenue DECIMAL, staff_share_pct DECIMAL, period_date DATE`

**New API Endpoints:**
- `GET /staff/:id/schedule` — schedule with idle windows calculated
- `POST /staff/:id/schedule/block` — staff blocks time
- `GET /branches/:id/staff/idle-windows` — aggregate idle time view
- `GET /services/:id/procedure-stages` — fetch multi-stage model
- `POST /services/:id/procedure-stages` — define/update stages
- `POST /bookings/:id/assign-stages` — auto-assign staff to stages
- `GET /staff/:id/revenue-contribution` — revenue/hours breakdown
- `GET /branches/:id/utilization` — branch utilization report

**New Frontend:**
- Staff self-service calendar (staff login): week view, block time, upcoming bookings
- Idle time dashboard (manager): visual timeline of gaps across all staff
- Procedure stage editor (admin): drag-and-order stages per service, role requirements
- Stage assignment view (booking detail): which staff handles which stage
- Staff revenue dashboard: hours, bookings, revenue vs. target

**Dependencies:** Module 1 (staff roles for stage assignment), Module 2 (shared vs. branch-independent HR toggle)
**Complexity:** Very High
**Phase:** 2 (self-service calendar) / 3 (idle-time optimization engine)

**Important:** Do not attempt to automate idle-time optimization in Phase 2. Ship calendar + blocking. Get real clinic workflow data. Build optimization in Phase 3 with actual operator input.

---

## Module 9 — Product Tiers / POS Interface

**What it is:** Two subscription tiers defining feature access, with POS (point-of-sale) as the Tier 2 differentiator.

**Tiers:**
- **Tier 1:** Booking + CRM + HR
- **Tier 2:** Booking + HR + POS + CRM

**DB Changes:**
- Extend `merchants`: add `subscription_tier ENUM(tier1, tier2)`, `subscription_status ENUM(active, trial, suspended)`, `trial_ends_at TIMESTAMP`
- New table: `feature_flags` — `merchant_id, feature_key VARCHAR, enabled BOOLEAN, enabled_at`

**New API Endpoints:**
- `GET /merchants/:id/subscription` — current tier and features
- Feature gate middleware on all new feature endpoints
- `POST /merchants/:id/subscription/upgrade` — trigger Stripe subscription change

**New Frontend:**
- Subscription management page: current tier, upgrade CTA, feature comparison
- Feature gate UI: graceful degradation + upgrade prompt for locked features
- POS interface (Tier 2 only): in-clinic billing, cart-style item addition, payment method selector, receipt

**Dependencies:** All modules (tier gating wraps every feature). Module 7 is the seed of POS — POS is Module 7 extended with a cart UI and line-item billing.
**Complexity:** Medium (tier model) / High (POS UI)
**Phase:** 2 (tier infrastructure) / 3 (full POS UI)

---

## Architecture Decisions

> These decisions are locked based on founder clarifications (12 April 2026). Do not revisit without explicit founder sign-off.

### 1. Hierarchy: Group → Merchants (merchant = branch)
Confirmed: each `merchants` record is one branch. `groups` sits above. No intermediate level. `merchants.groupId` FK links a branch to its group. Single-outlet merchants have `groupId = null` and are unaffected by all group logic.

### 2. Profile Sharing: Four-Level Enum, Not Boolean
`group_settings.profileSharingLevel` is an ENUM with four values: `none`, `identity_only`, `selective`, `full_history`. Group admin sets this in their dashboard. Definition of each level:
- `none`: branches fully isolated — no cross-branch client visibility
- `identity_only`: name, phone, email only — confirms the person exists
- `selective`: identity + visit dates + total spend; `clientProfiles.notes` stays branch-private
- `full_history`: everything — complete visit history, treatment notes, skin condition notes

**Critical rule:** All client lookups must pass through `resolveClientVisibility(clientId, merchantId, groupId, sharingLevel)` in the service layer. No raw cross-merchant joins allowed anywhere in the codebase.

### 3. Group Admin: Separate Auth System
Group admins are NOT merchant users. They have their own table (`group_users`), their own login endpoints (`/auth/group/*`), and their own JWT shape (`{ groupId, role: 'group_owner' }`). The `requireGroupAdmin` middleware is distinct from `requireMerchant`. Group admin dashboard is a separate Next.js route tree (`/group-admin/*`).

### 4. Cross-Branch Staff: Opt-in via `staff_merchants` Join Table
`staff.merchantId` stays as the home branch. The new `staff_merchants` join table lists all branch assignments for a staff member. This table is only populated when `group_settings.crossBranchStaff = true` and the group admin explicitly assigns a staff member to an additional branch.

Availability calculation (`availability.ts`) must be updated to: when `crossBranchStaff` is ON for the group, query `staff_merchants` and block any slot where the staff member has a confirmed booking at ANY of their assigned branches — not just the current merchant.

### 5. Payment Ledger First
Every transaction gets a `payments` record regardless of method. `bookings.paymentMethod` (already exists as varchar) accepts `'stripe' | 'cash' | 'otc'`. Cash/OTC bookings have `paymentStatus: 'completed'` set at creation. Stripe remains the online gateway. POS Terminal is a Phase 3 extension.

### 6. Social Auth Separation
Social login is for end-customers (public booking widget) only. Merchant staff auth remains JWT. Group admin auth remains JWT. Keep all three auth systems separate. Use a lightweight OAuth library for customer social auth in Phase 2.

### 7. BullMQ Queue Architecture
Two new queues: `post-service-sequence` (receipt + rebook CTA) and `procedure-stage-transitions` (Phase 3). Use Bull delayed jobs for timed steps. Confirm Upstash Redis concurrency limits before Phase 2.

---

## CRM Migration — Recommended Default Pitch
Migrate only active client profiles, outstanding credits, and last 12 months of visit history. Older data stays in the source system. GlowOS becomes the system of record going forward. This is the fastest path to a clean, live installation.

---

## Team Structure

### 5 Roles Minimum / 7 Optimal

| Role | Owns | Phase |
|---|---|---|
| Backend Engineer | All API, schema, workers, multi-tenancy, promotions, social auth, migration | All |
| Frontend Engineer — Dashboard | Group admin, promotions, HR dashboard, POS, subscriptions | All |
| Frontend Engineer — Public | Booking widget, social login, staff cards, customer portal | All |
| Product / UX Designer | Designs run 1 sprint ahead of engineering | All |
| QA / Integration Engineer | E2E tests, multi-tenancy coverage, payment combos, migration validation | All |
| DevOps *(Phase 3)* | Railway/Upstash/Neon scaling | Phase 3 |
| Data Engineer *(Phase 2–3)* | Group analytics, staff revenue reports | Phase 2–3 |

### Parallel Build Streams (post Sprint 0)
- **Stream A (Backend):** Module 7 → 3 → 5 → 8
- **Stream B (Dashboard FE):** Module 1 admin → 2 group UI → 7 walk-in → 8 HR
- **Stream C (Public FE):** Module 1 cards → 4 consult → 5 social login → 3 promotions widget
- **Stream D (Designer):** Always 1 sprint ahead of all streams

---

## Sprint Roadmap

| Sprint | Focus |
|---|---|
| 0 | Group data model schema, feature flag schema, staff profile DB extensions, service description field. Design: group admin, walk-in panel, consult flow wireframes. |
| 1 | Staff profile UI (admin + public widget), service descriptions in booking widget, consult slot type + outcome form, walk-in registration + cash/OTC payment recording. |
| 2 | Promotions data model + management UI, credit balance tracking, promotion application at checkout. Post-service receipt + rebook CTA. |
| 3 | Social login backend (Google + Apple), client identity linking, post-service balance notification. |
| 4 | Group admin dashboard, branch switcher, shared/segregated policy enforcement, group-level analytics. |
| 5 | Staff self-service calendar, shift scheduling, staff-initiated blocks, basic revenue contribution. |
| 6 | Subscription tier infrastructure, feature gate middleware, subscription UI, Stripe upgrade flow. |
| 7+ | Procedure stage modeler, stage assignments, idle time dashboard, POS cart UI (Tier 2). |

---

## Phase Roadmap

### Phase 1 — Clinical Credibility (~3 months)
Staff profiles, consult slot type, service descriptions, walk-in + OTC capture, post-service receipt + rebook CTA, CSV migration tool, Stripe keys configured, Group data model in DB.
**End state:** First real paying clinic account can be demoed and onboarded.

### Phase 2 — Growth Infrastructure (~4 months)
Group admin UI + policy enforcement, promotions & credits, Google + Apple social login, staff self-service calendar, subscription tier model, CRM API connectors for top 2 source systems.
**End state:** First group accounts onboarded. Merchants running promotions. Social login live.

### Phase 3 — Platform Scale (~6+ months)
Multi-stage procedure engine + idle time optimization, POS interface (Tier 2), staff revenue tracking, WhatsApp login, group HR toggle, advanced group analytics, Zapier connectors.
**End state:** GlowOS is a Clinic Operating System with a defensible moat in staff scheduling + group management.

---

## Top 5 Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Group data model ambiguity | Critical | Resolve in Sprint 0 before any feature work. Document and commit schema. |
| WhatsApp template approval latency | High | Submit all templates in Sprint 1, even before backend is built. Never block a release on template approval. |
| Stripe Connect keys not configured | High | Founder 1-day action. Must be done before Sprint 2. All payment features blocked until then. |
| Multi-stage scheduling complexity | Medium-High | Do not automate idle-time optimization in Phase 2. Ship calendar + blocking. Get real workflow data first. |
| Social auth identity deduplication | Medium | Phone number as canonical key. Staff "merge clients" tool in Phase 2. Auto-flag duplicates on new identity link. |

---

## Zenoti Feature Gap Analysis (verified 12 April 2026)

Status key: ✅ Built · ⚠️ Partial · ❌ Missing

### 1. Online Booking Engine
| Feature | Status | Gap / Note |
|---|---|---|
| Real-time availability engine | ✅ | Redis-cached, slot leasing, duration + buffer |
| Guest flow (location → service → provider → time → pay) | ✅ | 5-step BookingWidget |
| Booking confirmation — WhatsApp | ✅ | Twilio |
| Booking confirmation — Email | ✅ | SendGrid added Phase 1 (Task 11) |
| "Any available" provider | ✅ | `isAnyAvailable` flag |
| Guest self-service cancellation | ✅ | `/cancel` page |
| Guest self-service reschedule | ❌ | Phase 2 |
| Group booking (multiple guests, one session) | ❌ | Phase 3 |
| Multi-service booking (one session) | ❌ | Phase 3 |
| Deposit / prepayment option | ❌ | Phase 2 |
| Pay-at-location (cash/OTC) | ⚠️ | Phase 1 (Task 8) |
| Gift card redemption | ❌ | Phase 3 |

### 2. Tenant Dashboard
| Feature | Status | Gap / Note |
|---|---|---|
| Appointment calendar (day/week/month, drag-drop) | ❌ | **Phase 2 priority** — currently list-only |
| Staff CRUD + working hours | ✅ | |
| Staff blocked time | ❌ | Phase 2 (staff self-service calendar) |
| Service catalog CRUD | ✅ | |
| Service resource requirements (rooms/equipment) | ❌ | Phase 3 |
| Location management (multi-outlet UI) | ⚠️ | Schema ready; group admin UI Phase 2 |
| Guest CRM (profiles, notes, visit history) | ✅ | |
| Loyalty points (earning, redemption) | ⚠️ | VIP tiers + RFM exist; points system Phase 2 |
| Inventory tracking | ❌ | Not planned — low priority for clinic segment |
| Financial reports | ⚠️ | Per-merchant built; cross-location Phase 2 |
| Waitlist management | ❌ | Phase 3 |

### 3. Guest-Facing Features
| Feature | Status | Gap / Note |
|---|---|---|
| Guest portal (booking history, upcoming) | ❌ | Phase 2 |
| Loyalty balance visible to guest | ❌ | Requires guest portal (Phase 2) |
| Memberships (recurring billing) | ❌ | Phase 3 |
| Referral program | ❌ | Phase 3 |

### 4. Revenue Growth Automation
| Feature | Status | Gap / Note |
|---|---|---|
| 24h pre-appointment reminder | ✅ | `scheduleReminder` |
| No-show re-engagement | ✅ | `scheduleNoShowReengagement` |
| Post-cancellation rebooking prompt | ✅ | `scheduleRebookingPrompt` |
| Review request automation | ✅ | `scheduleReviewRequest` |
| Post-service receipt + rebook CTA | ⚠️ | Phase 1 (Task 10 + 11) |
| Abandoned booking recovery | ❌ | Phase 2 — slot leases expire silently |
| Upsell engine at checkout | ❌ | Phase 3 |
| Dynamic pricing | ❌ | Phase 3 |

### 5. Staff / Provider Tools
| Feature | Status | Gap / Note |
|---|---|---|
| Commission tracking (DB fields) | ⚠️ | Fields exist; no UI or management |
| Tip tracking | ❌ | Phase 2 |
| Performance dashboard | ⚠️ | Basic analytics built; utilization rate not calculated |
| Provider calendar / mobile view | ❌ | Phase 2 (web-only, not native app) |
| Payroll export | ❌ | Phase 2 |

### 6. Admin / Platform Layer
| Feature | Status | Gap / Note |
|---|---|---|
| Super admin tenant management | ❌ | Phase 3 — GlowOS has no platform-level view |
| Subscription tiers with enforced limits | ⚠️ | Field exists; limits not enforced |
| Platform-wide analytics | ❌ | Phase 3 |
| White-label (custom domain, branding per tenant) | ❌ | Phase 3 |

### 7. Integrations
| Feature | Status | Gap / Note |
|---|---|---|
| Stripe | ⚠️ | Code written; keys not yet configured |
| Twilio WhatsApp | ✅ | Fully configured |
| SendGrid email | ⚠️ | Phase 1 (Task 11) — requires SENDGRID_API_KEY + sender verification |
| Google Calendar sync | ❌ | Phase 3 |
| Apple Calendar (iCal) | ❌ | Phase 3 |
| Facebook / Instagram Book Now | ❌ | Phase 3 |
| Reserve with Google | ⚠️ | Field in schema; not integrated |
| Outbound webhooks | ❌ | Phase 2 |

### 8. AI / Automation
| Feature | Status | Gap / Note |
|---|---|---|
| Churn prediction (RFM scoring) | ✅ | VIP worker + `churnRisk` field |
| Campaign targeting + send | ✅ | Campaigns page |
| Demand forecasting | ❌ | Phase 3 |
| AI chatbot | ❌ | Phase 3 |
| Smart scheduling (idle-time optimization) | ❌ | Phase 3 (Module 8) |

---

## Summary

GlowOS has a solid, functional core. These 9 modules transform it from a booking CRM into a category-defining Clinic Operating System. The staff scheduling engine (Module 8) is the long-term moat. The group management model (Module 2) is the enterprise unlock. The POS tier (Module 9) is the commercial ceiling. Get the group data model right in Sprint 0 and all 9 modules are buildable without architectural debt.

**Three gaps to close before pilot (not yet in any plan):**
1. ✅ Email (SendGrid) — added to Phase 1 plan Task 11
2. Appointment calendar view — Phase 2 priority, add to Phase 2 plan
3. Guest self-service reschedule — Phase 2 priority, add to Phase 2 plan

**Estimated timeline to full platform:** 13–15 months with a team of 5 core roles.

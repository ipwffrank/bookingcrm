# Google Reserve — Merchant Onboarding Flow

**Date:** 2026-04-22
**Status:** Design — pending user approval before implementation
**Depends on:** Reserve-with-Google partner approval (separate track, 4–9 months)

---

## Problem

GlowOS needs a way for merchants to connect their Google Business Profile
(GBP) to the platform so that — once Google approves GlowOS as a Reserve
partner — each merchant can be enabled for Reserve without a support ticket.

The hard constraint: Google requires **merchant opt-in at the GBP level**.
GlowOS can't enable Reserve on a merchant's behalf without them proving they
own the GBP and agreeing to use GlowOS as their booking partner.

## Outcome

By the end of this flow, a merchant has:
1. Validated their GBP URL against Google Places
2. Resolved any eligibility gaps (unverified, wrong category, existing
   partner conflict)
3. Confirmed what data GlowOS will send to Google
4. Clicked "Submit to Google" — status changes to `pending_review`
5. Sees a live status tile on their dashboard tracking Google approval

Once Google approves, the Reserve button appears on their Maps listing and
client bookings made through Google flow directly into the GlowOS booking
engine — no new merchant action.

---

## Merchant journey (7 stages)

### Stage 1 — Discovery
Entry points:
- Dashboard banner: "Get discovered on Google. Turn on Reserve →" (for
  merchants who haven't started)
- Settings → Google Reserve tab (always accessible)

Shows a one-page explainer with 3 panels:
- **What** — "Clients can book you directly from Google Maps, Search, and
  the Google Assistant."
- **How** — 30-second animated walkthrough showing a client tapping the
  Reserve button on Maps → seeing GlowOS's booking slots.
- **Requirements** — "You need a verified Google Business Profile. We'll
  check and guide you through any gaps."

Single CTA: **"Start setup →"**

### Stage 2 — GBP lookup
Form with one field: GBP URL or Place ID (`https://maps.google.com/place?q=...`
or a 27-char Place ID). Include a "How do I find my GBP URL?" inline help.

On submit:
- Backend calls Google Places API → Place Details
- Returns: business name, formatted address, phone, primary category,
  verification status, photos count, opening hours, `business_status`
- Cache the Place ID on the merchant record — no re-fetch on repeat visits

If lookup fails (Place ID invalid / business deleted), show clear error and
allow retry.

### Stage 3 — Eligibility check (the critical screen)
Display the fetched GBP data side-by-side with the merchant's GlowOS data.
For each of the 7 checks, show ✓ / ⚠ / ✗ with a "Fix this" CTA:

| Check | Pass criteria | On failure |
|---|---|---|
| GBP exists | Places lookup returned a valid result | Retry with correct URL |
| GBP verified | `business_status === "OPERATIONAL"` + verified badge detected | Instructions for the merchant to complete GBP verification with Google |
| Reserve-eligible category | Primary category in whitelist (see Appendix A) | List eligible alternatives; "Change category on GBP → [how to]" |
| Name matches | Fuzzy match ≥ 0.85 between GBP name and GlowOS merchant.name | "Update one so they match" with inline edit |
| Address matches | Normalized postal-code match | Same edit flow |
| Phone matches | E.164 normalized match | Same edit flow |
| No conflicting partner | No existing Reserve partner on the GBP (check via Places partner field if available) | Instructions to disconnect existing partner before continuing |

All 7 green → **"Continue to review"** unlocks.
Any yellow → merchant can proceed but sees a warning.
Any red → blocked, must resolve first.

### Stage 4 — Pre-submission review
Shows exactly what GlowOS will send Google:
- Services (name, duration, price, category)
- Staff (if publicly visible)
- Operating hours
- Cancellation + reschedule policy
- Sample availability for next 7 days (auto-generated)

Each section has an "Edit in GlowOS" link that deep-links to the relevant
settings page. This is the merchant's last chance to tweak their public
Google presence.

At the bottom: a short T&C acknowledgement — "I agree to Google's booking
partner terms and authorize GlowOS to manage my bookings on Google."

### Stage 5 — Submission
Single button: **"Submit to Google for approval"**.

Backend flow:
- Sets `merchants.reserve_status = 'pending_review'`,
  `reserve_submitted_at = now()`
- Queues the merchant in the next daily Actions Center feed
- Fires a confirmation email + WhatsApp to the merchant

### Stage 6 — Status tracking
Persistent card on the Settings → Google Reserve page showing the current
state. States:

| Status | Badge color | Next action (merchant) | Typical duration |
|---|---|---|---|
| `not_started` | grey | "Start setup" | — |
| `connecting` | grey | Finish the eligibility checks | — |
| `pending_review` | amber | Wait — nothing to do | 2–14 days |
| `live` | sage | Share booking link, monitor first bookings | — |
| `rejected` | danger | Read rejection reason, fix, resubmit | 1 cycle |
| `paused` | grey | Resume or keep paused | — |

A daily worker polls the Actions Center API for status changes on
`pending_review` merchants. When transitioned to `live` or `rejected`,
notify the merchant via WhatsApp + email.

### Stage 7 — Ongoing sync
Silent — merchant doesn't interact here. When the merchant edits services,
hours, staff, or cancellation policy in GlowOS, a queue job fires the diff
to Google within 24h.

If the merchant edits the **GBP directly** (e.g. changes phone number on
Google Maps independently), our daily Places re-check detects divergence
and shows a warning banner: *"Your Google listing differs from GlowOS —
reconcile."*

---

## Data model changes

**`merchants` table additions:**

```sql
gbp_place_id             varchar(255)  -- Google Places ID, nullable
gbp_url                  text          -- Cached full URL merchant pasted
gbp_category_primary     varchar(100)  -- As returned by Places
gbp_verified             boolean       -- Cached verification state
reserve_status           varchar(20)   -- enum above
reserve_submitted_at     timestamp tz
reserve_live_at          timestamp tz
reserve_rejected_reason  text
gbp_last_synced_at       timestamp tz  -- For divergence detection
```

**New table `gbp_sync_log`:**

```sql
id                   uuid pk
merchant_id          uuid fk
action               varchar(40)   -- 'feed_push' | 'status_poll' | 'divergence_detected'
success              boolean
google_response      jsonb         -- Raw response/error
created_at           timestamp tz
```

No migration of existing data — Reserve is additive.

---

## API surface

**Merchant-facing endpoints (all under `requireMerchant`):**

- `GET  /merchant/gbp/status` — Returns current `reserve_status` + last-checked
  eligibility state + any outstanding issues.
- `POST /merchant/gbp/lookup { url }` — Parses URL, calls Places API, returns
  the GBP data side-by-side with GlowOS data. Does NOT persist.
- `POST /merchant/gbp/connect { place_id }` — Persists the Place ID on the
  merchant record. Runs the 7 eligibility checks server-side. Returns
  pass/fail/gaps.
- `POST /merchant/gbp/submit-for-reserve` — Gates on all checks passing +
  T&C accepted. Sets `reserve_status = 'pending_review'`, queues feed entry.
- `POST /merchant/gbp/pause` — Takes merchant out of feed. `reserve_status
  = 'paused'`.
- `POST /merchant/gbp/resubmit` — After a `rejected`, merchant fixes issue
  and resubmits.

**Internal / worker:**

- Daily cron `gbp:feed` — Builds the Actions Center feed from all merchants
  whose `reserve_status IN ('pending_review', 'live')`. Uploads to Google.
- Daily cron `gbp:status-poll` — Polls partner API for status changes on
  `pending_review` merchants. Updates `reserve_status`. Notifies.
- Hourly cron `gbp:divergence-check` — For `live` merchants, re-fetches
  Places data. If name/address/phone diverges from GlowOS, writes a banner.

---

## UI surface

New page: **`/dashboard/settings/google`** — tabbed under Settings.

Components needed:
- `GbpOnboardingWizard` — the 4-step setup flow (discovery → lookup →
  eligibility → review)
- `GbpStatusCard` — persistent status tile for connected merchants
- `GbpGapResolutionModal` — one modal per failed eligibility check, each
  with tailored "how to fix" content
- `GbpDivergenceBanner` — top-of-dashboard warning when GBP ≠ GlowOS

Sidebar: small "Google" badge in the primary nav showing status at a glance
(grey / amber / sage / danger) — so merchants always see their state.

---

## Cost estimate

### One-time (build)

| Phase | Scope | Session-hours | Calendar (solo) | Outsourced cost (SGD) |
|---|---|---|---|---|
| 1. GBP connector MVP | Places API lookup + eligibility checks + 4-step wizard + settings page | ~20 hrs | 2–3 sessions / 1 week | $3,000–$4,500 |
| 2. Actions Center feed | Partner feed generator + daily cron + status-poll worker | ~30 hrs | 3–4 sessions / 1.5 weeks | $4,500–$7,000 |
| 3. Booking server | Live-availability, create/update/cancel endpoints per Google spec + test-harness iteration | ~40 hrs | 4–6 sessions / 2–3 weeks | $6,000–$10,000 |
| 4. Status + divergence | Divergence detection, reconciliation UI, notification plumbing | ~15 hrs | 2 sessions / 1 week | $2,500–$3,500 |
| **Total engineering** | | **~105 hrs** | **6–10 weeks** | **$16,000–$25,000** |

### Ongoing monthly (per merchant count)

| Scale | Google Places API | Google Reserve partner fees | Merchant support | Total |
|---|---|---|---|---|
| 100 merchants | $4 | $0 | ~$750 (1 hr/merchant/mo @ $30/hr prorated) | ~$754 |
| 1,000 merchants | $34 | $0 | ~$3,000 | ~$3,034 |
| 10,000 merchants | $340 | $0 | ~$15,000 | ~$15,340 |

Notes:
- Google gives **$200/month free credit** on Maps Platform APIs. At <5,000
  merchants, Places costs are effectively zero.
- **Reserve itself is free** for partners. Google monetizes through Maps
  ads, not the booking pipeline.
- **Support cost is the real variable.** Merchants who understand GBP
  self-serve. Merchants who don't need 15–30 min of hand-holding to verify
  or change category. Model this as the largest line item as you scale.
- **No per-booking fees** from Google. Bookings go through GlowOS's normal
  payment pipeline (Stripe for SG, eventually iPay88 for MY).

### Non-cost time investment

| Activity | Duration |
|---|---|
| Reserve partner application | ~3 weeks (submit form → first response) |
| NDA + docs access (if accepted) | 1–2 weeks |
| Test-harness iteration with Google | 2–4 weeks |
| Pilot with 3–5 real merchants | 2–4 weeks |
| Full rollout approval | 1–2 weeks |
| **Total to first live merchant on Reserve** | **4–9 months from application** |

---

## Gate strategy — what to build when

### Month 1 (now)
- Submit Reserve partner application
- Build **Phase 1 only** (GBP connector MVP) — useful regardless of Reserve
  approval because it lets merchants audit their Google listing and sets up
  the data plumbing

### Month 2–3 (while waiting for Google)
- **Ship the GBP direct-booking-link feature first** (smaller, 1 session).
  Every merchant gets a "Booking URL to paste into your GBP Booking Button
  field" — works today without Google approval. Single settings row +
  copy-to-clipboard.
- If Google accepted the application: start Phase 2 (feed generator)

### Month 4+ (only if approved)
- Phase 3 (booking server) + test-harness cycle
- Pilot launch

### Fallback
If Google rejects: the Phase 1 MVP is still useful as a "Google listing
health check" feature. Re-apply in 6 months with more merchants.

---

## Non-goals

- **OAuth into the merchant's Google account.** Places API gives us enough
  without asking for GBP management permissions. Invasive and breaks trust.
- **Auto-creating GBP for merchants who don't have one.** Google's terms
  prohibit this; it's also a compliance landmine.
- **Cross-partner migration.** We don't automate pulling the merchant off
  their existing Reserve partner — we only show them how to do it manually.
- **Reserve for non-whitelisted categories.** We don't try to force Reserve
  onto a GBP categorized as "Convenience Store" or similar. Only approved
  categories (Appendix A).

---

## Appendix A — Reserve-eligible primary GBP categories

Informed by Google's current partner docs. Subject to change — verify
during integration kickoff.

**Beauty / personal care:**
- Hair salon, Beauty salon, Nail salon, Barbershop, Spa, Massage therapist,
  Waxing hair removal service, Tanning salon, Makeup artist, Eyelash service

**Wellness / medical (limited):**
- Acupuncture clinic, Chiropractor, Physical therapist, Podiatrist (varies
  by region)

**Fitness:**
- Gym, Personal trainer, Yoga studio, Pilates studio

**Out of scope for GlowOS vertical** (but Reserve supports):
Restaurants, activities & attractions, car services

---

## Appendix B — What makes a successful application

When you submit the partner form, Google evaluates:

1. **Merchant pipeline credibility** — "We have N live merchants, M in
   pipeline, launching in SG + MY"
2. **Vertical focus** — GlowOS fits (beauty + wellness). Don't muddy the
   pitch with restaurants or other verticals in v1.
3. **Existing booking UX quality** — Google clicks through to your live
   booking widget. Make sure `/[slug]` is polished for at least 5 real
   merchants before applying.
4. **Operational maturity** — you need a support email, response SLA, and
   a public T&C that covers bookings.
5. **Geographic fit** — SG + MY are both supported regions.

Biggest first-time rejection reasons:
- Too few merchants (< 20 is typical rejection threshold)
- Booking flow has bugs or is not live
- No support infrastructure
- Vertical too broad

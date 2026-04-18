# Client Reviews — Design Spec

**Date:** 18 April 2026
**Status:** Approved
**Scope:** Review collection flow, merchant dashboard, client profile integration, analytics

---

## Overview

Add a client review system to GlowOS. Clients receive a WhatsApp review request 30 minutes after their booking is marked completed (trigger already built). They tap a link, rate 1–5 stars with an optional comment, and submit. Reviews are private — visible only to the merchant in their dashboard, client profiles, and analytics. Low-rating reviews (≤3★) trigger an instant WhatsApp alert to the merchant.

---

## Review Submission Page

**Route:** `/review/[bookingId]` (public, no auth required)

**Page content:**
- Merchant logo (or generated avatar) + merchant name
- Service name + appointment date (e.g., "How was your Hydrafacial on 17 Apr?")
- Staff card: avatar initials, staff name, role label ("Your aesthetician")
- 1–5 star rating (tap to select)
- Optional text comment (textarea, placeholder: "Tell us about your experience (optional)")
- Submit button
- Privacy note: "Your review is shared with the business only, not displayed publicly."

**After submission:** Thank-you screen confirming the review was received.

**Validation:**
- Booking must exist and have status `completed`
- One review per booking (reject duplicates with friendly message: "You've already reviewed this appointment")
- Rating required (1–5), comment optional
- Booking ID validated as UUID

**Data flow:**
1. Page loads → `GET /review/{bookingId}` fetches booking details (merchant, service, staff, date)
2. Client submits → `POST /review/{bookingId}` with `{ rating, comment }`
3. Server inserts into `reviews` table
4. If rating ≤ 3: queue `low_rating_alert` job to notification worker

---

## Low-Rating Alert

**Trigger:** Review submitted with rating ≤ 3 stars.

**Action:** WhatsApp message to merchant's phone number:
```
⚠️ New review needs attention

{clientName} rated their {serviceName} appointment {rating}/5 stars.
{comment ? `"${comment}"` : "No comment left."}

Check your dashboard: {frontendUrl}/dashboard/reviews
```

**Implementation:** New job type `low_rating_alert` in the existing notification worker. Sets `isAlertSent = true` on the review record after sending.

---

## Merchant Dashboard — Reviews Tab

**Route:** `/dashboard/reviews` (new sidebar item, below Clients)

**Sidebar icon:** Star outline

### Summary Stats (4 cards)

| Card | Value | Subtitle |
|------|-------|----------|
| Avg Rating | e.g. 4.6 | Gold stars visualization |
| Total Reviews | e.g. 47 | "+N this month" delta |
| Response Rate | e.g. 34% | "N of M bookings" (reviews / completed bookings in period) |
| Needs Attention | e.g. 2 | Count of reviews ≤3★ in period, red text |

### Filters

- **Rating:** All / 5★ / 4★ / 3★ / 2★ / 1★
- **Staff:** All / individual staff members
- **Period:** Last 7 days / Last 30 days / Last 90 days / All time

### Review List

Each review card shows:
- Client avatar (initials, colored background) + client name
- Service name · staff name · date
- Star rating (gold filled stars)
- Comment text (if present)
- Reviews with rating ≤ 3: red background (`bg-red-50`), red border, "Needs attention" badge

Reviews without comments render compact (no comment section).

Sorted by `createdAt` descending (newest first).

---

## Client Profile Integration

**File:** `/dashboard/clients/[id]/page.tsx`

Replace the existing `PlaceholderSection` for "Reviews" with actual review data for that client.

**Display:**
- List of reviews from this client, sorted newest first
- Each entry: star rating, comment (if any), service name, date
- If no reviews: "No reviews yet" empty state

---

## Analytics Integration

Two new sections added to the existing analytics page, respecting the current period filter (7d / 30d / 90d).

### Rating Distribution

Horizontal bar chart:
- 5 rows (5★ through 1★)
- Gold bars for 4-5★, amber for 3★, red for 1-2★
- Each row shows count and percentage
- Footer: total reviews, response rate, average rating

### Average Rating Over Time

Line chart:
- Weekly average rating for the selected period
- Gold line with dots at each data point
- Y-axis: 1.0 to 5.0
- X-axis: week labels

---

## API Endpoints

### Public (no auth)

#### `GET /review/{bookingId}`
Returns booking details for the review page.

**Response:**
```json
{
  "merchantName": "Glow Aesthetics",
  "merchantLogo": null,
  "serviceName": "Hydrafacial",
  "staffName": "Jessica Lee",
  "appointmentDate": "2026-04-17",
  "alreadyReviewed": false
}
```

Returns 404 if booking doesn't exist or isn't completed.

#### `POST /review/{bookingId}`
Submits a review.

**Body:** `{ "rating": 5, "comment": "Great experience!" }`

**Validation:** rating 1–5 (integer, required), comment (string, optional, max 1000 chars), bookingId (valid UUID).

**Response:** `{ "success": true }` or `{ "error": "Already reviewed" }` (409)

**Side effects:**
- Inserts row into `reviews` table
- If rating ≤ 3: queues `low_rating_alert` notification job

### Merchant-scoped (auth required)

#### `GET /merchant/reviews`
List reviews with filters.

**Query params:** `rating` (1–5), `staffId` (uuid), `period` (7d/30d/90d/all), `limit` (default 50), `offset` (default 0)

**Response:** Array of review objects with joined client name, service name, staff name.

#### `GET /merchant/reviews/stats`
Summary stats for the dashboard cards.

**Query params:** `period` (7d/30d/90d/all)

**Response:**
```json
{
  "avgRating": 4.6,
  "totalReviews": 47,
  "reviewsThisMonth": 8,
  "responseRate": 0.34,
  "completedBookings": 138,
  "needsAttention": 2
}
```

#### `GET /merchant/analytics/review-distribution`
Rating distribution for analytics.

**Query params:** `period` (7d/30d/90d)

**Response:**
```json
{
  "period": "30d",
  "distribution": [
    { "rating": 5, "count": 29, "percentage": 61.7 },
    { "rating": 4, "count": 11, "percentage": 23.4 },
    { "rating": 3, "count": 4, "percentage": 8.5 },
    { "rating": 2, "count": 2, "percentage": 4.3 },
    { "rating": 1, "count": 1, "percentage": 2.1 }
  ]
}
```

#### `GET /merchant/analytics/review-trend`
Weekly average rating over time.

**Query params:** `period` (7d/30d/90d)

**Response:**
```json
{
  "period": "30d",
  "trend": [
    { "week": "2026-03-24", "avgRating": 4.3, "count": 5 },
    { "week": "2026-03-31", "avgRating": 4.7, "count": 8 },
    { "week": "2026-04-07", "avgRating": 4.5, "count": 6 },
    { "week": "2026-04-14", "avgRating": 4.8, "count": 4 }
  ]
}
```

---

## Database

No schema changes required. The existing `reviews` table has all needed columns:

```
reviews
├── id (uuid, PK)
├── merchant_id (uuid, FK → merchants)
├── client_id (uuid, FK → clients)
├── booking_id (uuid, FK → bookings)
├── rating (integer, CHECK 1–5)
├── comment (text, nullable)
├── is_alert_sent (boolean, default false)
└── created_at (timestamptz)
```

---

## Existing Infrastructure Used

| Component | Status | Notes |
|-----------|--------|-------|
| `reviews` table | Exists | All columns present |
| `scheduleReviewRequest()` | Exists | Queues WhatsApp 30min post-completion |
| `handleReviewRequest()` worker | Exists | Sends WhatsApp with `/review/{bookingId}` link |
| Analytics `avg_rating` per staff | Exists | Already joins reviews table |
| Client profile placeholder | Exists | `PlaceholderSection` ready to replace |
| BullMQ notification worker | Exists | Add `low_rating_alert` handler |
| WhatsApp + email sending | Exists | Reuse `sendWhatsApp()` and `sendEmail()` |

---

## Files to Create

- `glowos/apps/web/app/review/[bookingId]/page.tsx` — review submission page
- `glowos/apps/web/app/dashboard/reviews/page.tsx` — merchant reviews dashboard
- `glowos/services/api/src/routes/reviews.ts` — review API endpoints

## Files to Modify

- `glowos/services/api/src/index.ts` — mount reviews router
- `glowos/services/api/src/workers/notification.worker.ts` — add `low_rating_alert` handler
- `glowos/apps/web/app/dashboard/layout.tsx` — add Reviews sidebar item
- `glowos/apps/web/app/dashboard/clients/[id]/page.tsx` — replace reviews placeholder
- `glowos/apps/web/app/dashboard/analytics/page.tsx` — add 2 review sections
- `glowos/services/api/src/routes/analytics.ts` — add 2 review analytics endpoints

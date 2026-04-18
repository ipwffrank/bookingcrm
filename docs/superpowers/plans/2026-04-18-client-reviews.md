# Client Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a client review system with a public review submission page, merchant dashboard tab, client profile integration, analytics sections, and low-rating WhatsApp alerts.

**Architecture:** Public review page at `/review/[bookingId]` (no auth). API routes split into public review endpoints (mounted at `/review`) and merchant-scoped endpoints (mounted at `/merchant/reviews`). Analytics endpoints added to existing `analyticsRouter`. Low-rating alert handled by existing BullMQ notification worker.

**Tech Stack:** Hono API, Drizzle ORM (existing `reviews` table), Next.js 15 App Router, BullMQ, Twilio WhatsApp

---

## File Map

### New files:
- `glowos/services/api/src/routes/reviews.ts` — public review GET/POST + merchant-scoped review list/stats endpoints
- `glowos/apps/web/app/review/[bookingId]/page.tsx` — public review submission page (client-facing)
- `glowos/apps/web/app/dashboard/reviews/page.tsx` — merchant reviews dashboard tab

### Modified files:
- `glowos/services/api/src/index.ts` — mount review routers
- `glowos/services/api/src/workers/notification.worker.ts` — add `low_rating_alert` handler + switch case
- `glowos/services/api/src/routes/analytics.ts` — add review-distribution + review-trend endpoints
- `glowos/apps/web/app/dashboard/layout.tsx` — add Reviews nav item + StarIcon
- `glowos/apps/web/app/dashboard/clients/[id]/page.tsx` — replace reviews PlaceholderSection with real data
- `glowos/apps/web/app/dashboard/analytics/page.tsx` — add RatingDistribution + RatingTrend components

---

## Task 1: Review API — Public Endpoints + Merchant List/Stats

**Files:**
- Create: `glowos/services/api/src/routes/reviews.ts`
- Modify: `glowos/services/api/src/index.ts`

- [ ] **Step 1: Create `reviews.ts` with public GET endpoint**

Create `glowos/services/api/src/routes/reviews.ts`:

```typescript
import { Hono } from "hono";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { db, bookings, reviews, clients, clientProfiles, services, staff, merchants } from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { addJob } from "../lib/queue.js";
import type { AppVariables } from "../lib/types.js";

// ─── Public routes (no auth) ─────────────────────────────────────────────────

export const publicReviewRouter = new Hono<{ Variables: AppVariables }>();

// GET /review/:bookingId — fetch booking details for the review page
publicReviewRouter.get("/:bookingId", async (c) => {
  const bookingId = c.req.param("bookingId")!;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(bookingId)) {
    return c.json({ error: "Bad Request", message: "Invalid booking ID" }, 400);
  }

  const [row] = await db
    .select({
      bookingId: bookings.id,
      status: bookings.status,
      startTime: bookings.startTime,
      merchantName: merchants.name,
      merchantLogo: merchants.logoUrl,
      serviceName: services.name,
      staffName: staff.name,
    })
    .from(bookings)
    .innerJoin(merchants, eq(bookings.merchantId, merchants.id))
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(staff, eq(bookings.staffId, staff.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!row || row.status !== "completed") {
    return c.json({ error: "Not Found", message: "Booking not found or not completed" }, 404);
  }

  // Check if already reviewed
  const [existing] = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(eq(reviews.bookingId, bookingId))
    .limit(1);

  return c.json({
    merchantName: row.merchantName,
    merchantLogo: row.merchantLogo,
    serviceName: row.serviceName,
    staffName: row.staffName,
    appointmentDate: row.startTime,
    alreadyReviewed: !!existing,
  });
});
```

- [ ] **Step 2: Add public POST endpoint for review submission**

Append to `reviews.ts` after the GET endpoint:

```typescript
// POST /review/:bookingId — submit a review
publicReviewRouter.post("/:bookingId", async (c) => {
  const bookingId = c.req.param("bookingId")!;

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(bookingId)) {
    return c.json({ error: "Bad Request", message: "Invalid booking ID" }, 400);
  }

  const body = await c.req.json<{ rating: number; comment?: string }>();

  // Validate rating
  if (!body.rating || !Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
    return c.json({ error: "Bad Request", message: "Rating must be an integer from 1 to 5" }, 400);
  }

  // Validate comment length
  if (body.comment && body.comment.length > 1000) {
    return c.json({ error: "Bad Request", message: "Comment must be 1000 characters or less" }, 400);
  }

  // Load booking
  const [booking] = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      merchantId: bookings.merchantId,
      clientId: bookings.clientId,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking || booking.status !== "completed") {
    return c.json({ error: "Not Found", message: "Booking not found or not completed" }, 404);
  }

  // Check for duplicate review
  const [existing] = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(eq(reviews.bookingId, bookingId))
    .limit(1);

  if (existing) {
    return c.json({ error: "Conflict", message: "You've already reviewed this appointment" }, 409);
  }

  // Insert review
  await db.insert(reviews).values({
    merchantId: booking.merchantId,
    clientId: booking.clientId,
    bookingId: booking.id,
    rating: body.rating,
    comment: body.comment?.trim() || null,
  });

  // Queue low-rating alert if rating <= 3
  if (body.rating <= 3) {
    await addJob("notifications", "low_rating_alert", {
      booking_id: bookingId,
    });
  }

  return c.json({ success: true });
});
```

- [ ] **Step 3: Add merchant-scoped review list and stats endpoints**

Append to `reviews.ts`:

```typescript
// ─── Merchant-scoped routes (auth required) ──────────────────────────────────

export const merchantReviewRouter = new Hono<{ Variables: AppVariables }>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getReviewPeriodBounds(period: string): { start: Date; end: Date } | null {
  if (period === "all") return null;
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end };
}

// GET /merchant/reviews — list reviews with filters
merchantReviewRouter.get("/", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const ratingFilter = c.req.query("rating");
  const staffFilter = c.req.query("staffId");
  const period = c.req.query("period") ?? "30d";
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
  const offset = Number(c.req.query("offset") ?? 0);

  const bounds = getReviewPeriodBounds(period);

  const conditions = [eq(reviews.merchantId, merchantId)];
  if (bounds) {
    conditions.push(gte(reviews.createdAt, bounds.start));
    conditions.push(lte(reviews.createdAt, bounds.end));
  }
  if (ratingFilter) {
    conditions.push(eq(reviews.rating, Number(ratingFilter)));
  }
  if (staffFilter) {
    conditions.push(eq(bookings.staffId, staffFilter));
  }

  const rows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      comment: reviews.comment,
      createdAt: reviews.createdAt,
      clientName: clients.name,
      clientEmail: clients.email,
      serviceName: services.name,
      staffName: staff.name,
      appointmentDate: bookings.startTime,
    })
    .from(reviews)
    .innerJoin(bookings, eq(reviews.bookingId, bookings.id))
    .innerJoin(clients, eq(reviews.clientId, clients.id))
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(staff, eq(bookings.staffId, staff.id))
    .where(and(...conditions))
    .orderBy(desc(reviews.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ reviews: rows });
});

// GET /merchant/reviews/stats — summary stats for dashboard cards
merchantReviewRouter.get("/stats", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const period = c.req.query("period") ?? "30d";
  const bounds = getReviewPeriodBounds(period);

  const periodConditions = [eq(reviews.merchantId, merchantId)];
  if (bounds) {
    periodConditions.push(gte(reviews.createdAt, bounds.start));
    periodConditions.push(lte(reviews.createdAt, bounds.end));
  }

  // Avg rating + total reviews + needs attention in one query
  const [stats] = await db
    .select({
      avgRating: sql<number>`coalesce(avg(cast(${reviews.rating} as numeric)), 0)`,
      totalReviews: sql<number>`cast(count(*) as int)`,
      needsAttention: sql<number>`cast(count(*) filter (where ${reviews.rating} <= 3) as int)`,
    })
    .from(reviews)
    .where(and(...periodConditions));

  // Reviews this month (always calendar month, not period-based)
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [monthCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(reviews)
    .where(and(eq(reviews.merchantId, merchantId), gte(reviews.createdAt, monthStart)));

  // Completed bookings in period (for response rate)
  const bookingConditions = [
    eq(bookings.merchantId, merchantId),
    eq(bookings.status, "completed"),
  ];
  if (bounds) {
    bookingConditions.push(gte(bookings.completedAt, bounds.start));
    bookingConditions.push(lte(bookings.completedAt, bounds.end));
  }

  const [completedCount] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(bookings)
    .where(and(...bookingConditions));

  const totalReviews = Number(stats.totalReviews);
  const completedBookings = Number(completedCount.count);

  return c.json({
    avgRating: parseFloat(Number(stats.avgRating).toFixed(1)),
    totalReviews,
    reviewsThisMonth: Number(monthCount.count),
    responseRate: completedBookings > 0 ? parseFloat((totalReviews / completedBookings).toFixed(2)) : 0,
    completedBookings,
    needsAttention: Number(stats.needsAttention),
  });
});
```

- [ ] **Step 4: Mount both routers in `index.ts`**

In `glowos/services/api/src/index.ts`, add import and mount lines:

Add import (after line 22, the `closuresRouter` import):
```typescript
import { publicReviewRouter, merchantReviewRouter } from "./routes/reviews.js";
```

Add route mounting (after line 74, the `publicClosuresRouter` line):
```typescript
app.route("/review", publicReviewRouter);
app.route("/merchant/reviews", merchantReviewRouter);
```

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/projects/bookingcrm
git add glowos/services/api/src/routes/reviews.ts glowos/services/api/src/index.ts
git commit -m "feat: review API — public submission + merchant list/stats endpoints"
```

---

## Task 2: Low-Rating Alert in Notification Worker

**Files:**
- Modify: `glowos/services/api/src/workers/notification.worker.ts`

- [ ] **Step 1: Add `LowRatingAlertData` interface**

In `notification.worker.ts`, after the existing interfaces (around line 55, after `PostServiceRebookData`), add:

```typescript
interface LowRatingAlertData {
  booking_id: string;
}
```

- [ ] **Step 2: Add `handleLowRatingAlert` function**

Add after the `handlePostServiceRebook` function (after line 689):

```typescript
async function handleLowRatingAlert(bookingId: string): Promise<void> {
  const row = await loadBookingWithDetails(bookingId);
  if (!row) {
    console.warn("[NotificationWorker] low_rating_alert: booking not found", { bookingId });
    return;
  }

  const { booking, merchant, service, client } = row;

  // Load the review
  const [review] = await db
    .select({ id: reviews.id, rating: reviews.rating, comment: reviews.comment })
    .from(reviews)
    .where(eq(reviews.bookingId, bookingId))
    .limit(1);

  if (!review) {
    console.warn("[NotificationWorker] low_rating_alert: review not found", { bookingId });
    return;
  }

  // Find merchant owner's phone (from merchant_users with role=owner)
  const [owner] = await db
    .select({ phone: merchantUsers.phone })
    .from(merchantUsers)
    .where(and(eq(merchantUsers.merchantId, merchant.id), eq(merchantUsers.role, "owner")))
    .limit(1);

  if (!owner?.phone) {
    console.warn("[NotificationWorker] low_rating_alert: merchant owner has no phone", { merchantId: merchant.id });
    return;
  }

  const commentLine = review.comment ? `"${review.comment}"` : "No comment left.";

  const message = [
    `⚠️ New review needs attention`,
    ``,
    `${client.name} rated their ${service.name} appointment ${review.rating}/5 stars.`,
    commentLine,
    ``,
    `Check your dashboard: ${config.frontendUrl}/dashboard/reviews`,
  ].join("\n");

  const sid = await sendWhatsApp(owner.phone, message);

  // Mark alert as sent
  await db
    .update(reviews)
    .set({ isAlertSent: true })
    .where(eq(reviews.id, review.id));

  await logNotification({
    merchantId: merchant.id,
    clientId: client.id,
    bookingId: booking.id,
    type: "low_rating_alert",
    channel: "whatsapp",
    recipient: owner.phone,
    messageBody: message,
    status: sid ? "sent" : "failed",
    twilioSid: sid || undefined,
  });

  console.log("[NotificationWorker] low_rating_alert handled", { bookingId, rating: review.rating });
}
```

- [ ] **Step 3: Add import for `reviews` and `merchantUsers` tables**

At the top of `notification.worker.ts`, ensure the import from `@glowos/db` includes `reviews` and `merchantUsers`:

Update the existing db import line to include `reviews` and `merchantUsers` if not already present.

- [ ] **Step 4: Add switch case for `low_rating_alert`**

In the `createNotificationWorker` function's switch statement (around line 753, before the `default` case):

```typescript
        case "low_rating_alert": {
          const data = job.data as LowRatingAlertData;
          await handleLowRatingAlert(data.booking_id);
          break;
        }
```

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/projects/bookingcrm
git add glowos/services/api/src/workers/notification.worker.ts
git commit -m "feat: low-rating alert — WhatsApp notification to merchant for reviews ≤3 stars"
```

---

## Task 3: Review Submission Page (Frontend)

**Files:**
- Create: `glowos/apps/web/app/review/[bookingId]/page.tsx`

- [ ] **Step 1: Create the review submission page**

Create `glowos/apps/web/app/review/[bookingId]/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface BookingDetails {
  merchantName: string;
  merchantLogo: string | null;
  serviceName: string;
  staffName: string;
  appointmentDate: string;
  alreadyReviewed: boolean;
}

function getApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
}

function StarRating({ rating, onRate }: { rating: number; onRate: (r: number) => void }) {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex justify-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onRate(star)}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          className="text-4xl transition-transform hover:scale-110 focus:outline-none"
          aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
        >
          <span className={(hover || rating) >= star ? 'text-[#c4a778]' : 'text-gray-200'}>
            ★
          </span>
        </button>
      ))}
    </div>
  );
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
}

export default function ReviewPage() {
  const params = useParams();
  const bookingId = params.bookingId as string;

  const [details, setDetails] = useState<BookingDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch(`${getApiUrl()}/review/${bookingId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { message?: string }).message || 'Not found');
        }
        return res.json();
      })
      .then((data: BookingDetails) => {
        setDetails(data);
        if (data.alreadyReviewed) setSubmitted(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [bookingId]);

  async function handleSubmit() {
    if (rating === 0) return;
    setSubmitting(true);

    try {
      const res = await fetch(`${getApiUrl()}/review/${bookingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message || 'Failed to submit');
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafaf8] flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading…</div>
      </div>
    );
  }

  if (error && !details) {
    return (
      <div className="min-h-screen bg-[#fafaf8] flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!details) return null;

  // Thank-you screen
  if (submitted) {
    return (
      <div className="min-h-screen bg-[#fafaf8] flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Thank you!</h1>
          <p className="text-sm text-gray-500">Your feedback has been shared with {details.merchantName}.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafaf8] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        {/* Merchant header */}
        <div className="text-center mb-8">
          {details.merchantLogo ? (
            <img src={details.merchantLogo} alt={details.merchantName} className="w-14 h-14 rounded-full mx-auto mb-3 object-cover" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#c4a778] to-[#d4b88a] flex items-center justify-center mx-auto mb-3">
              <span className="text-white font-bold text-lg">{getInitials(details.merchantName)}</span>
            </div>
          )}
          <h1 className="font-serif text-xl font-semibold text-[#1a1a2e]">{details.merchantName}</h1>
          <p className="text-sm text-gray-500 mt-1">
            How was your {details.serviceName} on {formatDate(details.appointmentDate)}?
          </p>
        </div>

        {/* Staff card */}
        <div className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center font-semibold text-indigo-600 text-sm flex-shrink-0">
            {getInitials(details.staffName)}
          </div>
          <div>
            <div className="font-semibold text-sm text-[#1a1a2e]">{details.staffName}</div>
            <div className="text-xs text-gray-400">Your specialist</div>
          </div>
        </div>

        {/* Star rating */}
        <div className="mb-6 text-center">
          <StarRating rating={rating} onRate={setRating} />
          <p className="text-xs text-gray-400 mt-2">Tap to rate</p>
        </div>

        {/* Comment */}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Tell us about your experience (optional)"
          maxLength={1000}
          rows={3}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#c4a778]/50 resize-none mb-4"
        />

        {/* Error */}
        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={rating === 0 || submitting}
          className="w-full py-3.5 bg-[#1a1a2e] text-white rounded-xl font-semibold text-sm hover:bg-[#2a2a3e] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Submitting…' : 'Submit Review'}
        </button>

        <p className="text-[11px] text-gray-400 text-center mt-3">
          Your review is shared with the business only, not displayed publicly.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/Desktop/projects/bookingcrm
git add glowos/apps/web/app/review/[bookingId]/page.tsx
git commit -m "feat: review submission page — star rating + comment for clients"
```

---

## Task 4: Merchant Reviews Dashboard Page

**Files:**
- Create: `glowos/apps/web/app/dashboard/reviews/page.tsx`
- Modify: `glowos/apps/web/app/dashboard/layout.tsx`

- [ ] **Step 1: Create the reviews dashboard page**

Create `glowos/apps/web/app/dashboard/reviews/page.tsx`:

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';

interface ReviewStats {
  avgRating: number;
  totalReviews: number;
  reviewsThisMonth: number;
  responseRate: number;
  completedBookings: number;
  needsAttention: number;
}

interface ReviewItem {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  clientName: string;
  clientEmail: string;
  serviceName: string;
  staffName: string;
  appointmentDate: string;
}

type Period = '7d' | '30d' | '90d' | 'all';

function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-sm tracking-wider">
      {[1, 2, 3, 4, 5].map(s => (
        <span key={s} className={s <= rating ? 'text-[#c4a778]' : 'text-gray-200'}>★</span>
      ))}
    </span>
  );
}

// Color palette for initials avatars
const AVATAR_COLORS = [
  { bg: 'bg-blue-100', text: 'text-blue-600' },
  { bg: 'bg-pink-100', text: 'text-pink-600' },
  { bg: 'bg-purple-100', text: 'text-purple-600' },
  { bg: 'bg-emerald-100', text: 'text-emerald-600' },
  { bg: 'bg-amber-100', text: 'text-amber-700' },
  { bg: 'bg-cyan-100', text: 'text-cyan-600' },
];

function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function ReviewsPage() {
  const router = useRouter();
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState<Period>('30d');
  const [ratingFilter, setRatingFilter] = useState<string>('');
  const [staffFilter, setStaffFilter] = useState<string>('');
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ period });
      if (ratingFilter) params.set('rating', ratingFilter);
      if (staffFilter) params.set('staffId', staffFilter);

      const [statsData, reviewsData] = await Promise.all([
        apiFetch(`/merchant/reviews/stats?period=${period}`),
        apiFetch(`/merchant/reviews?${params.toString()}`),
      ]);

      setStats(statsData as ReviewStats);
      setReviews((reviewsData as { reviews: ReviewItem[] }).reviews);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [period, ratingFilter, staffFilter, router]);

  useEffect(() => {
    // Fetch staff list once
    apiFetch('/merchant/staff')
      .then((data: unknown) => {
        const staffData = data as { id: string; name: string }[];
        setStaffList(staffData);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) { router.push('/login'); return; }
    fetchData();
  }, [fetchData, router]);

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Reviews</h1>

      {/* ── Stats cards ── */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Avg Rating</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{stats.avgRating.toFixed(1)}</p>
            <Stars rating={Math.round(stats.avgRating)} />
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Total Reviews</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{stats.totalReviews}</p>
            <p className="text-xs text-emerald-600 mt-0.5">+{stats.reviewsThisMonth} this month</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Response Rate</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{Math.round(stats.responseRate * 100)}%</p>
            <p className="text-xs text-gray-400 mt-0.5">{stats.totalReviews} of {stats.completedBookings} bookings</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Needs Attention</p>
            <p className={`text-2xl font-bold mt-1 ${stats.needsAttention > 0 ? 'text-red-500' : 'text-gray-900'}`}>{stats.needsAttention}</p>
            <p className="text-xs text-red-400 mt-0.5">≤ 3 stars</p>
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={ratingFilter}
          onChange={e => setRatingFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white"
        >
          <option value="">All ratings</option>
          {[5, 4, 3, 2, 1].map(r => (
            <option key={r} value={r}>{'★'.repeat(r)} ({r})</option>
          ))}
        </select>
        <select
          value={staffFilter}
          onChange={e => setStaffFilter(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white"
        >
          <option value="">All staff</option>
          {staffList.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select
          value={period}
          onChange={e => setPeriod(e.target.value as Period)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      {/* ── Review list ── */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 animate-pulse">
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-full bg-gray-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-1/3" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-gray-400 text-sm">No reviews found for the selected filters.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map(review => {
            const isLow = review.rating <= 3;
            const color = avatarColor(review.clientName);
            return (
              <div
                key={review.id}
                className={`rounded-xl border p-4 ${isLow ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full ${color.bg} flex items-center justify-center font-semibold text-xs ${color.text} flex-shrink-0`}>
                      {getInitials(review.clientName)}
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-gray-900">{review.clientName}</p>
                      <p className="text-xs text-gray-400">{review.serviceName} · {review.staffName} · {formatDate(review.appointmentDate)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isLow && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-600 border border-red-200">Needs attention</span>
                    )}
                    <Stars rating={review.rating} />
                  </div>
                </div>
                {review.comment && (
                  <p className="text-sm text-gray-700 leading-relaxed">&ldquo;{review.comment}&rdquo;</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add Reviews nav item + StarIcon to dashboard layout**

In `glowos/apps/web/app/dashboard/layout.tsx`:

Add `StarIcon` component after the existing icon components (after line ~129, alongside the other icon functions):

```typescript
function StarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
    </svg>
  );
}
```

Add to NAV_ITEMS array after the Clients entry (after `{ href: '/dashboard/clients', label: 'Clients', icon: HeartIcon }`):

```typescript
  { href: '/dashboard/reviews', label: 'Reviews', icon: StarIcon },
```

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/projects/bookingcrm
git add glowos/apps/web/app/dashboard/reviews/page.tsx glowos/apps/web/app/dashboard/layout.tsx
git commit -m "feat: merchant reviews dashboard — stats, filters, review list with low-rating highlights"
```

---

## Task 5: Client Profile — Replace Reviews Placeholder

**Files:**
- Modify: `glowos/apps/web/app/dashboard/clients/[id]/page.tsx`

- [ ] **Step 1: Add review fetching to the client profile page**

In `glowos/apps/web/app/dashboard/clients/[id]/page.tsx`, add a `ClientReview` interface near the other types at the top of the file:

```typescript
interface ClientReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  serviceName: string;
  staffName: string;
  appointmentDate: string;
}
```

Add a new state variable alongside the existing ones (around line 116):

```typescript
const [clientReviews, setClientReviews] = useState<ClientReview[]>([]);
```

In the `useEffect` that fetches client data (around line 120-135), add a second fetch for reviews after the existing `apiFetch`. Inside the `.then()` chain, add:

```typescript
    // Fetch client reviews
    apiFetch(`/merchant/reviews?clientId=${profileId}&period=all&limit=10`)
      .then((d: unknown) => {
        const result = d as { reviews: ClientReview[] };
        setClientReviews(result.reviews);
      })
      .catch(() => {}); // Non-critical — reviews section stays empty
```

- [ ] **Step 2: Add `clientId` filter support to the merchant reviews endpoint**

In `glowos/services/api/src/routes/reviews.ts`, in the `GET /merchant/reviews` handler, add a `clientId` filter alongside the existing filters.

After the `staffFilter` declaration, add:

```typescript
  const clientFilter = c.req.query("clientId");
```

In the conditions array, add:

```typescript
  if (clientFilter) {
    conditions.push(eq(reviews.clientId, clientFilter));
  }
```

- [ ] **Step 3: Replace the Reviews PlaceholderSection with real review data**

In `glowos/apps/web/app/dashboard/clients/[id]/page.tsx`, replace the reviews placeholder block (lines 316-325) with:

```tsx
      {/* ── Reviews ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"/>
          </svg>
          <h3 className="text-sm font-semibold text-gray-700">Reviews</h3>
        </div>
        {clientReviews.length === 0 ? (
          <p className="text-xs text-gray-400">No reviews yet</p>
        ) : (
          <div className="space-y-3">
            {clientReviews.map(review => (
              <div key={review.id} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs tracking-wider">
                    {[1, 2, 3, 4, 5].map(s => (
                      <span key={s} className={s <= review.rating ? 'text-[#c4a778]' : 'text-gray-200'}>★</span>
                    ))}
                  </span>
                  <span className="text-[11px] text-gray-400">
                    {new Date(review.appointmentDate).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                <p className="text-xs text-gray-500">{review.serviceName} · {review.staffName}</p>
                {review.comment && (
                  <p className="text-xs text-gray-700 mt-1">&ldquo;{review.comment}&rdquo;</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
```

- [ ] **Step 4: Commit**

```bash
cd ~/Desktop/projects/bookingcrm
git add glowos/apps/web/app/dashboard/clients/[id]/page.tsx glowos/services/api/src/routes/reviews.ts
git commit -m "feat: client profile shows real review history, replace placeholder"
```

---

## Task 6: Analytics — Review Distribution + Rating Trend

**Files:**
- Modify: `glowos/services/api/src/routes/analytics.ts`
- Modify: `glowos/apps/web/app/dashboard/analytics/page.tsx`

- [ ] **Step 1: Add review-distribution API endpoint**

In `glowos/services/api/src/routes/analytics.ts`, add before the final export line:

```typescript
// ─── GET /merchant/analytics/review-distribution ──────────────────────────────

analyticsRouter.get("/review-distribution", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const days = getPeriodDays(periodParam);
  const { start, end } = getPeriodBounds(days);

  const rows = await db
    .select({
      rating: reviews.rating,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.merchantId, merchantId),
        gte(reviews.createdAt, start),
        lte(reviews.createdAt, end)
      )
    )
    .groupBy(reviews.rating)
    .orderBy(sql`${reviews.rating} desc`);

  const total = rows.reduce((sum, r) => sum + Number(r.count), 0);

  // Ensure all 5 ratings are present
  const distribution = [5, 4, 3, 2, 1].map(rating => {
    const row = rows.find(r => r.rating === rating);
    const count = row ? Number(row.count) : 0;
    return {
      rating,
      count,
      percentage: total > 0 ? parseFloat(((count / total) * 100).toFixed(1)) : 0,
    };
  });

  return c.json({ period: periodParam, distribution });
});
```

- [ ] **Step 2: Add review-trend API endpoint**

Append to `analytics.ts` before the export:

```typescript
// ─── GET /merchant/analytics/review-trend ─────────────────────────────────────

analyticsRouter.get("/review-trend", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId")!;
  const periodParam = c.req.query("period") ?? "30d";
  const days = getPeriodDays(periodParam);
  const { start, end } = getPeriodBounds(days);

  const rows = await db
    .select({
      week: sql<string>`to_char(date_trunc('week', ${reviews.createdAt}), 'YYYY-MM-DD')`,
      avgRating: sql<number>`avg(cast(${reviews.rating} as numeric))`,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.merchantId, merchantId),
        gte(reviews.createdAt, start),
        lte(reviews.createdAt, end)
      )
    )
    .groupBy(sql`date_trunc('week', ${reviews.createdAt})`)
    .orderBy(sql`date_trunc('week', ${reviews.createdAt}) asc`);

  return c.json({
    period: periodParam,
    trend: rows.map(r => ({
      week: r.week,
      avgRating: parseFloat(Number(r.avgRating).toFixed(1)),
      count: Number(r.count),
    })),
  });
});
```

- [ ] **Step 3: Add interfaces to the analytics page**

In `glowos/apps/web/app/dashboard/analytics/page.tsx`, add these interfaces near the other interfaces (around line 94):

```typescript
interface ReviewDistributionRow { rating: number; count: number; percentage: number; }
interface ReviewDistributionData { period: string; distribution: ReviewDistributionRow[]; }

interface ReviewTrendRow { week: string; avgRating: number; count: number; }
interface ReviewTrendData { period: string; trend: ReviewTrendRow[]; }
```

- [ ] **Step 4: Add RatingDistribution component**

Add after the existing `PeakHoursHeatmap` component (around line 720):

```tsx
function RatingDistribution({ data }: { data: ReviewDistributionData | null }) {
  if (!data || data.distribution.every(d => d.count === 0)) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Rating Distribution</h3>
        <p className="text-xs text-gray-400">No reviews in this period.</p>
      </div>
    );
  }

  const total = data.distribution.reduce((sum, d) => sum + d.count, 0);
  const avg = total > 0
    ? data.distribution.reduce((sum, d) => sum + d.rating * d.count, 0) / total
    : 0;

  function barColor(rating: number): string {
    if (rating >= 4) return 'bg-[#c4a778]';
    if (rating === 3) return 'bg-amber-400';
    return 'bg-red-400';
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Rating Distribution</h3>
      <div className="space-y-2">
        {data.distribution.map(d => (
          <div key={d.rating} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-7 text-right">{d.rating} ★</span>
            <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
              <div
                className={`h-full ${barColor(d.rating)} rounded`}
                style={{ width: `${d.percentage}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 w-16">{d.count} ({d.percentage}%)</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-3 pt-3 border-t border-gray-100">
        <span className="text-xs text-gray-400">{total} reviews</span>
        <span className="text-sm font-semibold text-[#c4a778]">★ {avg.toFixed(1)} avg</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add RatingTrend component**

Add after `RatingDistribution`:

```tsx
function RatingTrend({ data }: { data: ReviewTrendData | null }) {
  if (!data || data.trend.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Average Rating Over Time</h3>
        <p className="text-xs text-gray-400">No reviews in this period.</p>
      </div>
    );
  }

  const maxRating = 5;
  const minRating = 1;
  const range = maxRating - minRating;
  const points = data.trend;
  const chartWidth = 400;
  const chartHeight = 140;
  const padding = 10;

  const xStep = points.length > 1 ? (chartWidth - 2 * padding) / (points.length - 1) : 0;

  const polyline = points
    .map((p, i) => {
      const x = padding + i * xStep;
      const y = chartHeight - padding - ((p.avgRating - minRating) / range) * (chartHeight - 2 * padding);
      return `${x},${y}`;
    })
    .join(' ');

  function formatWeek(weekStr: string): string {
    const d = new Date(weekStr + 'T00:00:00');
    return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Average Rating Over Time</h3>
      <div className="relative" style={{ height: chartHeight + 30 }}>
        {/* Y-axis labels */}
        {[5, 4, 3, 2, 1].map(val => {
          const y = chartHeight - padding - ((val - minRating) / range) * (chartHeight - 2 * padding);
          return (
            <span key={val} className="absolute text-[10px] text-gray-400" style={{ left: 0, top: y - 6 }}>
              {val}.0
            </span>
          );
        })}

        {/* Chart */}
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full"
          style={{ height: chartHeight, marginLeft: 28 }}
          preserveAspectRatio="none"
        >
          {/* Grid lines */}
          {[5, 4, 3, 2, 1].map(val => {
            const y = chartHeight - padding - ((val - minRating) / range) * (chartHeight - 2 * padding);
            return <line key={val} x1={0} y1={y} x2={chartWidth} y2={y} stroke="#f3f4f6" strokeWidth={1} />;
          })}
          <polyline
            fill="none"
            stroke="#c4a778"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={polyline}
          />
          {points.map((p, i) => {
            const x = padding + i * xStep;
            const y = chartHeight - padding - ((p.avgRating - minRating) / range) * (chartHeight - 2 * padding);
            return <circle key={i} cx={x} cy={y} r={3.5} fill="#c4a778" />;
          })}
        </svg>

        {/* X-axis labels */}
        <div className="flex justify-between" style={{ marginLeft: 28, marginTop: 4 }}>
          {points.map((p, i) => (
            <span key={i} className="text-[10px] text-gray-400">{formatWeek(p.week)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Wire up data fetching and rendering in the main component**

In the main `AnalyticsPage` component:

Add state variables alongside the existing ones:

```typescript
  const [reviewDistribution, setReviewDistribution] = useState<ReviewDistributionData | null>(null);
  const [reviewTrend, setReviewTrend] = useState<ReviewTrendData | null>(null);
```

In the `fetchAll` function, add two more fetch calls to the existing `Promise.all` (or as separate fetches alongside):

```typescript
      apiFetch(`/merchant/analytics/review-distribution?period=${period}`)
        .then((d: unknown) => setReviewDistribution(d as ReviewDistributionData))
        .catch(() => {}),
      apiFetch(`/merchant/analytics/review-trend?period=${period}`)
        .then((d: unknown) => setReviewTrend(d as ReviewTrendData))
        .catch(() => {}),
```

In the JSX return, add the two new components after the existing analytics sections (after the `PeakHoursHeatmap` and `RevByDow` components):

```tsx
          {/* ── Review analytics ── */}
          <RatingDistribution data={reviewDistribution} />
          <RatingTrend data={reviewTrend} />
```

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/projects/bookingcrm
git add glowos/services/api/src/routes/analytics.ts glowos/apps/web/app/dashboard/analytics/page.tsx
git commit -m "feat: analytics — rating distribution + rating trend charts"
```

---

## Task 7: Verify and Test End-to-End

**Files:** None (testing only)

- [ ] **Step 1: Run TypeScript type check**

```bash
cd ~/Desktop/projects/bookingcrm/glowos
pnpm turbo typecheck
```

Expected: 0 errors across all packages.

- [ ] **Step 2: Start the API server and verify endpoints**

```bash
cd ~/Desktop/projects/bookingcrm/glowos/services/api
npx tsx src/index.ts
```

Verify in logs:
- Server starts without errors
- Workers start (if REDIS_URL set)
- No import/module resolution errors

- [ ] **Step 3: Start the frontend dev server and test**

```bash
cd ~/Desktop/projects/bookingcrm/glowos/apps/web
pnpm dev
```

Test in browser:
1. Navigate to `/dashboard/reviews` — verify stats cards load, empty state shows if no reviews
2. Navigate to `/dashboard/analytics` — verify two new review sections appear at the bottom
3. Navigate to any client profile — verify the reviews section replaces the old placeholder
4. Navigate to `/review/{any-completed-booking-id}` — verify the review form renders

- [ ] **Step 4: Fix any typecheck or runtime errors**

If errors, fix and commit:

```bash
git add -A
git commit -m "fix: resolve typecheck and runtime errors in review feature"
```

- [ ] **Step 5: Final commit updating progress.md**

Update `progress.md` with Session 10 notes and commit.

import { Hono } from "hono";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { db, bookings, reviews, clients, services, staff, merchants } from "@glowos/db";
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

// POST /review/:bookingId — submit a review
publicReviewRouter.post("/:bookingId", async (c) => {
  const bookingId = c.req.param("bookingId")!;

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(bookingId)) {
    return c.json({ error: "Bad Request", message: "Invalid booking ID" }, 400);
  }

  let body: { rating: number; comment?: string };
  try {
    body = await c.req.json<{ rating: number; comment?: string }>();
  } catch {
    return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400);
  }

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
  try {
    await db.insert(reviews).values({
      merchantId: booking.merchantId,
      clientId: booking.clientId,
      bookingId: booking.id,
      rating: body.rating,
      comment: body.comment?.trim() || null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("unique") || message.includes("duplicate")) {
      return c.json({ error: "Conflict", message: "You've already reviewed this appointment" }, 409);
    }
    throw err;
  }

  // Queue low-rating alert if rating <= 3
  if (body.rating <= 3) {
    await addJob("notifications", "low_rating_alert", {
      booking_id: bookingId,
    });
  }

  return c.json({ success: true });
});

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
  const maxRatingFilter = c.req.query("maxRating");
  const staffFilter = c.req.query("staffId");
  const clientFilter = c.req.query("clientId");
  const period = c.req.query("period") ?? "30d";
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
  const offset = Number(c.req.query("offset") ?? 0);

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (staffFilter && !uuidRegex.test(staffFilter)) {
    return c.json({ error: "Bad Request", message: "Invalid staffId" }, 400);
  }
  if (clientFilter && !uuidRegex.test(clientFilter)) {
    return c.json({ error: "Bad Request", message: "Invalid clientId" }, 400);
  }

  const bounds = getReviewPeriodBounds(period);

  const conditions = [eq(reviews.merchantId, merchantId)];
  if (bounds) {
    conditions.push(gte(reviews.createdAt, bounds.start));
    conditions.push(lte(reviews.createdAt, bounds.end));
  }
  if (ratingFilter) {
    conditions.push(eq(reviews.rating, Number(ratingFilter)));
  }
  if (maxRatingFilter) {
    const maxR = Number(maxRatingFilter);
    if (!Number.isFinite(maxR) || maxR < 1 || maxR > 5) {
      return c.json({ error: "Bad Request", message: "maxRating must be 1–5" }, 400);
    }
    conditions.push(lte(reviews.rating, maxR));
  }
  if (staffFilter) {
    conditions.push(eq(bookings.staffId, staffFilter));
  }
  if (clientFilter) {
    conditions.push(eq(reviews.clientId, clientFilter));
  }

  const rows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      comment: reviews.comment,
      createdAt: reviews.createdAt,
      clientId: clients.id,
      clientName: clients.name,
      clientPhone: clients.phone,
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

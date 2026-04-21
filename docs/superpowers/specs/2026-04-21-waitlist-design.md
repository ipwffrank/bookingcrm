# Waitlist

**Date:** 2026-04-21
**Session:** 16
**Status:** Draft

## Problem

Clients who can't find a slot with their preferred staff on a preferred date/window lose trust and sometimes book elsewhere. Salons want a lightweight way to capture that demand, notify the right person when a slot opens, and give staff visibility to follow up manually if needed.

## Scope

**In scope**

- Client can "Join waitlist" from the booking widget when their picked date+staff has no available slot in their time window.
- Stored entry: `merchant`, `client`, `service`, `staff`, `target_date`, `window_start`, `window_end`, `status`.
- Auto-match when a booking is **cancelled** or **rescheduled out of** a slot that overlaps a waitlist entry. First-in-first-out.
- Notification via WhatsApp (existing `sendWhatsApp`), email fallback. Deep link → widget pre-fills the freed slot → one-tap confirm.
- 10-minute hold while a waitlisted client considers the offer. Miss the window → entry drops off; next entry gets notified.
- Dashboard card showing active entries with phone (tap-to-call) and a Remove action. Only renders when there's ≥1 active entry.
- Waitlist history surfaced on individual client detail page.

**Out of scope (explicit)**

- Proactive "add me to the waitlist even though slots are available" — widget only offers the waitlist when no slot fits the chosen window.
- Client can't change their waitlist entry after creating it. They cancel + re-join.
- No notification to other waitlisted clients when a higher-priority client takes the slot — they just stay pending.
- No deposit / payment requirement for joining the waitlist.
- No cap on waitlist entries per client. YAGNI.
- No sidebar nav item or standalone `/dashboard/waitlist` page — the dashboard card covers it.
- Notifying client if their waitlist entry expired at end of target date (silent expiry for v1).
- Bulk CSV export.

## Data Model

One new table, one migration.

```ts
// glowos/packages/db/src/schema/waitlist.ts
export const waitlist = pgTable("waitlist", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id").notNull().references(() => merchants.id, { onDelete: "cascade" }),
  clientId:   uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  serviceId:  uuid("service_id").notNull().references(() => services.id, { onDelete: "restrict" }),
  staffId:    uuid("staff_id").notNull().references(() => staff.id, { onDelete: "restrict" }),
  targetDate: date("target_date").notNull(),              // 'YYYY-MM-DD'
  windowStart: varchar("window_start", { length: 5 }).notNull(),  // 'HH:MM'
  windowEnd:   varchar("window_end", { length: 5 }).notNull(),    // 'HH:MM'
  status: varchar("status", { length: 20 }).notNull().default("pending")
    .$type<"pending" | "notified" | "booked" | "expired" | "cancelled">(),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
  notifiedBookingSlotId: uuid("notified_booking_slot_id"),  // references the booking that was cancelled and created the opening; nullable
  cancelToken: varchar("cancel_token", { length: 64 }).notNull(),  // unguessable token for self-cancel link
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  merchantIdx: index("waitlist_merchant_idx").on(table.merchantId),
  matchIdx: index("waitlist_match_idx").on(table.merchantId, table.staffId, table.targetDate, table.status),
}));
```

Migration `0012_waitlist.sql`.

## State Machine

```
                   create (widget)
                         │
                         ▼
                     pending ──────cancel/remove──────▶ cancelled
                         │
                match-fires (cancellation or reschedule)
                         │
                         ▼
                     notified  ─────confirm──────▶  booked
                         │
               10-min timer expires
                         │
                         ▼
                     expired
```

`expired` is a terminal state. Missing the 10-minute window removes the entry from consideration (per Section 4: Option A of brainstorming — "drop off the queue"). The client is free to re-join via the widget.

Entries also auto-expire at end of target date (EOD in merchant's timezone) via a scheduled job.

## API

### Public

#### `POST /waitlist`

Body:
```ts
{
  merchant_slug: string,
  client_name: string,
  client_phone: string,       // E.164
  client_email?: string,       // used as email fallback per Option B
  service_id: string,
  staff_id: string,
  target_date: string,         // 'YYYY-MM-DD'
  window_start: string,        // 'HH:MM'
  window_end: string,          // 'HH:MM'
}
```

- Validate `merchant_slug` → merchant; service and staff belong to that merchant.
- Validate `windowStart < windowEnd`; target_date ≥ today.
- Normalize phone (SG/MY per merchant's country).
- Find-or-create `clients` row by normalized phone on that merchant. Same `findOrCreateClient` helper used by walk-in group.
- Generate `cancelToken` with `crypto.randomUUID().replace(/-/g, '')`.
- Insert waitlist row with `status='pending'`.
- Send a WhatsApp confirmation: "You're on the waitlist for <service> with <staff> on <target_date> between <window>. We'll notify you if a slot opens up. Cancel: <link>".
- Return `{ id, cancelToken }` so widget can show the cancel link.

#### `DELETE /waitlist/:id?token=<cancelToken>`

Client-side cancellation via the WhatsApp link.

- 404 if not found, 403 if token mismatch.
- Set `status='cancelled'`, `updatedAt=now`.
- Return 200.

#### `POST /waitlist/:id/confirm?token=<cancelToken>`

Called when the waitlisted client accepts the freed slot from the widget's deep link (`/book?waitlist=<id>&token=<cancelToken>`).

- Validate token. Validate the waitlist row is `status='notified'` and `holdExpiresAt > now`.
- Use the `notifiedBookingSlotId` to locate the freed slot (merchant + staff + start time), create a new booking for this client, transactional with the waitlist update.
- Set waitlist `status='booked'`.
- Send WhatsApp "You're booked! …" using the existing booking-confirmation flow.
- 409 if the slot has already been filled (race with a walk-in create), or if the hold expired, or if already booked/cancelled.

### Merchant-scoped

#### `GET /merchant/waitlist?status=active|all`

Returns the dashboard-card and history lists.

- `active` (default): `status in (pending, notified)`, ordered by `createdAt ASC`.
- `all`: all statuses, ordered by `createdAt DESC`.
- Response: `{ entries: [...] }` with `id`, `clientId`, `clientName`, `clientPhone`, `serviceName`, `staffName`, `targetDate`, `windowStart`, `windowEnd`, `status`, `holdExpiresAt`, `createdAt`.

#### `DELETE /merchant/waitlist/:id`

Merchant-side removal. `requireMerchant`, ownership check, sets `status='cancelled'`.

#### `GET /merchant/clients/:id/waitlist-history`

Returns a client's historical waitlist entries for the merchant. For the client-detail page's "Waitlist history" section.

## Matcher

A worker job fires whenever a booking transitions to `cancelled` (via `POST /booking/:slug/cancel` or merchant cancel), or is **rescheduled such that its startTime moves away from the old slot** (reschedule creates a "freed slot" at the old time).

Job input: `{ merchantId, staffId, serviceId, freedStart: Date, freedEnd: Date }`. Service match is optional — the job first tries exact service match, then falls back to any service within the window (most merchants have interchangeable staff per service category, but we can tighten later).

```
find entries where
  merchant_id = ? AND staff_id = ? AND status = 'pending'
  AND target_date = freedStart::date
  AND window_start <= freedStart::time
  AND window_end   >= freedEnd::time   (freed slot fully inside window)
order by created_at asc
limit 1
```

If found:
- Set `status='notified'`, `notifiedAt=now`, `holdExpiresAt=now+10min`, `notifiedBookingSlotId=<freed slot origin booking id for reference>`.
- Send WhatsApp (with email fallback if sendWhatsApp throws or client_email exists and phone is unreachable): "A slot opened up — Sarah at 3:00 PM Tuesday 26 April. Confirm in 10 min: <deep link>"
- Schedule a follow-up job at `holdExpiresAt` that checks: if status still `notified`, flip to `expired` and re-run the matcher for the same freed slot (pick next entry).

### Trigger points

Booking cancel endpoint (`POST /booking/:slug/cancel` + `POST /merchant/bookings/:id/cancel`), booking reschedule endpoint (`PATCH /merchant/bookings/:id/reschedule`, and the merchant group PATCH that changes a row's `start_time`). Each calls `scheduleWaitlistMatchJob({ merchantId, staffId, serviceId, freedStart, freedEnd })`.

### End-of-day expiry

Cron job daily at midnight (merchant timezone): set `status='expired'` on any `pending`/`notified` rows whose `target_date < today`.

## Frontend

### Widget (`apps/web/app/[slug]/BookingWidget.tsx`)

When staff+date picked and **all candidate slots in the widget's current filter are unavailable**, replace the empty state with:

```
No slots available with Sarah on Tue 26 April.
[ Join waitlist instead ]
```

Click → small inline form:
- Time window (two HH:MM inputs; default = widest visible range, e.g., 9 AM – 6 PM).
- Phone + optional email (pre-filled if we already have them from an earlier step).
- Submit → `POST /waitlist` → toast "You're on the waitlist. We'll WhatsApp you if a slot opens."

A WhatsApp message is sent to confirm.

When the client later taps the deep link `/book?waitlist=<id>&token=<t>`:
- Widget mounts in "confirm freed slot" mode, reads the waitlist row, prefills staff+service+time, shows a single Confirm button.
- Confirm → `POST /waitlist/:id/confirm?token=<t>` → success → redirect to existing `/confirm` booking-confirmation flow. 409 → "This slot was released. Rejoin the waitlist?" → one-tap re-join.

### Dashboard card (`apps/web/app/dashboard/page.tsx`)

New component `apps/web/app/dashboard/components/WaitlistCard.tsx`. Fetches `/merchant/waitlist?status=active`.

- Render only if `entries.length > 0`.
- Positioned between Revenue and Low Ratings cards.
- Shows up to 5 rows; "+ view all" expands to show all remaining (no new page).
- Each row: client name · tappable phone (`tel:` link) · service · staff · date/window · status (with countdown for `notified`).
- Remove button per row → `DELETE /merchant/waitlist/:id` with optimistic UI.

### Client detail page (`apps/web/app/dashboard/clients/[id]/page.tsx`)

New "Waitlist history" section, only when `/merchant/clients/:id/waitlist-history` returns ≥1 entry. Simple list: target_date · window · service · staff · status. Placed below "Package Activity".

## Edge Cases

1. **Two waitlist entries for same slot, opening fires** → first-in wins. Entry #1 gets 10-min hold. Entry #2 stays `pending`. If entry #1 expires without confirming, matcher runs again and #2 gets notified.
2. **Entry #1's 10-min hold expires, slot still open** → `status='expired'`. Matcher re-fires for the same freed slot. Next pending entry (if any) gets `notified`.
3. **Matcher fires but no waitlist rows match** → silent. Slot stays open for normal widget/admin booking.
4. **Client cancels their waitlist after being notified** → `cancelled`. Matcher re-runs for that slot.
5. **Freed slot gets filled by a walk-in before the held client confirms** → `/waitlist/:id/confirm` returns 409 ("slot unavailable"). Waitlist entry stays `notified` until hold expires, then becomes `expired`. We do **not** re-match for a slot that's already gone — other matches only fire on new cancellations.
6. **Cancellation triggers the matcher but booking was in the past** — don't match entries for past dates. Matcher checks `target_date >= today`.
7. **Client has no WhatsApp account** — `sendWhatsApp` fails → if `client_email` is present, send email instead; otherwise log a warning and leave the entry `notified` (staff can manually contact via the dashboard card).
8. **Merchant cancels a booking whose staff/service has no waitlist entries** → nothing happens. Not an error.
9. **Widget submits a waitlist for a date in the past** → 400.
10. **Deep link reused after successful booking** → waitlist row is already `booked`; `/confirm` returns 409.

## Testing

- **API / curl:**
  - Create waitlist entry → verify DB row, verify WhatsApp confirmation fires (mock or inspect Twilio dashboard).
  - Cancel a booking that overlaps a waitlist entry → verify entry flips to `notified`, `holdExpiresAt` set ~10 min out.
  - Confirm deep link → verify new booking created, waitlist flips to `booked`.
  - Let hold expire → verify entry flips to `expired`, verify next pending entry (if seeded) picks up.
- **Frontend:** Playwright walk-through:
  1. Pick a date with no slots → click "Join waitlist" → fill form → submit → confirmation toast appears.
  2. Create a conflicting booking as merchant → cancel it via merchant dashboard → verify dashboard card shows the notified entry with a countdown.
  3. Visit the deep link → verify the widget shows the confirm screen → tap Confirm → booking created, card goes from "notified" to "booked" on next refresh.
  4. Let a hold expire → verify entry disappears from card.

## Migration / Rollout

- One DB migration: `0012_waitlist.sql` — new table + indexes.
- No feature flag. Additive.
- Deploy API + web together.

## Open Questions

None.

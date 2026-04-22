# Superadmin Role — Design Spec

**Date:** 2026-04-22
**Status:** Design — approved via auto-mode default defaults; ready to implement

---

## Purpose

A platform-level role for the developer/operator of GlowOS. Lets the developer
inspect cross-tenant state, reset/activate/deactivate client profiles, assist
merchants with debugging, and measure the WhatsApp → booking funnel — without
requiring the merchant to share credentials or create per-merchant ops
accounts.

Distinct from `owner` / `manager` / `staff` (merchant-scoped) and
`group_owner` (group-scoped across branches).

## Auth model

**Allowlist via env var:** `SUPER_ADMIN_EMAILS` (comma-separated). A
`merchantUsers` row whose email appears in the allowlist gets elevated to
superadmin on login. No separate table, no separate login page.

Rationale: fewest moving parts. Zero DB migrations for the access control
surface. Bootstrappable by editing Vercel env vars. Revokable by removing the
email from the list — no DB cleanup needed.

**JWT shape (self-mode):**
```
{ userId, merchantId, role: 'owner'|'manager'|'staff', superAdmin: true, ... }
```

**JWT shape (impersonation):**
```
{
  userId: <impersonatedOwnerUserId>,
  merchantId: <targetMerchantId>,
  role: 'owner',
  superAdmin: true,
  impersonating: true,
  actorUserId: <realUserId>,
  actorEmail: <realEmail>,
}
```

During impersonation, every existing `/merchant/*` endpoint works unchanged —
the JWT carries the target merchant's scope. The middleware logs all writes.

## Impersonation vs separate console

**Chose impersonation.** Superadmin can "View as merchant" → JWT re-issues,
routes to `/dashboard` with the target merchant's data. Every admin screen
works immediately. Banner at the top of every page during impersonation:

```
You are viewing [merchant name]'s data as [actor email]. Exit impersonation →
```

A small set of cross-tenant endpoints live at `/super/*` for the view-all-
merchants overview and WhatsApp funnel. These are the only bespoke surfaces.

Trade-off: audit logging must be explicit. Without impersonation-mode tracking,
a superadmin's writes would be indistinguishable from the owner's own writes.
Solved by wrapping `/merchant/*` writes in an audit-logging middleware that
reads `actorUserId` / `actorEmail` from the JWT.

## Data

**New tables (migration `0002_superadmin.sql`):**

```sql
super_admin_audit_log (
  id uuid primary key,
  actor_user_id uuid references merchant_users(id) on delete set null,
  actor_email varchar(255) not null,
  action varchar(40) not null,          -- 'impersonate_start' | 'impersonate_end' | 'write' | 'read'
  target_merchant_id uuid references merchants(id) on delete set null,
  method varchar(10),                    -- HTTP method for wrapped writes
  path text,                             -- request path
  metadata jsonb,
  created_at timestamp with tz not null default now()
)
create index on super_admin_audit_log (actor_user_id, created_at desc);
create index on super_admin_audit_log (target_merchant_id, created_at desc);

whatsapp_inbound_log (
  id uuid primary key,
  merchant_id uuid references merchants(id) on delete cascade,
  from_phone varchar(20) not null,       -- E.164 normalized
  body text not null,
  matched_client_id uuid references clients(id) on delete set null,
  twilio_message_sid varchar(255) unique,
  received_at timestamp with tz not null default now()
)
create index on whatsapp_inbound_log (merchant_id, received_at desc);
create index on whatsapp_inbound_log (from_phone);
```

Why `whatsapp_inbound_log` sits separate from `notification_log`: the log is
for outbound, this is for inbound. Different lifecycle, different authors
(client vs system). Keeping them apart makes the funnel query trivial and
avoids bloating the outbound table.

## API surface

### Inbound WhatsApp webhook
- `POST /webhooks/twilio/whatsapp-inbound` — Twilio TwiML endpoint. Verifies
  the Twilio signature header, parses `From` + `Body` + `MessageSid`,
  normalizes the phone, looks up the matching client across all merchants by
  phone, inserts a row. Returns an empty `<Response/>` (no auto-reply).

### Superadmin endpoints (all require `superAdmin: true` JWT)
- `POST /super/impersonate` `{ merchant_id }` → issues an impersonation JWT
  as defined above. Writes `impersonate_start` to audit log.
- `POST /super/end-impersonation` → re-issues a self-mode JWT. Writes
  `impersonate_end`.
- `GET /super/merchants?search=&limit=&offset=` → paginated list across all
  merchants with last-active-at, MTD revenue, booking count.
- `GET /super/analytics/overview?period=7d|30d|90d` → cross-tenant aggregate:
  total merchants, active merchants (bookings in period), total bookings,
  total revenue, new merchants.
- `GET /super/analytics/whatsapp-funnel?period=7d|30d&merchant_id=<optional>` →
  funnel metrics described below.

### WhatsApp funnel math

For the given period, per-merchant (or aggregate when `merchant_id` omitted):

1. **Outbound sent** = count rows in `notification_log` where
   `channel='whatsapp'` AND `status='sent'` AND `sent_at` in period.
2. **Inbound replies** = count rows in `whatsapp_inbound_log` where
   `received_at` in period.
3. **Conversions** = distinct `matched_client_id` from step 2 whose client
   has at least one booking created within 7 days (or 30 days) of an inbound
   reply.
4. **Conversion rate** = conversions / inbound replies.

Two reply-windows reported side-by-side: 7-day and 30-day.

Note — step 3 uses the *earliest* inbound-reply timestamp for the client
within the period as the anchor. A client who replies twice in the period
counts once.

## UI surface

### Banner (every page, impersonation mode)
A persistent ink banner across the top of the app when `impersonating: true`.

```
[VIEWING AS X]  You are managing [merchant name] as [actor email].
                                                       [Exit impersonation]
```

### `/super` (new)
- **Layout:** distinct sidebar from `/dashboard`. Four entries: Overview,
  Merchants, WhatsApp Funnel, Audit Log.
- Only accessible to `superAdmin: true` and only when not currently
  impersonating. (Impersonation mode redirects `/super/*` → `/dashboard`.)

### Pages

- **`/super`** — overview card grid (merchants, MTD revenue, bookings,
  new-merchant count); cross-tenant revenue chart.
- **`/super/merchants`** — table of merchants with search + sort. Each row
  has a "View as" button that calls `POST /super/impersonate` and pushes
  `/dashboard`.
- **`/super/whatsapp-funnel`** — the funnel numbers, per merchant. Table of
  merchant × outbound / inbound / 7d-conv / 30d-conv. Period selector.
- **`/super/audit-log`** — chronological log of superadmin actions.

## Middleware

**`requireSuperAdmin`** — rejects unless `superAdmin: true` on the JWT AND
`impersonating !== true`. Used on `/super/*` routes.

**`auditSuperAdminWrite`** — wraps all non-GET handlers that pass through
`requireMerchant` AND see `impersonating: true` in the JWT. Logs the
attempted write to `super_admin_audit_log` before calling the handler.

## Rollout

1. Schema + migration.
2. Auth plumbing (extend login to elevate on allowlist; extend JWT generator).
3. Impersonation endpoints + JWT swap.
4. `/super` layout + Overview + Merchants list + Impersonate button.
5. Twilio inbound webhook + schema + integration test.
6. WhatsApp funnel endpoint + UI.
7. Audit log middleware + `/super/audit-log` page.
8. Banner component (feature-flag on `impersonating` JWT claim).

Steps 5–7 can ship later as a second PR if the foundation rolls out first.
Steps 1–4 are the minimum viable superadmin: cross-tenant visibility +
impersonation + action logging from the start.

## Non-goals

- **Per-tenant role granularity.** Superadmin is all-or-nothing. No
  "superadmin but read-only" mode.
- **Merchant-side disclosure of impersonation.** The merchant does not see a
  banner or notification. (Can be added later if required by T&Cs.)
- **Multi-tenant search.** Not cross-client search (finding a single client
  across all merchants by phone); only merchant-level enumeration. Client-
  level lookup is left to per-merchant impersonation.
- **Two-factor for superadmin login.** Out of scope; add later if the
  allowlist becomes broader than a single developer.

## Risk

Impersonation via a mutable JWT is safe only if the JWT secret stays safe.
The current `JWT_SECRET` is shared with refresh tokens. Compromise of that
key lets an attacker mint a superadmin token. Mitigation: superadmin status
is additionally env-gated at login time — i.e. the server re-validates that
the user's email is still in `SUPER_ADMIN_EMAILS` on every token refresh and
on every `/super/*` request. Rotating the env var effectively revokes.

# Brand Invite Link — Design Spec

**Date:** 2026-04-26
**Phase:** Multi-branch Phase 2 — invite & onboarding
**Depends on:** brand-admin frontend Phase 1 + co-brand-admin promotion

---

## Goal

Let a brand admin invite an **existing merchant owner** (whose merchant is currently NOT in any group) to join the brand via a one-time, email-bound link. Acceptance is the consent step that:

1. Moves the recipient's merchant into the brand's group.
2. Promotes the recipient to co-brand-admin of the group (so they have full visibility into the brand they just joined).
3. Re-issues the recipient's tokens so the change takes effect immediately.

This closes the gap from the co-brand-admin spec — where promotion required the target's merchant to *already* be in the group, which today only happens via raw DB writes. Once invites land, the loop is fully self-serve.

## Scope

In:
- New table `brand_invites` (single migration, additive).
- API: create / list / cancel invites (brand admin); read invite by token (public); accept invite (authenticated recipient).
- Frontend: invite section on `/dashboard/group/admins` page (form + outstanding-invites table); public `/brand-invite/[token]` page for the recipient.

Out:
- Inviting an email that has no `merchant_users` row yet. Recipient must already have an account; the link tells them to sign up first if not. (A signup-then-accept flow is a future polish.)
- Multi-use invites. Each token is single-use, single-email.
- Email delivery. The brand admin shares the link manually (WhatsApp/email/etc.). Adding SendGrid here doubles complexity; we already have one untested email path (forgot-password). Defer.
- Audit logging.
- A "join brand without becoming a co-admin" option. Every accepted invite makes the recipient a co-brand-admin. If you don't want them as an admin, demote them after via `DELETE /group/admins/:userId`.
- Inviting an already-co-admin (no-op; reject at create time).
- Inviting an existing merchant whose merchant is already in **another** group. Accept will 409. Brand admin should know not to invite them; we don't pre-check on create (recipient might switch groups before accepting).

---

## Schema

New migration `0009_brand_invites.sql`:

```sql
CREATE TABLE "brand_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "group_id" uuid NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "invitee_email" varchar(255) NOT NULL,
  "token" varchar(64) NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "accepted_by_user_id" uuid,
  "canceled_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "brand_invites_group_id_idx" ON "brand_invites" ("group_id");
CREATE INDEX "brand_invites_token_idx" ON "brand_invites" ("token");
```

Drizzle schema in a new file `glowos/packages/db/src/schema/brand-invites.ts`. No FK constraints on `group_id` / `created_by_user_id` / `accepted_by_user_id` to keep the circular-import pattern consistent with the existing `merchants.groupId` decision. Application-layer enforcement only.

The token is generated server-side via `crypto.randomBytes(32).toString("base64url")` (44-character URL-safe). No hash/secret split — the token itself is the secret. Single-use mitigates the risk: once accepted, it's burned.

---

## API

All `/group/invites/*` routes mount on the existing `groupRouter` (so they go through `requireGroupAccess`).

### `POST /group/invites`

```jsonc
// Request
{ "email": "sarah@example.com", "expiresInDays": 7 }   // expiresInDays optional, 1..30, default 7
// Response 201
{
  "invite": {
    "id": "uuid-...",
    "inviteeEmail": "sarah@example.com",
    "token": "lL5p…base64url",
    "expiresAt": "2026-05-03T...Z",
    "createdAt": "2026-04-26T...Z",
    "shareUrl": "https://<host>/brand-invite/lL5p…"
  }
}
// Errors
// 400 invalid body
// 409 outstanding invite for the same email already exists in this group
// 409 a merchant_users row with that email is already a brand admin of THIS group
```

Server behavior:
1. Reject if there's an active (`accepted_at IS NULL AND canceled_at IS NULL AND expires_at > now()`) invite with the same `invitee_email` for the same group.
2. Reject if the email already belongs to a brand admin of *this* group (no-op).
3. Generate token, INSERT row.
4. Build `shareUrl` from `process.env.PUBLIC_WEB_URL ?? request origin`.
5. Return.

We don't reject if the email belongs to a merchant_user whose merchant is in another group, or to a brand admin of another group — those checks happen at accept time, where the user has actual context. Brand admin sending an invite is a low-cost action; recipient bears the rejection cost.

### `GET /group/invites?status=outstanding|all`

Default `outstanding`: returns invites where `accepted_at IS NULL AND canceled_at IS NULL AND expires_at > now()`. With `all`, returns everything ordered by `created_at desc`, capped at 200.

```jsonc
{
  "invites": [
    {
      "id", "inviteeEmail", "token", "expiresAt", "createdAt",
      "acceptedAt", "canceledAt",
      "createdByName", "createdByEmail",
      "status": "outstanding" | "accepted" | "canceled" | "expired",
      "shareUrl": "..."
    }
  ]
}
```

`status` is computed server-side for UI clarity. The list should sort: outstanding first (oldest expires_at first), then everything else by created_at desc.

### `DELETE /group/invites/:id`

Sets `canceled_at = now()` if the invite is currently outstanding. 409 if already accepted, 404 if not in this group.

### `GET /brand-invite/:token` — public, no auth required

```jsonc
{
  "valid": true | false,
  "reason": "expired" | "used" | "canceled" | "not_found" | null,
  // when valid:
  "groupName": "Aura Wellness Group",
  "inviterName": "Frank Ip",
  "inviterEmail": "frank@example.com",
  "inviteeEmail": "sarah@example.com"
}
```

Implementation: SELECT with the necessary joins (groups.name, inviter merchant_users.name/email). Return only safe metadata (no group_id, no caller info).

### `POST /brand-invite/:token/accept` — requires authenticated `merchant_users` JWT

The caller must already be signed in. If not, the frontend redirects them to `/login` first (with a return-to query param).

```jsonc
// Request: empty body
// Response 200
{
  "access_token": "...",         // re-issued — now carries brandAdminGroupId
  "refresh_token": "...",
  "user": { /* with brandAdminGroupId set */ },
  "merchant": { /* with groupId set */ },
  "group": { "id": "...", "name": "..." }
}
// Errors
// 401  not signed in
// 403  signed in as wrong email (caller.email !== invite.inviteeEmail)
// 404  token doesn't match any invite
// 409  invite already accepted / canceled
// 410  invite expired (gone forever — explicit gone status code for clarity)
// 409  caller's merchant is already in a group
// 409  caller is already a brand admin somewhere
// 403  caller is impersonating
```

Server behavior, single transaction:

1. Load invite + group_name. Validate state per the error table.
2. Load caller's merchant_users + merchants. Reject if `caller.email !== invite.invitee_email` (case-insensitive); reject if `merchant.groupId` is non-null; reject if `caller.brandAdminGroupId` is non-null; reject if `c.get("impersonating")`.
3. Mark invite as accepted: `accepted_at = now(), accepted_by_user_id = caller.id`.
4. UPDATE merchants SET group_id = invite.group_id, updated_at = now() WHERE id = caller.merchantId.
5. UPDATE merchant_users SET brand_admin_group_id = invite.group_id WHERE id = caller.id.
6. SELECT updated user + merchant + group rows.
7. Re-issue tokens carrying `brandAdminGroupId`.
8. Return.

The transaction rolls back on any constraint failure. Caller's session swaps to the new tokens on receipt.

---

## Frontend

### 1. `/dashboard/group/admins` page — extend with an Invites section

Below the existing Brand admins table, add:

```
─── Invite a brand owner by link ─────────────────────────────────
[ email input    ] [ Generate link ]

OUTSTANDING INVITES (3)
| Email              | Expires        | Action                  |
| sarah@example.com  | in 4 days      | [ Copy link ] [ Cancel ]|
| ...                | ...            | ...                      |
```

On `Generate link` success: append the row, automatically copy the URL to clipboard, and toast "Link copied — share it with sarah@example.com via your preferred channel."

`Copy link` re-copies the URL. `Cancel` is a single-click action with inline confirm (same lightweight pattern as the Remove button on admins).

### 2. `/brand-invite/[token]` — public recipient page

Server-side fetches `GET /brand-invite/:token` to render the page (so SEO-bot-safe and works with JS off — though we'll need a client component for the accept flow).

Layout (simple):

```
┌────────────────────────────────────────────────┐
│ GlowOS                                         │
│                                                │
│ You've been invited to join                    │
│ Aura Wellness Group                            │
│                                                │
│ Invited by Frank Ip <frank@example.com>        │
│ This invite is for sarah@example.com.          │
│                                                │
│ Accepting will:                                │
│  • Add your branch to this brand               │
│  • Make you a co-brand-admin                   │
│  • Re-issue your session tokens                │
│                                                │
│ [ Accept invite ]   [ Decline / Close ]        │
└────────────────────────────────────────────────┘
```

States:
- **Invalid (`reason !== null`)**: render a friendly error ("This invite has expired" / "This invite has already been used" / "This invite was canceled by the inviter" / "Invite not found"). No accept button.
- **Valid + not signed in**: render the metadata, but the `Accept invite` button reads "Sign in to accept" and routes to `/login?return_to=/brand-invite/<token>`.
- **Valid + signed in, wrong email**: "This invite is for sarah@example.com. Sign in with that email to accept." Button: "Switch account" (links to /login).
- **Valid + signed in, correct email**: full button. On click → POST accept → swap localStorage tokens + redirect to `/dashboard/group/overview`.

After accept: the session reloads with `brandAdminGroupId` set, the Group sidebar item appears, and they can navigate the brand.

Palette: use the same cream + ink + sage pattern as the `/login` and `/forgot-password` pages, since this is a public-facing surface (matches the landing brand voice, not the dashboard).

### 3. Login — return-to support

`/login` currently redirects to `/dashboard` (or `/super`, `/staff/dashboard`) after success. Extend to honor a `return_to` query param: if it starts with `/brand-invite/`, redirect there instead. This is the one query-param exception (we don't want open-redirect).

---

## Failure modes

- The recipient's merchant is in a different group when they click accept → 409 with a clear message ("Your branch is already part of another brand. Contact support to switch."). They keep their current brand; the invite stays in the inviter's "outstanding" list until expiry or cancel.
- The recipient's email matches but they were demoted from a different brand mid-flow → unaffected; the accept flow still works (their `brand_admin_group_id` is null, which is what we check).
- Two invites for the same email exist (one canceled, one outstanding): the create-time check rejects only against currently-outstanding invites, so this is impossible to reach normally — but if it does, the most-recently-outstanding one is what the recipient will use.
- Inviter is demoted before recipient accepts: invite remains valid (it's tied to `group_id`, not the inviter). Acceptance succeeds and the recipient joins. The invite's "Invited by …" line in the recipient page still shows the original inviter's name (from a JOIN at GET time).

## Testing

- Manual: as brand admin, create an invite for `sarah@example.com` → row appears in outstanding list, Copy link works.
- Manual: open the share URL in incognito (not signed in) → page renders metadata + "Sign in to accept" button. Click → land on `/login?return_to=...`. Sign in with sarah's account → redirected back to invite page → click Accept → land on `/dashboard/group/overview` with the new sidebar Group item visible. Verify in DB or `/group/admins` that Sarah is now a co-brand-admin and her merchant has `groupId` set.
- Manual: sign in as someone else, visit the invite link → page says "This invite is for sarah@…" with no Accept button.
- Manual: revisit the same invite link after acceptance → "This invite has already been used." 409.
- Manual: as inviter, cancel an outstanding invite → recipient visits → "This invite was canceled."
- Manual: wait for expiry (or set `expires_at` to past) → "This invite has expired." 410.
- Manual: invite an email that's already a brand admin of this group → 409 at create time.
- Typecheck clean.

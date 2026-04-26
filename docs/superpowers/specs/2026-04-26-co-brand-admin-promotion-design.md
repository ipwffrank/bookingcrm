# Co-Brand-Admin Promotion — Design Spec

**Date:** 2026-04-26
**Phase:** Multi-branch Phase 1 — incremental
**Depends on:** brand-admin frontend Phase 1 (commits `aea8471` … `100c8f5`)

---

## Goal

Let an existing brand admin add another `merchant_user` (whose branch is already in the same group) as a **co-brand-admin** of that group. After promotion, the new user sees the "Group" sidebar item and can do everything a brand admin can do — `/group/*` access, branch CRUD, view-as-branch, the works.

Counterpart: let a brand admin remove another co-brand-admin (revoke the claim) — with a guardrail against orphaning the group.

This is the smallest delta that turns "one brand admin per group" into "one or more". Invite-link flow (option C from the discussion) is **out of scope** for this slot — handled in a later spec.

## Scope

In:
- `GET /group/admins` — list current brand admins of the caller's group.
- `POST /group/admins` — promote by email; the target's merchant must already be in the caller's group.
- `DELETE /group/admins/:userId` — demote; rejects if it would leave the group with zero brand admins.
- `/dashboard/group/admins` page — list, add, remove. Plus a new "Admins" item in the group sidebar.

Out:
- Inviting a brand-new email (no `merchant_users` row yet) — needs the invite-link flow (Phase 1 follow-on).
- Promoting someone whose merchant is NOT in the group — needs the absorb / invite flow (Phase 1 follow-on).
- Sub-roles inside the brand admin role (e.g., "read-only co-admin"). Every co-brand-admin is full-power, same as the original.
- Audit logging for promote/demote events. Defer until super-admin audit middleware is generalized.
- Email notification to the promoted user. They'll see the new sidebar item the next time they log in (or refresh).

---

## API additions

All three routes mount on the existing `groupRouter` and inherit the `requireGroupAccess` middleware. So both the merchant_users brand-admin path and the legacy group_users path can manage admins for their group.

### `GET /group/admins`

Returns every `merchant_users` row whose `brand_admin_group_id === caller's groupId`, joined to the user's home branch for display:

```jsonc
// Response 200
{
  "admins": [
    {
      "userId": "uuid-...",
      "name": "Frank Ip",
      "email": "frank@example.com",
      "homeMerchantId": "uuid-...",
      "homeMerchantName": "Aura — KL",
      "isSelf": true                 // helps the UI guard against self-removal
    },
    {
      "userId": "uuid-...",
      "name": "Sarah Lim",
      "email": "sarah@example.com",
      "homeMerchantId": "uuid-...",
      "homeMerchantName": "Aura — Damansara",
      "isSelf": false
    }
  ]
}
```

`isSelf` is computed server-side: `row.userId === c.get("userId")` for the merchant_users path. For the legacy group_users path, `isSelf` is always `false` (group_users sessions can't be brand admins of themselves; they're a separate identity).

Sort: `isSelf desc, name asc, email asc` so the caller appears first.

### `POST /group/admins`

```jsonc
// Request
{ "email": "sarah@example.com" }   // strict, lowercased before lookup
// Response 201
{
  "admin": {
    "userId": "uuid-...", "name": "Sarah Lim", "email": "sarah@example.com",
    "homeMerchantId": "uuid-...", "homeMerchantName": "Aura — Damansara",
    "isSelf": false
  }
}
// Errors
// 400 invalid body / email format
// 404 no merchant_user with that email
// 409 user is inactive
// 409 user's merchant is NOT in the caller's group
// 409 user is already a brand admin (anywhere — own or another group)
```

Server behavior, single statement after validation:

1. Find merchant_user by lowercased email; 404 if not found.
2. Reject 409 if `!user.isActive`.
3. Reject 409 if `user.brandAdminGroupId` is already set (covers both "already in this group" and the multi-group case which we don't support).
4. Reject 409 if `user.merchantId`'s `merchants.groupId !== c.get("groupId")`. We require the target's branch to already be in the brand — that's the consent proxy. (If the brand admin wants to absorb a merchant that isn't yet in the group, that's the future absorb/invite flow.)
5. UPDATE merchant_users SET brand_admin_group_id = :groupId WHERE id = :userId.
6. Return the joined row in the same shape as `GET /group/admins`.

### `DELETE /group/admins/:userId`

```jsonc
// Response 200
{ "removed": true }
// Errors
// 404 target user is not currently a brand admin of this group
// 409 demoting this user would leave zero brand admins for the group
```

Server behavior:
1. Verify target's `brand_admin_group_id === c.get("groupId")`. 404 if not.
2. SELECT count(*) FROM merchant_users WHERE brand_admin_group_id = :groupId. If count === 1, return 409 "Cannot remove the last brand admin — promote someone else first or contact support to delete the brand."
3. UPDATE merchant_users SET brand_admin_group_id = NULL WHERE id = :userId.

Self-demotion is allowed (subject to the count guard). The user demoting themselves loses the sidebar Group item on their next page load and is redirected (the existing 401/403 path handles it once they hit a /group/* route).

Legacy group_users sessions can call DELETE — they don't have a userId in merchant_users so the count guard works fine. They are not subject to self-demotion (they're not in `merchant_users`).

---

## Frontend changes

### 1. New sidebar item — `Admins`

Add to `app/dashboard/group/layout.tsx`'s `GROUP_NAV` after Clients:

```tsx
{ href: '/dashboard/group/admins', label: 'Admins', icon: ShieldIcon }
```

`ShieldIcon` is a new inline SVG defined alongside the existing icons in the same file.

### 2. New page — `app/dashboard/group/admins/page.tsx`

Layout: page header ("Brand admins" + "Anyone here can manage every branch in this brand.") on the left, "+ Add admin" button on the right.

Below: a table/list of admins. Columns: Name • Email • Home branch • Action (Remove). The current user's row labeled "(you)" next to their name; their Remove button is disabled with tooltip "Promote someone else first to step down."

Add modal: a single email input + Add button. Inline error rendering for 404/409. On success: success toast, refetch list, modal closes.

Remove flow: click "Remove" → small inline confirm ("Remove Sarah Lim from brand admins?") → DELETE → toast → refetch. No separate modal — keep it lightweight.

Palette: same 3-tone tokens as the rest of `/group`. No new color choices.

### 3. Optional touch — refresh `/group/overview` "Brand admins" hint

Not required, but a single-line note on the overview page ("X people admin this brand →") with a link to `/dashboard/group/admins` is a 5-line change and improves discoverability. Mark as optional polish.

---

## Failure modes

- A demotion succeeds while the demoted user is still mid-session (their tokens still carry `brandAdminGroupId`). Their next /group/* request returns 403 (the existing `requireGroupAccess` re-reads DB on each call). Frontend already redirects on 403 — no change needed.
- A promotion doesn't take effect on the new admin's *current* session — they need to refresh or re-login for the sidebar item to appear (the JWT wasn't re-issued for them). This is acceptable; promotion is a low-frequency action. A `/auth/refresh-token` from their device will pick up the new claim from the DB-backed re-read.
- Race: two brand admins promote the same user simultaneously. The second `UPDATE merchant_users SET brand_admin_group_id` is idempotent; the second 201 returns successfully. (No 409 needed for the race — only for the standing-state check.)

## Testing

- Manual: as brand admin, GET /group/admins returns 1 row (yourself). POST with another owner's email whose merchant is in your group → 201, GET now returns 2 rows.
- Manual: POST with an email that doesn't exist → 404. POST with an owner whose merchant is in another group → 409. POST with an owner who is already a brand admin → 409.
- Manual: DELETE the second admin → 200. DELETE yourself when you're the only admin → 409.
- Manual: as the second admin (after refreshing their session), they see the Group sidebar item, /group/admins lists both, and they can demote the first. (Group never goes to zero admins because the count guard fires.)
- Typecheck clean across web + api.

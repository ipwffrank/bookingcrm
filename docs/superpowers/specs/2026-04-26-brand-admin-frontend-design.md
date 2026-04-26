# Brand-admin Frontend — Design Spec

**Date:** 2026-04-26
**Phase:** Multi-branch Phase 1 — frontend slot
**Depends on:** `feat(brand): unified brand-admin auth foundation` (04aa38a) and `feat(brand): /group/* accepts brand-admin merchant_users tokens` (aea8471)

---

## Goal

Let a merchant_user with `brand_admin_group_id` set reach the existing `/dashboard/group/*` views from their normal merchant login — no separate group_users account, no second password, no second portal — AND give them the ability to:

- Spin up new branches in their group and edit existing branch profiles (group composition is self-serve).
- Operate inside any branch in their group as if they were that branch's owner, by switching branch context from the group sidebar (so a brand admin doesn't need a separate login per branch to manage day-to-day).

## Scope

In:
- One additive field on the `POST /auth/login` response so the frontend can show the group name without a second API call.
- A "Group" item in the merchant dashboard sidebar, visible only when the logged-in merchant_user has `brandAdminGroupId`.
- A "← Back to [Branch Name]" item at the top of the group sidebar.
- The group layout sources its group name from `localStorage` (set at login), not from the legacy group_users-only login flow.
- Palette migration of `app/dashboard/group/{layout,overview,branches,clients}.tsx` from indigo → the 3-tone palette mandated by `app/dashboard/CLAUDE.md`.
- **Branch CRUD by brand admin:** create a new branch (inserts `merchants` row pre-tied to the brand admin's `groupId`); edit branch profile fields on existing branches.
- **Branch switching by brand admin:** a `[Branch ▾]` picker in the group sidebar (replacing the fixed "Back to [Branch]" item) lists every branch in the group; selecting one re-issues the JWT scoped to that branch, with a `brandViewing: true` claim. A persistent banner inside `/dashboard/*` shows the active branch and a one-click "End view" that returns to the home branch.

Out:
- Logout button behavior. The existing handler clears localStorage + redirects to `/login`. That's the same shape as `/dashboard` logout — leave it.
- Group-users login path (the legacy fallback in `requireGroupAccess`). Untouched. Still works for HQ-only accounts.
- New `/group/*` analytics features. Pure access + visual parity for the analytics views; the new write surface is branch CRUD only.
- Inviting a branch owner email at create-time. The new branch has no `merchant_users` row of its own — that's fine because the brand admin can operate the branch via view-as-branch. A future change can add an "invite human operator" flow when brand admins want to delegate.
- Scaffolding inside a new branch (operating hours, services, staff, payment gateway). Empty branch shell only; the brand admin (or the eventual branch owner) sets these up by switching into the branch via the picker and using the normal `/dashboard/*` flows.
- Slug edits after creation. Changing a slug invalidates outbound booking links and is reserved for super-admin.

---

## API change

**`POST /auth/login`** — when the matching `merchant_users` row has a non-null `brand_admin_group_id`, include a top-level `group` object in the response:

```jsonc
{
  "userType": "merchant",
  "user": { /* ... */, "brandAdminGroupId": "uuid-..." },
  "merchant": { /* ... */ },
  "group": { "id": "uuid-...", "name": "Aura Wellness Group" },  // ← new, conditional
  "access_token": "...",
  "refresh_token": "..."
}
```

Implementation:
- In `routes/auth.ts`, the merchant-user branch already computes `brandAdminGroupId`. When it's truthy, JOIN/select the matching `groups` row by id and add `group: { id, name }` to the response payload.
- The legacy group-users branch already returns `group` — same shape — so the frontend handler that already writes `localStorage.group` for `userType: "group_admin"` works unchanged.
- Refresh-token response: not extended. The group id never changes during a session; the frontend keeps the cached value across refreshes.

Failure modes:
- `brand_admin_group_id` points to a missing/deleted group row → omit `group` from the response and log a warning. The login still succeeds; the frontend will not render the Group sidebar item. (Defense-in-depth: the API path also checks DB on every request.)

## API additions — branch CRUD

**`POST /group/branches`** — create a new branch inside the caller's group.

```jsonc
// Request body (zod-validated)
{
  "name": "Aura Wellness — Damansara",        // required, 1..255
  "slug": "aura-damansara",                    // required, lowercase + dashes, 3..100, unique across all merchants
  "country": "MY",                             // required, "SG" | "MY"
  "category": "spa",                           // optional, enum (see merchants schema)
  "addressLine1": "Lot 3.10, ...",             // optional
  "addressLine2": null,
  "postalCode": "50490",
  "phone": "+60123456789",
  "email": "damansara@aurawellness.com",
  "description": "..."                         // optional, free text
}
// Response 201
{ "merchant": { /* full row */ } }
// Errors
// 400 invalid body / slug format / unsupported country
// 409 slug already taken
```

Server behavior:
- `groupId` is set from `c.get("groupId")` (the brand admin's group from JWT) — never from request body.
- `timezone` defaults from `country`: `SG` → `Asia/Singapore`, `MY` → `Asia/Kuala_Lumpur`.
- `paymentGateway` defaults: `SG` → `stripe`, `MY` → `ipay88`.
- `subscriptionTier` defaults to `starter`, `subscriptionStatus` to `trial`. Brand admin doesn't set platform/billing fields.
- The legacy group_users path (also accepted by `requireGroupAccess`) gets the same write surface — no extra branch on the route.

**`PATCH /group/branches/:merchantId`** — partial update of editable profile fields on an existing branch in the caller's group.

```jsonc
// Request body — any subset of:
{ "name", "category", "addressLine1", "addressLine2", "postalCode",
  "phone", "email", "description", "logoUrl", "coverPhotoUrl" }
// Response 200
{ "merchant": { /* full row */ } }
// Errors
// 400 invalid field value
// 404 merchantId not in caller's group
```

Editable allow-list above is intentional. Off-limits via this endpoint (each guarded by zod):
- `slug` — would invalidate outbound booking links
- `country`, `timezone` — locale concerns; bake during create
- `subscriptionTier`, `subscriptionStatus`, `subscriptionExpiresAt` — billing
- `paymentGateway`, `stripeAccountId`, `hitpayMerchantId`, `ipay88*` — payment provisioning
- `gbpPlaceId`, `gbpBookingLinkConnectedAt`, `googleActionsStatus` — owned by the branch owner via their merchant `/dashboard/settings`
- `operatingHours`, `cancellationPolicy` — owned by the branch owner
- `groupId` — set at create, never editable
- `payoutFrequency` — platform concern

The existing `GET /group/branches/:merchantId` route currently returns a 3-field `merchant` block (`id`, `name`, `location`). **Extend it** to return the full editable profile so the edit modal can pre-fill without a second call:

```jsonc
{
  "merchant": {
    "id", "slug", "name", "country", "timezone",
    "category", "addressLine1", "addressLine2", "postalCode",
    "phone", "email", "description", "logoUrl", "coverPhotoUrl"
  },
  "revenue": ..., "bookingCount": ..., "activeClients": ..., "recentBookings": [...]
}
```

The aggregate fields and `recentBookings` are unchanged. The change is additive on the `merchant` block only — existing consumers reading `id`/`name`/`location` keep working (the new field is `addressLine1` instead of `location`; existing UI either keeps `location` for back-compat or migrates in this same change).

### Zod schemas

Both `POST` and `PATCH` schemas use `.strict()` so unknown keys are rejected at the boundary, not silently dropped. The PATCH schema is `.partial()` over the editable allow-list. Anything outside the allow-list is a 400 — including off-limits fields like `slug`, `subscriptionTier`, etc. — to give an explicit failure rather than a silent no-op.

## API additions — branch switching (view-as-branch)

Mirror of the super-admin impersonation pattern, scoped to "any branch within my group" instead of "any merchant in the platform".

**`POST /group/view-as-branch`** — re-issue the caller's tokens scoped to a target branch in their group.

```jsonc
// Request
{ "merchantId": "uuid-..." }
// Response 200 — same shape as /auth/login's merchant branch
{
  "access_token": "...",
  "refresh_token": "...",
  "user": { /* unchanged: their merchant_users row */ },
  "merchant": { /* the target branch row */ },
  "group": { /* unchanged */ },
  "brandViewing": true,
  "homeMerchantId": "uuid-..."  // their original branch, for the banner
}
// Errors
// 403 not a brand admin / impersonating session
// 404 target merchantId not in caller's group
```

Server behavior:
- Caller must have `brandAdminGroupId` on the inbound JWT and not be impersonating.
- Validate the target `merchantId` exists and `merchants.groupId === payload.brandAdminGroupId`.
- New token claims (additive to existing payload):
  - `viewingMerchantId: <target>` — the branch the JWT is scoped to.
  - `brandViewing: true`
  - `homeMerchantId: <caller's merchant_users.merchant_id>` — for "End view" and audit.
  - Existing `brandAdminGroupId` is preserved.
- Refresh token gets the same view claims so the session survives token refresh. The `/auth/refresh-token` handler is updated to forward these claims through (parallel to how it forwards `brandAdminGroupId` today).

**`POST /auth/end-brand-view`** — revert to the home-branch JWT.

```jsonc
// Request: empty body
// Response 200 — fresh tokens scoped to the brand admin's home branch
{ "access_token": "...", "refresh_token": "...", "user", "merchant", "group" }
// Errors: 409 not currently brand-viewing
```

Behavior: drops `viewingMerchantId`, `brandViewing`, `homeMerchantId` from the new token pair. Re-reads `merchant_users.merchant_id` from DB to find the home branch.

### `requireMerchant` change

The existing middleware reads `merchant_users` by `payload.userId` and sets `c.merchantId = user.merchantId`. Extend it: when `payload.viewingMerchantId` is present:

1. Verify `payload.brandAdminGroupId` is still set on the user's row (DB re-read — rejecting brand-viewing immediately if brand authority was revoked).
2. Verify the target `merchants.groupId === user.brandAdminGroupId`. 404 if missing or mismatched.
3. Set `c.merchantId = payload.viewingMerchantId`, `c.userRole = "owner"` (synthetic — the brand admin doesn't have a `merchant_users` row at the target branch, but inside their group they have owner-equivalent power).
4. Set `c.brandViewing = true` and `c.homeMerchantId = user.merchantId` for audit visibility downstream.

`c.userId` stays the brand admin's own user id, so any code that writes `created_by_user_id` or audit rows logs the real actor.

### Audit logging

Out of scope for this spec (lighter than super-admin: brand admins are trusted within their group, not cross-tenant). The brand admin's own `userId` is already on every write, so per-branch audit logs already attribute the action correctly. A dedicated `brand_admin_view_log` parallel to `super_admin_audit_log` can land in a follow-on if visibility into "what did the brand admin do where" is needed centrally.

### `/group/*` access during brand-viewing

`requireGroupAccess` already rejects impersonating sessions (the super-admin pattern). For brand-viewing the rule is **opposite**: `/group/*` must remain accessible during brand-viewing so the picker keeps working ("I'm in Branch A, want to switch to Branch B"). No change to `requireGroupAccess`. The middleware should also not treat `viewingMerchantId` as if it were impersonation — it's a separate concept.

---

## Frontend changes

### 1. Login (`app/login/page.tsx`)

The merchant branch of the response handler already writes `access_token`, `refresh_token`, `user`, `merchant` to localStorage. Add one line: when the response contains `data.group`, also write `localStorage.setItem('group', JSON.stringify(data.group))`. Otherwise, `localStorage.removeItem('group')` to avoid stale data leaking across logins.

The legacy `userType === "group_admin"` branch is untouched.

### 2. Merchant dashboard sidebar (`app/dashboard/layout.tsx`)

Add one nav item, rendered only when `JSON.parse(localStorage.user).brandAdminGroupId` is truthy:

```tsx
{ href: '/dashboard/group/overview', label: 'Group', icon: BuildingIcon }
```

Position: below "Campaigns", above the divider/logout area. The icon (`BuildingIcon`) already exists in the group layout and can be inlined or shared via the icons module — same pattern as the rest of the file.

The check happens once on mount, alongside the existing `setMerchant` block. No new context, no new fetch.

### 3. Group layout (`app/dashboard/group/layout.tsx`)

Three changes, all small:

a) **Branch picker.** Above the existing 3-item nav, render a `<BranchPicker>` button that:

- Reads the list of branches in the group from a small new endpoint (or reuses `GET /group/branches`'s existing list — it already returns `merchantId` + `name`).
- Renders as `← [Home Branch ▾]` by default. The home branch is read from `localStorage.merchant`. Clicking expands a small popover listing every branch in the group plus a `Stay in Group view` no-op item at the top for symmetry.
- Selecting a branch other than the current home → `POST /group/view-as-branch { merchantId }` → on 200, replace `access_token`/`refresh_token` and `merchant` in localStorage, set a sticky `localStorage.brandViewing = "true"` and `localStorage.homeMerchantId`, then `router.push('/dashboard')`.
- Selecting the home branch (when not currently brand-viewing) → just `router.push('/dashboard')` — no token swap.

Legacy group_users sessions don't have `localStorage.merchant`. Render the link as `← Back to dashboard` (no picker) for them — the legacy session has no branch context and no view-as capability.

b) **Group name fallback chain.** The existing `localStorage.getItem('group')` read keeps working — the new login path now writes the same key for brand admins. No code change here, but the comment/wording in the file should stop implying group_users is the only source.

c) **Palette migration.** Replace every `indigo-*` class with the 3-tone equivalents per `docs/superpowers/specs/2026-04-22-palette-hierarchy-redesign.md`:

| Old | New |
|---|---|
| `text-indigo-600` (logo, active state) | `text-tone-ink` (logo) / `text-tone-sage` (active link) |
| `bg-indigo-50` (active link bg) | `bg-tone-sage/10` |
| `text-indigo-700` (active link text) | `text-tone-sage` |
| `bg-gray-50` (canvas) | `bg-tone-surface-warm` (matches the rest of the dashboard) |
| `text-gray-*`, `bg-gray-*`, `border-gray-*` | `text-grey-*`, `bg-grey-*`, `border-grey-*` (opacity ramp tokens) |

The non-indigo neutrals (`gray-50`, `gray-200`, etc.) get migrated to the project's `grey-*` token ramp at the same time. The CLAUDE.md rule is permissive about `gray-*` from a strict reading, but the rest of the redesigned dashboard uses `grey-*`, so this keeps everything consistent.

### 4. Group pages

`overview` and `clients` pages — same indigo→3-tone substitution rules. No structural changes. Stat cards stay the same shape; just the colors move.

The "Hero metric" pattern from the analytics page (ink-filled card for the headline number, sage tint for the secondary, neutrals for the rest) is the right reference if a card hierarchy choice comes up. Default: revenue card = ink-filled, branch count = sage tint, the rest = `tone-surface` over warm canvas.

### 5. Brand-view banner in the merchant dashboard (`app/dashboard/components/BrandViewBanner.tsx`)

A new component, mounted next to `<ImpersonationBanner>` at the top of `/dashboard/layout.tsx` and `/staff/layout.tsx`, visible when `localStorage.brandViewing === "true"`:

> "Viewing **{Branch.name}** as a brand admin. **End view** to return to {Home Branch.name}."

`End view` → `POST /auth/end-brand-view` → swap tokens + `localStorage.merchant`, drop `localStorage.brandViewing` + `localStorage.homeMerchantId`, `router.push('/dashboard')`.

Distinct from `<ImpersonationBanner>`: different copy, different color (sage background — informational, not warn — since brand-viewing is normal-day-of-work for a brand admin, not a privileged super-admin action). The two banners can never render simultaneously: `POST /group/view-as-branch` rejects impersonating sessions, and `POST /super/impersonate` is updated in this change to also reject brand-viewing sessions, so only one mode is ever active.

### 6. Branches page (`app/dashboard/group/branches/page.tsx`)

Same palette migration as overview/clients, plus two new affordances:

a) **`+ New branch` primary button** in the page header. Click opens a modal with the create form (fields per `POST /group/branches` body). Submit → success toast → modal closes → refetch the list. Validation errors render inline.

b) **Per-row `Edit` button** (or `⋯` menu) on each branch in the list. Click opens a modal with the same form pre-filled from `GET /group/branches/:merchantId` (the existing endpoint already returns the merchant block). Submit → `PATCH /group/branches/:merchantId` → success toast → modal closes → refetch.

Both modals share a single `<BranchForm>` component with a `mode: "create" | "edit"` prop. Required fields disabled in edit mode (slug, country) per the API allow-list. Country select drives the timezone hint shown to the user ("This branch will operate on Asia/Kuala_Lumpur time") rather than letting them pick timezone directly.

A real `/dashboard/group/branches/[merchantId]` deep-detail page is still out of scope — the modal pattern keeps the entire workflow on one route.

---

## Data flow

```
Login form
  └─> POST /auth/login
       └─> response { user.brandAdminGroupId?, group? }
            └─> localStorage: access_token, user, merchant, group?

Dashboard layout (merchant)
  └─> reads user.brandAdminGroupId from localStorage
       └─> conditionally renders "Group" sidebar item

Click "Group"
  └─> /dashboard/group/overview
       └─> Group layout
            ├─> reads localStorage.group → renders group.name in sidebar header
            ├─> reads localStorage.merchant → renders "Back to {name}" link
            └─> Pages call GET /group/* with Bearer access_token
                 └─> requireGroupAccess: validates brand-admin claim, sets c.groupId
```

---

## Auth/security notes

- The frontend never trusts `brandAdminGroupId` as authority; it's only used for menu visibility. The API enforces every request via `requireGroupAccess`.
- Stale localStorage on a brand-admin revocation: when an admin removes the `brand_admin_group_id`, the API returns 403 on the next `/group/*` call. The frontend should treat the same 401/403 path it already has — redirect to `/login` and clear localStorage. The "Group" sidebar item will disappear after re-login.
- The shipped commit aea8471 already blocks impersonating sessions from `/group/*`; nothing to do on the frontend.

---

## Testing

Auth + entry:
- Manual: log in as a merchant_user with `brand_admin_group_id` set → confirm the "Group" sidebar item appears, clicks through to `/dashboard/group/overview`, the group name renders, the picker shows their home branch.
- Manual: log in as a merchant_user without `brand_admin_group_id` → confirm no "Group" sidebar item appears, direct nav to `/dashboard/group/overview` returns 403 from the API and the existing 401/403 redirect kicks in.
- Manual: log in as a legacy group_users account → existing flow (group name in sidebar header, "Back to dashboard" fallback, no picker) still works.

Branch CRUD:
- Manual: as brand admin, click "+ New branch", submit a valid form → branch appears in the list and is reachable at `/booking/<slug>` (empty-services state).
- Manual: as brand admin, edit an existing branch → name change reflects on the `/super` Merchants table and on the branch's own dashboard the next time its owner logs in.
- Manual: `PATCH /group/branches/:id` with `slug` or `subscriptionTier` in the body → 400. `POST /group/branches` with a slug already in use → 409. `POST /group/branches` from group A → branch created with `groupId = A` regardless of body shape.

Branch switching:
- Manual: as brand admin (currently in home branch), open the picker → see all branches in the group; pick a different branch → land on `/dashboard` for that branch with the brand-view banner showing.
- Manual: while brand-viewing branch B, edit a service → the audit row shows the brand admin's userId (not a phantom owner of branch B).
- Manual: while brand-viewing, open `/group/overview` → still works (picker remains usable so admin can hop to another branch).
- Manual: while brand-viewing, click "End view" in the banner → return to home branch dashboard, banner gone, tokens swapped.
- Manual: revoke `brand_admin_group_id` on the user mid-session → next request inside the brand-viewed branch returns 403 → frontend lands on `/login`. Same for deleting the target branch mid-session.
- Manual: a super admin attempting `/super/impersonate` while brand-viewing → 403 (and vice-versa: `/group/view-as-branch` while impersonating → 403).

Visual + typecheck:
- Spot-check the migrated `/group` pages: no `indigo-*` or other forbidden hues.
- `pnpm --filter @glowos/web typecheck` and `pnpm --filter @glowos/api typecheck` clean.

---

## Out of scope (deferred)

- A real `/dashboard/group/branches/[merchantId]` deep-detail frontend page (read-only API endpoint exists; UI uses modals from the list page).
- Multi-group brand admins (current schema and JWT model supports a single `brand_admin_group_id` per user).
- Brand-admin RBAC inside `/group/*` (currently any matching merchant_user is full-power within their group; sub-roles can land later if needed).
- Replacing the legacy group_users login path entirely — kept for back-compat.
- Inviting / provisioning a branch owner email at create-time — handled by super-admin or future invite flow.
- Branch-internal scaffolding (operating hours, services, staff, payment config) — stays in the branch owner's `/dashboard/*` flows.
- Slug rename and country/timezone migration after create — super-admin only.

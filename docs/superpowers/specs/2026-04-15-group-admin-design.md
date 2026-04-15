# GlowOS Phase 2A — Group Admin UI Design Spec
**Date:** 2026-04-15
**Status:** Approved

---

## Overview

A read-only group administration dashboard for head-office operators (e.g., COO, area manager) who oversee multiple GlowOS branches but do not manage any individual branch themselves. Group admins log in through the same login page as branch admins but are routed to a separate dashboard experience scoped to their group.

This spec covers Phase 2A (head-office model only). Franchise-specific controls (separate billing per franchisee, royalty reporting, franchisor overrides) are deferred to Phase 2B, designed so the same data model supports both.

---

## Personas

**Group Admin (COO / Area Manager)**
- Employed by the clinic/salon group, not an owner of any individual branch
- Needs consolidated revenue, operations, and client data across all branches
- Read-only access — cannot modify branch settings, staff, services, or bookings
- Priority: revenue visibility (A) > ops health (B) > client overview (C)

**Branch Admin (existing)**
- Unchanged — continues to use existing `/dashboard` experience
- Unaware of group admin layer unless explicitly informed

---

## Authentication & Routing

**Login flow**
- Single `/login` page shared with branch admins
- Auth middleware checks `groupUsers` table first, then `merchant_users`
- Match in `groupUsers`: session stores `{ role: "group_admin", groupId, userId }`
- Match in `merchant_users`: existing branch admin flow (unchanged)
- Group admins redirected to `/dashboard/group/overview` on login
- Branch admins redirected to `/dashboard` (unchanged)

**Session enforcement**
- All `/dashboard/group/*` routes protected by middleware that verifies `session.role === "group_admin"`
- Branch admins cannot access group routes; group admins cannot access branch `/dashboard/*` routes
- Group admin session carries `groupId` — all API calls are scoped to that group

**Existing schema used**
- `groupUsers` table: `id`, `groupId`, `userId`, `role` (already created in Phase 1 Task 2)
- `merchants.groupId`: links each branch to its group (already added in Phase 1 Task 1)
- No schema changes required for Phase 2A

---

## Pages

### 1. Overview — `/dashboard/group/overview`

**Layout: Stats First**
- Top row: 3 KPI cards — Total Revenue (MTD), Total Bookings (MTD), Active Clients
- Middle: Revenue by Branch horizontal bar chart (branches ranked by revenue descending)
- Bottom row: Ops Health panel (utilisation % per branch, colour-coded) + Top Clients panel (name, total spend)
- Date range picker at top-right: MTD (default), Last 7 days, Last 30 days, Last 3 months, Custom

**KPI definitions**
- Revenue: sum of `bookings.price` where `status = 'completed'` and `merchantId` in group
- Bookings: count of bookings with `status` in (`confirmed`, `completed`) across group
- Active Clients: distinct `clientId` count with at least one booking in selected period
- Utilisation: bookings in period / (available slots in period) per branch — approximated as confirmed+completed bookings / total staff working hours

---

### 2. Branches — `/dashboard/group/branches`

**Branch list view**
- Table/card list of all branches in the group
- Columns: Branch name, Location, MTD Revenue, Booking Count, Utilisation %, Top Service
- Date range picker — state stored in URL query params (`?from=&to=`) so it persists across navigation and is shareable
- Clicking a branch row navigates to `/dashboard/group/branches/[merchantId]`

**Branch detail — `/dashboard/group/branches/[merchantId]`**
- Shows same stats as branch admin's dashboard for that merchant, but rendered in read-only mode
- Sections: Revenue trend (last 30 days), Top services by revenue, Staff utilisation, Recent bookings list
- No edit controls rendered

---

### 3. Clients — `/dashboard/group/clients`

**Unified client list**
- Deduplicated by phone number (primary identifier across branches)
- Columns: Name, Phone, Total Spend (across group), Branches Visited (count + names), Last Visit Date
- "2 branches" badge on clients who have visited multiple locations
- Searchable by name or phone
- Sortable by total spend (default, descending) and last visit date

**Deduplication logic**
- `clients` table uses phone as unique key — same phone across merchants = same client row
- `merchant_client_profiles` links clients to merchants — one client row, multiple profiles
- Group clients query: `SELECT DISTINCT clients.*` joined through `merchant_client_profiles` where `merchants.groupId = $groupId`

---

## API Endpoints

All endpoints require group admin session. `groupId` is read from session, not URL param (avoids IDOR).

```
GET /group/overview?from=&to=
  Returns: { revenue, bookings, activeClients, revenueByBranch[], opsHealth[], topClients[] }

GET /group/branches?from=&to=
  Returns: { branches[{ merchantId, name, location, revenue, bookings, utilisation, topService }] }

GET /group/branches/:merchantId?from=&to=
  Returns: branch detail stats (read-only mirror of branch admin dashboard data)
  Security: verify merchants.groupId = session.groupId before returning

GET /group/clients?search=&sort=&page=&limit=
  Returns: { clients[{ id, name, phone, totalSpend, branchCount, branchNames[], lastVisit }], total }
```

---

## Navigation

Group admins see a dedicated sidebar (replaces branch admin nav entirely):

```
Overview          /dashboard/group/overview
Branches          /dashboard/group/branches
Clients           /dashboard/group/clients
```

No access to: Services, Staff, Bookings, Walk-ins, Import, Settings (branch-level features).

---

## Scope Boundary

**In scope (Phase 2A)**
- Group admin login + session detection
- Overview, Branches, Clients pages (3 pages)
- 4 new API endpoints aggregating existing data
- Read-only branch detail view
- Date range filtering across all pages
- Dedicated group admin sidebar nav

**Deferred (Phase 2B)**
- Policy enforcement (communication requirements, data collection mandates)
- Franchise controls (separate billing, royalty reporting, franchisee overrides)
- Cross-branch staff sharing UI (schema exists, UI later)
- Group-level broadcast messaging
- Group admin user management UI (adding/removing group users)
- Export to CSV / PDF reporting

---

## Future-Proofing for Franchise (Phase 2B)

The schema already has a `group_type` extension point. To support franchise in Phase 2B:
- Add `groupType` enum (`head_office` | `franchise`) to `groups` table
- Add `franchiseeId` to `merchants` table
- Group admin UI shows/hides franchise controls based on `groupType`
- No rewrite required — Phase 2A code stays unchanged

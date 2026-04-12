# GlowOS Phase 1 — Clinical Credibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform GlowOS into a credible clinic-specific platform — practitioner profiles, consult bookings, walk-in capture, post-service follow-up, and a CSV migration tool — enabling the first paying clinic account.

**Architecture:** All schema changes are additive (no breaking changes to existing tables). Walk-ins reuse the existing booking engine with `bookingSource: 'walk_in'`. Post-service comms extend the existing BullMQ notification worker. Group management is schema-only this phase (no UI — the data model must exist before Phase 2 builds on it).

**Tech Stack:** Drizzle ORM (Neon PostgreSQL), Hono API (Railway), Next.js 15 (Vercel), BullMQ + Upstash Redis, Twilio WhatsApp, TypeScript (ESM, `.js` imports required)

**Phase split:** This is Plan 1 of 3. Phase 2 plan covers group admin UI, promotions, social login, staff calendar, and subscription tiers. Phase 3 plan covers idle-time optimization and POS.

---

## Pre-work: What already exists (do NOT re-implement)

- `services.description` — already in schema AND in the BookingWidget `Service` interface. **Task 2 just needs to render it.**
- `bookings.paymentMethod` — already a nullable varchar. Cash/OTC extends its values.
- `bookings.bookingSource` — already exists. Walk-ins use `'walk_in'`.
- `merchants.subscriptionTier` and `merchants.subscriptionStatus` — already in schema.
- `clientProfiles` — already has `marketingOptIn`.

---

## File Map

### New files (create):
- `glowos/packages/db/src/schema/groups.ts` — groups, group_settings tables
- `glowos/packages/db/src/schema/consult.ts` — consult_outcomes table
- `glowos/packages/db/src/schema/post-service.ts` — post_service_sequences table
- `glowos/services/api/src/routes/walkins.ts` — walk-in registration + payment recording
- `glowos/apps/web/app/dashboard/walkins/page.tsx` — walk-in registration panel

### Modified files:
- `glowos/packages/db/src/schema/staff.ts` — add bio, specialty_tags, credentials, is_publicly_visible
- `glowos/packages/db/src/schema/services.ts` — add slot_type, requires_consult_first, consult_service_id
- `glowos/packages/db/src/schema/clients.ts` — add acquisition_source, preferred_contact_channel
- `glowos/packages/db/src/schema/merchants.ts` — add group_id FK
- `glowos/packages/db/src/schema/index.ts` — export new schema files
- `glowos/packages/db/src/migrations/` — generated migration SQL (do not hand-edit)
- `glowos/services/api/src/routes/staff.ts` — profile PATCH + public profile GET
- `glowos/services/api/src/routes/services.ts` — extend PATCH for slot_type, add consult-outcome endpoint
- `glowos/services/api/src/index.ts` — mount walkins router
- `glowos/services/api/src/lib/scheduler.ts` — add schedulePostServiceSequence
- `glowos/services/api/src/workers/notification.worker.ts` — add post_service_receipt + post_service_rebook handlers
- `glowos/apps/web/app/dashboard/staff/page.tsx` — add bio/specialty/visibility fields
- `glowos/apps/web/app/dashboard/services/page.tsx` — add slot_type selector + consult toggle
- `glowos/apps/web/app/dashboard/layout.tsx` — add Walk-ins nav item
- `glowos/apps/web/app/[slug]/BookingWidget.tsx` — staff cards with bio, service descriptions, consult gating

---

## Task 1: Sprint 0 — Extend Existing Schema Files

**Files:**
- Modify: `glowos/packages/db/src/schema/staff.ts`
- Modify: `glowos/packages/db/src/schema/services.ts`
- Modify: `glowos/packages/db/src/schema/clients.ts`
- Modify: `glowos/packages/db/src/schema/merchants.ts`

- [ ] **Step 1: Extend staff table with profile fields**

In `glowos/packages/db/src/schema/staff.ts`, add four new columns after `displayOrder`:

```typescript
// Add these columns to the staff pgTable definition, after displayOrder:
  bio: text("bio"),
  specialtyTags: text("specialty_tags").array(),
  credentials: text("credentials"),
  isPubliclyVisible: boolean("is_publicly_visible").notNull().default(true),
```

The complete updated `staff` export should look like:

```typescript
export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  title: varchar("title", { length: 100 }),
  photoUrl: text("photo_url"),
  isActive: boolean("is_active").notNull().default(true),
  isAnyAvailable: boolean("is_any_available").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(0),
  bio: text("bio"),
  specialtyTags: text("specialty_tags").array(),
  credentials: text("credentials"),
  isPubliclyVisible: boolean("is_publicly_visible").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Extend services table with consult fields**

In `glowos/packages/db/src/schema/services.ts`, add three new columns after `isActive`. Note the self-referential FK — Drizzle handles this with a lazy reference:

```typescript
// Add to imports at top:
import { sql } from "drizzle-orm";

// Add these columns to the services pgTable definition, after isActive:
  slotType: varchar("slot_type", { length: 20 })
    .notNull()
    .default("standard")
    .$type<"standard" | "consult" | "treatment">(),
  requiresConsultFirst: boolean("requires_consult_first").notNull().default(false),
  consultServiceId: uuid("consult_service_id"),
```

> Note: `consultServiceId` is a self-referential FK. Drizzle does not support self-referential `.references()` directly in some versions — add it as a bare column and enforce via the application layer. The FK constraint will be added manually in the migration SQL if needed.

- [ ] **Step 3: Extend clients table with acquisition and contact fields**

In `glowos/packages/db/src/schema/clients.ts`, add two columns after `name`:

```typescript
// Add these columns to the clients pgTable definition, after name:
  acquisitionSource: varchar("acquisition_source", { length: 30 })
    .notNull()
    .default("online_booking")
    .$type<"online_booking" | "walkin" | "import" | "social">(),
  preferredContactChannel: varchar("preferred_contact_channel", { length: 20 })
    .notNull()
    .default("whatsapp")
    .$type<"email" | "whatsapp">(),
```

- [ ] **Step 4: Extend merchants table with group FK**

In `glowos/packages/db/src/schema/merchants.ts`, add one column after `updatedAt`:

```typescript
// Add this import at top if not already present:
// (merchants.ts has no existing imports — uuid is already imported)

// Add to the merchants pgTable definition, before the closing brace:
  groupId: uuid("group_id"),
```

> Note: The actual FK to the `groups` table will be wired after `groups.ts` is created and exported. For now this is a bare nullable UUID column.

- [ ] **Step 5: Commit schema file changes**

```bash
cd ~/Desktop/Projects/bookingcrm
git add glowos/packages/db/src/schema/staff.ts glowos/packages/db/src/schema/services.ts glowos/packages/db/src/schema/clients.ts glowos/packages/db/src/schema/merchants.ts
git commit -m "feat(db): extend staff, services, clients, merchants schema for Phase 1"
```

---

## Task 2: Sprint 0 — Create New Schema Files

**Files:**
- Create: `glowos/packages/db/src/schema/groups.ts`
- Create: `glowos/packages/db/src/schema/consult.ts`
- Create: `glowos/packages/db/src/schema/post-service.ts`
- Modify: `glowos/packages/db/src/schema/index.ts`

- [ ] **Step 1: Create groups.ts**

```typescript
// glowos/packages/db/src/schema/groups.ts
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { merchants } from "./merchants";

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  ownerMerchantId: uuid("owner_merchant_id")
    .notNull()
    .references(() => merchants.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groupSettings = pgTable("group_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .unique()
    .references(() => groups.id, { onDelete: "cascade" }),
  sharedCustomerProfiles: boolean("shared_customer_profiles").notNull().default(false),
  sharedMarketing: boolean("shared_marketing").notNull().default(false),
  sharedHr: boolean("shared_hr").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Create consult.ts**

```typescript
// glowos/packages/db/src/schema/consult.ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { services } from "./services";
import { staff } from "./staff";

export const consultOutcomes = pgTable("consult_outcomes", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  recommendedServiceId: uuid("recommended_service_id").references(() => services.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),
  followUpBookingId: uuid("follow_up_booking_id"),
  createdByStaffId: uuid("created_by_staff_id").references(() => staff.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Create post-service.ts**

```typescript
// glowos/packages/db/src/schema/post-service.ts
import {
  pgTable,
  uuid,
  varchar,
  timestamp,
} from "drizzle-orm/pg-core";
import { bookings } from "./bookings";

export const postServiceSequences = pgTable("post_service_sequences", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id")
    .notNull()
    .unique()
    .references(() => bookings.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 20 })
    .notNull()
    .default("pending")
    .$type<"pending" | "sent" | "completed">(),
  receiptSentAt: timestamp("receipt_sent_at", { withTimezone: true }),
  balanceNotifSentAt: timestamp("balance_notif_sent_at", { withTimezone: true }),
  rebookCtaSentAt: timestamp("rebook_cta_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Export new schema files from index.ts**

In `glowos/packages/db/src/schema/index.ts`, add three new export lines:

```typescript
export * from "./merchants.js";
export * from "./merchant-users.js";
export * from "./services.js";
export * from "./staff.js";
export * from "./clients.js";
export * from "./bookings.js";
export * from "./payouts.js";
export * from "./campaigns.js";
export * from "./reviews.js";
export * from "./notifications.js";
export * from "./groups.js";
export * from "./consult.js";
export * from "./post-service.js";
```

- [ ] **Step 5: Generate and apply migration**

```bash
cd ~/Desktop/Projects/bookingcrm/glowos/packages/db
pnpm db:generate
```

Expected: Drizzle prints a new migration file path like `src/migrations/0001_<name>.sql` and lists the new/altered tables.

```bash
pnpm db:push
```

Expected output includes: `groups`, `group_settings`, `consult_outcomes`, `post_service_sequences` created; `staff`, `services`, `clients`, `merchants` altered.

If `db:push` fails on the self-referential `consultServiceId` column, that is fine — the column was added as a bare UUID without FK. The migration will succeed regardless.

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/Projects/bookingcrm
git add glowos/packages/db/src/schema/ glowos/packages/db/src/migrations/
git commit -m "feat(db): add groups, consult_outcomes, post_service_sequences tables"
```

---

## Task 3: Staff Profile API Extensions

**Files:**
- Modify: `glowos/services/api/src/routes/staff.ts`

- [ ] **Step 1: Add profile update schema to staff.ts route file**

In `glowos/services/api/src/routes/staff.ts`, after the existing `updateStaffSchema`, add:

```typescript
const updateProfileSchema = z.object({
  bio: z.string().max(1000).optional(),
  specialty_tags: z.array(z.string().max(50)).max(10).optional(),
  credentials: z.string().max(500).optional(),
  is_publicly_visible: z.boolean().optional(),
});
```

- [ ] **Step 2: Add PATCH /:id/profile endpoint**

In `glowos/services/api/src/routes/staff.ts`, add this endpoint after the existing DELETE endpoint at the bottom of the file (before `export default staffRouter`):

```typescript
// ─── PATCH /merchant/staff/:id/profile ─────────────────────────────────────────

staffRouter.patch("/:id/profile", requireMerchant, zValidator(updateProfileSchema), async (c) => {
  const merchantId = c.get("merchantId");
  const staffId = c.req.param("id");
  const body = c.get("body") as z.infer<typeof updateProfileSchema>;

  const [existing] = await db
    .select()
    .from(staff)
    .where(and(eq(staff.id, staffId), eq(staff.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Staff member not found" }, 404);
  }

  const [updated] = await db
    .update(staff)
    .set({
      ...(body.bio !== undefined && { bio: body.bio }),
      ...(body.specialty_tags !== undefined && { specialtyTags: body.specialty_tags }),
      ...(body.credentials !== undefined && { credentials: body.credentials }),
      ...(body.is_publicly_visible !== undefined && { isPubliclyVisible: body.is_publicly_visible }),
    })
    .where(eq(staff.id, staffId))
    .returning();

  return c.json({ staff: updated });
});
```

- [ ] **Step 3: Add public staff profiles endpoint to the bookings router**

The public staff endpoint is needed by the booking widget. It belongs in `glowos/services/api/src/routes/bookings.ts` since public routes live there. Add this to `bookingsRouter` (not `merchantBookingsRouter`) near the top of the public routes section:

```typescript
// ─── GET /booking/:slug/staff ──────────────────────────────────────────────────
// Public — returns visible staff with profile fields for the booking widget

bookingsRouter.get("/:slug/staff", async (c) => {
  const slug = c.req.param("slug");

  const [merchant] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.slug, slug))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Business not found" }, 404);
  }

  const staffList = await db
    .select()
    .from(staff)
    .where(
      and(
        eq(staff.merchantId, merchant.id),
        eq(staff.isActive, true),
        eq(staff.isPubliclyVisible, true)
      )
    )
    .orderBy(staff.displayOrder);

  return c.json({ staff: staffList });
});
```

Note: You must import `staff` and `and` in `bookings.ts` — check the existing imports at the top of that file. `staff` and `and` are already imported.

- [ ] **Step 4: Verify the API starts without errors**

```bash
cd ~/Desktop/Projects/bookingcrm/glowos/services/api
npx tsx src/index.ts
```

Expected: Server starts on port 3001 (or configured port) with no TypeScript errors. Stop with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/Projects/bookingcrm
git add glowos/services/api/src/routes/staff.ts glowos/services/api/src/routes/bookings.ts
git commit -m "feat(api): staff profile PATCH endpoint + public staff profiles endpoint"
```

---

## Task 4: Staff Profile Admin UI

**Files:**
- Modify: `glowos/apps/web/app/dashboard/staff/page.tsx`

- [ ] **Step 1: Add profile fields to the StaffMember interface**

In `glowos/apps/web/app/dashboard/staff/page.tsx`, extend the `StaffMember` interface:

```typescript
interface StaffMember {
  id: string;
  name: string;
  title: string | null;
  photoUrl: string | null;
  isActive: boolean;
  isAnyAvailable: boolean;
  isPubliclyVisible: boolean;
  bio: string | null;
  specialtyTags: string[] | null;
  credentials: string | null;
  service_ids: string[];
}
```

- [ ] **Step 2: Add profile fields to the StaffForm interface**

Extend the `StaffForm` interface (or add one if it doesn't exist by that name — search for the form state shape):

```typescript
interface StaffForm {
  name: string;
  title: string;
  photo_url: string;
  is_any_available: boolean;
  is_publicly_visible: boolean;
  bio: string;
  specialty_tags: string;   // comma-separated in UI, split on save
  credentials: string;
  service_ids: string[];
  working_hours: WorkingHour[];
}
```

- [ ] **Step 3: Add profile fields to the form initial state**

Find where the empty form state is defined (likely `useState<StaffForm>({...})`). Add:

```typescript
is_publicly_visible: true,
bio: '',
specialty_tags: '',
credentials: '',
```

- [ ] **Step 4: Populate profile fields when editing a staff member**

Find the function that sets form state from an existing `StaffMember` (typically the edit button handler). Add:

```typescript
is_publicly_visible: s.isPubliclyVisible ?? true,
bio: s.bio ?? '',
specialty_tags: (s.specialtyTags ?? []).join(', '),
credentials: s.credentials ?? '',
```

- [ ] **Step 5: Add profile form fields to the staff modal/form JSX**

Find the staff form JSX (the modal or inline form). After the `Photo URL` input, add:

```tsx
{/* Bio */}
<div>
  <label className="block text-sm font-medium text-gray-300 mb-1">Bio</label>
  <textarea
    value={form.bio}
    onChange={(e) => setForm({ ...form, bio: e.target.value })}
    rows={3}
    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
    placeholder="Brief introduction for clients..."
    maxLength={1000}
  />
</div>

{/* Specialty Tags */}
<div>
  <label className="block text-sm font-medium text-gray-300 mb-1">
    Specialty Tags <span className="text-gray-500 font-normal">(comma-separated)</span>
  </label>
  <input
    type="text"
    value={form.specialty_tags}
    onChange={(e) => setForm({ ...form, specialty_tags: e.target.value })}
    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
    placeholder="e.g. Laser, Acne Treatment, Anti-ageing"
  />
</div>

{/* Credentials */}
<div>
  <label className="block text-sm font-medium text-gray-300 mb-1">Credentials</label>
  <input
    type="text"
    value={form.credentials}
    onChange={(e) => setForm({ ...form, credentials: e.target.value })}
    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
    placeholder="e.g. MBBS, NUS Dermatology Cert"
  />
</div>

{/* Publicly Visible */}
<div className="flex items-center gap-3">
  <input
    type="checkbox"
    id="is_publicly_visible"
    checked={form.is_publicly_visible}
    onChange={(e) => setForm({ ...form, is_publicly_visible: e.target.checked })}
    className="w-4 h-4 rounded"
  />
  <label htmlFor="is_publicly_visible" className="text-sm text-gray-300">
    Show profile on public booking page
  </label>
</div>
```

- [ ] **Step 6: Include profile fields in the save API call**

Find the function that calls `apiFetch` to create or update a staff member. After the main staff upsert, add a profile PATCH call if editing an existing staff member:

```typescript
// After the main staff create/update call succeeds, if we have profile fields to save:
if (editingId) {
  await apiFetch(`/merchant/staff/${editingId}/profile`, {
    method: 'PATCH',
    body: JSON.stringify({
      bio: form.bio || undefined,
      specialty_tags: form.specialty_tags
        ? form.specialty_tags.split(',').map((t) => t.trim()).filter(Boolean)
        : undefined,
      credentials: form.credentials || undefined,
      is_publicly_visible: form.is_publicly_visible,
    }),
  });
}
```

For new staff, the profile fields need to be saved after creation — use the returned `id` from the create call.

- [ ] **Step 7: Verify the staff dashboard loads and profile fields appear**

```bash
cd ~/Desktop/Projects/bookingcrm/glowos
pnpm dev
```

Navigate to `http://localhost:3000/dashboard/staff`. Open the edit modal for a staff member. Confirm bio/specialty/credentials/visibility fields render. Stop dev server.

- [ ] **Step 8: Commit**

```bash
cd ~/Desktop/Projects/bookingcrm
git add glowos/apps/web/app/dashboard/staff/page.tsx
git commit -m "feat(ui): staff profile fields in admin dashboard"
```

---

## Task 5: Staff Profile Cards in Booking Widget

**Files:**
- Modify: `glowos/apps/web/app/[slug]/BookingWidget.tsx`

- [ ] **Step 1: Extend the StaffMember interface in BookingWidget.tsx**

```typescript
interface StaffMember {
  id: string;
  name: string;
  photoUrl: string | null;
  title: string | null;
  bio: string | null;
  specialtyTags: string[] | null;
  isAnyAvailable: boolean;
}
```

- [ ] **Step 2: Display service description in the service selection step**

Find the service list rendering in BookingWidget. Each service is likely rendered as a card or button. After the service name, add the description:

```tsx
{service.description && (
  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{service.description}</p>
)}
```

- [ ] **Step 3: Display staff bio and specialty in the staff selection step**

Find the staff selection card rendering. After the staff name/title, add:

```tsx
{staffMember.bio && (
  <p className="text-xs text-gray-400 mt-1 line-clamp-2">{staffMember.bio}</p>
)}
{staffMember.specialtyTags && staffMember.specialtyTags.length > 0 && (
  <div className="flex flex-wrap gap-1 mt-1">
    {staffMember.specialtyTags.map((tag) => (
      <span
        key={tag}
        className="text-xs bg-gray-700 text-gray-300 rounded-full px-2 py-0.5"
      >
        {tag}
      </span>
    ))}
  </div>
)}
```

- [ ] **Step 4: Verify the booking widget renders staff cards with bio/specialty**

Start the dev server:

```bash
cd ~/Desktop/Projects/bookingcrm/glowos
pnpm dev
```

Navigate to `http://localhost:3000/[your-test-slug]`. Proceed through the booking widget to the staff selection step. Confirm bio and specialty tags appear (they may be empty for test data — update a staff member via the admin first).

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/Projects/bookingcrm
git add glowos/apps/web/app/\[slug\]/BookingWidget.tsx
git commit -m "feat(widget): staff profile cards with bio/specialty + service descriptions"
```

---

## Task 6: Consult Slot Type — API

**Files:**
- Modify: `glowos/services/api/src/routes/services.ts`

- [ ] **Step 1: Extend the createServiceSchema with slot_type fields**

In `glowos/services/api/src/routes/services.ts`, extend `createServiceSchema`:

```typescript
const createServiceSchema = z.object({
  name: z.string().min(1, "Service name is required"),
  description: z.string().min(1, "Description is required"),
  category: z.enum(["hair", "nails", "face", "body", "massage", "dining", "medical", "other"], {
    errorMap: () => ({
      message: "Invalid category",
    }),
  }),
  duration_minutes: z.number().int().positive("Duration must be positive"),
  buffer_minutes: z.number().int().min(0).optional().default(0),
  price_sgd: z.number().positive("Price must be positive"),
  display_order: z.number().int().min(0).optional().default(0),
  slot_type: z.enum(["standard", "consult", "treatment"]).optional().default("standard"),
  requires_consult_first: z.boolean().optional().default(false),
  consult_service_id: z.string().uuid().nullable().optional(),
});
```

- [ ] **Step 2: Update the POST /merchant/services handler to save new fields**

Find the `servicesRouter.post("/", ...)` handler. In the `db.insert(services).values({...})` call, add:

```typescript
slotType: body.slot_type,
requiresConsultFirst: body.requires_consult_first,
consultServiceId: body.consult_service_id ?? null,
```

- [ ] **Step 3: Update the PATCH /merchant/services/:id handler to save new fields**

Find the `servicesRouter.patch("/:id", ...)` handler. In the `db.update(services).set({...})` call, add:

```typescript
...(body.slot_type !== undefined && { slotType: body.slot_type }),
...(body.requires_consult_first !== undefined && { requiresConsultFirst: body.requires_consult_first }),
...(body.consult_service_id !== undefined && { consultServiceId: body.consult_service_id }),
```

- [ ] **Step 4: Add consult outcome endpoint**

Import `consultOutcomes` from `@glowos/db` at the top of `services.ts`. Then add the endpoint after the existing routes:

```typescript
// First add the import at the top:
import { db, services, consultOutcomes } from "@glowos/db";
```

Add the consult outcome schema and endpoint at the bottom of `services.ts`:

```typescript
// ─── Schemas for consult outcomes ─────────────────────────────────────────────

const consultOutcomeSchema = z.object({
  booking_id: z.string().uuid(),
  recommended_service_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).optional(),
  follow_up_booking_id: z.string().uuid().nullable().optional(),
});

// ─── POST /merchant/services/consult-outcomes ──────────────────────────────────

servicesRouter.post("/consult-outcomes", requireMerchant, zValidator(consultOutcomeSchema), async (c) => {
  const merchantId = c.get("merchantId");
  const staffId = c.get("staffId") as string | undefined;
  const body = c.get("body") as z.infer<typeof consultOutcomeSchema>;

  const [outcome] = await db
    .insert(consultOutcomes)
    .values({
      bookingId: body.booking_id,
      recommendedServiceId: body.recommended_service_id ?? null,
      notes: body.notes ?? null,
      followUpBookingId: body.follow_up_booking_id ?? null,
      createdByStaffId: staffId ?? null,
    })
    .returning();

  return c.json({ outcome }, 201);
});

// ─── GET /merchant/services/consult-outcomes/:bookingId ────────────────────────

servicesRouter.get("/consult-outcomes/:bookingId", requireMerchant, async (c) => {
  const bookingId = c.req.param("bookingId");

  const [outcome] = await db
    .select()
    .from(consultOutcomes)
    .where(eq(consultOutcomes.bookingId, bookingId))
    .limit(1);

  if (!outcome) {
    return c.json({ outcome: null });
  }

  return c.json({ outcome });
});
```

Note: `c.get("staffId")` may not be set by the auth middleware currently — if it causes a TypeScript error, cast to `undefined` and leave `createdByStaffId: null` for now.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/Projects/bookingcrm
git add glowos/services/api/src/routes/services.ts
git commit -m "feat(api): consult slot type on services + consult outcome endpoints"
```

---

## Task 7: Consult Slot Type — Admin UI + Widget Gating

**Files:**
- Modify: `glowos/apps/web/app/dashboard/services/page.tsx`
- Modify: `glowos/apps/web/app/[slug]/BookingWidget.tsx`

- [ ] **Step 1: Extend Service and ServiceForm interfaces in services/page.tsx**

```typescript
interface Service {
  id: string;
  name: string;
  description: string;
  category: Category;
  durationMinutes: number;
  bufferMinutes: number;
  priceSgd: string;
  displayOrder: number;
  isActive: boolean;
  slotType: 'standard' | 'consult' | 'treatment';
  requiresConsultFirst: boolean;
  consultServiceId: string | null;
}

// Add to ServiceForm:
interface ServiceForm {
  name: string;
  description: string;
  category: Category;
  duration_minutes: string;
  buffer_minutes: string;
  price_sgd: string;
  slot_type: 'standard' | 'consult' | 'treatment';
  requires_consult_first: boolean;
  consult_service_id: string;
}
```

- [ ] **Step 2: Add slot_type and consult fields to form initial state**

```typescript
slot_type: 'standard',
requires_consult_first: false,
consult_service_id: '',
```

- [ ] **Step 3: Populate consult fields when editing a service**

In the edit handler that populates the form:

```typescript
slot_type: s.slotType ?? 'standard',
requires_consult_first: s.requiresConsultFirst ?? false,
consult_service_id: s.consultServiceId ?? '',
```

- [ ] **Step 4: Add slot_type UI to the service form JSX**

After the category selector, add:

```tsx
{/* Slot Type */}
<div>
  <label className="block text-sm font-medium text-gray-300 mb-1">Booking Type</label>
  <select
    value={form.slot_type}
    onChange={(e) => setForm({ ...form, slot_type: e.target.value as 'standard' | 'consult' | 'treatment' })}
    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
  >
    <option value="standard">Standard — book directly</option>
    <option value="consult">Consultation — assess client first</option>
    <option value="treatment">Treatment — requires prior consult</option>
  </select>
  <p className="text-xs text-gray-500 mt-1">
    "Consultation" slots let staff assess the client before recommending a treatment.
    "Treatment" slots can be linked to require a consult booking first.
  </p>
</div>

{/* Requires Consult First (only shown for treatment type) */}
{form.slot_type === 'treatment' && (
  <div className="space-y-2">
    <div className="flex items-center gap-3">
      <input
        type="checkbox"
        id="requires_consult_first"
        checked={form.requires_consult_first}
        onChange={(e) => setForm({ ...form, requires_consult_first: e.target.checked })}
        className="w-4 h-4 rounded"
      />
      <label htmlFor="requires_consult_first" className="text-sm text-gray-300">
        Require consultation booking before this treatment
      </label>
    </div>
    {form.requires_consult_first && (
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Consultation service (optional)
        </label>
        <select
          value={form.consult_service_id}
          onChange={(e) => setForm({ ...form, consult_service_id: e.target.value })}
          className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
        >
          <option value="">— any consultation —</option>
          {services
            .filter((s) => s.slotType === 'consult')
            .map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
        </select>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5: Include slot_type fields in the API save call**

In the service create/update handler, include:

```typescript
slot_type: form.slot_type,
requires_consult_first: form.requires_consult_first,
consult_service_id: form.consult_service_id || null,
```

- [ ] **Step 6: Gate treatment services in the booking widget**

In `glowos/apps/web/app/[slug]/BookingWidget.tsx`, extend the Service interface:

```typescript
interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceSgd: string;
  category: string;
  slotType: 'standard' | 'consult' | 'treatment';
  requiresConsultFirst: boolean;
}
```

In the service selection rendering, add a "requires consult" banner on treatment services that have `requiresConsultFirst: true`:

```tsx
{service.requiresConsultFirst && (
  <div className="mt-1 flex items-center gap-1 text-xs text-amber-400">
    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
    </svg>
    Book a consultation first
  </div>
)}
```

- [ ] **Step 7: Verify services page loads, consult fields render, and widget shows gating banner**

```bash
cd ~/Desktop/Projects/bookingcrm/glowos && pnpm dev
```

1. Navigate to `http://localhost:3000/dashboard/services`
2. Create a new service with type "Treatment" and enable "Require consultation first"
3. Navigate to the public booking page — confirm the treatment shows the amber consult banner

- [ ] **Step 8: Commit**

```bash
cd ~/Desktop/Projects/bookingcrm
git add glowos/apps/web/app/dashboard/services/page.tsx glowos/apps/web/app/\[slug\]/BookingWidget.tsx
git commit -m "feat(ui): consult slot type in services admin + booking widget gating"
```

---

## Task 8: Walk-in Registration + Payment Recording API

**Files:**
- Create: `glowos/services/api/src/routes/walkins.ts`
- Modify: `glowos/services/api/src/index.ts`

- [ ] **Step 1: Create walkins.ts route file**

```typescript
// glowos/services/api/src/routes/walkins.ts
import { Hono } from "hono";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  clients,
  clientProfiles,
  bookings,
  services,
  staff,
  merchants,
} from "@glowos/db";
import { requireMerchant } from "../middleware/auth.js";
import { zValidator } from "../middleware/validate.js";
import type { AppVariables } from "../lib/types.js";

export const walkinsRouter = new Hono<{ Variables: AppVariables }>();

// ─── Schemas ───────────────────────────────────────────────────────────────────

const walkinRegisterSchema = z.object({
  client_name: z.string().min(1, "Client name is required"),
  client_phone: z.string().min(1, "Client phone is required"),
  client_email: z.string().email().optional(),
  service_id: z.string().uuid(),
  staff_id: z.string().uuid(),
  start_time: z.string().datetime({ message: "start_time must be an ISO datetime string" }),
  payment_method: z.enum(["stripe", "cash", "otc"]).default("cash"),
  notes: z.string().optional(),
});

const recordPaymentSchema = z.object({
  payment_method: z.enum(["stripe", "cash", "otc"]),
  amount_sgd: z.number().positive().optional(),
  notes: z.string().optional(),
});

// ─── POST /merchant/walkins/register ──────────────────────────────────────────

walkinsRouter.post("/register", requireMerchant, zValidator(walkinRegisterSchema), async (c) => {
  const merchantId = c.get("merchantId");
  const body = c.get("body") as z.infer<typeof walkinRegisterSchema>;

  // Load merchant for payout config
  const [merchant] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  if (!merchant) {
    return c.json({ error: "Merchant not found" }, 404);
  }

  // Load service to get duration and price
  const [service] = await db
    .select()
    .from(services)
    .where(and(eq(services.id, body.service_id), eq(services.merchantId, merchantId)))
    .limit(1);

  if (!service) {
    return c.json({ error: "Service not found" }, 404);
  }

  // Find or create client by phone
  let client = await db
    .select()
    .from(clients)
    .where(eq(clients.phone, body.client_phone))
    .limit(1)
    .then((rows) => rows[0] ?? null);

  if (!client) {
    const [created] = await db
      .insert(clients)
      .values({
        phone: body.client_phone,
        email: body.client_email ?? null,
        name: body.client_name,
        acquisitionSource: "walkin",
      })
      .returning();
    client = created;
  }

  // Ensure client profile exists for this merchant
  const [existingProfile] = await db
    .select()
    .from(clientProfiles)
    .where(
      and(
        eq(clientProfiles.merchantId, merchantId),
        eq(clientProfiles.clientId, client.id)
      )
    )
    .limit(1);

  if (!existingProfile) {
    await db.insert(clientProfiles).values({
      merchantId,
      clientId: client.id,
    });
  }

  // Calculate end time
  const startTime = new Date(body.start_time);
  const endTime = new Date(startTime.getTime() + service.durationMinutes * 60 * 1000);

  // Create booking
  const [booking] = await db
    .insert(bookings)
    .values({
      merchantId,
      clientId: client.id,
      serviceId: body.service_id,
      staffId: body.staff_id,
      startTime,
      endTime,
      durationMinutes: service.durationMinutes,
      status: "in_progress",
      priceSgd: service.priceSgd,
      paymentStatus: body.payment_method === "cash" || body.payment_method === "otc" ? "completed" : "pending",
      paymentMethod: body.payment_method,
      bookingSource: "walk_in",
      commissionRate: "0",
      commissionSgd: "0",
      merchantPayoutSgd: service.priceSgd,
      staffNotes: body.notes ?? null,
    })
    .returning();

  return c.json({ booking, client }, 201);
});

// ─── POST /merchant/walkins/bookings/:id/record-payment ────────────────────────

walkinsRouter.post("/bookings/:id/record-payment", requireMerchant, zValidator(recordPaymentSchema), async (c) => {
  const merchantId = c.get("merchantId");
  const bookingId = c.req.param("id");
  const body = c.get("body") as z.infer<typeof recordPaymentSchema>;

  const [existing] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.merchantId, merchantId)))
    .limit(1);

  if (!existing) {
    return c.json({ error: "Booking not found" }, 404);
  }

  const [updated] = await db
    .update(bookings)
    .set({
      paymentMethod: body.payment_method,
      paymentStatus: "completed",
      ...(body.amount_sgd && { priceSgd: body.amount_sgd.toString() }),
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, bookingId))
    .returning();

  return c.json({ booking: updated });
});

// ─── GET /merchant/walkins/today ───────────────────────────────────────────────

walkinsRouter.get("/today", requireMerchant, async (c) => {
  const merchantId = c.get("merchantId");
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  const todayWalkins = await db
    .select({
      booking: bookings,
      client: clients,
      service: services,
      staffMember: staff,
    })
    .from(bookings)
    .innerJoin(clients, eq(bookings.clientId, clients.id))
    .innerJoin(services, eq(bookings.serviceId, services.id))
    .innerJoin(staff, eq(bookings.staffId, staff.id))
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        eq(bookings.bookingSource, "walk_in"),
      )
    )
    .orderBy(bookings.startTime);

  // Filter to today in JS (avoids tz issues with DB gte/lte)
  const filtered = todayWalkins.filter((row) => {
    const t = row.booking.startTime.getTime();
    return t >= startOfToday.getTime() && t < endOfToday.getTime();
  });

  return c.json({ walkins: filtered });
});
```

- [ ] **Step 2: Mount the walkins router in index.ts**

In `glowos/services/api/src/index.ts`, add the import and route mounting:

```typescript
// Add import (alongside other route imports):
import { walkinsRouter } from "./routes/walkins.js";

// Add route mounting (alongside other merchant routes):
app.route("/merchant/walkins", walkinsRouter);
```

- [ ] **Step 3: Verify API starts and walkins routes are reachable**

```bash
cd ~/Desktop/Projects/bookingcrm/glowos/services/api
npx tsx src/index.ts
```

Expected: No TypeScript errors. Server starts. Stop with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
cd ~/Desktop/Projects/bookingcrm
git add glowos/services/api/src/routes/walkins.ts glowos/services/api/src/index.ts
git commit -m "feat(api): walk-in registration + cash/OTC payment recording endpoints"
```

---

## Task 9: Walk-in Panel UI

**Files:**
- Create: `glowos/apps/web/app/dashboard/walkins/page.tsx`
- Modify: `glowos/apps/web/app/dashboard/layout.tsx`

- [ ] **Step 1: Add Walk-ins to the sidebar nav**

In `glowos/apps/web/app/dashboard/layout.tsx`, find the `navItems` array (or wherever the sidebar links are defined). Add:

```typescript
{ href: '/dashboard/walkins', label: 'Walk-ins', icon: '🚶' },
```

Place it after the Bookings item (typically first in the nav).

- [ ] **Step 2: Create the walk-ins page**

```tsx
// glowos/apps/web/app/dashboard/walkins/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';

interface ServiceOption {
  id: string;
  name: string;
  durationMinutes: number;
  priceSgd: string;
}

interface StaffOption {
  id: string;
  name: string;
  title: string | null;
}

interface WalkinForm {
  client_name: string;
  client_phone: string;
  client_email: string;
  service_id: string;
  staff_id: string;
  payment_method: 'cash' | 'otc' | 'stripe';
  notes: string;
}

export default function WalkinsPage() {
  const router = useRouter();
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const emptyForm: WalkinForm = {
    client_name: '',
    client_phone: '',
    client_email: '',
    service_id: '',
    staff_id: '',
    payment_method: 'cash',
    notes: '',
  };

  const [form, setForm] = useState<WalkinForm>(emptyForm);

  const loadOptions = useCallback(async () => {
    try {
      const [svcRes, staffRes] = await Promise.all([
        apiFetch('/merchant/services?active=true'),
        apiFetch('/merchant/staff'),
      ]);
      setServices((svcRes as any).services ?? []);
      setStaff(((staffRes as any).staff ?? []).filter((s: any) => !s.isAnyAvailable));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
      }
    }
  }, [router]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const startTime = new Date().toISOString();
      await apiFetch('/merchant/walkins/register', {
        method: 'POST',
        body: JSON.stringify({
          client_name: form.client_name,
          client_phone: form.client_phone,
          client_email: form.client_email || undefined,
          service_id: form.service_id,
          staff_id: form.staff_id,
          start_time: startTime,
          payment_method: form.payment_method,
          notes: form.notes || undefined,
        }),
      });

      setSuccess(`Walk-in registered for ${form.client_name}`);
      setForm(emptyForm);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.status === 401) router.push('/login');
      } else {
        setError('Failed to register walk-in');
      }
    } finally {
      setLoading(false);
    }
  }

  const selectedService = services.find((s) => s.id === form.service_id);

  return (
    <div className="max-w-lg mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Walk-in Registration</h1>
        <p className="text-gray-400 text-sm mt-1">Register a walk-in client and record payment</p>
      </div>

      {success && (
        <div className="bg-green-900/30 border border-green-700 rounded-lg px-4 py-3 text-green-300 text-sm">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Client Info */}
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-300 uppercase tracking-wide">Client</h2>
          <input
            type="text"
            value={form.client_name}
            onChange={(e) => setForm({ ...form, client_name: e.target.value })}
            placeholder="Full name *"
            required
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
          />
          <input
            type="tel"
            value={form.client_phone}
            onChange={(e) => setForm({ ...form, client_phone: e.target.value })}
            placeholder="Phone number * (used for profile)"
            required
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
          />
          <input
            type="email"
            value={form.client_email}
            onChange={(e) => setForm({ ...form, client_email: e.target.value })}
            placeholder="Email (optional)"
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
          />
        </div>

        {/* Appointment */}
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-300 uppercase tracking-wide">Appointment</h2>
          <select
            value={form.service_id}
            onChange={(e) => setForm({ ...form, service_id: e.target.value })}
            required
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="">Select service *</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.durationMinutes}min — S${s.priceSgd}
              </option>
            ))}
          </select>
          <select
            value={form.staff_id}
            onChange={(e) => setForm({ ...form, staff_id: e.target.value })}
            required
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
          >
            <option value="">Select staff *</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.title ? ` — ${s.title}` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Payment */}
        <div className="bg-gray-800 rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-medium text-gray-300 uppercase tracking-wide">Payment</h2>
          <div className="flex gap-3">
            {(['cash', 'otc', 'stripe'] as const).map((method) => (
              <button
                key={method}
                type="button"
                onClick={() => setForm({ ...form, payment_method: method })}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                  form.payment_method === method
                    ? 'bg-amber-600 border-amber-500 text-white'
                    : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {method === 'cash' ? 'Cash' : method === 'otc' ? 'OTC / Terminal' : 'Card (Stripe)'}
              </button>
            ))}
          </div>
          {selectedService && (
            <p className="text-sm text-gray-400">
              Amount: <span className="text-white font-medium">S${selectedService.priceSgd}</span>
            </p>
          )}
        </div>

        {/* Notes */}
        <textarea
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Notes (optional)"
          rows={2}
          className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
        >
          {loading ? 'Registering...' : 'Register Walk-in'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Verify walk-ins page renders and submits**

```bash
cd ~/Desktop/Projects/bookingcrm/glowos && pnpm dev
```

Navigate to `http://localhost:3000/dashboard/walkins`. Confirm the form renders with service/staff dropdowns populated. Submit a test walk-in. Confirm success message appears.

- [ ] **Step 4: Commit**

```bash
cd ~/Desktop/Projects/bookingcrm
git add glowos/apps/web/app/dashboard/walkins/ glowos/apps/web/app/dashboard/layout.tsx
git commit -m "feat(ui): walk-in registration panel with cash/OTC payment"
```

---

## Task 10: Post-Service Comms — Scheduler + Worker

**Files:**
- Modify: `glowos/services/api/src/lib/scheduler.ts`
- Modify: `glowos/services/api/src/workers/notification.worker.ts`
- Modify: `glowos/services/api/src/routes/bookings.ts`

- [ ] **Step 1: Add schedulePostServiceSequence to scheduler.ts**

In `glowos/services/api/src/lib/scheduler.ts`, add after the existing schedule functions:

```typescript
// ─── schedulePostServiceSequence ───────────────────────────────────────────────

/**
 * Queue the post-service receipt immediately, and the rebook CTA after 48 hours.
 */
export async function schedulePostServiceSequence(bookingId: string): Promise<void> {
  // Receipt: send immediately (1 second delay to let the DB commit settle)
  await addJob(
    "notifications",
    "post_service_receipt",
    { booking_id: bookingId },
    { delay: 1000 }
  );

  // Rebook CTA: send 48 hours later
  const rebookDelay = 48 * 60 * 60 * 1000;
  await addJob(
    "notifications",
    "post_service_rebook",
    { booking_id: bookingId },
    { delay: rebookDelay }
  );

  console.log("[Scheduler] Post-service sequence scheduled", {
    bookingId,
    rebookCTAAt: new Date(Date.now() + rebookDelay).toISOString(),
  });
}
```

- [ ] **Step 2: Add job type interfaces in notification.worker.ts**

In `glowos/services/api/src/workers/notification.worker.ts`, add two new data interfaces after the existing ones:

```typescript
interface PostServiceReceiptData {
  booking_id: string;
}

interface PostServiceRebookData {
  booking_id: string;
}
```

- [ ] **Step 3: Add post_service_receipt handler in notification.worker.ts**

Find the large `switch` statement or if/else chain in the worker's job processor function. Add cases for the two new job types. After the last existing `case`:

```typescript
case "post_service_receipt": {
  const data = job.data as PostServiceReceiptData;
  const details = await loadBookingWithDetails(data.booking_id);
  if (!details) {
    console.warn("[Worker] post_service_receipt — booking not found", data.booking_id);
    return;
  }

  const { booking, merchant, service, client } = details;

  if (!client.phone) return;

  const receiptMessage =
    `✅ *Service Complete — ${merchant.name}*\n\n` +
    `Hi ${client.name ?? "there"}, thank you for visiting us!\n\n` +
    `*Service:* ${service.name}\n` +
    `*Amount:* S$${booking.priceSgd}\n` +
    `*Date:* ${new Date(booking.startTime).toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" })}\n\n` +
    `We hope to see you again soon! 🌟`;

  await sendWhatsApp(client.phone, receiptMessage);
  await logNotification({
    merchantId: merchant.id,
    clientId: client.id,
    bookingId: booking.id,
    type: "post_service_receipt",
    channel: "whatsapp",
    status: "sent",
    message: receiptMessage,
  });
  break;
}

case "post_service_rebook": {
  const data = job.data as PostServiceRebookData;
  const details = await loadBookingWithDetails(data.booking_id);
  if (!details) {
    console.warn("[Worker] post_service_rebook — booking not found", data.booking_id);
    return;
  }

  const { booking, merchant, service, client } = details;

  if (!client.phone) return;

  const bookingUrl = `${config.frontendUrl}/${merchant.slug}`;
  const rebookMessage =
    `💆 *Time for your next visit?*\n\n` +
    `Hi ${client.name ?? "there"}! It's been a couple of days since your *${service.name}* at ${merchant.name}.\n\n` +
    `Ready to book again? Tap the link below:\n${bookingUrl}\n\n` +
    `See you soon! ✨`;

  await sendWhatsApp(client.phone, rebookMessage);
  await logNotification({
    merchantId: merchant.id,
    clientId: client.id,
    bookingId: booking.id,
    type: "post_service_rebook",
    channel: "whatsapp",
    status: "sent",
    message: rebookMessage,
  });
  break;
}
```

> Note: `config.frontendUrl` must exist in `glowos/services/api/src/lib/config.ts`. If it doesn't, check the config file and use whatever the public URL env var is named (likely `FRONTEND_URL` or `NEXT_PUBLIC_APP_URL`). Add `frontendUrl: process.env.FRONTEND_URL ?? 'https://glowos-nine.vercel.app'` to the config object if missing.

- [ ] **Step 4: Trigger post-service sequence on booking completion**

In `glowos/services/api/src/routes/bookings.ts`, find the endpoint that handles booking status updates (the `PATCH /:id/status` or similar that sets status to `"completed"`). Import `schedulePostServiceSequence` and call it:

```typescript
// Add import at top of bookings.ts (with other scheduler imports):
import { scheduleReminder, scheduleReviewRequest, scheduleNoShowReengagement, scheduleRebookingPrompt, schedulePostServiceSequence } from "../lib/scheduler.js";

// In the status update handler, after status is set to "completed":
if (body.status === "completed") {
  await schedulePostServiceSequence(bookingId);
}
```

Find where the booking status is updated to `completed` in the merchant bookings router. It's likely in a PATCH or POST handler. Add the `schedulePostServiceSequence` call there.

- [ ] **Step 5: Verify workers handle the new job types without errors**

```bash
cd ~/Desktop/Projects/bookingcrm/glowos/services/api
npx tsx src/index.ts
```

Expected: Server starts. No TypeScript errors. Stop with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/Projects/bookingcrm
git add glowos/services/api/src/lib/scheduler.ts glowos/services/api/src/workers/notification.worker.ts glowos/services/api/src/routes/bookings.ts
git commit -m "feat(workers): post-service receipt + rebook CTA notification sequence"
```

---

## Task 11: CSV Import — API

**Files:**
- Modify: `glowos/services/api/src/routes/clients.ts`

- [ ] **Step 1: Add CSV import endpoint to clients.ts**

In `glowos/services/api/src/routes/clients.ts`, add the following at the bottom of the file:

```typescript
// ─── POST /merchant/clients/import ────────────────────────────────────────────
// Accepts a JSON array of client records (parsed from CSV by the frontend)

const importClientSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  email: z.string().email().optional().or(z.literal("")),
  notes: z.string().optional(),
  birthday: z.string().optional(),
});

const importBatchSchema = z.object({
  clients: z.array(importClientSchema).min(1).max(500),
});

clientsRouter.post("/import", requireMerchant, zValidator(importBatchSchema), async (c) => {
  const merchantId = c.get("merchantId");
  const body = c.get("body") as z.infer<typeof importBatchSchema>;

  const results = {
    created: 0,
    skipped: 0,
    errors: [] as { phone: string; reason: string }[],
  };

  for (const record of body.clients) {
    try {
      // Check if client already exists by phone
      const [existing] = await db
        .select()
        .from(clients)
        .where(eq(clients.phone, record.phone))
        .limit(1);

      let clientId: string;

      if (existing) {
        clientId = existing.id;
        // Update name/email if currently null
        if (!existing.name && record.name) {
          await db.update(clients).set({ name: record.name }).where(eq(clients.id, existing.id));
        }
      } else {
        const [created] = await db
          .insert(clients)
          .values({
            phone: record.phone,
            email: record.email || null,
            name: record.name,
            acquisitionSource: "import",
          })
          .returning();
        clientId = created.id;
        results.created++;
      }

      // Ensure client profile exists for this merchant
      const [existingProfile] = await db
        .select()
        .from(clientProfiles)
        .where(and(eq(clientProfiles.merchantId, merchantId), eq(clientProfiles.clientId, clientId)))
        .limit(1);

      if (!existingProfile) {
        await db.insert(clientProfiles).values({
          merchantId,
          clientId,
          notes: record.notes ?? null,
          birthday: record.birthday ?? null,
        });
        if (existing) results.created++; // profile is new even if client existed
      } else {
        results.skipped++;
      }
    } catch (err) {
      results.errors.push({ phone: record.phone, reason: String(err) });
    }
  }

  return c.json({ results });
});
```

Make sure `clientProfiles` is imported at the top of `clients.ts` alongside other db imports.

- [ ] **Step 2: Verify clients.ts compiles**

```bash
cd ~/Desktop/Projects/bookingcrm/glowos/services/api
npx tsx --check src/routes/clients.ts 2>&1 | head -20
```

Expected: No output (no errors). If errors appear, fix imports.

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/Projects/bookingcrm
git add glowos/services/api/src/routes/clients.ts
git commit -m "feat(api): CSV client import endpoint (batch up to 500 records)"
```

---

## Task 12: CSV Import — UI

**Files:**
- Create: `glowos/apps/web/app/dashboard/import/page.tsx`
- Modify: `glowos/apps/web/app/dashboard/layout.tsx`

- [ ] **Step 1: Add Import to the sidebar nav**

In `glowos/apps/web/app/dashboard/layout.tsx`, add to the nav items array:

```typescript
{ href: '/dashboard/import', label: 'Import Clients', icon: '📥' },
```

- [ ] **Step 2: Create the import page**

```tsx
// glowos/apps/web/app/dashboard/import/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '../../lib/api';

interface ParsedClient {
  name: string;
  phone: string;
  email: string;
  notes: string;
}

interface ImportResults {
  created: number;
  skipped: number;
  errors: { phone: string; reason: string }[];
}

function parseCSV(text: string): ParsedClient[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].toLowerCase().split(',').map((h) => h.trim().replace(/"/g, ''));
  const nameIdx = headers.findIndex((h) => h.includes('name'));
  const phoneIdx = headers.findIndex((h) => h.includes('phone') || h.includes('mobile'));
  const emailIdx = headers.findIndex((h) => h.includes('email'));
  const notesIdx = headers.findIndex((h) => h.includes('notes') || h.includes('remark'));

  if (phoneIdx === -1) {
    throw new Error('CSV must have a "phone" or "mobile" column');
  }

  return lines
    .slice(1)
    .map((line) => {
      const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      return {
        name: nameIdx >= 0 ? cols[nameIdx] ?? '' : '',
        phone: cols[phoneIdx] ?? '',
        email: emailIdx >= 0 ? cols[emailIdx] ?? '' : '',
        notes: notesIdx >= 0 ? cols[notesIdx] ?? '' : '',
      };
    })
    .filter((r) => r.phone.length > 0);
}

export default function ImportPage() {
  const router = useRouter();
  const [preview, setPreview] = useState<ParsedClient[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ImportResults | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setParseError(null);
    setResults(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const parsed = parseCSV(text);
        setPreview(parsed);
      } catch (err) {
        setParseError(String(err));
      }
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (preview.length === 0) return;
    setLoading(true);
    try {
      const res = await apiFetch('/merchant/clients/import', {
        method: 'POST',
        body: JSON.stringify({ clients: preview }),
      }) as { results: ImportResults };
      setResults(res.results);
      setPreview([]);
    } catch (err) {
      if (err instanceof ApiError) {
        setParseError(err.message);
        if (err.status === 401) router.push('/login');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Import Clients</h1>
        <p className="text-gray-400 text-sm mt-1">
          Upload a CSV file to import your existing client list. Required column: <code className="text-amber-400">phone</code>.
          Optional columns: <code className="text-amber-400">name</code>, <code className="text-amber-400">email</code>, <code className="text-amber-400">notes</code>.
        </p>
      </div>

      {/* Template download hint */}
      <div className="bg-gray-800 rounded-lg p-4 text-sm text-gray-400">
        <p className="font-medium text-gray-300 mb-1">CSV Format</p>
        <code className="text-xs text-amber-300">name,phone,email,notes</code>
        <br />
        <code className="text-xs text-amber-300">Jane Tan,+6591234567,jane@email.com,Sensitive skin</code>
      </div>

      <input
        type="file"
        accept=".csv"
        onChange={handleFile}
        className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-amber-600 file:text-white hover:file:bg-amber-500"
      />

      {parseError && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          {parseError}
        </div>
      )}

      {preview.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">{preview.length} clients ready to import</p>
            <button
              onClick={handleImport}
              disabled={loading}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {loading ? 'Importing...' : `Import ${preview.length} clients`}
            </button>
          </div>
          <div className="max-h-64 overflow-auto rounded-lg border border-gray-700">
            <table className="w-full text-xs text-gray-300">
              <thead className="bg-gray-800 sticky top-0">
                <tr>
                  {['Name', 'Phone', 'Email', 'Notes'].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-medium text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-t border-gray-700">
                    <td className="px-3 py-2">{r.name || '—'}</td>
                    <td className="px-3 py-2">{r.phone}</td>
                    <td className="px-3 py-2">{r.email || '—'}</td>
                    <td className="px-3 py-2">{r.notes || '—'}</td>
                  </tr>
                ))}
                {preview.length > 50 && (
                  <tr className="border-t border-gray-700">
                    <td colSpan={4} className="px-3 py-2 text-gray-500 italic">
                      ... and {preview.length - 50} more
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {results && (
        <div className="bg-gray-800 rounded-lg p-4 space-y-1 text-sm">
          <p className="font-medium text-white">Import Complete</p>
          <p className="text-green-400">✓ {results.created} clients created</p>
          {results.skipped > 0 && (
            <p className="text-gray-400">⟳ {results.skipped} already existed (skipped)</p>
          )}
          {results.errors.length > 0 && (
            <div>
              <p className="text-red-400">✗ {results.errors.length} errors:</p>
              {results.errors.map((e, i) => (
                <p key={i} className="text-xs text-red-300 ml-4">{e.phone}: {e.reason}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify import page renders and file picker works**

```bash
cd ~/Desktop/Projects/bookingcrm/glowos && pnpm dev
```

Navigate to `http://localhost:3000/dashboard/import`. Upload a test CSV. Confirm the preview table renders. Submit import. Confirm results display.

- [ ] **Step 4: Commit**

```bash
cd ~/Desktop/Projects/bookingcrm
git add glowos/apps/web/app/dashboard/import/ glowos/apps/web/app/dashboard/layout.tsx
git commit -m "feat(ui): CSV client import page with preview and results"
```

---

## Task 13: Final Integration Check + Deploy

- [ ] **Step 1: Run typecheck across all packages**

```bash
cd ~/Desktop/Projects/bookingcrm/glowos
pnpm turbo typecheck 2>&1 | tail -30
```

Expected: No TypeScript errors. If there are errors, fix them before deploying.

- [ ] **Step 2: Start API and frontend together and smoke-test the golden path**

```bash
# Terminal 1 — API
cd ~/Desktop/Projects/bookingcrm/glowos/services/api
npx tsx src/index.ts

# Terminal 2 — Frontend
cd ~/Desktop/Projects/bookingcrm/glowos/apps/web
pnpm dev
```

Test these flows in the browser:
1. Dashboard → Staff → Edit a staff member → Add bio + specialty tags → Save → Verify profile saved
2. Dashboard → Services → Edit a service → Set type to "Treatment" + enable consult gate → Save
3. Navigate to public booking page → Confirm treatment shows consult banner, service description shows
4. Dashboard → Walk-ins → Register a walk-in with Cash payment → Confirm success message
5. Dashboard → Import Clients → Upload a CSV → Confirm preview + import results

- [ ] **Step 3: Deploy**

```bash
# Push to GitHub (triggers Railway auto-deploy for API)
cd ~/Desktop/Projects/bookingcrm
git push origin main

# Deploy frontend to Vercel
cd glowos
vercel --prod
```

- [ ] **Step 4: Verify production**

After deploy, visit:
- `https://glowos-nine.vercel.app/dashboard/staff` — confirm profile fields render
- `https://glowos-nine.vercel.app/dashboard/walkins` — confirm walk-in panel renders
- `https://glowos-nine.vercel.app/[your-test-slug]` — confirm staff cards + service descriptions + consult banners render

---

## Self-Review Checklist

**Spec coverage:**
- [x] Module 1 (Staff Profiles) — Tasks 3, 4, 5
- [x] Module 4 (Service Descriptions — already existed) — Task 5 (renders it)
- [x] Module 4 (Consult slot type) — Tasks 6, 7
- [x] Module 7 (Walk-in + OTC) — Tasks 8, 9
- [x] Module 5 partial (Post-service comms) — Task 10
- [x] Module 6 (CSV import) — Tasks 11, 12
- [x] Module 2 schema (groups) — Task 2 (schema only, no UI — by design)

**Not in this plan (Phase 2):**
- Group admin UI and policy enforcement
- Promotions & credits system
- Social login (Google, Apple)
- Staff self-service calendar
- Subscription tier UI

**Known gaps to address in Phase 2:**
- The `staffId` context variable is not guaranteed to be set by `requireMerchant` middleware — the consult outcome `createdByStaffId` will be `null` for owner/manager-created outcomes until staff auth is wired. This is acceptable for Phase 1.
- WhatsApp post-service templates require Meta pre-approval. Submit `post_service_receipt` and `post_service_rebook` templates to Meta Business Manager immediately after Phase 1 ships. They must match the exact message format in Task 10.
- The walk-in `start_time` is set to `new Date()` on the client side — for the MVP this is fine, but Phase 2 should add a time picker so staff can backdate walk-ins.

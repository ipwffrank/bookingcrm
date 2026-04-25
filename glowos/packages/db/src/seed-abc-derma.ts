/**
 * One-shot revamp: turns the existing "ABC" merchant into a derma/laser
 * showcase with realistic services, staff, packages, clients, and bookings.
 *
 * SAFE TO RE-RUN — script wipes ABC's owned data (bookings, packages,
 * clients tied to demo phones, services, staff) inside a transaction and
 * re-seeds. Other merchants are untouched.
 *
 * Usage:
 *   DATABASE_URL=<neon-url> npx tsx packages/db/src/seed-abc-derma.ts
 *
 * Demo client phone range: +65 8888 0001..0012. Re-running deletes any
 * existing clients in that range first to avoid the unique-phone clash.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "./schema/index.js";
import dotenv from "dotenv";
import path from "path";

// Load DATABASE_URL from glowos/.env so the script "just runs" without an
// inline env var. Try common cwds — the workspace root and `packages/db`.
for (const candidate of [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
]) {
  dotenv.config({ path: candidate });
}

const {
  merchants,
  services,
  staff,
  staffServices,
  staffHours,
  clients,
  clientProfiles,
  bookings,
  servicePackages,
  clientPackages,
  packageSessions,
  treatmentQuotes,
  reviews,
  waitlist,
  notificationLog,
  consultOutcomes,
  bookingGroups,
  bookingEdits,
  clientNotes,
  postServiceSequences,
} = schema;

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://glowos:glowos_dev@localhost:5432/glowos_dev";

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

// ─── Time helpers ──────────────────────────────────────────────────────────────

const TODAY = new Date();
TODAY.setUTCHours(0, 0, 0, 0);

function sgt(daysFromToday: number, hour: number, minute = 0): Date {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  // SGT = UTC+8, so 10:00 SGT = 02:00 UTC
  d.setUTCHours(hour - 8, minute, 0, 0);
  return d;
}

function addMin(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60_000);
}

// Demo client phone range (+65 8888 000X)
const DEMO_PHONES = Array.from({ length: 12 }, (_, i) =>
  `+658888${String(i + 1).padStart(4, "0")}`,
);

// ─── Service / staff / package definitions ─────────────────────────────────────

const SERVICE_DEFS = [
  // [key, name, description, category, duration, buffer, price, slot_type, requires_consult, visible]
  ["consult",      "Skin Consultation",                "30-min consultation with our doctor to assess your skin concerns and recommend a personalised plan.",                                                "face",    30, 0,  80,   "consult",   false, true ],
  ["botox",        "Botox Treatment",                  "FDA-approved Botox for fine lines, frown lines, and crow's feet. Issued by quote after consultation.",                                              "face",    60, 15, 480,  "treatment", true,  true ],
  ["filler_1ml",   "Dermal Filler — 1ml",              "Hyaluronic acid filler for cheeks, lips, or chin. Quote issued after consultation.",                                                                "face",    45, 15, 750,  "treatment", true,  true ],
  ["lhr_underarm", "Laser Hair Removal — Underarm",    "Diode laser permanent hair reduction for both underarms.",                                                                                          "body",    20, 5,  90,   "standard",  false, true ],
  ["lhr_legs",     "Laser Hair Removal — Full Legs",   "Diode laser hair removal covering full legs, ankle to upper thigh.",                                                                                "body",    60, 10, 280,  "standard",  false, true ],
  ["lhr_brazilian","Laser Hair Removal — Brazilian",   "Discreet diode laser hair removal for the bikini area.",                                                                                            "body",    45, 10, 190,  "standard",  false, true ],
  ["ipl",          "IPL Photofacial",                  "Intense Pulsed Light treatment for sun damage, redness, and uneven tone.",                                                                          "face",    45, 10, 280,  "standard",  false, true ],
  ["chem_peel",    "Chemical Peel",                    "Medical-grade glycolic peel for skin renewal and brightening. Mild downtime.",                                                                      "face",    45, 10, 220,  "standard",  false, true ],
  ["hydrafacial",  "Hydrafacial",                      "Multi-step facial: deep cleanse, exfoliate, extract, hydrate. The instant-glow signature.",                                                          "face",    60, 10, 260,  "standard",  false, true ],
  ["mnrf",         "Microneedling RF",                 "Radiofrequency microneedling for skin tightening, scar reduction, and pore refinement. Quote issued after consultation.",                            "face",    75, 15, 480,  "treatment", true,  true ],
  ["acne_facial",  "Acne Extraction Facial",           "Targeted facial for active breakouts: deep cleanse, extraction, and calming mask.",                                                                  "face",    60, 10, 180,  "standard",  false, true ],
  ["pigment_spot", "Laser Pigmentation Spot (per area)","Quick targeted Q-switched laser shot for individual pigmentation spots. Sold as add-on within other treatments.",                                   "face",    15, 0,  80,   "standard",  false, false], // visible_on_booking_page=false → add-on demo
] as const;

const STAFF_DEFS = [
  { key: "dr_lim",     name: "Dr Lim Wei Jie",  title: "Aesthetic Doctor",   bio: "MBBS, Aesthetic Medicine. Trained in cosmetic injectables and laser dermatology." },
  { key: "dr_karen",   name: "Dr Karen Tan",    title: "Dermatologist",      bio: "MBBS, MRCP (UK), Diploma in Practical Dermatology. Focus on medical-grade skin treatments." },
  { key: "joanne",     name: "Joanne Soh",      title: "Senior Therapist",   bio: "10+ years clinical aesthetician experience. Hydrafacial-certified." },
  { key: "felicia",    name: "Felicia Wong",    title: "Laser Specialist",   bio: "Certified laser technician for Diode, Q-switched, and IPL platforms." },
] as const;

const PACKAGE_DEFS = [
  {
    key: "glow_renewal",
    name: "Glow Renewal Plan",
    description: "Four signature Hydrafacials — your monthly glow-up commitment.",
    priceSgd: "880.00",
    validityDays: 180,
    requiresConsultFirst: false,
    sessions: [{ key: "hydrafacial", qty: 4 }],
  },
  {
    key: "smooth_year",
    name: "Smooth Year Laser Bundle",
    description: "A full year of underarms (×6) plus two Brazilians. Lock in the hair-free life.",
    priceSgd: "1990.00",
    validityDays: 365,
    requiresConsultFirst: false,
    sessions: [
      { key: "lhr_underarm", qty: 6 },
      { key: "lhr_brazilian", qty: 2 },
    ],
  },
  {
    key: "anti_aging",
    name: "Anti-Aging Premium Plan",
    description: "Botox refresh + 3× Microneedling RF + 2× Hydrafacial. Quote-based after consultation.",
    priceSgd: "4200.00",
    validityDays: 270,
    requiresConsultFirst: true, // demo of consult-first package gate
    sessions: [
      { key: "botox", qty: 1 },
      { key: "mnrf", qty: 3 },
      { key: "hydrafacial", qty: 2 },
    ],
  },
] as const;

const CLIENT_DEFS = [
  { phone: DEMO_PHONES[0],  name: "Sarah Ng",        email: "sarah.ng@example.com",      vipTier: "silver", source: "online_booking" as const },
  { phone: DEMO_PHONES[1],  name: "Michelle Cheong", email: "michelle.c@example.com",    vipTier: "gold",   source: "online_booking" as const },
  { phone: DEMO_PHONES[2],  name: "Rachel Tan",      email: "rachel.tan@example.com",    vipTier: "bronze", source: "online_booking" as const },
  { phone: DEMO_PHONES[3],  name: "Jasmine Lee",     email: "jasmine.lee@example.com",   vipTier: "silver", source: "online_booking" as const },
  { phone: DEMO_PHONES[4],  name: "Priya Menon",     email: "priya.menon@example.com",   vipTier: "gold",   source: "online_booking" as const },
  { phone: DEMO_PHONES[5],  name: "Karen Yip",       email: null,                        vipTier: "bronze", source: "walkin"         as const },
  { phone: DEMO_PHONES[6],  name: "Alicia Wong",     email: "alicia.w@example.com",      vipTier: "bronze", source: "online_booking" as const },
  { phone: DEMO_PHONES[7],  name: "Jennifer Tan",    email: "jennifer.t@example.com",    vipTier: "silver", source: "online_booking" as const },
  { phone: DEMO_PHONES[8],  name: "Fiona Goh",       email: "fiona.goh@example.com",     vipTier: "bronze", source: "online_booking" as const },
  { phone: DEMO_PHONES[9],  name: "Vanessa Lim",     email: "vanessa.l@example.com",     vipTier: "silver", source: "online_booking" as const },
  { phone: DEMO_PHONES[10], name: "Linda Chua",      email: "linda.chua@example.com",    vipTier: "gold",   source: "online_booking" as const },
  { phone: DEMO_PHONES[11], name: "Christine Wee",   email: "christine.w@example.com",   vipTier: "silver", source: "online_booking" as const },
] as const;

// ─── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log("[seed-abc-derma] start");

  const [merchant] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.slug, "abc"))
    .limit(1);
  if (!merchant) {
    console.error("Merchant 'abc' not found. Aborting.");
    process.exit(1);
  }
  const merchantId = merchant.id;
  console.log("  merchant:", merchant.name, merchantId);

  await db.transaction(async (tx) => {
    // 1. Update merchant identity + operating hours
    await tx
      .update(merchants)
      .set({
        name: "ABC Aesthetic & Laser Centre",
        description:
          "Doctor-led aesthetic and laser clinic in Orchard. Botox, fillers, lasers, and signature facials.",
        operatingHours: {
          monday:    { open: "09:00", close: "18:00", closed: false },
          tuesday:   { open: "09:00", close: "18:00", closed: false },
          wednesday: { open: "09:00", close: "18:00", closed: false },
          thursday:  { open: "09:00", close: "18:00", closed: false },
          friday:    { open: "09:00", close: "18:00", closed: false },
          saturday:  { open: "09:00", close: "17:00", closed: false },
          sunday:    { open: "09:00", close: "18:00", closed: true  },
        },
      } as never)
      .where(eq(merchants.id, merchantId));

    // 2. Wipe owned data — order matters because of FK restrict constraints.
    await tx.delete(reviews).where(eq(reviews.merchantId, merchantId));
    await tx.delete(treatmentQuotes).where(eq(treatmentQuotes.merchantId, merchantId));
    await tx.delete(notificationLog).where(eq(notificationLog.merchantId, merchantId));
    await tx.delete(waitlist).where(eq(waitlist.merchantId, merchantId));
    // package_sessions cascades from client_packages, but consult_outcomes
    // cascades from bookings — kill bookings transitively after the next layer.
    const cps = await tx
      .select({ id: clientPackages.id })
      .from(clientPackages)
      .where(eq(clientPackages.merchantId, merchantId));
    if (cps.length) {
      await tx.delete(packageSessions).where(
        inArray(packageSessions.clientPackageId, cps.map((r) => r.id)),
      );
    }
    await tx.delete(clientPackages).where(eq(clientPackages.merchantId, merchantId));
    await tx.delete(servicePackages).where(eq(servicePackages.merchantId, merchantId));
    // booking_edits / consult_outcomes / post_service_sequences cascade from bookings.
    void bookingEdits;
    void postServiceSequences;
    void consultOutcomes;
    await tx.delete(bookings).where(eq(bookings.merchantId, merchantId));
    await tx.delete(bookingGroups).where(eq(bookingGroups.merchantId, merchantId));
    await tx.delete(clientNotes).where(eq(clientNotes.merchantId, merchantId));
    await tx.delete(clientProfiles).where(eq(clientProfiles.merchantId, merchantId));
    // staff_services + staff_hours cascade from staff
    await tx.delete(staff).where(eq(staff.merchantId, merchantId));
    await tx.delete(services).where(eq(services.merchantId, merchantId));
    // Demo clients (phone-scoped). Other merchants don't share these phones.
    await tx.delete(clients).where(inArray(clients.phone, [...DEMO_PHONES]));

    // 3. Insert services
    const insertedServices = await tx
      .insert(services)
      .values(
        SERVICE_DEFS.map(([_key, name, description, category, dur, buf, price, slotType, reqConsult, visible], i) => ({
          merchantId,
          name,
          description,
          category,
          durationMinutes: dur,
          bufferMinutes: buf,
          priceSgd: price.toFixed(2),
          isActive: true,
          slotType: slotType as "standard" | "consult" | "treatment",
          requiresConsultFirst: reqConsult,
          consultServiceId: null,
          visibleOnBookingPage: visible,
          displayOrder: i,
          discountPct: null,
          discountShowOnline: false,
          firstTimerDiscountPct: null,
          firstTimerDiscountEnabled: false,
        })),
      )
      .returning();
    const svcByKey = new Map<string, string>();
    SERVICE_DEFS.forEach(([key], i) => svcByKey.set(key, insertedServices[i]!.id));

    // Wire consultServiceId on consult-required treatments to point to the consult service
    const consultId = svcByKey.get("consult")!;
    await tx
      .update(services)
      .set({ consultServiceId: consultId })
      .where(
        and(
          eq(services.merchantId, merchantId),
          eq(services.requiresConsultFirst, true),
        ),
      );

    // 4. Insert staff
    const insertedStaff = await tx
      .insert(staff)
      .values(
        STAFF_DEFS.map((s, i) => ({
          merchantId,
          name: s.name,
          title: s.title,
          bio: s.bio,
          isActive: true,
          isAnyAvailable: true,
          isPubliclyVisible: true,
          displayOrder: i,
          specialtyTags: [],
        })),
      )
      .returning();
    const staffByKey = new Map<string, string>();
    STAFF_DEFS.forEach((s, i) => staffByKey.set(s.key, insertedStaff[i]!.id));

    // 5. staff_services — every staff covers every service for demo simplicity
    const allStaffServices = insertedStaff.flatMap((st) =>
      insertedServices.map((sv) => ({ staffId: st.id, serviceId: sv.id })),
    );
    await tx.insert(staffServices).values(allStaffServices);

    // 6. staff_hours — Mon-Fri 09:00-18:00, Sat 09:00-17:00, Sun off
    const hourRows = insertedStaff.flatMap((st) =>
      [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
        staffId: st.id,
        dayOfWeek: dow,
        startTime: "09:00",
        endTime: dow === 6 ? "17:00" : "18:00",
        isWorking: dow !== 0, // Sunday off
      })),
    );
    await tx.insert(staffHours).values(hourRows);

    // 7. Insert demo clients
    const insertedClients = await tx
      .insert(clients)
      .values(
        CLIENT_DEFS.map((c) => ({
          phone: c.phone,
          name: c.name,
          email: c.email,
          acquisitionSource: c.source,
          preferredContactChannel: "whatsapp" as const,
        })),
      )
      .returning();
    const clientByPhone = new Map<string, string>();
    insertedClients.forEach((c) => clientByPhone.set(c.phone, c.id));

    // 8. client_profiles
    await tx.insert(clientProfiles).values(
      CLIENT_DEFS.map((c) => ({
        merchantId,
        clientId: clientByPhone.get(c.phone)!,
        vipTier: c.vipTier,
        marketingOptIn: true,
      })),
    );

    // 9. Service packages
    const insertedPackages = await tx
      .insert(servicePackages)
      .values(
        PACKAGE_DEFS.map((p) => ({
          merchantId,
          name: p.name,
          description: p.description,
          totalSessions: p.sessions.reduce((s, x) => s + x.qty, 0),
          priceSgd: p.priceSgd,
          includedServices: p.sessions.map((s) => ({
            serviceId: svcByKey.get(s.key)!,
            serviceName: SERVICE_DEFS.find(([k]) => k === s.key)![1],
            quantity: s.qty,
          })),
          validityDays: p.validityDays,
          isActive: true,
          requiresConsultFirst: p.requiresConsultFirst,
        })),
      )
      .returning();
    const pkgByKey = new Map<string, string>();
    PACKAGE_DEFS.forEach((p, i) => pkgByKey.set(p.key, insertedPackages[i]!.id));

    // ── Helpers for booking inserts ────────────────────────────────────────────
    const cId = (phone: string) => clientByPhone.get(phone)!;
    const sId = (k: string) => svcByKey.get(k)!;
    const stId = (k: string) => staffByKey.get(k)!;

    function bookingRow(args: {
      phone: string;
      serviceKey: typeof SERVICE_DEFS[number][0];
      staffKey: typeof STAFF_DEFS[number]["key"];
      daysFromToday: number;
      hour: number;
      minute?: number;
      status?: "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";
      paymentStatus?: "pending" | "paid" | "refunded" | "waived";
      paymentMethod?: "card" | "cash" | null;
      bookingSource?: "direct_widget" | "embedded_widget" | "walkin" | "manual" | "treatment_quote";
      cancellationReason?: string;
      firstTimer?: boolean;
    }) {
      const def = SERVICE_DEFS.find(([k]) => k === args.serviceKey)!;
      const dur = def[4];
      const buf = def[5];
      const price = def[6];
      const start = sgt(args.daysFromToday, args.hour, args.minute ?? 0);
      const end = addMin(start, dur + buf);
      const status = args.status ?? "confirmed";
      const isPast = args.daysFromToday < 0;
      const completedAt = status === "completed" ? end : null;
      const noShowAt = status === "no_show" ? end : null;
      const cancelledAt = status === "cancelled" ? addMin(start, -60 * 24) : null;
      return {
        merchantId,
        clientId: cId(args.phone),
        serviceId: sId(args.serviceKey),
        staffId: stId(args.staffKey),
        startTime: start,
        endTime: end,
        durationMinutes: dur,
        status,
        priceSgd: price.toFixed(2),
        paymentStatus: args.paymentStatus ?? (status === "completed" ? "paid" : "pending"),
        paymentMethod: args.paymentMethod ?? (isPast ? "card" : "card"),
        bookingSource: args.bookingSource ?? "direct_widget",
        firstTimerDiscountApplied: args.firstTimer ?? false,
        cancelledAt,
        cancellationReason: args.cancellationReason ?? null,
        completedAt,
        noShowAt,
      };
    }

    // 10. Bookings
    // Use phone references (DEMO_PHONES[i]) for readability.
    const P = DEMO_PHONES;
    const bookingValues = [
      // ─── Past completed (13) ──
      bookingRow({ phone: P[10], serviceKey: "hydrafacial",  staffKey: "joanne",   daysFromToday: -25, hour: 10, status: "completed" }),
      bookingRow({ phone: P[9],  serviceKey: "hydrafacial",  staffKey: "joanne",   daysFromToday: -22, hour: 14, status: "completed" }),
      bookingRow({ phone: P[1],  serviceKey: "botox",        staffKey: "dr_lim",   daysFromToday: -20, hour: 11, status: "completed", bookingSource: "treatment_quote" }),
      bookingRow({ phone: P[0],  serviceKey: "ipl",          staffKey: "felicia",  daysFromToday: -18, hour: 15, status: "completed" }),
      bookingRow({ phone: P[4],  serviceKey: "botox",        staffKey: "dr_lim",   daysFromToday: -15, hour: 10, status: "completed", bookingSource: "treatment_quote" }),
      bookingRow({ phone: P[3],  serviceKey: "lhr_legs",     staffKey: "felicia",  daysFromToday: -13, hour: 16, status: "completed" }),
      bookingRow({ phone: P[2],  serviceKey: "consult",      staffKey: "dr_karen", daysFromToday: -10, hour: 10, status: "completed", firstTimer: true }),
      bookingRow({ phone: P[7],  serviceKey: "hydrafacial",  staffKey: "joanne",   daysFromToday: -8,  hour: 11, status: "completed" }),
      bookingRow({ phone: P[11], serviceKey: "lhr_underarm", staffKey: "felicia",  daysFromToday: -6,  hour: 14, status: "completed" }),
      bookingRow({ phone: P[10], serviceKey: "chem_peel",    staffKey: "dr_karen", daysFromToday: -5,  hour: 11, status: "completed" }),
      bookingRow({ phone: P[1],  serviceKey: "hydrafacial",  staffKey: "joanne",   daysFromToday: -4,  hour: 15, status: "completed" }),
      bookingRow({ phone: P[9],  serviceKey: "hydrafacial",  staffKey: "joanne",   daysFromToday: -2,  hour: 10, status: "completed" }),
      bookingRow({ phone: P[8],  serviceKey: "consult",      staffKey: "dr_karen", daysFromToday: -1,  hour: 14, status: "completed", firstTimer: true }),

      // ─── Past no-show (1) + past cancelled (1) ──
      bookingRow({ phone: P[5],  serviceKey: "lhr_brazilian",staffKey: "felicia",  daysFromToday: -3,  hour: 16, status: "no_show", paymentStatus: "pending", paymentMethod: null }),
      bookingRow({ phone: P[6],  serviceKey: "mnrf",         staffKey: "dr_karen", daysFromToday: -2,  hour: 11, status: "cancelled", paymentStatus: "pending", paymentMethod: null, cancellationReason: "Client felt unwell — rescheduling later" }),

      // ─── Today (Apr 25, Saturday, open) ──
      bookingRow({ phone: P[10], serviceKey: "hydrafacial",  staffKey: "joanne",   daysFromToday: 0,   hour: 10, status: "confirmed" }),
      // Walk-ins for today
      bookingRow({ phone: P[5],  serviceKey: "ipl",          staffKey: "felicia",  daysFromToday: 0,   hour: 11, status: "confirmed", bookingSource: "walkin", paymentMethod: "cash" }),
      bookingRow({ phone: P[6],  serviceKey: "acne_facial",  staffKey: "joanne",   daysFromToday: 0,   hour: 15, status: "confirmed", bookingSource: "walkin", paymentMethod: "cash" }),

      // ─── Upcoming confirmed (6) ──
      bookingRow({ phone: P[0],  serviceKey: "hydrafacial",  staffKey: "joanne",   daysFromToday: 1,   hour: 10, status: "confirmed" }),
      bookingRow({ phone: P[11], serviceKey: "lhr_underarm", staffKey: "felicia",  daysFromToday: 1,   hour: 14, status: "confirmed" }),
      bookingRow({ phone: P[4],  serviceKey: "botox",        staffKey: "dr_lim",   daysFromToday: 3,   hour: 11, status: "confirmed", bookingSource: "treatment_quote" }),
      bookingRow({ phone: P[3],  serviceKey: "lhr_legs",     staffKey: "felicia",  daysFromToday: 4,   hour: 15, status: "confirmed" }),
      bookingRow({ phone: P[7],  serviceKey: "hydrafacial",  staffKey: "joanne",   daysFromToday: 5,   hour: 10, status: "confirmed" }),
      bookingRow({ phone: P[9],  serviceKey: "hydrafacial",  staffKey: "joanne",   daysFromToday: 7,   hour: 16, status: "confirmed" }),
      bookingRow({ phone: P[10], serviceKey: "chem_peel",    staffKey: "dr_karen", daysFromToday: 10,  hour: 14, status: "confirmed" }),
    ];
    const insertedBookings = await tx.insert(bookings).values(bookingValues).returning();

    // 11. Two active client packages with sessions
    // (a) Christine Wee (P[11]) — Smooth Year Laser Bundle, bought 24d ago, 1 used, 1 booked
    const purchase1 = sgt(-24, 14);
    const expires1 = new Date(purchase1);
    expires1.setUTCDate(expires1.getUTCDate() + 365);
    const [christinePkg] = await tx
      .insert(clientPackages)
      .values({
        merchantId,
        clientId: cId(P[11]),
        packageId: pkgByKey.get("smooth_year")!,
        packageName: "Smooth Year Laser Bundle",
        sessionsTotal: 8,
        sessionsUsed: 1,
        purchasedAt: purchase1,
        expiresAt: expires1,
        status: "active",
        pricePaidSgd: "1990.00",
        soldByStaffId: stId("felicia"),
      })
      .returning();
    // Map the existing -6 day underarm booking to package session 1, the +1 day to session 2.
    const lhrUnderarmDone = insertedBookings.find(
      (b) => b.serviceId === sId("lhr_underarm") && b.status === "completed",
    )!;
    const lhrUnderarmUpcoming = insertedBookings.find(
      (b) =>
        b.serviceId === sId("lhr_underarm") &&
        b.status === "confirmed" &&
        b.startTime > TODAY,
    )!;
    await tx.insert(packageSessions).values([
      { clientPackageId: christinePkg!.id, sessionNumber: 1, serviceId: sId("lhr_underarm"), bookingId: lhrUnderarmDone.id, status: "completed", staffId: stId("felicia"), staffName: "Felicia Wong", completedAt: lhrUnderarmDone.endTime },
      { clientPackageId: christinePkg!.id, sessionNumber: 2, serviceId: sId("lhr_underarm"), bookingId: lhrUnderarmUpcoming.id, status: "booked", staffId: stId("felicia"), staffName: "Felicia Wong" },
      { clientPackageId: christinePkg!.id, sessionNumber: 3, serviceId: sId("lhr_underarm"), status: "pending" },
      { clientPackageId: christinePkg!.id, sessionNumber: 4, serviceId: sId("lhr_underarm"), status: "pending" },
      { clientPackageId: christinePkg!.id, sessionNumber: 5, serviceId: sId("lhr_underarm"), status: "pending" },
      { clientPackageId: christinePkg!.id, sessionNumber: 6, serviceId: sId("lhr_underarm"), status: "pending" },
      { clientPackageId: christinePkg!.id, sessionNumber: 7, serviceId: sId("lhr_brazilian"), status: "pending" },
      { clientPackageId: christinePkg!.id, sessionNumber: 8, serviceId: sId("lhr_brazilian"), status: "pending" },
    ]);

    // (b) Jennifer Tan (P[7]) — Glow Renewal Plan, bought 20d ago, 1 used, 1 booked, 2 pending
    const purchase2 = sgt(-20, 11);
    const expires2 = new Date(purchase2);
    expires2.setUTCDate(expires2.getUTCDate() + 180);
    const [jenniferPkg] = await tx
      .insert(clientPackages)
      .values({
        merchantId,
        clientId: cId(P[7]),
        packageId: pkgByKey.get("glow_renewal")!,
        packageName: "Glow Renewal Plan",
        sessionsTotal: 4,
        sessionsUsed: 1,
        purchasedAt: purchase2,
        expiresAt: expires2,
        status: "active",
        pricePaidSgd: "880.00",
        soldByStaffId: stId("joanne"),
      })
      .returning();
    const jenniferDone = insertedBookings.find(
      (b) =>
        b.clientId === cId(P[7]) &&
        b.serviceId === sId("hydrafacial") &&
        b.status === "completed",
    )!;
    const jenniferUpcoming = insertedBookings.find(
      (b) =>
        b.clientId === cId(P[7]) &&
        b.serviceId === sId("hydrafacial") &&
        b.status === "confirmed",
    )!;
    await tx.insert(packageSessions).values([
      { clientPackageId: jenniferPkg!.id, sessionNumber: 1, serviceId: sId("hydrafacial"), bookingId: jenniferDone.id, status: "completed", staffId: stId("joanne"), staffName: "Joanne Soh", completedAt: jenniferDone.endTime },
      { clientPackageId: jenniferPkg!.id, sessionNumber: 2, serviceId: sId("hydrafacial"), bookingId: jenniferUpcoming.id, status: "booked", staffId: stId("joanne"), staffName: "Joanne Soh" },
      { clientPackageId: jenniferPkg!.id, sessionNumber: 3, serviceId: sId("hydrafacial"), status: "pending" },
      { clientPackageId: jenniferPkg!.id, sessionNumber: 4, serviceId: sId("hydrafacial"), status: "pending" },
    ]);

    // 12. One pending treatment_quote (Fiona Goh, Filler 1ml — quote sent, awaiting accept)
    await tx.insert(treatmentQuotes).values({
      merchantId,
      clientId: cId(P[8]),
      serviceId: sId("filler_1ml"),
      serviceName: "Dermal Filler — 1ml",
      priceSgd: "750.00",
      notes: "Recommended 1ml on cheeks following consultation. Discussed downtime + aftercare.",
      issuedAt: sgt(-1, 16),
      validUntil: sgt(13, 23, 59),
      acceptToken: `demo-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
      status: "pending",
    } as never);

    console.log("  inserted:");
    console.log("    services:", insertedServices.length);
    console.log("    staff:   ", insertedStaff.length);
    console.log("    packages:", insertedPackages.length);
    console.log("    clients: ", insertedClients.length);
    console.log("    bookings:", insertedBookings.length);
    console.log("    package sessions: 12 across 2 client packages");
    console.log("    pending treatment quote: 1 (Fiona Goh / Filler 1ml)");
  });

  console.log("[seed-abc-derma] done");
  await pool.end();
}

run().catch((err) => {
  console.error("[seed-abc-derma] failed", err);
  process.exit(1);
});

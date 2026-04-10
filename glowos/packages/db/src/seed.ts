/**
 * Seed script: adds test branches, staff, services, clients, and appointments
 * for the existing "ABC Salon" merchant.
 *
 * Usage:
 *   DATABASE_URL=<url> npx tsx packages/db/src/seed.ts
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, and } from "drizzle-orm";
import * as schema from "./schema/index.js";

const {
  merchants,
  merchantUsers,
  services,
  staff,
  staffServices,
  staffHours,
  clients,
  clientProfiles,
  bookings,
} = schema;

// ─── Configuration ────────────────────────────────────────────────────────────

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://glowos:glowos_dev@localhost:5432/glowos_dev";

const pool = new Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

// Today's date for seeding appointments
const TODAY = "2026-04-11";

// ─── Helper: create a date at a specific SGT time ─────────────────────────────

function sgtDate(dateStr: string, hours: number, minutes: number = 0): Date {
  // SGT is UTC+8
  const d = new Date(`${dateStr}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00+08:00`);
  return d;
}

// ─── Main Seed Function ───────────────────────────────────────────────────────

async function seed() {
  console.log("Starting seed...");

  // 1. Find existing ABC Salon merchant
  const [abcSalon] = await db
    .select()
    .from(merchants)
    .where(eq(merchants.slug, "abc-salon"))
    .limit(1);

  if (!abcSalon) {
    console.error("ERROR: ABC Salon merchant not found. Please ensure the base merchant exists first.");
    process.exit(1);
  }

  const merchantId = abcSalon.id;
  console.log(`Found ABC Salon: ${merchantId}`);

  // 2. Create additional branch merchants (Orchard, Tampines, Jurong)
  const branches = [
    {
      slug: "abc-salon-orchard",
      name: "ABC Salon - Orchard",
      description: "Premium hair salon at Orchard Road, specializing in Korean-style treatments.",
      addressLine1: "391 Orchard Road, #03-12",
      addressLine2: "Ngee Ann City",
      postalCode: "238872",
      phone: "+65 6733 1234",
      email: "orchard@abcsalon.sg",
      category: "hair_salon" as const,
    },
    {
      slug: "abc-salon-tampines",
      name: "ABC Salon - Tampines",
      description: "Full-service hair and beauty salon in the heart of Tampines.",
      addressLine1: "4 Tampines Central 5, #02-08",
      addressLine2: "Tampines Mall",
      postalCode: "529510",
      phone: "+65 6784 5678",
      email: "tampines@abcsalon.sg",
      category: "hair_salon" as const,
    },
    {
      slug: "abc-salon-jurong",
      name: "ABC Salon - Jurong",
      description: "Affordable yet quality hair services in Jurong East.",
      addressLine1: "1 Jurong East Street 21, #01-45",
      addressLine2: "JCube",
      postalCode: "609732",
      phone: "+65 6567 9012",
      email: "jurong@abcsalon.sg",
      category: "hair_salon" as const,
    },
  ];

  const branchIds: string[] = [];

  for (const branch of branches) {
    // Upsert: skip if slug already exists
    const [existing] = await db
      .select({ id: merchants.id })
      .from(merchants)
      .where(eq(merchants.slug, branch.slug))
      .limit(1);

    if (existing) {
      console.log(`Branch "${branch.name}" already exists, skipping.`);
      branchIds.push(existing.id);
      continue;
    }

    const [created] = await db
      .insert(merchants)
      .values({
        ...branch,
        timezone: "Asia/Singapore",
        subscriptionTier: "professional",
        subscriptionStatus: "active",
      })
      .returning({ id: merchants.id });

    console.log(`Created branch: ${branch.name} (${created!.id})`);
    branchIds.push(created!.id);
  }

  // 3. Create services for each branch (and ensure ABC Salon has enough services)
  const serviceTemplates = [
    { name: "Men's Haircut", description: "Classic men's haircut with styling", durationMinutes: 30, priceSgd: "25.00", category: "haircut" },
    { name: "Women's Haircut", description: "Professional women's cut and blow dry", durationMinutes: 45, priceSgd: "45.00", category: "haircut" },
    { name: "Hair Colouring", description: "Full head colour treatment with premium products", durationMinutes: 90, priceSgd: "120.00", category: "colour" },
    { name: "Highlights / Balayage", description: "Partial or full highlights using foil or balayage technique", durationMinutes: 120, priceSgd: "180.00", category: "colour" },
    { name: "Keratin Treatment", description: "Smoothing keratin treatment for frizz-free hair", durationMinutes: 120, priceSgd: "200.00", category: "treatment" },
    { name: "Scalp Treatment", description: "Detox and nourishing scalp therapy", durationMinutes: 45, priceSgd: "65.00", category: "treatment" },
    { name: "Hair Wash & Blow Dry", description: "Relaxing wash and professional blow dry", durationMinutes: 30, priceSgd: "20.00", category: "wash" },
    { name: "Perming", description: "Digital or cold perm for lasting curls", durationMinutes: 150, priceSgd: "250.00", category: "perm" },
  ];

  // Create services for all merchants (original + branches)
  const allMerchantIds = [merchantId, ...branchIds];
  const serviceIdMap = new Map<string, string[]>(); // merchantId -> serviceIds

  for (const mid of allMerchantIds) {
    const existingServices = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.merchantId, mid));

    if (existingServices.length >= 4) {
      console.log(`Merchant ${mid} already has ${existingServices.length} services, skipping service creation.`);
      serviceIdMap.set(mid, existingServices.map((s) => s.id));
      continue;
    }

    const created: string[] = [];
    for (let i = 0; i < serviceTemplates.length; i++) {
      const tmpl = serviceTemplates[i]!;
      const [svc] = await db
        .insert(services)
        .values({
          merchantId: mid,
          name: tmpl.name,
          description: tmpl.description,
          durationMinutes: tmpl.durationMinutes,
          priceSgd: tmpl.priceSgd,
          category: tmpl.category,
          isActive: true,
          displayOrder: i,
        })
        .returning({ id: services.id });
      created.push(svc!.id);
    }
    console.log(`Created ${created.length} services for merchant ${mid}`);
    serviceIdMap.set(mid, created);
  }

  // 4. Create staff for each branch
  const staffTemplates = [
    { name: "Sarah Tan", title: "Senior Stylist" },
    { name: "David Lim", title: "Colourist" },
    { name: "Jessica Wong", title: "Junior Stylist" },
    { name: "Michael Chen", title: "Barber" },
  ];

  const staffIdMap = new Map<string, string[]>(); // merchantId -> staffIds

  for (const mid of allMerchantIds) {
    const existingStaff = await db
      .select({ id: staff.id })
      .from(staff)
      .where(eq(staff.merchantId, mid));

    if (existingStaff.length >= 2) {
      console.log(`Merchant ${mid} already has ${existingStaff.length} staff, skipping staff creation.`);
      staffIdMap.set(mid, existingStaff.map((s) => s.id));
      continue;
    }

    const created: string[] = [];
    for (let i = 0; i < staffTemplates.length; i++) {
      const tmpl = staffTemplates[i]!;
      const [member] = await db
        .insert(staff)
        .values({
          merchantId: mid,
          name: tmpl.name,
          title: tmpl.title,
          isActive: true,
          displayOrder: i,
        })
        .returning({ id: staff.id });
      created.push(member!.id);

      // Assign all services to this staff member
      const svcIds = serviceIdMap.get(mid) ?? [];
      for (const svcId of svcIds) {
        await db
          .insert(staffServices)
          .values({ staffId: member!.id, serviceId: svcId })
          .onConflictDoNothing();
      }

      // Create working hours (Mon-Sat, 10am-7pm)
      for (let dow = 1; dow <= 6; dow++) {
        await db.insert(staffHours).values({
          staffId: member!.id,
          dayOfWeek: dow,
          startTime: "10:00",
          endTime: "19:00",
          isWorking: true,
        });
      }
    }
    console.log(`Created ${created.length} staff for merchant ${mid}`);
    staffIdMap.set(mid, created);
  }

  // 5. Create test clients
  const clientTemplates = [
    { phone: "+65 9111 0001", name: "Aisha Rahman", email: "aisha@example.com" },
    { phone: "+65 9111 0002", name: "Tan Wei Ming", email: "weiming@example.com" },
    { phone: "+65 9111 0003", name: "Priya Nair", email: "priya@example.com" },
    { phone: "+65 9111 0004", name: "John Lim", email: "john.lim@example.com" },
    { phone: "+65 9111 0005", name: "Emily Koh", email: "emily.koh@example.com" },
    { phone: "+65 9111 0006", name: "Raj Kumar", email: "raj.kumar@example.com" },
    { phone: "+65 9111 0007", name: "Siti Aminah", email: "siti@example.com" },
    { phone: "+65 9111 0008", name: "Alex Ong", email: "alex.ong@example.com" },
  ];

  const clientIds: string[] = [];

  for (const tmpl of clientTemplates) {
    const [existing] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.phone, tmpl.phone))
      .limit(1);

    if (existing) {
      clientIds.push(existing.id);
      continue;
    }

    const [created] = await db
      .insert(clients)
      .values(tmpl)
      .returning({ id: clients.id });

    clientIds.push(created!.id);
  }
  console.log(`Ensured ${clientIds.length} test clients exist`);

  // 6. Create client profiles for ABC Salon (main) and branches
  for (const mid of allMerchantIds) {
    for (let i = 0; i < clientIds.length; i++) {
      const clientId = clientIds[i]!;
      const [existing] = await db
        .select({ id: clientProfiles.id })
        .from(clientProfiles)
        .where(
          and(
            eq(clientProfiles.merchantId, mid),
            eq(clientProfiles.clientId, clientId)
          )
        )
        .limit(1);

      if (existing) continue;

      const tiers: Array<"bronze" | "silver" | "gold" | "platinum"> = ["bronze", "silver", "gold", "platinum"];
      const churnRisks: Array<"low" | "medium" | "high"> = ["low", "low", "medium", "high"];

      await db.insert(clientProfiles).values({
        merchantId: mid,
        clientId,
        vipTier: tiers[i % tiers.length]!,
        churnRisk: churnRisks[i % churnRisks.length]!,
        marketingOptIn: true,
      });
    }
    console.log(`Ensured client profiles for merchant ${mid}`);
  }

  // 7. Create test bookings for today and upcoming dates
  // Focus on ABC Salon (main merchant) for dashboard visibility
  const mainStaffIds = staffIdMap.get(merchantId) ?? [];
  const mainServiceIds = serviceIdMap.get(merchantId) ?? [];

  if (mainStaffIds.length === 0 || mainServiceIds.length === 0) {
    console.error("ERROR: No staff or services found for ABC Salon. Cannot create bookings.");
    process.exit(1);
  }

  // Check if there are already bookings for today
  const existingTodayBookings = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.merchantId, merchantId),
        eq(bookings.status, "confirmed")
      )
    )
    .limit(1);

  // Today's bookings - various times throughout the day
  const todayBookings = [
    { hour: 10, min: 0, clientIdx: 0, staffIdx: 0, serviceIdx: 0, status: "confirmed" as const },
    { hour: 10, min: 30, clientIdx: 1, staffIdx: 1, serviceIdx: 1, status: "confirmed" as const },
    { hour: 11, min: 0, clientIdx: 2, staffIdx: 0, serviceIdx: 2, status: "in_progress" as const },
    { hour: 11, min: 30, clientIdx: 3, staffIdx: 2, serviceIdx: 0, status: "confirmed" as const },
    { hour: 13, min: 0, clientIdx: 4, staffIdx: 1, serviceIdx: 3, status: "confirmed" as const },
    { hour: 14, min: 0, clientIdx: 5, staffIdx: 0, serviceIdx: 1, status: "confirmed" as const },
    { hour: 14, min: 30, clientIdx: 6, staffIdx: 3, serviceIdx: 4, status: "confirmed" as const },
    { hour: 15, min: 30, clientIdx: 7, staffIdx: 2, serviceIdx: 5, status: "confirmed" as const },
    { hour: 16, min: 0, clientIdx: 0, staffIdx: 1, serviceIdx: 6, status: "confirmed" as const },
    { hour: 17, min: 0, clientIdx: 1, staffIdx: 0, serviceIdx: 0, status: "confirmed" as const },
  ];

  // Past bookings (for spending data) - last 30 days
  const pastDates = [
    "2026-03-15", "2026-03-18", "2026-03-20", "2026-03-22",
    "2026-03-25", "2026-03-28", "2026-04-01", "2026-04-03",
    "2026-04-05", "2026-04-07", "2026-04-09",
  ];

  const pastBookings = pastDates.flatMap((date, idx) => [
    { date, hour: 10, min: 0, clientIdx: idx % clientIds.length, staffIdx: idx % mainStaffIds.length, serviceIdx: idx % mainServiceIds.length, status: "completed" as const },
    { date, hour: 14, min: 0, clientIdx: (idx + 1) % clientIds.length, staffIdx: (idx + 1) % mainStaffIds.length, serviceIdx: (idx + 2) % mainServiceIds.length, status: "completed" as const },
  ]);

  // Future bookings (upcoming)
  const futureBookings = [
    { date: "2026-04-12", hour: 10, min: 0, clientIdx: 0, staffIdx: 0, serviceIdx: 1, status: "confirmed" as const },
    { date: "2026-04-12", hour: 11, min: 0, clientIdx: 2, staffIdx: 1, serviceIdx: 3, status: "confirmed" as const },
    { date: "2026-04-12", hour: 14, min: 0, clientIdx: 4, staffIdx: 2, serviceIdx: 0, status: "confirmed" as const },
    { date: "2026-04-13", hour: 10, min: 30, clientIdx: 1, staffIdx: 0, serviceIdx: 2, status: "confirmed" as const },
    { date: "2026-04-13", hour: 13, min: 0, clientIdx: 3, staffIdx: 1, serviceIdx: 4, status: "confirmed" as const },
    { date: "2026-04-14", hour: 11, min: 0, clientIdx: 5, staffIdx: 2, serviceIdx: 1, status: "confirmed" as const },
    { date: "2026-04-14", hour: 15, min: 0, clientIdx: 6, staffIdx: 3, serviceIdx: 5, status: "confirmed" as const },
  ];

  // Helper to get service details for duration/price
  async function getServiceDetails(svcId: string) {
    const [svc] = await db
      .select({
        durationMinutes: services.durationMinutes,
        priceSgd: services.priceSgd,
      })
      .from(services)
      .where(eq(services.id, svcId))
      .limit(1);
    return svc ?? { durationMinutes: 30, priceSgd: "30.00" };
  }

  let bookingsCreated = 0;

  // Insert today's bookings
  for (const b of todayBookings) {
    const staffId = mainStaffIds[b.staffIdx % mainStaffIds.length]!;
    const serviceId = mainServiceIds[b.serviceIdx % mainServiceIds.length]!;
    const clientId = clientIds[b.clientIdx]!;
    const svcDetails = await getServiceDetails(serviceId);
    const startTime = sgtDate(TODAY, b.hour, b.min);
    const endTime = new Date(startTime.getTime() + svcDetails.durationMinutes * 60 * 1000);

    await db.insert(bookings).values({
      merchantId,
      clientId,
      serviceId,
      staffId,
      startTime,
      endTime,
      durationMinutes: svcDetails.durationMinutes,
      status: b.status,
      priceSgd: svcDetails.priceSgd,
      paymentStatus: "pending",
      paymentMethod: ["cash", "card", "paynow"][bookingsCreated % 3]!,
      bookingSource: "walk_in",
      checkedInAt: b.status === "in_progress" ? new Date() : undefined,
    });
    bookingsCreated++;
  }

  console.log(`Created ${bookingsCreated} today's bookings`);

  // Insert past bookings (completed)
  let pastCreated = 0;
  for (const b of pastBookings) {
    const staffId = mainStaffIds[b.staffIdx % mainStaffIds.length]!;
    const serviceId = mainServiceIds[b.serviceIdx % mainServiceIds.length]!;
    const clientId = clientIds[b.clientIdx]!;
    const svcDetails = await getServiceDetails(serviceId);
    const startTime = sgtDate(b.date, b.hour, b.min);
    const endTime = new Date(startTime.getTime() + svcDetails.durationMinutes * 60 * 1000);

    await db.insert(bookings).values({
      merchantId,
      clientId,
      serviceId,
      staffId,
      startTime,
      endTime,
      durationMinutes: svcDetails.durationMinutes,
      status: "completed",
      priceSgd: svcDetails.priceSgd,
      paymentStatus: "paid",
      paymentMethod: ["cash", "card", "paynow"][pastCreated % 3]!,
      bookingSource: ["walk_in", "online", "google"][pastCreated % 3]!,
      completedAt: endTime,
    });
    pastCreated++;
  }
  console.log(`Created ${pastCreated} past bookings`);

  // Insert future bookings
  let futureCreated = 0;
  for (const b of futureBookings) {
    const staffId = mainStaffIds[b.staffIdx % mainStaffIds.length]!;
    const serviceId = mainServiceIds[b.serviceIdx % mainServiceIds.length]!;
    const clientId = clientIds[b.clientIdx]!;
    const svcDetails = await getServiceDetails(serviceId);
    const startTime = sgtDate(b.date, b.hour, b.min);
    const endTime = new Date(startTime.getTime() + svcDetails.durationMinutes * 60 * 1000);

    await db.insert(bookings).values({
      merchantId,
      clientId,
      serviceId,
      staffId,
      startTime,
      endTime,
      durationMinutes: svcDetails.durationMinutes,
      status: "confirmed",
      priceSgd: svcDetails.priceSgd,
      paymentStatus: "pending",
      bookingSource: "online",
    });
    futureCreated++;
  }
  console.log(`Created ${futureCreated} future bookings`);

  // Also create some bookings for branches
  for (const branchId of branchIds) {
    const branchStaffIds = staffIdMap.get(branchId) ?? [];
    const branchServiceIds = serviceIdMap.get(branchId) ?? [];

    if (branchStaffIds.length === 0 || branchServiceIds.length === 0) continue;

    let branchBookingsCreated = 0;
    for (let i = 0; i < 3; i++) {
      const staffId = branchStaffIds[i % branchStaffIds.length]!;
      const serviceId = branchServiceIds[i % branchServiceIds.length]!;
      const clientId = clientIds[i]!;
      const svcDetails = await getServiceDetails(serviceId);
      const startTime = sgtDate(TODAY, 10 + i * 2, 0);
      const endTime = new Date(startTime.getTime() + svcDetails.durationMinutes * 60 * 1000);

      await db.insert(bookings).values({
        merchantId: branchId,
        clientId,
        serviceId,
        staffId,
        startTime,
        endTime,
        durationMinutes: svcDetails.durationMinutes,
        status: "confirmed",
        priceSgd: svcDetails.priceSgd,
        paymentStatus: "pending",
        bookingSource: "online",
      });
      branchBookingsCreated++;
    }
    console.log(`Created ${branchBookingsCreated} bookings for branch ${branchId}`);
  }

  console.log("\nSeed complete!");
  console.log(`Summary:
  - ${branches.length} branch merchants (Orchard, Tampines, Jurong)
  - ${serviceTemplates.length} services per new merchant
  - ${staffTemplates.length} staff per new merchant
  - ${clientTemplates.length} test clients
  - ${bookingsCreated} today's bookings for ABC Salon
  - ${pastCreated} past completed bookings (for spending data)
  - ${futureCreated} future bookings
  - Branch bookings for each new location`);

  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

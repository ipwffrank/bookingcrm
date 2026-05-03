/**
 * Professional client-profile PDF renderer.
 *
 * Replaces the old approach (browser print-to-PDF on the dashboard route)
 * which produced un-shareable screenshots with the dashboard sidebar +
 * list bleeding through. This is a real PDF: clean layout, no chrome,
 * branded with the clinic's identity, suitable for handing to the
 * patient or attaching to a clinical handoff.
 *
 * Layout (A4 portrait):
 *   1. Header strip — clinic name + address + tax reg, with "CLIENT
 *      PROFILE" eyebrow and the patient's name + VIP/risk badges
 *   2. Patient details block — phone, email, member-since
 *   3. Three KPI cards — Total Visits | Total Revenue | Last Visit
 *   4. Upcoming appointments table (if any)
 *   5. Service history table (last 50 bookings)
 *   6. Confidentiality footer — PDPA notice + GlowOS attribution
 *
 * The bulk renderer (renderBulkClientProfilesPdf) glues N single-client
 * sections together with page breaks. One file, easy to share.
 */

import PDFDocument from "pdfkit";
import type {
  clients,
  clientProfiles,
  bookings,
  services,
  staff,
  merchants,
  clinicalRecords,
  clinicalRecordOdontograms,
} from "@glowos/db";

// ─── Palette (mirrors restricted dashboard palette) ─────────────────────

const COLOURS = {
  ink: "#1a2313",
  sage: "#456466",
  paper: "#fafaf7",
  grey90: "#1f2419",
  grey70: "#5a6051",
  grey60: "#6b7165",
  grey45: "#8a8e85",
  grey20: "#d4d6cf",
  grey10: "#e7e8e3",
  grey5: "#f1f2ed",
  warn: "#a8580a",
  danger: "#a82a1a",
};

const PAGE_LEFT = 50;
const PAGE_RIGHT = 545;
const PAGE_BOTTOM = 800; // safe content boundary for footer

// ─── Types ──────────────────────────────────────────────────────────────

type MerchantRow = typeof merchants.$inferSelect;
type ProfileRow = typeof clientProfiles.$inferSelect;
type ClientRow = typeof clients.$inferSelect;
type BookingRow = typeof bookings.$inferSelect;
type ServiceRow = typeof services.$inferSelect;
type StaffRow = typeof staff.$inferSelect;
type ClinicalRecordRow = typeof clinicalRecords.$inferSelect;
type OdontogramRow = typeof clinicalRecordOdontograms.$inferSelect;

export interface BookingWithLookups {
  booking: BookingRow;
  service: { id: string; name: string };
  staffMember: { id: string; name: string };
}

export interface LoyaltySummary {
  balance: number;
  enabled: boolean;
  pointsPerDollar: number | null;
  pointsPerDollarRedeem: number | null;
}

export interface ClientProfileData {
  merchant: MerchantRow;
  profile: ProfileRow;
  client: ClientRow;
  totalVisits: number;
  totalSpendSgd: string;
  lastVisitAt: string | null;
  noShowCount: number;
  recentBookings: BookingWithLookups[];
  loyalty: LoyaltySummary;
  clinicalRecords: ClinicalRecordRow[];
  latestOdontogram: OdontogramRow | null;
}

// ─── Single-client renderer ─────────────────────────────────────────────

export async function renderClientProfilePdf(data: ClientProfileData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: {
      Title: `Client Profile — ${data.client.name ?? data.client.phone}`,
      Author: data.merchant.name,
      Subject: "Patient profile report",
      Keywords: "client profile glowos pdpa",
    },
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c as Buffer));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  drawClientProfileSection(doc, data, { isFirst: true });
  drawFooter(doc);

  doc.end();
  return finished;
}

// ─── Bulk renderer — one combined PDF, page break per client ────────────

export async function renderBulkClientProfilesPdf(
  rows: ClientProfileData[],
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: {
      Title: `Client Profiles (${rows.length}) — ${rows[0]?.merchant.name ?? "GlowOS"}`,
      Author: rows[0]?.merchant.name ?? "GlowOS",
      Subject: "Bulk patient profile report",
      Keywords: "client profile glowos pdpa bulk",
    },
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c as Buffer));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // Cover page (lightweight) — clinic name + report date + count
  drawCoverPage(doc, rows);
  // First client starts on a fresh page
  rows.forEach((data, idx) => {
    doc.addPage();
    drawClientProfileSection(doc, data, { isFirst: idx === 0 });
  });
  drawFooter(doc);

  doc.end();
  return finished;
}

// ─── Cover page (bulk export only) ──────────────────────────────────────

function drawCoverPage(doc: PDFKit.PDFDocument, rows: ClientProfileData[]): void {
  const merchant = rows[0]?.merchant;
  if (!merchant) return;

  doc.y = 200;
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(10)
    .font("Helvetica")
    .text("CLIENT PROFILE EXPORT", PAGE_LEFT, doc.y, { characterSpacing: 1.5, width: PAGE_RIGHT - PAGE_LEFT, align: "center" });
  doc.x = PAGE_LEFT;
  doc.y += 16;

  doc
    .fillColor(COLOURS.ink)
    .fontSize(28)
    .font("Helvetica-Bold")
    .text(merchant.name, PAGE_LEFT, doc.y, { width: PAGE_RIGHT - PAGE_LEFT, align: "center" });
  doc.x = PAGE_LEFT;
  doc.y += 32;

  doc
    .fillColor(COLOURS.grey60)
    .fontSize(11)
    .font("Helvetica")
    .text(
      `Report generated ${formatDate(new Date())} · ${rows.length} client${rows.length === 1 ? "" : "s"}`,
      PAGE_LEFT,
      doc.y,
      { width: PAGE_RIGHT - PAGE_LEFT, align: "center" },
    );
  doc.x = PAGE_LEFT;
  doc.y += 60;

  // Confidentiality notice — prominent on the cover
  const noticeY = doc.y;
  const noticeH = 90;
  doc
    .strokeColor(COLOURS.grey20)
    .lineWidth(0.5)
    .roundedRect(PAGE_LEFT + 30, noticeY, PAGE_RIGHT - PAGE_LEFT - 60, noticeH, 6)
    .stroke();
  doc
    .fillColor(COLOURS.warn)
    .fontSize(9)
    .font("Helvetica-Bold")
    .text("CONFIDENTIAL", PAGE_LEFT + 50, noticeY + 14, { characterSpacing: 1.5 });
  doc.x = PAGE_LEFT;
  doc
    .fillColor(COLOURS.grey90)
    .fontSize(10)
    .font("Helvetica")
    .text(
      "This report contains personal data protected under PDPA Act 709 (Malaysia) " +
        "and equivalent privacy frameworks. Distribute only to authorised parties. " +
        "Do not retain copies beyond the period required for the stated purpose.",
      PAGE_LEFT + 50,
      noticeY + 32,
      { width: PAGE_RIGHT - PAGE_LEFT - 100, lineGap: 2 },
    );
  doc.x = PAGE_LEFT;
}

// ─── Per-client section (~1 page typical, can spill to a 2nd) ───────────

function drawClientProfileSection(
  doc: PDFKit.PDFDocument,
  data: ClientProfileData,
  _opts: { isFirst: boolean },
): void {
  const { merchant, profile, client, totalVisits, totalSpendSgd, lastVisitAt, recentBookings } = data;

  // ─── Header: clinic identity (small) ──────────────────────────────────
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(8.5)
    .font("Helvetica")
    .text(merchant.name.toUpperCase(), PAGE_LEFT, 40, { characterSpacing: 1.2 });
  doc.x = PAGE_LEFT;

  const issuerSubLines: string[] = [];
  if (merchant.addressLine1) issuerSubLines.push(merchant.addressLine1);
  if (merchant.addressLine2) issuerSubLines.push(merchant.addressLine2);
  if (merchant.phone || merchant.email) {
    issuerSubLines.push([merchant.phone, merchant.email].filter(Boolean).join(" · "));
  }
  if (issuerSubLines.length > 0) {
    doc
      .fillColor(COLOURS.grey45)
      .fontSize(8)
      .text(issuerSubLines.join(" · "), PAGE_LEFT, 52, { width: PAGE_RIGHT - PAGE_LEFT });
    doc.x = PAGE_LEFT;
  }

  // Top-right: report date
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(8.5)
    .font("Helvetica")
    .text(`REPORT GENERATED ${formatDate(new Date()).toUpperCase()}`, PAGE_LEFT, 40, {
      width: PAGE_RIGHT - PAGE_LEFT,
      align: "right",
      characterSpacing: 1.2,
    });
  doc.x = PAGE_LEFT;

  doc.y = 80;
  doc
    .strokeColor(COLOURS.grey20)
    .lineWidth(0.5)
    .moveTo(PAGE_LEFT, doc.y)
    .lineTo(PAGE_RIGHT, doc.y)
    .stroke();
  doc.y += 22;

  // ─── Eyebrow + patient name ──────────────────────────────────────────
  doc
    .fillColor(COLOURS.sage)
    .fontSize(9.5)
    .font("Helvetica")
    .text("CLIENT PROFILE", PAGE_LEFT, doc.y, { characterSpacing: 1.5 });
  doc.x = PAGE_LEFT;
  doc.y += 12;

  const name = client.name ?? client.phone ?? "—";
  doc
    .fillColor(COLOURS.ink)
    .fontSize(28)
    .font("Helvetica-Bold")
    .text(name, PAGE_LEFT, doc.y);
  doc.x = PAGE_LEFT;
  doc.y += 36;

  // VIP + risk inline badges
  const badges: Array<{ label: string; bg: string; fg: string }> = [];
  const vipLabel = profile.vipTier
    ? profile.vipTier.charAt(0).toUpperCase() + profile.vipTier.slice(1)
    : null;
  if (vipLabel) {
    badges.push({ label: vipLabel, bg: COLOURS.grey5, fg: COLOURS.grey90 });
  }
  if (profile.churnRisk) {
    const risk = profile.churnRisk;
    badges.push({
      label: `${risk.charAt(0).toUpperCase()}${risk.slice(1)} risk`,
      bg: risk === "high" ? `${COLOURS.danger}10` : COLOURS.grey5,
      fg: risk === "high" ? COLOURS.danger : COLOURS.grey70,
    });
  }
  if (badges.length > 0) {
    // Set font + size before measuring so widthOfString reflects them.
    doc.font("Helvetica-Bold").fontSize(9);
    let bx = PAGE_LEFT;
    for (const b of badges) {
      const w = doc.widthOfString(b.label) + 18;
      doc
        .fillColor(b.bg)
        .roundedRect(bx, doc.y - 18, w, 18, 4)
        .fill();
      doc
        .fillColor(b.fg)
        .text(b.label, bx + 9, doc.y - 14);
      bx += w + 6;
    }
    doc.x = PAGE_LEFT;
  }

  doc.y += 16;

  // ─── Contact + first-visit row ────────────────────────────────────────
  // client_profiles.createdAt = the day this client was first registered
  // at this merchant (effectively first-visit-at-this-clinic since walk-ins
  // and bookings both create the profile on first interaction).
  const contactBits: string[] = [];
  if (client.phone) contactBits.push(client.phone);
  if (client.email) contactBits.push(client.email);
  if (profile.createdAt)
    contactBits.push(`Member since ${formatDate(new Date(profile.createdAt))}`);

  if (contactBits.length > 0) {
    doc
      .fillColor(COLOURS.grey70)
      .fontSize(11)
      .font("Helvetica")
      .text(contactBits.join("  ·  "), PAGE_LEFT, doc.y, { width: PAGE_RIGHT - PAGE_LEFT });
    doc.x = PAGE_LEFT;
    doc.y += 18;
  }

  doc.y += 14;

  // ─── KPI cards ────────────────────────────────────────────────────────
  drawKpiCards(doc, {
    totalVisits,
    totalSpendSgd,
    lastVisitAt,
  });

  doc.y += 16;

  // ─── Loyalty snapshot (inline strip) ─────────────────────────────────
  // Always renders if a balance exists OR the program is enabled — even a
  // zero balance on an enabled program is information ("never earned, never
  // redeemed").
  if (data.loyalty.balance > 0 || data.loyalty.enabled) {
    drawLoyaltyStrip(doc, data.loyalty);
    doc.y += 16;
  }

  // ─── Upcoming appointments table ─────────────────────────────────────
  const now = new Date();
  const upcoming = recentBookings.filter(
    (rb) => new Date(rb.booking.startTime) > now && rb.booking.status !== "cancelled",
  );
  const past = recentBookings.filter(
    (rb) => new Date(rb.booking.startTime) <= now || rb.booking.status === "cancelled",
  );

  if (upcoming.length > 0) {
    drawSectionHeading(doc, "Upcoming");
    drawBookingTable(doc, upcoming, { showStatus: true });
    doc.y += 10;
  }

  // ─── Service history ──────────────────────────────────────────────────
  drawSectionHeading(doc, `Service History (${past.length})`);
  if (past.length === 0) {
    doc
      .fillColor(COLOURS.grey45)
      .fontSize(10)
      .font("Helvetica-Oblique")
      .text("No past appointments on record.", PAGE_LEFT, doc.y);
    doc.x = PAGE_LEFT;
    doc.y += 14;
  } else {
    drawBookingTable(doc, past, { showStatus: true });
  }

  // ─── Clinical records (consultation notes, treatment logs, etc.) ─────
  if (data.clinicalRecords.length > 0) {
    doc.y += 10;
    if (doc.y > PAGE_BOTTOM - 100) { doc.addPage(); doc.y = 60; }
    drawSectionHeading(doc, `Clinical Records (${data.clinicalRecords.length})`);
    drawClinicalRecords(doc, data.clinicalRecords);
  }

  // ─── Dental charting (only when merchant.vertical='dental') ──────────
  if (data.latestOdontogram) {
    doc.y += 10;
    if (doc.y > PAGE_BOTTOM - 120) { doc.addPage(); doc.y = 60; }
    drawSectionHeading(doc, "Dental Charting (latest snapshot)");
    drawOdontogramSummary(doc, data.latestOdontogram);
  }
}

// ─── Loyalty strip ──────────────────────────────────────────────────────

function drawLoyaltyStrip(doc: PDFKit.PDFDocument, loy: LoyaltySummary): void {
  const stripY = doc.y;
  const stripH = 56;
  doc
    .strokeColor(COLOURS.grey20)
    .lineWidth(0.5)
    .roundedRect(PAGE_LEFT, stripY, PAGE_RIGHT - PAGE_LEFT, stripH, 6)
    .stroke();

  doc
    .fillColor(COLOURS.grey60)
    .fontSize(8.5)
    .font("Helvetica")
    .text("LOYALTY POINTS", PAGE_LEFT + 16, stripY + 12, { characterSpacing: 1.2 });
  doc
    .fillColor(COLOURS.ink)
    .fontSize(20)
    .font("Helvetica-Bold")
    .text(loy.balance.toLocaleString("en-SG"), PAGE_LEFT + 16, stripY + 26);

  // Right-side: redeemable value when program config is known
  if (loy.pointsPerDollarRedeem && loy.pointsPerDollarRedeem > 0) {
    const redeemableSgd = Math.floor(loy.balance / loy.pointsPerDollarRedeem);
    doc
      .fillColor(COLOURS.grey60)
      .fontSize(8.5)
      .font("Helvetica")
      .text("REDEEMABLE", PAGE_RIGHT - 16, stripY + 12, {
        width: 200,
        align: "right",
        characterSpacing: 1.2,
      });
    doc
      .fillColor(COLOURS.sage)
      .fontSize(15)
      .font("Helvetica-Bold")
      .text(`S$${redeemableSgd}`, PAGE_RIGHT - 16, stripY + 28, {
        width: 200,
        align: "right",
      });
    doc
      .fillColor(COLOURS.grey45)
      .fontSize(8)
      .font("Helvetica")
      .text(
        `${loy.pointsPerDollarRedeem} pts = S$1 · earn ${loy.pointsPerDollar ?? "—"}/SGD`,
        PAGE_LEFT + 16,
        stripY + 46,
        { width: PAGE_RIGHT - PAGE_LEFT - 32 },
      );
  }
  doc.x = PAGE_LEFT;
  doc.y = stripY + stripH;
}

// ─── Clinical records list ──────────────────────────────────────────────

function drawClinicalRecords(
  doc: PDFKit.PDFDocument,
  records: ClinicalRecordRow[],
): void {
  for (const r of records) {
    if (doc.y > PAGE_BOTTOM - 80) { doc.addPage(); doc.y = 60; }

    const rowYStart = doc.y;
    const dateStr = formatDate(new Date(r.createdAt));
    const typeLabel = clinicalRecordTypeLabel(r.type);

    // Date column (left, fixed width)
    doc
      .fillColor(COLOURS.grey90)
      .fontSize(10)
      .font("Helvetica")
      .text(dateStr, PAGE_LEFT, rowYStart, { width: 85 });

    // Type pill + author + body excerpt — all in the right-hand column
    const bodyX = PAGE_LEFT + 100;
    const bodyW = PAGE_RIGHT - bodyX;

    doc
      .fillColor(COLOURS.sage)
      .fontSize(8.5)
      .font("Helvetica-Bold")
      .text(typeLabel.toUpperCase(), bodyX, rowYStart, {
        width: bodyW,
        characterSpacing: 1.2,
      });
    doc.y += 12;

    if (r.title) {
      doc
        .fillColor(COLOURS.ink)
        .fontSize(11)
        .font("Helvetica-Bold")
        .text(r.title, bodyX, doc.y, { width: bodyW });
    }

    // Body excerpt — truncated to keep the section bounded.
    const excerpt = truncate(r.body ?? "", 280);
    if (excerpt) {
      doc
        .fillColor(COLOURS.grey70)
        .fontSize(10)
        .font("Helvetica")
        .text(excerpt, bodyX, doc.y, {
          width: bodyW,
          lineGap: 1.5,
        });
    }

    // Footer line: recorded by + amendment marker
    const footerLine = [`by ${r.recordedByName}`, r.amendsId ? "amendment" : null]
      .filter(Boolean)
      .join(" · ");
    doc
      .fillColor(COLOURS.grey45)
      .fontSize(8.5)
      .font("Helvetica-Oblique")
      .text(footerLine, bodyX, doc.y + 2, { width: bodyW });

    doc.x = PAGE_LEFT;
    doc.y += 16;

    // Hairline between records
    doc
      .strokeColor(COLOURS.grey10)
      .lineWidth(0.3)
      .moveTo(PAGE_LEFT, doc.y)
      .lineTo(PAGE_RIGHT, doc.y)
      .stroke();
    doc.y += 8;
  }
}

function clinicalRecordTypeLabel(type: string): string {
  switch (type) {
    case "consultation_note": return "Consultation";
    case "treatment_log": return "Treatment";
    case "prescription": return "Prescription";
    case "amendment": return "Amendment";
    default: return type;
  }
}

// ─── Odontogram summary (dental clinics only) ───────────────────────────

function drawOdontogramSummary(
  doc: PDFKit.PDFDocument,
  ondg: OdontogramRow,
): void {
  const startY = doc.y;
  const charting = (ondg.charting ?? {}) as Record<string, {
    whole?: string;
    surfaces?: Record<string, string[]>;
    notes?: string;
  }>;

  // Tally findings: count teeth by whole-tooth status + count surface
  // condition occurrences.
  const wholeStatusCounts: Record<string, number> = {};
  const surfaceCondCounts: Record<string, number> = {};
  let toothCount = 0;

  for (const fdi of Object.keys(charting)) {
    const t = charting[fdi];
    if (!t) continue;
    toothCount += 1;
    if (t.whole) {
      wholeStatusCounts[t.whole] = (wholeStatusCounts[t.whole] ?? 0) + 1;
    }
    if (t.surfaces) {
      for (const surfConds of Object.values(t.surfaces)) {
        for (const c of surfConds ?? []) {
          surfaceCondCounts[c] = (surfaceCondCounts[c] ?? 0) + 1;
        }
      }
    }
  }

  // Header strip — date + recorded by
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(9)
    .font("Helvetica")
    .text(
      `Recorded ${formatDate(new Date(ondg.createdAt))} by ${ondg.recordedByName}`,
      PAGE_LEFT,
      startY,
    );
  doc.x = PAGE_LEFT;
  doc.y += 16;

  // Tooth count + finding summary lines
  doc
    .fillColor(COLOURS.ink)
    .fontSize(11)
    .font("Helvetica")
    .text(
      `${toothCount} tooth ${toothCount === 1 ? "annotation" : "annotations"} on this snapshot.`,
      PAGE_LEFT,
      doc.y,
    );
  doc.x = PAGE_LEFT;
  doc.y += 14;

  // Whole-tooth breakdown (e.g. "2 missing · 1 crown · 1 implant")
  const wholeBits: string[] = [];
  for (const [status, count] of Object.entries(wholeStatusCounts)) {
    if (status === "present") continue;
    wholeBits.push(`${count} ${prettyToothStatus(status)}`);
  }
  if (wholeBits.length > 0) {
    doc
      .fillColor(COLOURS.grey70)
      .fontSize(10)
      .font("Helvetica")
      .text(`Tooth status: ${wholeBits.join(" · ")}`, PAGE_LEFT, doc.y, {
        width: PAGE_RIGHT - PAGE_LEFT,
      });
    doc.x = PAGE_LEFT;
    doc.y += 14;
  }

  // Surface conditions breakdown
  const surfBits: string[] = [];
  for (const [cond, count] of Object.entries(surfaceCondCounts)) {
    surfBits.push(`${count} ${cond}`);
  }
  if (surfBits.length > 0) {
    doc
      .fillColor(COLOURS.grey70)
      .fontSize(10)
      .font("Helvetica")
      .text(`Surface findings: ${surfBits.join(" · ")}`, PAGE_LEFT, doc.y, {
        width: PAGE_RIGHT - PAGE_LEFT,
      });
    doc.x = PAGE_LEFT;
    doc.y += 14;
  }

  if (ondg.chartingNotes) {
    doc.y += 4;
    doc
      .fillColor(COLOURS.grey60)
      .fontSize(8.5)
      .font("Helvetica-Bold")
      .text("CHARTING NOTES", PAGE_LEFT, doc.y, { characterSpacing: 1.2 });
    doc.y += 12;
    doc
      .fillColor(COLOURS.grey90)
      .fontSize(10)
      .font("Helvetica-Oblique")
      .text(ondg.chartingNotes, PAGE_LEFT, doc.y, {
        width: PAGE_RIGHT - PAGE_LEFT,
        lineGap: 1.5,
      });
    doc.x = PAGE_LEFT;
    doc.y += doc.heightOfString(ondg.chartingNotes, { width: PAGE_RIGHT - PAGE_LEFT });
  }
}

function prettyToothStatus(status: string): string {
  return status.replace(/_/g, " ");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + "…";
}

// ─── Drawing helpers ────────────────────────────────────────────────────

function drawKpiCards(
  doc: PDFKit.PDFDocument,
  args: { totalVisits: number; totalSpendSgd: string; lastVisitAt: string | null },
): void {
  const cardW = (PAGE_RIGHT - PAGE_LEFT - 16) / 3;
  const cardH = 70;
  const y = doc.y;

  const cards = [
    { label: "TOTAL VISITS", value: String(args.totalVisits) },
    { label: "TOTAL REVENUE", value: `${fmtCurrency(args.totalSpendSgd)}` },
    {
      label: "LAST VISIT",
      value: args.lastVisitAt ? formatDate(new Date(args.lastVisitAt)) : "—",
    },
  ];

  cards.forEach((card, i) => {
    const x = PAGE_LEFT + i * (cardW + 8);
    doc
      .strokeColor(COLOURS.grey20)
      .lineWidth(0.5)
      .roundedRect(x, y, cardW, cardH, 6)
      .stroke();
    doc
      .fillColor(COLOURS.grey60)
      .fontSize(8.5)
      .font("Helvetica")
      .text(card.label, x + 14, y + 14, { width: cardW - 28, characterSpacing: 1 });
    doc
      .fillColor(COLOURS.ink)
      .fontSize(20)
      .font("Helvetica-Bold")
      .text(card.value, x + 14, y + 32, { width: cardW - 28 });
  });
  doc.x = PAGE_LEFT;
  doc.y = y + cardH;
}

function drawSectionHeading(doc: PDFKit.PDFDocument, label: string): void {
  doc.y += 4;
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(9)
    .font("Helvetica-Bold")
    .text(label.toUpperCase(), PAGE_LEFT, doc.y, { characterSpacing: 1.2 });
  doc.x = PAGE_LEFT;
  doc.y += 12;
  doc
    .strokeColor(COLOURS.grey20)
    .lineWidth(0.5)
    .moveTo(PAGE_LEFT, doc.y)
    .lineTo(PAGE_RIGHT, doc.y)
    .stroke();
  doc.y += 8;
}

function drawBookingTable(
  doc: PDFKit.PDFDocument,
  rows: BookingWithLookups[],
  opts: { showStatus: boolean },
): void {
  const colDate = PAGE_LEFT;
  const colService = PAGE_LEFT + 90;
  const colStaff = PAGE_LEFT + 290;
  const colPrice = PAGE_RIGHT - 110;
  const colStatus = PAGE_RIGHT - 60;
  // Single-line rows. Time stamp is dropped — clinic owners care about
  // dates, and stacking date+time was causing visual overlap with the
  // next row's content.
  const rowH = 22;
  const headerH = 16;

  // Column header
  const headerY = doc.y;
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(8.5)
    .font("Helvetica-Bold");
  doc.text("DATE", colDate, headerY, { characterSpacing: 1, width: 80 });
  doc.text("SERVICE", colService, headerY, { characterSpacing: 1, width: colStaff - colService - 8 });
  doc.text("STAFF", colStaff, headerY, { characterSpacing: 1, width: colPrice - colStaff - 8 });
  doc.text("PRICE", colPrice, headerY, { characterSpacing: 1, width: 50, align: "right" });
  if (opts.showStatus) {
    doc.text("STATUS", colStatus, headerY, { characterSpacing: 1, width: 60, align: "right" });
  }
  doc.x = PAGE_LEFT;
  doc.y = headerY + headerH;

  // Hairline under header
  doc
    .strokeColor(COLOURS.grey20)
    .lineWidth(0.5)
    .moveTo(PAGE_LEFT, doc.y - 2)
    .lineTo(PAGE_RIGHT, doc.y - 2)
    .stroke();

  for (const r of rows) {
    if (doc.y > PAGE_BOTTOM - 60) {
      doc.addPage();
      doc.y = 60;
    }
    const dateStr = formatDate(new Date(r.booking.startTime));
    const rowY = doc.y;

    doc
      .fillColor(COLOURS.grey90)
      .fontSize(10)
      .font("Helvetica")
      .text(dateStr, colDate, rowY + 5, { width: 85 });

    doc
      .fillColor(COLOURS.ink)
      .fontSize(10.5)
      .font("Helvetica")
      .text(r.service.name, colService, rowY + 5, {
        width: colStaff - colService - 8,
        ellipsis: true,
        lineBreak: false,
      });
    doc
      .fillColor(COLOURS.grey70)
      .fontSize(10)
      .font("Helvetica")
      .text(r.staffMember.name, colStaff, rowY + 5, {
        width: colPrice - colStaff - 8,
        ellipsis: true,
        lineBreak: false,
      });
    doc
      .fillColor(COLOURS.ink)
      .fontSize(10)
      .font("Helvetica-Bold")
      .text(`S$${parseFloat(r.booking.priceSgd).toFixed(0)}`, colPrice, rowY + 5, {
        width: 50,
        align: "right",
      });
    if (opts.showStatus) {
      const statusLabel = r.booking.status.replace("_", " ").toUpperCase();
      const statusColor = statusColorFor(r.booking.status);
      doc
        .fillColor(statusColor)
        .fontSize(8)
        .font("Helvetica-Bold")
        .text(statusLabel, colStatus, rowY + 7, {
          width: 60,
          align: "right",
          characterSpacing: 0.5,
        });
    }

    doc.x = PAGE_LEFT;
    doc.y = rowY + rowH;
    // Hairline between rows
    doc
      .strokeColor(COLOURS.grey10)
      .lineWidth(0.3)
      .moveTo(PAGE_LEFT, doc.y - 1)
      .lineTo(PAGE_RIGHT, doc.y - 1)
      .stroke();
  }
}

function statusColorFor(status: string): string {
  switch (status) {
    case "completed":
      return COLOURS.sage;
    case "cancelled":
    case "no_show":
      return COLOURS.danger;
    case "in_progress":
      return COLOURS.warn;
    case "confirmed":
    case "pending":
      return COLOURS.grey70;
    default:
      return COLOURS.grey60;
  }
}

function drawFooter(doc: PDFKit.PDFDocument): void {
  // Render PDPA notice + page numbers on every existing page using bufferPages.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .fillColor(COLOURS.grey45)
      .fontSize(7.5)
      .font("Helvetica")
      .text(
        "Confidential — PDPA Act 709 protected · Generated by GlowOS",
        PAGE_LEFT,
        820,
        { width: PAGE_RIGHT - PAGE_LEFT, align: "left" },
      );
    doc.text(
      `Page ${i - range.start + 1} of ${range.count}`,
      PAGE_LEFT,
      820,
      { width: PAGE_RIGHT - PAGE_LEFT, align: "right" },
    );
  }
}

// ─── Formatters ─────────────────────────────────────────────────────────

function fmtCurrency(amount: string | number): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return `S$${n.toLocaleString("en-SG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function clientProfilePdfFilename(args: {
  merchantName: string;
  clientName: string | null;
  clientPhone: string;
}): string {
  const safeMerchant = args.merchantName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safeClient = (args.clientName ?? args.clientPhone)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safeMerchant}-client-${safeClient}.pdf`;
}

export function bulkClientsPdfFilename(args: { merchantName: string; count: number }): string {
  const safe = args.merchantName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const stamp = new Date().toISOString().slice(0, 10);
  return `${safe}-clients-${args.count}-${stamp}.pdf`;
}

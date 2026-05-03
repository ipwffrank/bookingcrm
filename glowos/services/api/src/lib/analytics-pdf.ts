import PDFDocument from "pdfkit";
import type { DigestMetrics } from "./analytics-aggregator.js";
import type { UtilizationResult } from "./utilization.js";
import type { CohortRetentionResult } from "./cohort-retention.js";
import type { RebookLagResult } from "./rebook-lag.js";

/**
 * Server-rendered PDF of the merchant's analytics dashboard. Replaces the
 * old window.print() flow which captured the live page DOM (with chrome,
 * loading skeletons, scrollbars, and palette-clashed pixels). This builds
 * a structured 1–2 page report from the same aggregator the email digest
 * uses, plus a few dashboard-specific datasets (top services, booking
 * sources, revenue-by-DOW). Every metric is footnoted with how it's
 * derived so the reader can audit before acting.
 *
 * Implementation: pdfkit (Node-native, no Chromium). Same approach as
 * client-profile-pdf.ts and analytics-digest-pdf.ts.
 */

interface TopService {
  serviceName: string;
  bookingsCount: number;
  revenue: number;
}

interface BookingSource {
  source: string | null;
  count: number;
  revenue: number;
}

interface RevenueByDow {
  dow: number;
  label: string;
  revenue: number;
  count: number;
}

export interface AnalyticsPdfArgs {
  merchantName: string;
  currency: "SGD" | "MYR";
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  metrics: DigestMetrics;
  utilization: UtilizationResult | null;
  cohortRetention: CohortRetentionResult | null;
  rebookLag: RebookLagResult | null;
  topServices: TopService[];
  bookingSources: BookingSource[];
  revenueByDow: RevenueByDow[];
}

const COLOURS = {
  ink: "#1a2313",
  surface: "#ffffff",
  surfaceWarm: "#f7f5f0",
  sage: "#456466",
  sageLight: "#9bb0b1",
  grey75: "#3f4744",
  grey60: "#6b7771",
  grey45: "#9ca3a1",
  grey15: "#e3e6e1",
  grey5: "#f3f4f1",
  warn: "#a86a2c",
  danger: "#a13b3b",
} as const;

const PAGE_LEFT = 50;
const PAGE_RIGHT_PAD = 50;

function fmtMoney(n: number, currency: "SGD" | "MYR"): string {
  const sym = currency === "MYR" ? "RM" : "S$";
  if (n >= 100000) return `${sym}${(n / 1000).toFixed(0)}k`;
  if (n >= 10000) return `${sym}${(n / 1000).toFixed(1)}k`;
  return `${sym}${Math.round(n).toLocaleString("en-SG")}`;
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function deltaPct(current: number, prior: number): { text: string; positive: boolean | null } {
  if (prior === 0 && current === 0) return { text: "-", positive: null };
  if (prior === 0) return { text: "new", positive: true };
  const diff = ((current - prior) / prior) * 100;
  const abs = Math.abs(diff);
  if (abs < 0.5) return { text: "-", positive: null };
  const sign = diff > 0 ? "+" : "-";
  return {
    text: `${sign}${abs.toFixed(abs < 10 ? 1 : 0)}%`,
    positive: diff > 0,
  };
}

function fmtDateLong(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export async function renderAnalyticsPdf(args: AnalyticsPdfArgs): Promise<Buffer> {
  const {
    merchantName,
    currency,
    periodLabel,
    metrics: m,
    utilization,
    cohortRetention,
    rebookLag,
    topServices,
    bookingSources,
    revenueByDow,
  } = args;

  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: {
      Title: `Analytics Report — ${merchantName} — ${periodLabel}`,
      Author: "GlowOS",
      Subject: `Analytics report for ${periodLabel}`,
      Keywords: "analytics report kpi",
    },
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c as Buffer));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ─── Header strip ──────────────────────────────────────────────────
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(9)
    .font("Helvetica")
    .text(`ANALYTICS REPORT · ${periodLabel.toUpperCase()}`, PAGE_LEFT, 50, {
      characterSpacing: 1,
    });
  doc.moveDown(0.3);
  doc
    .fillColor(COLOURS.ink)
    .fontSize(20)
    .font("Helvetica-Bold")
    .text(merchantName);
  doc.moveDown(0.2);
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(10)
    .font("Helvetica")
    .text(
      `Generated ${new Date().toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })} · All deltas vs prior period of equal length`,
    );
  doc.moveDown(1);

  // ─── Hero KPIs (4 columns) ─────────────────────────────────────────
  const heroY = doc.y;
  const heroGap = 8;
  const heroCardWidth = (doc.page.width - 100 - heroGap * 3) / 4;
  const heroCardHeight = 70;

  drawHeroCard(doc, PAGE_LEFT, heroY, heroCardWidth, heroCardHeight,
    "REVENUE", fmtMoney(m.revenueSgd, currency),
    deltaPct(m.revenueSgd, m.prior.revenueSgd), true);
  drawHeroCard(doc, PAGE_LEFT + heroCardWidth + heroGap, heroY, heroCardWidth, heroCardHeight,
    "BOOKINGS", String(m.bookingsCount),
    deltaPct(m.bookingsCount, m.prior.bookingsCount), true);
  drawHeroCard(doc, PAGE_LEFT + 2 * (heroCardWidth + heroGap), heroY, heroCardWidth, heroCardHeight,
    "NO-SHOW RATE", fmtPct(m.noShowRate),
    deltaPct(m.noShowRate, m.prior.noShowRate), false);
  drawHeroCard(doc, PAGE_LEFT + 3 * (heroCardWidth + heroGap), heroY, heroCardWidth, heroCardHeight,
    "AVG RATING",
    m.averageRating === null ? "—" : `${m.averageRating.toFixed(1)}/5`,
    m.averageRating !== null && m.prior.averageRating !== null
      ? deltaPct(m.averageRating, m.prior.averageRating)
      : { text: "-", positive: null },
    true);

  doc.x = PAGE_LEFT;
  doc.y = heroY + heroCardHeight + 16;

  // ─── KPI grid (paired rows) ─────────────────────────────────────────
  drawSectionLabel(doc, "KEY METRICS");

  drawGridRow(
    doc,
    "Cancellation count",
    String(m.cancelledCount),
    deltaPct(m.cancelledCount, m.prior.cancelledCount),
    false,
  );
  drawGridRow(
    doc,
    "First-timer return rate",
    m.firstTimerReturnRatePct === null
      ? `— (${m.firstTimerSampleSize} new)`
      : `${m.firstTimerReturnRatePct}% (${m.firstTimerSampleSize} new)`,
    m.prior.firstTimerReturnRatePct !== null && m.firstTimerReturnRatePct !== null
      ? deltaPct(m.firstTimerReturnRatePct, m.prior.firstTimerReturnRatePct)
      : null,
    true,
  );

  if (utilization?.headline) {
    const h = utilization.headline;
    const display = Math.min(100, Math.round(h.utilizationPct));
    const valueText = h.utilizationPct > 100 ? `${display}% (raw)` : `${display}%`;
    const utilDelta = h.deltaVsPriorPp === null
      ? null
      : Math.abs(h.deltaVsPriorPp) < 0.5
        ? { text: "-", positive: null as boolean | null }
        : {
            text: `${h.deltaVsPriorPp > 0 ? "+" : "-"}${Math.abs(h.deltaVsPriorPp).toFixed(1)}pp`,
            positive: h.deltaVsPriorPp > 0,
          };
    drawGridRow(doc, "Capacity utilization", valueText, utilDelta, true);
  }
  if (cohortRetention?.headline) {
    const h = cohortRetention.headline;
    const valueText = `${h.retentionPct.toFixed(1)}% (cohort: ${h.cohortSize})`;
    const cohortDelta = h.deltaVsPriorCohortPp === null
      ? null
      : Math.abs(h.deltaVsPriorCohortPp) < 0.5
        ? { text: "-", positive: null as boolean | null }
        : {
            text: `${h.deltaVsPriorCohortPp > 0 ? "+" : "-"}${Math.abs(h.deltaVsPriorCohortPp).toFixed(1)}pp`,
            positive: h.deltaVsPriorCohortPp > 0,
          };
    drawGridRow(doc, "60d cohort retention", valueText, cohortDelta, true);
  }
  if (rebookLag?.headline) {
    const h = rebookLag.headline;
    const valueText = h.medianDays === null
      ? `— (${h.returnedCount} returners)`
      : `${h.medianDays}d median (${h.returnedCount}/${h.cohortSize})`;
    const lagDelta = h.deltaVsPriorCohortDays === null
      ? null
      : Math.abs(h.deltaVsPriorCohortDays) < 1
        ? { text: "-", positive: null as boolean | null }
        : {
            text: `${h.deltaVsPriorCohortDays > 0 ? "+" : "-"}${Math.abs(h.deltaVsPriorCohortDays)}d`,
            positive: h.deltaVsPriorCohortDays > 0,
          };
    drawGridRow(doc, "Rebook lag", valueText, lagDelta, false);
  }
  drawGridRow(
    doc,
    "Reviews collected",
    String(m.reviewsCount),
    deltaPct(m.reviewsCount, m.prior.reviewsCount),
    true,
  );

  doc.x = PAGE_LEFT;
  doc.moveDown(0.8);

  // ─── Top services bar chart ────────────────────────────────────────
  if (topServices.length > 0) {
    drawSectionLabel(doc, "TOP SERVICES BY REVENUE");
    drawHorizontalBars(
      doc,
      topServices.slice(0, 5).map((s) => ({
        label: s.serviceName,
        value: s.revenue,
        sub: `${s.bookingsCount} booking${s.bookingsCount === 1 ? "" : "s"}`,
        valueLabel: fmtMoney(s.revenue, currency),
      })),
    );
    doc.moveDown(0.5);
  }

  // ─── Page 2 ────────────────────────────────────────────────────────
  doc.addPage();
  doc.x = PAGE_LEFT;
  doc.y = 50;

  // Revenue by day-of-week — vertical mini-bars across 7 days
  if (revenueByDow.length === 7) {
    drawSectionLabel(doc, "REVENUE BY DAY OF WEEK");
    drawVerticalDowBars(doc, revenueByDow, currency);
    doc.moveDown(0.5);
  }

  // Booking sources — horizontal bars
  if (bookingSources.length > 0) {
    drawSectionLabel(doc, "BOOKING SOURCES (BY COUNT)");
    const totalCount = bookingSources.reduce((acc, s) => acc + s.count, 0) || 1;
    drawHorizontalBars(
      doc,
      bookingSources.slice(0, 6).map((s) => ({
        label: humanizeSource(s.source),
        value: s.count,
        sub: `${fmtMoney(s.revenue, currency)} revenue`,
        valueLabel: `${s.count} (${Math.round((s.count / totalCount) * 100)}%)`,
      })),
    );
    doc.moveDown(0.5);
  }

  // Highlights
  if (
    m.highlights.busiestDay ||
    m.highlights.quietestDay ||
    m.highlights.topServiceByRevenue
  ) {
    drawSectionLabel(doc, "HIGHLIGHTS");
    if (m.highlights.busiestDay) {
      drawBullet(doc, `Best day: ${fmtDateLong(m.highlights.busiestDay.date)} — ${m.highlights.busiestDay.bookings} booking${m.highlights.busiestDay.bookings === 1 ? "" : "s"}`);
    }
    if (m.highlights.quietestDay && m.highlights.busiestDay && m.highlights.quietestDay.date !== m.highlights.busiestDay.date) {
      drawBullet(doc, `Quietest day: ${fmtDateLong(m.highlights.quietestDay.date)} — ${m.highlights.quietestDay.bookings} booking${m.highlights.quietestDay.bookings === 1 ? "" : "s"}`);
    }
    if (m.highlights.topServiceByRevenue) {
      drawBullet(doc, `Top service: ${m.highlights.topServiceByRevenue.name} — ${fmtMoney(m.highlights.topServiceByRevenue.revenueSgd, currency)}`);
    }
    doc.moveDown(0.5);
  }

  // ─── Footnotes ─────────────────────────────────────────────────────
  drawSectionLabel(doc, "HOW THESE NUMBERS ARE DERIVED");
  drawFootnote(doc, "Revenue", "Sum of price across all bookings starting in the period, excluding cancelled and no-show bookings. Walk-ins, deposits, and package redemptions are all counted at their booked price.");
  drawFootnote(doc, "Bookings", "Count of bookings starting in the period with status not in (cancelled, no_show). Edited bookings count once at their current state.");
  drawFootnote(doc, "No-show rate", "no_show ÷ (completed + no_show). The denominator excludes cancellations because a cancelled booking was never expected at the chair.");
  drawFootnote(doc, "Avg rating", "Mean star rating of reviews submitted in the period (1–5). Independent of booking date — a review collected in this period for a prior visit still counts here.");
  drawFootnote(doc, "First-timer return rate", "Of clients whose first ever non-cancelled booking at this business fell inside the period, the share who have at least one later non-cancelled booking. Honest measure of whether new clients come back.");
  if (utilization?.headline) {
    drawFootnote(doc, "Capacity utilization", "Booked staff-hours ÷ available staff-hours. Available hours come from staff duty rosters where set, otherwise operating-hours × number of staff. >100% means manual overrides exceeded scheduled capacity.");
  }
  if (cohortRetention?.headline) {
    drawFootnote(doc, "60d cohort retention", "Of clients whose first visit was 60+ days before period end, the share with any return visit since. Cohort size shown in brackets — interpret with caution if <20.");
  }
  if (rebookLag?.headline) {
    drawFootnote(doc, "Rebook lag", "Median days between completed visits, for clients with at least two visits in the cohort window. Lower = faster repeat business; up = customers waiting longer between bookings.");
  }
  drawFootnote(doc, "Top services", "Aggregated by service ID across all non-cancelled, non-no-show bookings; sorted by revenue.");
  drawFootnote(doc, "Booking sources", "booking_source field captured at booking creation: online (booking page), walkin_manual (counter walk-in), staff_manual (staff-created), reserve_with_google, etc.");
  drawFootnote(doc, "Revenue by day of week", "Bookings grouped by their start time's day-of-week in Asia/Singapore. Same revenue rule as the headline (excludes cancelled/no-show).");
  drawFootnote(doc, "Deltas", "Compared against the equal-length period immediately before (e.g. 30d window → previous 30d). \"new\" = no prior data; \"-\" = change <0.5%.");

  // Footer with explicit y position to prevent pdfkit auto-paginate
  // emitting blank trailing pages. Same fix applied to client-profile-pdf.ts.
  const footerY = doc.page.height - 40;
  doc
    .fillColor(COLOURS.grey45)
    .fontSize(8)
    .font("Helvetica")
    .text(
      `Generated by GlowOS for ${merchantName} on ${new Date().toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" })}`,
      PAGE_LEFT,
      footerY,
      {
        width: doc.page.width - PAGE_LEFT - PAGE_RIGHT_PAD,
        lineBreak: false,
        height: 1,
      },
    );

  doc.end();
  return finished;
}

// ─── Drawing helpers ──────────────────────────────────────────────────

function drawHeroCard(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
  delta: { text: string; positive: boolean | null },
  goodIfUp: boolean,
): void {
  doc.save();
  doc.roundedRect(x, y, width, height, 6).fill(COLOURS.grey5);

  doc
    .fillColor(COLOURS.grey60)
    .fontSize(8)
    .font("Helvetica")
    .text(label, x + 10, y + 10, { width: width - 20, characterSpacing: 0.5 });

  doc
    .fillColor(COLOURS.ink)
    .fontSize(16)
    .font("Helvetica-Bold")
    .text(value, x + 10, y + 24, { width: width - 20 });

  const tone =
    delta.positive === null
      ? COLOURS.grey60
      : (delta.positive ? goodIfUp : !goodIfUp)
        ? COLOURS.sage
        : COLOURS.danger;
  doc
    .fillColor(tone)
    .fontSize(9)
    .font("Helvetica-Bold")
    .text(delta.text, x + 10, y + height - 18, { width: width - 20 });

  doc.restore();
}

function drawGridRow(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  delta: { text: string; positive: boolean | null } | null,
  goodIfUp: boolean,
): void {
  doc.x = PAGE_LEFT;
  const startY = doc.y;
  const deltaWidth = 50;
  const valueWidth = 130;
  const colGap = 8;
  const deltaX = doc.page.width - PAGE_RIGHT_PAD - deltaWidth;
  const valueX = deltaX - colGap - valueWidth;

  doc
    .fillColor(COLOURS.grey60)
    .fontSize(11)
    .font("Helvetica")
    .text(label, PAGE_LEFT, startY, { width: valueX - PAGE_LEFT, lineBreak: false });

  doc
    .fillColor(COLOURS.ink)
    .fontSize(11)
    .font("Helvetica-Bold")
    .text(value, valueX, startY, { width: valueWidth, align: "right", lineBreak: false });

  if (delta) {
    const tone =
      delta.positive === null
        ? COLOURS.grey60
        : (delta.positive ? goodIfUp : !goodIfUp)
          ? COLOURS.sage
          : COLOURS.danger;
    doc
      .fillColor(tone)
      .fontSize(9)
      .font("Helvetica-Bold")
      .text(delta.text, deltaX, startY + 1, { width: deltaWidth, align: "right", lineBreak: false });
  }

  doc.y = startY + 18;
  doc
    .moveTo(PAGE_LEFT, doc.y)
    .lineTo(doc.page.width - PAGE_RIGHT_PAD, doc.y)
    .strokeColor(COLOURS.grey15)
    .lineWidth(0.5)
    .stroke();
  doc.y += 6;
  doc.x = PAGE_LEFT;
}

function drawSectionLabel(doc: PDFKit.PDFDocument, label: string): void {
  doc.x = PAGE_LEFT;
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(8)
    .font("Helvetica-Bold")
    .text(label, PAGE_LEFT, doc.y, {
      width: doc.page.width - PAGE_LEFT - PAGE_RIGHT_PAD,
      characterSpacing: 0.5,
    });
  doc.moveDown(0.4);
}

function drawBullet(doc: PDFKit.PDFDocument, text: string): void {
  const startY = doc.y;
  const lineWidth = doc.page.width - PAGE_LEFT - PAGE_RIGHT_PAD;
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(10)
    .font("Helvetica")
    .text("•", PAGE_LEFT, startY, { width: 10, lineBreak: false });
  doc
    .fillColor(COLOURS.ink)
    .fontSize(10)
    .font("Helvetica")
    .text(text, PAGE_LEFT + 14, startY, {
      width: lineWidth - 14,
      lineGap: 2,
    });
  doc.x = PAGE_LEFT;
  doc.moveDown(0.2);
}

function drawFootnote(doc: PDFKit.PDFDocument, term: string, definition: string): void {
  const startY = doc.y;
  const totalWidth = doc.page.width - PAGE_LEFT - PAGE_RIGHT_PAD;
  const termWidth = 110;

  doc
    .fillColor(COLOURS.sage)
    .fontSize(8.5)
    .font("Helvetica-Bold")
    .text(term, PAGE_LEFT, startY, { width: termWidth, lineBreak: false });

  doc
    .fillColor(COLOURS.grey75)
    .fontSize(8.5)
    .font("Helvetica")
    .text(definition, PAGE_LEFT + termWidth + 6, startY, {
      width: totalWidth - termWidth - 6,
      lineGap: 1.5,
    });

  doc.x = PAGE_LEFT;
  doc.moveDown(0.25);
}

interface HBarItem {
  label: string;
  value: number;
  sub: string;
  valueLabel: string;
}

function drawHorizontalBars(doc: PDFKit.PDFDocument, items: HBarItem[]): void {
  if (items.length === 0) return;
  const max = Math.max(...items.map((i) => i.value), 1);
  const totalWidth = doc.page.width - PAGE_LEFT - PAGE_RIGHT_PAD;
  const labelWidth = 150;
  const valueLabelWidth = 90;
  const barWidth = totalWidth - labelWidth - valueLabelWidth - 16;
  const rowHeight = 22;

  for (const it of items) {
    const startY = doc.y;
    // Truncate long labels
    const truncatedLabel = it.label.length > 30 ? it.label.slice(0, 27) + "..." : it.label;

    doc
      .fillColor(COLOURS.ink)
      .fontSize(9.5)
      .font("Helvetica")
      .text(truncatedLabel, PAGE_LEFT, startY + 2, { width: labelWidth, lineBreak: false });
    doc
      .fillColor(COLOURS.grey60)
      .fontSize(7.5)
      .font("Helvetica")
      .text(it.sub, PAGE_LEFT, startY + 13, { width: labelWidth, lineBreak: false });

    // Bar track
    const barX = PAGE_LEFT + labelWidth + 8;
    const barY = startY + 5;
    const barHeight = 10;
    doc.roundedRect(barX, barY, barWidth, barHeight, 2).fill(COLOURS.grey5);
    // Fill — at least 2px wide so zero-ish values are still visible-ish
    const fillW = Math.max(2, (it.value / max) * barWidth);
    doc.roundedRect(barX, barY, fillW, barHeight, 2).fill(COLOURS.sage);

    // Value label on the right
    doc
      .fillColor(COLOURS.ink)
      .fontSize(10)
      .font("Helvetica-Bold")
      .text(it.valueLabel, barX + barWidth + 8, startY + 4, {
        width: valueLabelWidth,
        align: "right",
        lineBreak: false,
      });

    doc.x = PAGE_LEFT;
    doc.y = startY + rowHeight;
  }
}

function drawVerticalDowBars(
  doc: PDFKit.PDFDocument,
  data: RevenueByDow[],
  currency: "SGD" | "MYR",
): void {
  const totalWidth = doc.page.width - PAGE_LEFT - PAGE_RIGHT_PAD;
  const chartHeight = 110;
  const chartTop = doc.y;
  const chartBottom = chartTop + chartHeight;
  const colWidth = totalWidth / 7;
  const barInset = 12;

  // Reorder so Mon first (UI convention) — DB returns dow 0=Sun..6=Sat
  const reordered = [1, 2, 3, 4, 5, 6, 0].map((dow) =>
    data.find((d) => d.dow === dow) ?? { dow, label: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dow]!, revenue: 0, count: 0 }
  );

  const maxRev = Math.max(...reordered.map((d) => d.revenue), 1);

  // Faint baseline
  doc
    .moveTo(PAGE_LEFT, chartBottom)
    .lineTo(PAGE_LEFT + totalWidth, chartBottom)
    .strokeColor(COLOURS.grey15)
    .lineWidth(0.5)
    .stroke();

  reordered.forEach((d, i) => {
    const colX = PAGE_LEFT + i * colWidth;
    const barX = colX + barInset / 2;
    const barW = colWidth - barInset;
    const barH = (d.revenue / maxRev) * (chartHeight - 24);
    const barY = chartBottom - barH;

    doc.roundedRect(barX, barY, barW, barH || 1, 2).fill(d.revenue > 0 ? COLOURS.sage : COLOURS.grey15);

    // Value above bar
    if (d.revenue > 0) {
      doc
        .fillColor(COLOURS.grey75)
        .fontSize(7.5)
        .font("Helvetica-Bold")
        .text(fmtMoney(d.revenue, currency), barX, barY - 11, {
          width: barW,
          align: "center",
          lineBreak: false,
        });
    }

    // Day label below baseline
    doc
      .fillColor(COLOURS.grey60)
      .fontSize(8.5)
      .font("Helvetica")
      .text(d.label, colX, chartBottom + 4, {
        width: colWidth,
        align: "center",
        lineBreak: false,
      });
    doc
      .fillColor(COLOURS.grey45)
      .fontSize(7)
      .font("Helvetica")
      .text(`${d.count}`, colX, chartBottom + 14, {
        width: colWidth,
        align: "center",
        lineBreak: false,
      });
  });

  doc.x = PAGE_LEFT;
  doc.y = chartBottom + 26;
}

function humanizeSource(source: string | null): string {
  if (!source) return "Unknown";
  return source
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function analyticsPdfFilename(args: { merchantName: string; periodLabel: string }): string {
  const slug = args.merchantName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const period = args.periodLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}-analytics-${period}.pdf`;
}

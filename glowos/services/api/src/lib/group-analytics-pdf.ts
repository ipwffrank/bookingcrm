import PDFDocument from "pdfkit";
import type { DigestMetrics } from "./analytics-aggregator.js";
import type { UtilizationResult } from "./utilization.js";
import type { CohortRetentionResult } from "./cohort-retention.js";
import type { RebookLagResult } from "./rebook-lag.js";

/**
 * Server-rendered PDF for the group/brand analytics dashboard. Mirrors
 * the per-merchant analytics PDF layout but the centerpiece is a
 * per-branch comparison table showing how each branch contributes to
 * the group total. The footnotes section explicitly notes that branches
 * with errored aggregations are omitted (the underlying aggregator is
 * fault-tolerant per branch — see analytics-aggregator.ts).
 *
 * Implementation: pdfkit (Node-native, no Chromium). Same approach as
 * analytics-pdf.ts.
 */

interface PerBranch {
  merchantId: string;
  merchantName: string;
  metrics: DigestMetrics;
}

export interface GroupAnalyticsPdfArgs {
  groupName: string;
  currency: "SGD" | "MYR" | "HKD";
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  // Group-level rolled-up metrics
  metrics: DigestMetrics;
  utilization: UtilizationResult | null;
  cohortRetention: CohortRetentionResult | null;
  rebookLag: RebookLagResult | null;
  // Per-branch breakdown for the comparison table
  perBranch: PerBranch[];
  // Branches that failed aggregation upstream — declared in footnotes
  // so the merchant knows the rollup is missing data.
  omittedBranchCount: number;
}

const COLOURS = {
  ink: "#1a2313",
  surface: "#ffffff",
  sage: "#456466",
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

function fmtMoney(n: number, currency: "SGD" | "MYR" | "HKD"): string {
  const sym =
    currency === "MYR" ? "RM"
    : currency === "HKD" ? "HK$"
    : "S$";
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

export async function renderGroupAnalyticsPdf(args: GroupAnalyticsPdfArgs): Promise<Buffer> {
  const {
    groupName,
    currency,
    periodLabel,
    metrics: m,
    utilization,
    cohortRetention,
    rebookLag,
    perBranch,
    omittedBranchCount,
  } = args;

  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: {
      Title: `Group Analytics — ${groupName} — ${periodLabel}`,
      Author: "GlowOS",
      Subject: `Group analytics for ${periodLabel}`,
      Keywords: "group analytics report kpi",
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
    .text(`GROUP ANALYTICS · ${periodLabel.toUpperCase()}`, PAGE_LEFT, 50, {
      characterSpacing: 1,
    });
  doc.moveDown(0.3);
  doc
    .fillColor(COLOURS.ink)
    .fontSize(20)
    .font("Helvetica-Bold")
    .text(groupName);
  doc.moveDown(0.2);
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(10)
    .font("Helvetica")
    .text(
      `Generated ${new Date().toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })} · ${perBranch.length} branch${perBranch.length === 1 ? "" : "es"} included · All deltas vs prior period of equal length`,
    );
  doc.moveDown(1);

  // ─── Hero KPIs (4 columns, group-level) ────────────────────────────
  const heroY = doc.y;
  const heroGap = 8;
  const heroCardWidth = (doc.page.width - 100 - heroGap * 3) / 4;
  const heroCardHeight = 70;

  drawHeroCard(doc, PAGE_LEFT, heroY, heroCardWidth, heroCardHeight,
    "GROUP REVENUE", fmtMoney(m.revenueSgd, currency),
    deltaPct(m.revenueSgd, m.prior.revenueSgd), true);
  drawHeroCard(doc, PAGE_LEFT + heroCardWidth + heroGap, heroY, heroCardWidth, heroCardHeight,
    "GROUP BOOKINGS", String(m.bookingsCount),
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

  // ─── Group operational metrics ─────────────────────────────────────
  drawSectionLabel(doc, "OPERATIONAL METRICS (GROUP ROLLUP)");

  drawGridRow(
    doc,
    "First-timer return rate",
    m.firstTimerReturnRatePct === null
      ? `— (${m.firstTimerSampleSize} new across group)`
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

  doc.x = PAGE_LEFT;
  doc.moveDown(0.6);

  // ─── Per-branch comparison table ───────────────────────────────────
  if (perBranch.length > 0) {
    drawSectionLabel(doc, "PER-BRANCH BREAKDOWN");
    drawPerBranchTable(doc, perBranch, m, currency);
    doc.moveDown(0.6);
  }

  // ─── Page 2: highlights + footnotes ────────────────────────────────
  doc.addPage();
  doc.x = PAGE_LEFT;
  doc.y = 50;

  if (
    m.highlights.busiestDay ||
    m.highlights.quietestDay ||
    m.highlights.topServiceByRevenue
  ) {
    drawSectionLabel(doc, "GROUP HIGHLIGHTS");
    if (m.highlights.busiestDay) {
      drawBullet(doc, `Best day across group: ${fmtDateLong(m.highlights.busiestDay.date)} — ${m.highlights.busiestDay.bookings} booking${m.highlights.busiestDay.bookings === 1 ? "" : "s"}`);
    }
    if (m.highlights.quietestDay && m.highlights.busiestDay && m.highlights.quietestDay.date !== m.highlights.busiestDay.date) {
      drawBullet(doc, `Quietest day across group: ${fmtDateLong(m.highlights.quietestDay.date)} — ${m.highlights.quietestDay.bookings} booking${m.highlights.quietestDay.bookings === 1 ? "" : "s"}`);
    }
    if (m.highlights.topServiceByRevenue) {
      drawBullet(doc, `Top service across group: ${m.highlights.topServiceByRevenue.name} — ${fmtMoney(m.highlights.topServiceByRevenue.revenueSgd, currency)}`);
    }
    doc.moveDown(0.5);
  }

  // ─── Top revenue / lowest no-show / highest no-show callouts ───────
  if (perBranch.length >= 2) {
    drawSectionLabel(doc, "BRANCH CALLOUTS");
    const sortedByRev = [...perBranch].sort((a, b) => b.metrics.revenueSgd - a.metrics.revenueSgd);
    const sortedByNoShow = [...perBranch]
      .filter((b) => b.metrics.bookingsCount + b.metrics.noShowsCount > 0)
      .sort((a, b) => a.metrics.noShowRate - b.metrics.noShowRate);

    if (sortedByRev[0]) {
      drawBullet(doc, `Top revenue: ${sortedByRev[0].merchantName} — ${fmtMoney(sortedByRev[0].metrics.revenueSgd, currency)}`);
    }
    if (sortedByNoShow.length > 0 && sortedByNoShow[0]) {
      drawBullet(doc, `Lowest no-show rate: ${sortedByNoShow[0].merchantName} — ${fmtPct(sortedByNoShow[0].metrics.noShowRate)}`);
    }
    if (sortedByNoShow.length > 1) {
      const worst = sortedByNoShow[sortedByNoShow.length - 1]!;
      if (worst.metrics.noShowRate >= 0.10) {
        drawBullet(doc, `Highest no-show rate: ${worst.merchantName} — ${fmtPct(worst.metrics.noShowRate)} · review reminder cadence here first`);
      }
    }
    doc.moveDown(0.6);
  }

  // ─── Footnotes ─────────────────────────────────────────────────────
  drawSectionLabel(doc, "HOW THESE NUMBERS ARE DERIVED");
  drawFootnote(doc, "Group revenue", "Sum of revenue across all branches in the group, computed as: sum of price for non-cancelled, non-no-show bookings starting in the period at each branch.");
  drawFootnote(doc, "Group bookings", "Count of non-cancelled, non-no-show bookings across all branches starting in the period.");
  drawFootnote(doc, "No-show rate (group)", "Weighted: sum(no_shows) ÷ sum(completed + no_shows) across all branches, NOT a simple average of branch rates. Stops a small branch with a few outliers from skewing the headline.");
  drawFootnote(doc, "Avg rating (group)", "Volume-weighted mean of branch averages — a branch with 100 reviews counts more than one with 5.");
  drawFootnote(doc, "First-timer return rate", "Aggregated across all branches: clients whose first ever non-cancelled booking at any branch fell in the period, share with at least one later non-cancelled booking at any branch in the group.");
  if (utilization?.headline) {
    drawFootnote(doc, "Capacity utilization", "Group: sum(booked staff-hours) ÷ sum(available staff-hours) across all branches. Treats the group as a single capacity pool — a branch with idle staff offsets one running hot.");
  }
  if (cohortRetention?.headline) {
    drawFootnote(doc, "60d cohort retention", "Combined cohort across all branches. A client's first visit can be at one branch, the return visit at another — both count, reflecting cross-branch loyalty.");
  }
  if (rebookLag?.headline) {
    drawFootnote(doc, "Rebook lag", "Median days between completed visits, pooled across branches. Cross-branch returns count.");
  }
  drawFootnote(doc, "Per-branch table", "Rows sorted by revenue desc. \"Top\" highlight indicates the branch contributing most revenue to the group total. Branches that failed aggregation upstream (timeout, schema error, etc.) are omitted; see the count below the heading if any are missing.");
  drawFootnote(doc, "Deltas", "Compared against the equal-length period immediately before. \"new\" = no prior data; \"-\" = change <0.5%.");
  if (omittedBranchCount > 0) {
    drawFootnote(doc, "Omitted branches", `${omittedBranchCount} branch${omittedBranchCount === 1 ? "" : "es"} could not be aggregated for this period — likely timeout or transient DB error. Re-running the export usually picks them up. Group totals exclude omitted branches.`);
  }

  // Footer with explicit y position to prevent pdfkit auto-paginate
  // emitting blank trailing pages.
  const footerY = doc.page.height - 40;
  doc
    .fillColor(COLOURS.grey45)
    .fontSize(8)
    .font("Helvetica")
    .text(
      `Generated by GlowOS for ${groupName} on ${new Date().toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" })}`,
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

function drawPerBranchTable(
  doc: PDFKit.PDFDocument,
  perBranch: PerBranch[],
  groupTotal: DigestMetrics,
  currency: "SGD" | "MYR" | "HKD",
): void {
  const sorted = [...perBranch].sort((a, b) => b.metrics.revenueSgd - a.metrics.revenueSgd);
  const topRevenueId = sorted[0]?.merchantId;
  const totalWidth = doc.page.width - PAGE_LEFT - PAGE_RIGHT_PAD;

  // Columns: Branch (flex) · Revenue · Bookings · No-show · Rating
  const colWidths = [
    Math.round(totalWidth * 0.32),  // Branch name
    Math.round(totalWidth * 0.18),  // Revenue
    Math.round(totalWidth * 0.16),  // Bookings
    Math.round(totalWidth * 0.16),  // No-show
    Math.round(totalWidth * 0.18),  // Rating
  ];
  const headerHeight = 18;
  const rowHeight = 18;

  const startY = doc.y;
  doc.fillColor(COLOURS.grey60).fontSize(9).font("Helvetica-Bold");
  let x = PAGE_LEFT;
  doc.text("BRANCH", x, startY, { width: colWidths[0], lineBreak: false });
  x += colWidths[0];
  doc.text("REVENUE", x, startY, { width: colWidths[1], align: "right", lineBreak: false });
  x += colWidths[1];
  doc.text("BOOKINGS", x, startY, { width: colWidths[2], align: "right", lineBreak: false });
  x += colWidths[2];
  doc.text("NO-SHOW", x, startY, { width: colWidths[3], align: "right", lineBreak: false });
  x += colWidths[3];
  doc.text("RATING", x, startY, { width: colWidths[4], align: "right", lineBreak: false });

  doc
    .moveTo(PAGE_LEFT, startY + headerHeight - 4)
    .lineTo(PAGE_LEFT + totalWidth, startY + headerHeight - 4)
    .strokeColor(COLOURS.grey15)
    .stroke();

  doc.font("Helvetica").fontSize(10);
  let rowY = startY + headerHeight;
  for (const branch of sorted) {
    const isTopRevenue = branch.merchantId === topRevenueId;
    const noShowColour = branch.metrics.noShowRate >= 0.10 ? COLOURS.warn : COLOURS.ink;
    const revenueColour = isTopRevenue ? COLOURS.sage : COLOURS.ink;

    let cx = PAGE_LEFT;
    const truncatedName = branch.merchantName.length > 28 ? branch.merchantName.slice(0, 25) + "..." : branch.merchantName;
    doc.fillColor(COLOURS.ink).text(truncatedName, cx, rowY, { width: colWidths[0], lineBreak: false });
    cx += colWidths[0];
    doc.fillColor(revenueColour).font(isTopRevenue ? "Helvetica-Bold" : "Helvetica").text(fmtMoney(branch.metrics.revenueSgd, currency), cx, rowY, { width: colWidths[1], align: "right", lineBreak: false });
    cx += colWidths[1];
    doc.fillColor(COLOURS.ink).font("Helvetica").text(String(branch.metrics.bookingsCount), cx, rowY, { width: colWidths[2], align: "right", lineBreak: false });
    cx += colWidths[2];
    doc.fillColor(noShowColour).text(fmtPct(branch.metrics.noShowRate), cx, rowY, { width: colWidths[3], align: "right", lineBreak: false });
    cx += colWidths[3];
    doc.fillColor(COLOURS.ink).text(branch.metrics.averageRating === null ? "—" : `${branch.metrics.averageRating.toFixed(1)}★ (${branch.metrics.reviewsCount})`, cx, rowY, { width: colWidths[4], align: "right", lineBreak: false });

    rowY += rowHeight;
  }

  // Total row separator + group total
  doc
    .moveTo(PAGE_LEFT, rowY + 2)
    .lineTo(PAGE_LEFT + totalWidth, rowY + 2)
    .strokeColor(COLOURS.ink)
    .lineWidth(1.2)
    .stroke();
  doc.lineWidth(1);

  rowY += 8;
  doc.font("Helvetica-Bold").fillColor(COLOURS.ink);
  let cx = PAGE_LEFT;
  doc.text("GROUP TOTAL", cx, rowY, { width: colWidths[0], lineBreak: false });
  cx += colWidths[0];
  doc.text(fmtMoney(groupTotal.revenueSgd, currency), cx, rowY, { width: colWidths[1], align: "right", lineBreak: false });
  cx += colWidths[1];
  doc.text(String(groupTotal.bookingsCount), cx, rowY, { width: colWidths[2], align: "right", lineBreak: false });
  cx += colWidths[2];
  doc.text(fmtPct(groupTotal.noShowRate), cx, rowY, { width: colWidths[3], align: "right", lineBreak: false });
  cx += colWidths[3];
  doc.text(groupTotal.averageRating === null ? "—" : `${groupTotal.averageRating.toFixed(1)}★`, cx, rowY, { width: colWidths[4], align: "right", lineBreak: false });

  doc.x = PAGE_LEFT;
  doc.y = rowY + rowHeight + 6;
  doc.font("Helvetica").fillColor(COLOURS.ink).fontSize(11);
}

export function groupAnalyticsPdfFilename(args: { groupName: string; periodLabel: string }): string {
  const slug = args.groupName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const period = args.periodLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}-group-analytics-${period}.pdf`;
}

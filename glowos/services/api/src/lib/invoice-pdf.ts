/**
 * Receipt / invoice PDF renderer.
 *
 * Universal — produces a clean, branded PDF that works for clinics in HK,
 * SG, MY without country-specific compliance assumptions. The MyInvois
 * layer (slice 2 — when a paying MY clinic asks) overlays the LHDN UUID
 * + QR code on top of this base receipt; that helper goes alongside in a
 * follow-up file.
 *
 * Layout (A4 portrait):
 *   Header: clinic logo (placeholder for now) + name + address
 *           tax registration number (when set)
 *   Title row: "INVOICE" or "RECEIPT" + invoice number + issued date
 *   Buyer block: name, phone, email, address (left)
 *   Issuer block: clinic name, BRN/tax reg, address, contact (right)
 *   Line items table: # | description | qty | unit price | total
 *   Totals block: subtotal · discount · tax · total (right-aligned)
 *   Footer: clinic-customizable footer text + GlowOS attribution line
 *
 * Follows the same pdfkit pattern as analytics-digest-pdf.ts:
 *   - PDFDocument with bufferPages: true
 *   - Stream chunks → Buffer
 *   - Reset doc.x to PAGE_LEFT after every absolute-positioned helper
 *     (otherwise text wraps one char per line — known pdfkit gotcha)
 */

import PDFDocument from "pdfkit";
import type { invoices, invoiceLineItems } from "@glowos/db";

// ─── Palette (mirror of GlowOS dashboard restricted palette) ─────────────

const COLOURS = {
  ink: "#1a2313",
  sage: "#456466",
  paper: "#fafaf7",
  grey90: "#1f2419",
  grey60: "#6b7165",
  grey45: "#8a8e85",
  grey20: "#d4d6cf",
  grey10: "#e7e8e3",
  warn: "#a8580a",
};

const PAGE_LEFT = 50;
const PAGE_RIGHT = 545; // A4 width 595 - 50 right margin

type InvoiceRow = typeof invoices.$inferSelect;
type LineItemRow = typeof invoiceLineItems.$inferSelect;

interface RenderArgs {
  invoice: InvoiceRow;
  lineItems: LineItemRow[];
  /** Customizable footer text from merchants.invoice_footer_text. Optional. */
  footerText?: string | null;
  /**
   * Whether to render the document title as "INVOICE" or "RECEIPT".
   * Receipts are typically issued post-payment; invoices pre-payment.
   * Defaults to RECEIPT since the universal slice fires after payment.
   */
  documentTitle?: "INVOICE" | "RECEIPT";
}

export async function renderInvoicePdf(args: RenderArgs): Promise<Buffer> {
  const { invoice: inv, lineItems, footerText } = args;
  const docTitle = args.documentTitle ?? "RECEIPT";

  const doc = new PDFDocument({
    size: "A4",
    margin: 50,
    info: {
      Title: `${docTitle} ${inv.internalInvoiceNumber} — ${inv.issuerName}`,
      Author: inv.issuerName,
      Subject: `Receipt issued to ${inv.buyerName}`,
      Keywords: "receipt invoice glowos",
    },
    bufferPages: true,
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c as Buffer));
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ─── Header strip — clinic name + small caption ────────────────────────
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(9)
    .font("Helvetica")
    .text(`${docTitle}`, PAGE_LEFT, 50, { characterSpacing: 1.5 });
  doc.x = PAGE_LEFT;

  doc
    .fillColor(COLOURS.ink)
    .fontSize(22)
    .font("Helvetica-Bold")
    .text(inv.issuerName, PAGE_LEFT, 64);
  doc.x = PAGE_LEFT;

  // Issuer subtitle line: address + reg number
  const issuerLines: string[] = [];
  if (inv.issuerAddressLine1) issuerLines.push(inv.issuerAddressLine1);
  if (inv.issuerAddressLine2) issuerLines.push(inv.issuerAddressLine2);
  const cityState = [inv.issuerPostalCode, inv.issuerCity, inv.issuerState]
    .filter(Boolean)
    .join(" ");
  if (cityState) issuerLines.push(cityState);
  if (inv.issuerPhone) issuerLines.push(`Phone: ${inv.issuerPhone}`);
  if (inv.issuerEmail) issuerLines.push(inv.issuerEmail);
  if (inv.issuerSstRegistrationNumber)
    issuerLines.push(`Tax reg: ${inv.issuerSstRegistrationNumber}`);

  if (issuerLines.length > 0) {
    doc
      .fillColor(COLOURS.grey60)
      .fontSize(9.5)
      .font("Helvetica")
      .text(issuerLines.join("\n"), PAGE_LEFT, 92, {
        width: 250,
        lineGap: 1.5,
      });
    doc.x = PAGE_LEFT;
  }

  // ─── Top-right: invoice number + issued date ───────────────────────────
  const rightX = PAGE_RIGHT - 200;
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(9)
    .font("Helvetica")
    .text("RECEIPT NO.", rightX, 64, { width: 200, align: "right" });
  doc
    .fillColor(COLOURS.ink)
    .fontSize(13)
    .font("Helvetica-Bold")
    .text(inv.internalInvoiceNumber, rightX, 78, { width: 200, align: "right" });
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(9)
    .font("Helvetica")
    .text("ISSUED", rightX, 100, { width: 200, align: "right" });
  doc
    .fillColor(COLOURS.ink)
    .fontSize(11)
    .font("Helvetica")
    .text(formatDate(inv.issuedAt), rightX, 113, { width: 200, align: "right" });

  doc.x = PAGE_LEFT;
  // Reset y to below the header block.
  doc.y = 150;

  // ─── Hairline divider ──────────────────────────────────────────────────
  doc
    .strokeColor(COLOURS.grey20)
    .lineWidth(0.5)
    .moveTo(PAGE_LEFT, doc.y)
    .lineTo(PAGE_RIGHT, doc.y)
    .stroke();
  doc.y += 18;

  // ─── Buyer block ───────────────────────────────────────────────────────
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(9)
    .font("Helvetica")
    .text("BILLED TO", PAGE_LEFT, doc.y, { characterSpacing: 1.2 });
  doc.y += 14;

  doc
    .fillColor(COLOURS.ink)
    .fontSize(13)
    .font("Helvetica-Bold")
    .text(inv.buyerName, PAGE_LEFT, doc.y);
  doc.y += 18;

  const buyerLines: string[] = [];
  if (inv.buyerPhone) buyerLines.push(inv.buyerPhone);
  if (inv.buyerEmail) buyerLines.push(inv.buyerEmail);
  if (inv.buyerAddressLine1) buyerLines.push(inv.buyerAddressLine1);
  if (inv.buyerAddressLine2) buyerLines.push(inv.buyerAddressLine2);
  if (buyerLines.length > 0) {
    doc
      .fillColor(COLOURS.grey60)
      .fontSize(10)
      .font("Helvetica")
      .text(buyerLines.join("\n"), PAGE_LEFT, doc.y, {
        width: 250,
        lineGap: 1.5,
      });
    doc.y += buyerLines.length * 12;
  }

  doc.y += 24;
  doc.x = PAGE_LEFT;

  // ─── Line items table ──────────────────────────────────────────────────
  drawLineItemsTable(doc, lineItems);

  // ─── Totals block (right-aligned) ──────────────────────────────────────
  doc.y += 16;
  drawTotalsBlock(doc, inv);

  // ─── Payment + thank-you footer ────────────────────────────────────────
  doc.y += 28;
  doc
    .strokeColor(COLOURS.grey20)
    .lineWidth(0.5)
    .moveTo(PAGE_LEFT, doc.y)
    .lineTo(PAGE_RIGHT, doc.y)
    .stroke();
  doc.y += 14;

  if (inv.paymentMode) {
    doc
      .fillColor(COLOURS.grey60)
      .fontSize(9)
      .font("Helvetica")
      .text(`Paid via ${humanPaymentMode(inv.paymentMode)}`, PAGE_LEFT, doc.y);
    doc.y += 14;
  }

  if (footerText) {
    doc
      .fillColor(COLOURS.grey90)
      .fontSize(10)
      .font("Helvetica-Oblique")
      .text(footerText, PAGE_LEFT, doc.y, { width: PAGE_RIGHT - PAGE_LEFT });
    doc.x = PAGE_LEFT;
    doc.y += Math.max(28, doc.heightOfString(footerText, { width: PAGE_RIGHT - PAGE_LEFT }) + 8);
  }

  // ─── GlowOS attribution at the very bottom ────────────────────────────
  doc
    .fillColor(COLOURS.grey45)
    .fontSize(8)
    .font("Helvetica")
    .text(
      `Generated by GlowOS · ${formatDate(new Date())}`,
      PAGE_LEFT,
      800,
      { width: PAGE_RIGHT - PAGE_LEFT, align: "center" },
    );

  doc.end();
  return finished;
}

// ─── Drawing helpers ─────────────────────────────────────────────────────

function drawLineItemsTable(doc: PDFKit.PDFDocument, items: LineItemRow[]): void {
  const rowHeight = 22;
  const colNo = PAGE_LEFT;
  const colDesc = PAGE_LEFT + 30;
  const colQty = PAGE_RIGHT - 200;
  const colUnit = PAGE_RIGHT - 130;
  const colTotal = PAGE_RIGHT - 60;

  // Header row
  doc
    .fillColor(COLOURS.grey60)
    .fontSize(9)
    .font("Helvetica-Bold");
  doc.text("#", colNo, doc.y, { width: 24 });
  doc.text("DESCRIPTION", colDesc, doc.y - 11, { width: colQty - colDesc - 12 });
  doc.text("QTY", colQty, doc.y - 11, { width: 60, align: "right" });
  doc.text("UNIT", colUnit, doc.y - 11, { width: 60, align: "right" });
  doc.text("TOTAL", colTotal, doc.y - 11, { width: 60, align: "right" });
  doc.y += 6;
  doc
    .strokeColor(COLOURS.grey20)
    .lineWidth(0.5)
    .moveTo(PAGE_LEFT, doc.y)
    .lineTo(PAGE_RIGHT, doc.y)
    .stroke();
  doc.y += 6;

  // Rows
  for (const item of items) {
    const rowY = doc.y;
    doc
      .fillColor(COLOURS.grey45)
      .fontSize(10)
      .font("Helvetica")
      .text(String(item.lineNumber), colNo, rowY, { width: 24 });
    doc
      .fillColor(COLOURS.ink)
      .fontSize(10.5)
      .font("Helvetica")
      .text(item.description, colDesc, rowY, { width: colQty - colDesc - 12 });
    doc
      .fillColor(COLOURS.grey60)
      .fontSize(10)
      .font("Helvetica")
      .text(formatQty(item.quantity), colQty, rowY, { width: 60, align: "right" });
    doc
      .fillColor(COLOURS.grey60)
      .text(fmt(item.unitPrice), colUnit, rowY, { width: 60, align: "right" });
    doc
      .fillColor(COLOURS.ink)
      .font("Helvetica-Bold")
      .text(fmt(item.totalAmount), colTotal, rowY, { width: 60, align: "right" });
    doc.x = PAGE_LEFT;
    doc.y = rowY + rowHeight;
  }

  doc.y += 4;
  doc
    .strokeColor(COLOURS.grey20)
    .lineWidth(0.5)
    .moveTo(PAGE_LEFT, doc.y)
    .lineTo(PAGE_RIGHT, doc.y)
    .stroke();
  doc.y += 4;
}

function drawTotalsBlock(doc: PDFKit.PDFDocument, inv: InvoiceRow): void {
  const labelX = PAGE_RIGHT - 200;
  const valueX = PAGE_RIGHT - 60;
  const lineH = 16;

  function row(label: string, value: string, opts?: { strong?: boolean; sage?: boolean }) {
    doc
      .fillColor(opts?.sage ? COLOURS.sage : COLOURS.grey60)
      .fontSize(opts?.strong ? 11 : 10)
      .font(opts?.strong ? "Helvetica-Bold" : "Helvetica")
      .text(label, labelX, doc.y, { width: 130, align: "right" });
    doc
      .fillColor(opts?.strong ? COLOURS.ink : COLOURS.grey90)
      .fontSize(opts?.strong ? 13 : 10.5)
      .font(opts?.strong ? "Helvetica-Bold" : "Helvetica")
      .text(value, valueX, doc.y - (opts?.strong ? 1.5 : 0), { width: 60, align: "right" });
    doc.x = PAGE_LEFT;
    doc.y += lineH;
  }

  row("Subtotal", fmt(inv.subtotalAmount));

  if (Number(inv.discountAmount) > 0) {
    row("Discount", `-${fmt(inv.discountAmount)}`);
  }

  if (Number(inv.taxAmount) > 0) {
    // Pull the tax label from the tax_breakdown JSONB (first key).
    const breakdown = inv.taxBreakdown as Record<string, { rate?: number }> | null;
    const taxLabel = breakdown ? Object.keys(breakdown)[0] : "Tax";
    const ratePart = breakdown && breakdown[taxLabel]?.rate ? ` (${breakdown[taxLabel].rate}%)` : "";
    row(`${taxLabel}${ratePart}`, fmt(inv.taxAmount));
  }

  // Hairline above total
  doc
    .strokeColor(COLOURS.grey20)
    .lineWidth(0.5)
    .moveTo(labelX, doc.y + 2)
    .lineTo(valueX + 60, doc.y + 2)
    .stroke();
  doc.y += 8;

  row(`TOTAL (${inv.currency})`, fmt(inv.totalAmount), { strong: true });
}

// ─── Formatters ──────────────────────────────────────────────────────────

function fmt(amount: string | number): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return n.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQty(qty: string | number): string {
  const n = typeof qty === "string" ? parseFloat(qty) : qty;
  // Trim trailing zeros for whole numbers.
  return Number.isInteger(n) ? String(n) : n.toString();
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function humanPaymentMode(mode: string): string {
  const map: Record<string, string> = {
    cash: "Cash",
    card: "Card",
    eft: "Bank transfer",
    fpx: "FPX",
    duitnow: "DuitNow QR",
    stripe: "Stripe",
    ipay88: "iPay88",
    grabpay: "GrabPay",
    boost: "Boost",
    tng: "Touch 'n Go eWallet",
  };
  return map[mode.toLowerCase()] ?? mode;
}

export function invoicePdfFilename(inv: { internalInvoiceNumber: string; issuerName: string }): string {
  const safe = inv.issuerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe}-${inv.internalInvoiceNumber}.pdf`;
}

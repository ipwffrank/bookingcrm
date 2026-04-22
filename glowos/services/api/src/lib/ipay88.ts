import { createHash, randomBytes } from "crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Ipay88InitiatePayload {
  MerchantCode: string;
  PaymentId?: string; // Optional — omit to show iPay88's method picker
  RefNo: string;
  Amount: string; // Formatted with commas — iPay88's display form expects them
  Currency: string;
  ProdDesc: string;
  UserName: string;
  UserEmail: string;
  UserContact: string;
  Remark?: string;
  Lang: string;
  SignatureType: "SHA256";
  Signature: string;
  ResponseURL: string;
  BackendURL: string;
}

export interface Ipay88CallbackPayload {
  MerchantCode: string;
  PaymentId: string;
  RefNo: string;
  Amount: string;
  Currency: string;
  Remark: string;
  TransId: string;
  AuthCode: string;
  Status: string; // "1" success, "6" pending FPX, other = failure
  ErrDesc: string;
  Signature: string;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────
// iPay88 uses the same host for sandbox + production; the MerchantCode itself
// is tied to one or the other. The endpoint URL does not change per environment.

export const IPAY88_ENTRY_URL = "https://payment.ipay88.com.my/epayment/entry.asp";
export const IPAY88_REQUERY_URL = "https://payment.ipay88.com.my/epayment/enquiry.asp";

// ─── RefNo generator ──────────────────────────────────────────────────────────
// iPay88 requires RefNo ≤ 20 chars and unique within 30 min. We use the last
// 10 hex chars of the booking UUID + a 6-byte random suffix (hex, 12 chars)
// to give both idempotency per booking AND uniqueness across retries.

export function generateRefNo(bookingId: string): string {
  const bookingStub = bookingId.replace(/-/g, "").slice(-6);
  const nonce = randomBytes(3).toString("hex"); // 6 hex chars
  return `GL${bookingStub}${nonce}`.slice(0, 20).toUpperCase();
}

// ─── Amount formatting ────────────────────────────────────────────────────────
// The display form expects "1,234.00" style. The signature, however, is
// computed on the *stripped* numeric string "1234.00". Getting this wrong is
// the #1 cause of "signature not match" errors (research: ipay88.co.id docs).

export function formatAmountForDisplay(amount: number): string {
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function stripAmountForSignature(displayAmount: string): string {
  return displayAmount.replace(/,/g, "");
}

// ─── Signatures ───────────────────────────────────────────────────────────────
// Outgoing request signature: SHA-256 hex of
//   ||MerchantKey||MerchantCode||RefNo||Amount||Currency||
// where Amount has commas stripped.
//
// Incoming callback signature: SHA-256 hex of
//   ||MerchantKey||MerchantCode||PaymentId||RefNo||Amount||Currency||Status||

export function signRequest(params: {
  merchantKey: string;
  merchantCode: string;
  refNo: string;
  amount: string; // Already in "1234.00" form (strip commas BEFORE calling)
  currency: string;
}): string {
  const hash = createHash("sha256");
  hash.update(
    `||${params.merchantKey}||${params.merchantCode}||${params.refNo}||${params.amount}||${params.currency}||`,
  );
  return hash.digest("hex");
}

export function verifyCallbackSignature(params: {
  merchantKey: string;
  merchantCode: string;
  paymentId: string;
  refNo: string;
  amount: string; // Callback "Amount" field (usually clean, still strip defensively)
  currency: string;
  status: string;
  receivedSignature: string;
}): boolean {
  const expected = createHash("sha256")
    .update(
      `||${params.merchantKey}||${params.merchantCode}||${params.paymentId}||${params.refNo}||${stripAmountForSignature(params.amount)}||${params.currency}||${params.status}||`,
    )
    .digest("hex");
  // Case-insensitive compare — iPay88 emits lowercase but belt-and-braces.
  return expected.toLowerCase() === params.receivedSignature.toLowerCase();
}

// ─── Helper: build the full form body for auto-POST ──────────────────────────

export function buildInitiatePayload(params: {
  merchantCode: string;
  merchantKey: string;
  refNo: string;
  amountDecimal: number; // e.g. 42.50
  currency: "MYR" | "SGD";
  prodDesc: string;
  userName: string;
  userEmail: string;
  userContact: string;
  remark?: string;
  responseUrl: string;
  backendUrl: string;
  paymentId?: string;
  lang?: string;
}): Ipay88InitiatePayload {
  const displayAmount = formatAmountForDisplay(params.amountDecimal);
  const signedAmount = stripAmountForSignature(displayAmount);
  const signature = signRequest({
    merchantKey: params.merchantKey,
    merchantCode: params.merchantCode,
    refNo: params.refNo,
    amount: signedAmount,
    currency: params.currency,
  });

  return {
    MerchantCode: params.merchantCode,
    ...(params.paymentId ? { PaymentId: params.paymentId } : {}),
    RefNo: params.refNo,
    Amount: displayAmount,
    Currency: params.currency,
    ProdDesc: params.prodDesc.slice(0, 100),
    UserName: params.userName.slice(0, 100),
    UserEmail: params.userEmail.slice(0, 100),
    UserContact: params.userContact.slice(0, 20),
    ...(params.remark ? { Remark: params.remark.slice(0, 100) } : {}),
    Lang: params.lang ?? "UTF-8",
    SignatureType: "SHA256",
    Signature: signature,
    ResponseURL: params.responseUrl,
    BackendURL: params.backendUrl,
  };
}

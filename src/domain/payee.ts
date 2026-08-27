/**
 * Two normalizations with very different contracts:
 *
 *  canonForFingerprint — FROZEN. Feeds the dedupe fingerprint; changing it would make
 *                        every stored row stop matching re-imports. Bump FINGERPRINT_VERSION
 *                        and write a migration if it must ever change.
 *
 *  normalizePayee      — evolves freely. Produces payee_key for rules, grouping, and
 *                        near-duplicate similarity. Recomputable for all rows at any time.
 */

export const FINGERPRINT_VERSION = 1;
export const PAYEE_KEY_VERSION = 1;

export function canonForFingerprint(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, " ").trim();
}

/** Bank-side transaction-type words that precede the merchant. */
const WORD_PREFIX =
  /^(POS DEBIT|POS PURCHASE|POS|PURCHASE|DEBIT CARD PURCHASE|DEBIT CARD|DEBIT|CREDIT|CHECKCARD|CHECK CARD|VISA|MASTERCARD|ACH|WEB|PPD|CCD|ARC|RECURRING|RECUR|APLPAY|APPLE PAY|CKCD|DBT|CRD|PENDING|CARD PURCHASE|ELECTRONIC|EFT)\b\s*/;
/** Payment processors that prefix the real merchant with "XX *". */
const PROCESSOR_PREFIX =
  /^(SQ|SQU|TST|PAYPAL|PP|GOOGLE|DD|DOORDASH|UBER|LYFT|IC|SP|EB|WL|PY|CKE|BT|TOAST)\s*\*\s*/;
/** Leading reference digits left behind by the prefixes: card last-4, MMDD dates. */
const LEADING_DIGITS = /^\d{3,}\s+/;

const TRAILING = [
  /\s*\*\s*[A-Z0-9]*\d[A-Z0-9]*$/, // "*2K4TR8XZ1" order/reference codes after an asterisk
  /\s+PPD ID:.*$/i,
  /\s+WEB ID:.*$/i,
  /\s+CCD ID:.*$/i,
  /\s+REF\s*#?\s*\w+$/i,
  /\s+ID:?\s*\w+$/i,
  /\s+X{2,}\d{2,4}$/, // masked card
  /\s+\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}$/, // phone
  /\s+[A-Z]{2}\s*\d{5}(-\d{4})?$/, // state + zip
  /\s+(USA?|US)$/,
  /\s+[A-Z]+(\s+[A-Z]+)?\s+[A-Z]{2}$/, // CITY ST (one or two city words)
  /\s+[A-Z]{2}$/, // lone state code
  /\s+#?\d{3,}$/, // store number
  /\s+\d{1,2}\/\d{1,2}(\/\d{2,4})?$/, // trailing date
];

/** Produce a stable grouping key for a merchant description. */
export function normalizePayee(raw: string): string {
  let s = raw.toUpperCase().replace(/\s+/g, " ").trim();
  for (let i = 0; i < 5; i++) {
    const before = s;
    s = s.replace(WORD_PREFIX, "").trim();
    s = s.replace(PROCESSOR_PREFIX, "").trim();
    s = s.replace(LEADING_DIGITS, "").trim();
    if (s === before) break;
  }
  // Long digit runs anywhere (card numbers, confirmation numbers).
  s = s
    .replace(/\b\d{6,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (let i = 0; i < 8; i++) {
    let changed = false;
    for (const re of TRAILING) {
      const next = s.replace(re, "").trim();
      if (next !== s && next.length >= 3 && /[A-Z]/.test(next)) {
        s = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  s = s.replace(/[*#]+/g, " ").replace(/[^A-Z0-9&'.\- ]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.length > 0 ? s : canonForFingerprint(raw);
}

/** A human-friendly default display name from a key: "WHOLE FOODS MKT" → "Whole Foods Mkt". */
export function displayFromKey(key: string): string {
  return key
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length <= 2 && /^[a-z]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

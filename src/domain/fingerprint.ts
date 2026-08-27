import { createHash } from "node:crypto";
import { canonForFingerprint, FINGERPRINT_VERSION } from "./payee";
import type { Cents, ISODate } from "./types";

export interface FingerprintInput {
  accountId: string;
  postedDate: ISODate;
  amountCents: Cents;
  payeeRaw: string;
}

/**
 * Content fingerprint of a transaction. Deterministic, frozen (see payee.ts).
 * NOT unique on its own: two identical purchases on one day share it. Uniqueness is (fingerprint, seq).
 */
export function computeFingerprint(t: FingerprintInput): string {
  const material = [
    `v${FINGERPRINT_VERSION}`,
    t.accountId,
    t.postedDate,
    String(t.amountCents),
    canonForFingerprint(t.payeeRaw),
  ].join("|");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

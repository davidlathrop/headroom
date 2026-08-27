import { diffDays } from "./dates";
import type { AccountKind, Cents, ISODate } from "./types";

export interface TransferCandidateTxn {
  id: string;
  accountId: string;
  postedDate: ISODate;
  amountCents: Cents;
  payeeKey: string;
  transferId: string | null;
}

export interface TransferProposal {
  fromTxnId: string; // the outflow side
  toTxnId: string; // the inflow side
  score: number;
}

export interface TransferDetectOptions {
  maxDays?: number; // default 4
  autoThreshold?: number; // default 0.7
  suggestThreshold?: number; // default 0.4
}

const TRANSFER_WORDS =
  /\b(PAYMENT|PMT|TRANSFER|XFER|AUTOPAY|AUTO PAY|ONLINE PMT|ZELLE|VENMO|EPAY|E-PAYMENT|DEPOSIT FROM|WITHDRAWAL TO|TO SAVINGS|FROM CHECKING|INTERNET TRANSFER|MOBILE TRANSFER)\b/;

export function looksLikeTransfer(payeeKey: string): boolean {
  return TRANSFER_WORDS.test(payeeKey);
}

/**
 * Propose transfer pairs among `fresh` transactions and `pool` (transactions in other accounts).
 * Pure. Returns proposals with score ≥ suggestThreshold, best-first; each transaction used at most once.
 */
export function detectTransfers(
  fresh: TransferCandidateTxn[],
  pool: TransferCandidateTxn[],
  accountKinds: Map<string, AccountKind>,
  pairHistory: Map<string, number>, // key: sorted "acctA|acctB" → count of confirmed transfers
  options: TransferDetectOptions = {},
): { auto: TransferProposal[]; suggested: TransferProposal[] } {
  const maxDays = options.maxDays ?? 4;
  const autoT = options.autoThreshold ?? 0.7;
  const suggestT = options.suggestThreshold ?? 0.4;

  const scored: TransferProposal[] = [];
  const all = [...fresh, ...pool];
  const freshIds = new Set(fresh.map((t) => t.id));
  for (const a of fresh) {
    if (a.transferId || a.amountCents === 0) continue;
    for (const b of all) {
      if (b.id === a.id || b.transferId) continue;
      if (b.accountId === a.accountId) continue;
      if (b.amountCents !== -a.amountCents) continue;
      // Avoid scoring each fresh/fresh pair twice.
      if (freshIds.has(b.id) && b.id < a.id) continue;
      if (Math.abs(diffDays(a.postedDate, b.postedDate)) > maxDays) continue;
      let score = 0;
      const aT = looksLikeTransfer(a.payeeKey);
      const bT = looksLikeTransfer(b.payeeKey);
      if (aT || bT) score += 0.5;
      if (aT && bT) score += 0.1;
      const pairKey = [a.accountId, b.accountId].sort().join("|");
      if ((pairHistory.get(pairKey) ?? 0) >= 2) score += 0.3;
      const ka = accountKinds.get(a.accountId);
      const kb = accountKinds.get(b.accountId);
      const isLiability = (k?: AccountKind) => k === "credit_card" || k === "loan";
      const isCash = (k?: AccountKind) => k === "checking" || k === "savings";
      if ((isLiability(ka) && isCash(kb)) || (isLiability(kb) && isCash(ka))) score += 0.2;
      if (isCash(ka) && isCash(kb)) score += 0.1;
      if (score < suggestT) continue;
      const out = a.amountCents < 0 ? a : b;
      const inn = a.amountCents < 0 ? b : a;
      scored.push({
        fromTxnId: out.id,
        toTxnId: inn.id,
        score: Math.min(1, Number(score.toFixed(2))),
      });
    }
  }
  scored.sort((x, y) => y.score - x.score);
  const used = new Set<string>();
  const auto: TransferProposal[] = [];
  const suggested: TransferProposal[] = [];
  for (const p of scored) {
    if (used.has(p.fromTxnId) || used.has(p.toTxnId)) continue;
    used.add(p.fromTxnId);
    used.add(p.toTxnId);
    (p.score >= autoT ? auto : suggested).push(p);
  }
  return { auto, suggested };
}

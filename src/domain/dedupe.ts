import { computeFingerprint } from "./fingerprint";
import { diffDays } from "./dates";
import { normalizePayee } from "./payee";
import { payeeSimilarity } from "./similarity";
import type { CandidateTransaction, LabeledCandidate, StoredTransactionLite } from "./types";

export interface DedupeOptions {
  /** Import rows flagged pending instead of skipping them. Default false. */
  importPending?: boolean;
  /** Layer 3 window in days. Default 3. */
  nearDays?: number;
  /** Layer 3 payee similarity threshold. Default 0.85. */
  nearSimilarity?: number;
}

export interface ExistingState {
  /** Stored transactions for the accounts involved, covering at least the file's date range ± nearDays. */
  stored: StoredTransactionLite[];
}

const DEFAULTS: Required<DedupeOptions> = {
  importPending: false,
  nearDays: 3,
  nearSimilarity: 0.85,
};

/**
 * Label every candidate with what will happen to it on commit.
 *
 * Layer 1: external_id (bank-provided) already stored → exact_duplicate
 * Layer 2: (fingerprint) multiset diff against stored counts → exact_duplicate / new with seq
 * Layer 3: same account+amount, date within ±nearDays, similar payee → probable_duplicate (review, default skip)
 *
 * Pure: no I/O. Deterministic given inputs (candidates are processed in sourceRow order).
 */
export function dedupe(
  candidates: CandidateTransaction[],
  existing: ExistingState,
  options: DedupeOptions = {},
): LabeledCandidate[] {
  const opts = { ...DEFAULTS, ...options };
  const stored = existing.stored;

  const storedExternal = new Set<string>();
  const storedFpCount = new Map<string, number>();
  const storedByAccount = new Map<string, StoredTransactionLite[]>();
  for (const s of stored) {
    if (s.externalId) storedExternal.add(`${s.accountId}|${s.externalId}`);
    storedFpCount.set(s.fingerprint, (storedFpCount.get(s.fingerprint) ?? 0) + 1);
    const list = storedByAccount.get(s.accountId) ?? [];
    list.push(s);
    storedByAccount.set(s.accountId, list);
  }

  const ordered = [...candidates].sort((a, b) => a.sourceRow - b.sourceRow);
  const out: LabeledCandidate[] = [];
  const seenExternalInFile = new Set<string>();
  const fileFpSeen = new Map<string, number>(); // fingerprint → how many already handled in this file
  const consumedStored = new Set<string>(); // stored ids matched by a probable duplicate

  for (const c of ordered) {
    const fingerprint = computeFingerprint(c);
    const base = {
      candidate: c,
      fingerprint,
      fingerprintSeq: null as number | null,
      matchedTransactionId: null as string | null,
      similarity: null as number | null,
    };

    // Pending rows are volatile: date, description and amount can all change on posting.
    if (c.isPending && !opts.importPending) {
      out.push({
        ...base,
        status: "pending_skipped",
        reason: "Pending transaction; it will import once posted",
      });
      continue;
    }

    // Layer 1 — bank-provided ID.
    if (c.externalId) {
      const key = `${c.accountId}|${c.externalId}`;
      if (storedExternal.has(key)) {
        out.push({
          ...base,
          status: "exact_duplicate",
          reason: `Bank transaction ID ${c.externalId} already imported`,
        });
        continue;
      }
      if (seenExternalInFile.has(key)) {
        out.push({
          ...base,
          status: "exact_duplicate",
          reason: `Bank transaction ID ${c.externalId} repeated within this file`,
        });
        continue;
      }
      seenExternalInFile.add(key);
    }

    // Layer 2 — fingerprint multiset.
    const kDb = storedFpCount.get(fingerprint) ?? 0;
    const kSeenInFile = fileFpSeen.get(fingerprint) ?? 0;
    fileFpSeen.set(fingerprint, kSeenInFile + 1);
    const ordinal = kSeenInFile + 1; // this is the Nth occurrence in the file
    if (ordinal <= kDb) {
      out.push({
        ...base,
        status: "exact_duplicate",
        reason:
          kDb === 1
            ? "Identical transaction already imported"
            : `Identical transaction already imported (${kDb} on this day)`,
      });
      continue;
    }
    const seq = ordinal; // seq = kDb+1 … kFile, and ordinal runs exactly through that range for the new ones

    // Layer 3 — near duplicate among stored rows with a *different* fingerprint.
    const near = findNear(
      c,
      fingerprint,
      storedByAccount.get(c.accountId) ?? [],
      consumedStored,
      opts,
    );
    if (near) {
      consumedStored.add(near.stored.id);
      out.push({
        ...base,
        status: "probable_duplicate",
        fingerprintSeq: seq,
        reason: near.reason,
        matchedTransactionId: near.stored.id,
        similarity: near.similarity,
      });
      continue;
    }

    out.push({ ...base, status: "new", fingerprintSeq: seq, reason: "Not seen before" });
  }
  return out;
}

function findNear(
  c: CandidateTransaction,
  fingerprint: string,
  stored: StoredTransactionLite[],
  consumed: Set<string>,
  opts: Required<DedupeOptions>,
): { stored: StoredTransactionLite; similarity: number; reason: string } | null {
  const key = normalizePayee(c.payeeRaw);
  let best: { stored: StoredTransactionLite; similarity: number } | null = null;
  for (const s of stored) {
    if (s.amountCents !== c.amountCents) continue;
    if (s.fingerprint === fingerprint) continue; // handled by the multiset rule
    if (consumed.has(s.id)) continue;
    const dd = Math.abs(diffDays(s.postedDate, c.postedDate));
    if (dd > opts.nearDays) continue;
    const sim = payeeSimilarity(key, s.payeeKey || normalizePayee(s.payeeRaw));
    if (sim < opts.nearSimilarity) continue;
    if (!best || sim > best.similarity) best = { stored: s, similarity: sim };
  }
  if (!best) return null;
  const dd = diffDays(best.stored.postedDate, c.postedDate);
  const when =
    dd === 0
      ? "the same day"
      : `${Math.abs(dd)} day${Math.abs(dd) === 1 ? "" : "s"} ${dd > 0 ? "earlier" : "later"}`;
  return {
    ...best,
    reason: `Looks like "${best.stored.payeeRaw}" for the same amount ${when} (${Math.round(best.similarity * 100)}% similar)`,
  };
}

export function summarize(labeled: LabeledCandidate[]) {
  const counts = { new: 0, exact_duplicate: 0, probable_duplicate: 0, pending_skipped: 0 };
  let start: string | null = null;
  let end: string | null = null;
  for (const l of labeled) {
    counts[l.status]++;
    const d = l.candidate.postedDate;
    if (start === null || d < start) start = d;
    if (end === null || d > end) end = d;
  }
  return { counts, coverageStart: start, coverageEnd: end, total: labeled.length };
}

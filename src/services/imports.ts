import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getImportDir } from "@/db/client";
import {
  batchCoverage,
  importBatches,
  transactions,
  transfers,
  type ImportBatch,
} from "@/db/schema";
import { addDays } from "@/domain/dates";
import { dedupe, summarize } from "@/domain/dedupe";
import { displayFromKey, normalizePayee } from "@/domain/payee";
import type { CandidateTransaction, LabeledCandidate, StoredTransactionLite } from "@/domain/types";
import {
  csvProfileSchema,
  type CsvProfileInput,
  type ImportProfileRecord,
} from "@/importers/csv/profile";
import { readHeader } from "@/importers/csv/parse";
import { detectFormat, matchCsvProfile, parseWithProfile } from "@/importers/detect";
import type { ParseIssue, ParsedBalance, ParsedRange, ParsedRow } from "@/importers/types";
import { createAccount, findAccountByLabel, getAccount, updateAccount } from "./accounts";
import { logAudit } from "./audit";
import { resolveCategoryHint } from "./categories";
import { AppError, newId, nowIso } from "./context";
import { createCsvProfile, getProfile, listProfiles } from "./profiles";
import { addSnapshot } from "./reconcile";
import { applyRulesToTransactions } from "./rules";
import { runTransferDetection } from "./transfers";

/** Everything the preview screen needs, persisted on the batch so it survives reloads and crashes. */
export interface StagedPreview {
  version: 1;
  profileId: string | null;
  skipRows: number | null;
  rows: ParsedRow[];
  issues: ParseIssue[];
  accountsInFile: string[];
  balances: ParsedBalance[];
  /** Statement date ranges (OFX); absent on previews staged before ranges were recorded. */
  ranges?: ParsedRange[];
  /** File account label → account id (null = unmapped). */
  accountMap: Record<string, string | null>;
  /** For files with no account labels. */
  singleAccountId: string | null;
  labels: Array<
    Pick<
      LabeledCandidate,
      "status" | "reason" | "matchedTransactionId" | "similarity" | "fingerprintSeq"
    > & { sourceRow: number }
  >;
  /** For needs_profile batches: what the file looks like. */
  headers?: string[];
  sample?: string[][];
}

export interface StageInput {
  fileName: string;
  bytes: Buffer;
  accountId?: string | null;
  profileId?: string | null;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function storeFile(sha: string, fileName: string, bytes: Buffer): string {
  const dir = getImportDir();
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(fileName).toLowerCase() || ".txt";
  const p = path.join(dir, `${sha}${ext}`);
  if (!fs.existsSync(p)) fs.writeFileSync(p, bytes);
  return p;
}

function readStoredFile(batch: ImportBatch): string {
  const dir = getImportDir();
  const match = fs.readdirSync(dir).find((f) => f.startsWith(batch.fileSha256));
  if (!match)
    throw new AppError("The uploaded file is no longer on disk; upload it again", "missing_file");
  return decode(fs.readFileSync(path.join(dir, match)));
}

function decode(bytes: Buffer): string {
  // Strip a UTF-8 BOM; bank exports are ASCII/UTF-8 in practice.
  let text = bytes.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

export function getBatch(db: Db, id: string): ImportBatch {
  const b = db.select().from(importBatches).where(eq(importBatches.id, id)).get();
  if (!b) throw new AppError("Import not found", "not_found");
  return b;
}

export function listBatches(db: Db, limit = 50): ImportBatch[] {
  return db.select().from(importBatches).orderBy(desc(importBatches.createdAt)).limit(limit).all();
}

export function readPreview(batch: ImportBatch): StagedPreview | null {
  return batch.previewJson ? (JSON.parse(batch.previewJson) as StagedPreview) : null;
}

/**
 * Stage 1–6 of the pipeline: hash, detect, parse, normalize, dedupe, and persist a preview.
 * Nothing is written to the ledger.
 */
export function stageImport(db: Db, input: StageInput): ImportBatch {
  const sha = sha256(input.bytes);
  const existing = db.select().from(importBatches).where(eq(importBatches.fileSha256, sha)).get();
  if (existing && existing.status === "committed") {
    throw new AppError(
      `This exact file was already imported on ${existing.committedAt?.slice(0, 10)} (batch ${existing.id.slice(-6)}). Nothing to do.`,
      "duplicate_file",
    );
  }
  if (existing) {
    // A previous preview or rollback of the same file: reuse the row so the hash stays unique.
    db.delete(importBatches).where(eq(importBatches.id, existing.id)).run();
  }
  storeFile(sha, input.fileName, input.bytes);
  const text = decode(input.bytes);
  const ts = nowIso();
  const id = newId();
  const format = detectFormat(text);

  let profile: ImportProfileRecord | null = null;
  let skipRows: number | null = null;
  if (input.profileId) {
    profile = getProfile(db, input.profileId);
    if (profile.format === "csv") {
      const header = readHeader(text, profile.config?.delimiter ?? ",");
      skipRows = header?.headerLineIndex ?? profile.config?.skipRows ?? 0;
    }
  } else if (format === "ofx") {
    profile = getProfile(db, "builtin-ofx");
  } else {
    const m = matchCsvProfile(text, listProfiles(db));
    if (m) {
      profile = m.profile;
      skipRows = m.skipRows;
    }
  }

  if (!profile) {
    const header = readHeader(text);
    const sample = text
      .split(/\r?\n/)
      .slice((header?.headerLineIndex ?? 0) + 1, (header?.headerLineIndex ?? 0) + 6)
      .map((l) => l.split(","));
    const preview: StagedPreview = {
      version: 1,
      profileId: null,
      skipRows: header?.headerLineIndex ?? 0,
      rows: [],
      issues: [],
      accountsInFile: [],
      balances: [],
      ranges: [],
      accountMap: {},
      singleAccountId: input.accountId ?? null,
      labels: [],
      headers: header?.headers ?? [],
      sample,
    };
    db.insert(importBatches)
      .values({
        id,
        accountId: input.accountId ?? null,
        profileId: null,
        fileName: input.fileName,
        fileSha256: sha,
        fileBytes: input.bytes.length,
        format,
        status: "needs_profile",
        previewJson: JSON.stringify(preview),
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    return getBatch(db, id);
  }

  db.insert(importBatches)
    .values({
      id,
      accountId: input.accountId ?? null,
      profileId: profile.id,
      fileName: input.fileName,
      fileSha256: sha,
      fileBytes: input.bytes.length,
      format: profile.format,
      status: "previewed",
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  buildPreview(db, getBatch(db, id), text, profile, skipRows, {
    singleAccountId: input.accountId ?? null,
    accountMap: {},
  });
  return getBatch(db, id);
}

/** For a needs_profile batch: save a new CSV profile from a column mapping and parse with it. */
export function assignProfile(
  db: Db,
  batchId: string,
  profileName: string,
  config: CsvProfileInput,
): ImportBatch {
  const batch = getBatch(db, batchId);
  const profile = createCsvProfile(db, profileName, null, config);
  const text = readStoredFile(batch);
  const prev = readPreview(batch);
  db.update(importBatches)
    .set({ profileId: profile.id, status: "previewed", format: "csv", updatedAt: nowIso() })
    .where(eq(importBatches.id, batchId))
    .run();
  buildPreview(db, getBatch(db, batchId), text, profile, prev?.skipRows ?? null, {
    singleAccountId: prev?.singleAccountId ?? batch.accountId,
    accountMap: {},
  });
  return getBatch(db, batchId);
}

/** Change how file account labels map to accounts (creating accounts if asked), then re-label. */
export function updateAccountMapping(
  db: Db,
  batchId: string,
  mapping: Record<string, string | null>,
  singleAccountId: string | null,
  createNames: Record<
    string,
    { name: string; kind: "checking" | "savings" | "credit_card" | "loan" | "investment" | "other" }
  > = {},
): ImportBatch {
  const batch = getBatch(db, batchId);
  if (batch.status !== "previewed")
    throw new AppError("This import can no longer be changed", "invalid");
  const prev = readPreview(batch);
  if (!prev || !batch.profileId) throw new AppError("Import has no preview", "invalid");
  const accountMap = { ...prev.accountMap, ...mapping };
  for (const [label, spec] of Object.entries(createNames)) {
    if (accountMap[label]) continue;
    const a = createAccount(db, {
      name: spec.name,
      kind: spec.kind,
      onBudget: spec.kind !== "investment",
      currency: "USD",
      openingBalanceCents: 0,
      externalLabel: label,
    });
    accountMap[label] = a.id;
  }
  const profile = getProfile(db, batch.profileId);
  buildPreview(db, batch, readStoredFile(batch), profile, prev.skipRows, {
    singleAccountId,
    accountMap,
  });
  return getBatch(db, batchId);
}

function buildPreview(
  db: Db,
  batch: ImportBatch,
  text: string,
  profile: ImportProfileRecord,
  skipRows: number | null,
  map: { singleAccountId: string | null; accountMap: Record<string, string | null> },
): void {
  const parsed = parseWithProfile(text, profile, skipRows ?? undefined);
  const accountMap: Record<string, string | null> = { ...map.accountMap };
  for (const label of parsed.accountsInFile) {
    if (accountMap[label]) continue;
    const found = findAccountByLabel(db, label);
    accountMap[label] = found?.id ?? null;
  }
  // A single-account file (one label, or no labels) with an explicitly chosen account: that's the mapping.
  let singleAccountId = map.singleAccountId;
  if (
    parsed.accountsInFile.length === 1 &&
    singleAccountId &&
    !accountMap[parsed.accountsInFile[0]!]
  )
    accountMap[parsed.accountsInFile[0]!] = singleAccountId;
  if (parsed.accountsInFile.length === 0 && !singleAccountId && batch.accountId)
    singleAccountId = batch.accountId;

  const rows = parsed.rows.map((r) => ({ ...r, externalId: cleanExternalId(r.externalId) }));
  const labels = labelRows(db, rows, accountMap, singleAccountId);
  const s = summarize(labels.labeled);
  const preview: StagedPreview = {
    version: 1,
    profileId: profile.id,
    skipRows,
    rows,
    issues: parsed.issues,
    accountsInFile: parsed.accountsInFile,
    balances: parsed.balances,
    ranges: parsed.ranges,
    accountMap,
    singleAccountId,
    labels: labels.labeled.map((l) => ({
      sourceRow: l.candidate.sourceRow,
      status: l.status,
      reason: l.reason,
      matchedTransactionId: l.matchedTransactionId,
      similarity: l.similarity,
      fingerprintSeq: l.fingerprintSeq,
    })),
  };
  db.update(importBatches)
    .set({
      profileId: profile.id,
      accountId:
        parsed.accountsInFile.length === 0
          ? singleAccountId
          : parsed.accountsInFile.length === 1
            ? (accountMap[parsed.accountsInFile[0]!] ?? null)
            : null,
      rowCount: rows.length,
      insertedCount: 0,
      exactDuplicateCount: s.counts.exact_duplicate,
      probableDuplicateCount: s.counts.probable_duplicate,
      pendingSkippedCount: s.counts.pending_skipped,
      issueCount: parsed.issues.length,
      coverageStart: s.coverageStart,
      coverageEnd: s.coverageEnd,
      previewJson: JSON.stringify(preview),
      updatedAt: nowIso(),
    })
    .where(eq(importBatches.id, batch.id))
    .run();
}

function cleanExternalId(id: string | null): string | null {
  if (!id) return null;
  const s = id.replace(/^['"\s]+|['"\s]+$/g, "");
  return s.length ? s : null;
}

/** Resolve account ids for rows; rows whose account is unmapped are left with accountId "". */
function resolveRows(
  rows: ParsedRow[],
  accountMap: Record<string, string | null>,
  singleAccountId: string | null,
): CandidateTransaction[] {
  return rows.map((r) => {
    const accountId =
      r.accountLabel != null ? (accountMap[r.accountLabel] ?? "") : (singleAccountId ?? "");
    const { accountLabel: _label, ...rest } = r;
    void _label;
    return { ...rest, accountId };
  });
}

function labelRows(
  db: Db,
  rows: ParsedRow[],
  accountMap: Record<string, string | null>,
  singleAccountId: string | null,
): { candidates: CandidateTransaction[]; labeled: LabeledCandidate[] } {
  const candidates = resolveRows(rows, accountMap, singleAccountId);
  const resolved = candidates.filter((c) => c.accountId !== "");
  const stored = resolved.length ? loadStored(db, resolved) : [];
  const labeled = dedupe(resolved, { stored });
  // Unmapped rows can't be judged yet; surface them as "new" so counts are honest but mark the reason.
  const unmapped = candidates
    .filter((c) => c.accountId === "")
    .map<LabeledCandidate>((c) => ({
      candidate: c,
      fingerprint: "",
      status: "new",
      fingerprintSeq: null,
      reason: "Account not mapped yet",
      matchedTransactionId: null,
      similarity: null,
    }));
  return {
    candidates,
    labeled: [...labeled, ...unmapped].sort(
      (a, b) => a.candidate.sourceRow - b.candidate.sourceRow,
    ),
  };
}

function loadStored(db: Db, candidates: CandidateTransaction[]): StoredTransactionLite[] {
  const accountIds = [...new Set(candidates.map((c) => c.accountId))];
  const min = addDays(
    candidates.reduce((m, c) => (c.postedDate < m ? c.postedDate : m), candidates[0]!.postedDate),
    -5,
  );
  const max = addDays(
    candidates.reduce((m, c) => (c.postedDate > m ? c.postedDate : m), candidates[0]!.postedDate),
    5,
  );
  return db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      postedDate: transactions.postedDate,
      amountCents: transactions.amountCents,
      payeeRaw: transactions.payeeRaw,
      payeeKey: transactions.payeeKey,
      externalId: transactions.externalId,
      fingerprint: transactions.fingerprint,
      fingerprintSeq: transactions.fingerprintSeq,
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.accountId, accountIds),
        isNull(transactions.deletedAt),
        gte(transactions.postedDate, min),
        lte(transactions.postedDate, max),
      ),
    )
    .all();
}

export interface CommitOptions {
  /** sourceRow indexes of probable duplicates (or pending rows) you chose to import anyway. */
  forceRows?: number[];
}

export interface CommitResult {
  batch: ImportBatch;
  inserted: number;
  categorized: number;
  transfersLinked: number;
}

/**
 * Stage 7–8: insert in one transaction, then annotate (hints, rules, transfers, snapshots).
 * Dedupe is recomputed at commit time so a batch committed in between cannot cause double counting.
 */
export function commitBatch(db: Db, batchId: string, opts: CommitOptions = {}): CommitResult {
  const batch = getBatch(db, batchId);
  if (batch.status !== "previewed")
    throw new AppError(
      `Import is ${batch.status.replace("_", " ")}; only previewed imports can be committed`,
      "invalid",
    );
  const prev = readPreview(batch);
  if (!prev) throw new AppError("Import has no preview", "invalid");
  const force = new Set(opts.forceRows ?? []);

  const { labeled } = labelRows(db, prev.rows, prev.accountMap, prev.singleAccountId);
  const unmapped = labeled.filter((l) => l.candidate.accountId === "");
  if (unmapped.length)
    throw new AppError(
      `${unmapped.length} rows belong to an account that isn't mapped yet`,
      "unmapped",
    );

  // Forced pending rows need a fingerprint sequence: relabel them as if importPending were on.
  const forcedPending = labeled.filter(
    (l) => l.status === "pending_skipped" && force.has(l.candidate.sourceRow),
  );
  let forcedPendingLabels: LabeledCandidate[] = [];
  if (forcedPending.length) {
    const stored = loadStored(
      db,
      forcedPending.map((l) => l.candidate),
    );
    forcedPendingLabels = dedupe(
      forcedPending.map((l) => l.candidate),
      { stored },
      { importPending: true },
    ).filter((l) => l.status === "new" || l.status === "probable_duplicate");
  }

  const toInsert = [
    ...labeled.filter(
      (l) =>
        l.status === "new" ||
        (l.status === "probable_duplicate" && force.has(l.candidate.sourceRow)),
    ),
    ...forcedPendingLabels,
  ];
  const ts = nowIso();
  const insertedIds: string[] = [];
  const hinted: Array<{ id: string; hint: string }> = [];

  db.transaction((tx) => {
    for (const l of toInsert) {
      const c = l.candidate;
      const payeeKey = normalizePayee(c.payeeRaw);
      const id = newId();
      tx.insert(transactions)
        .values({
          id,
          accountId: c.accountId,
          batchId,
          postedDate: c.postedDate,
          txnDate: c.txnDate,
          amountCents: c.amountCents,
          currency: c.currency,
          payeeRaw: c.payeeRaw,
          memoRaw: c.memoRaw,
          externalId: c.externalId,
          fingerprint: l.fingerprint,
          fingerprintSeq: l.fingerprintSeq ?? 1,
          payeeKey,
          payeeDisplay: displayFromKey(payeeKey),
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      insertedIds.push(id);
      if (c.categoryHint) hinted.push({ id, hint: c.categoryHint });
    }
    // Coverage is per account: the span of *all* rows in the file for that account, duplicates
    // included, widened by the statement's own date range when the file states one — so a
    // statement with no activity still vouches for its window.
    const byAccount = coverageByAccount(
      labeled,
      prev.ranges ?? [],
      prev.accountMap,
      prev.singleAccountId,
    );
    for (const [accountId, w] of byAccount) {
      tx.insert(batchCoverage)
        .values({ id: newId(), batchId, accountId, coverageStart: w.start, coverageEnd: w.end })
        .run();
    }
    const s = summarize(labeled);
    for (const w of byAccount.values()) {
      if (s.coverageStart === null || w.start < s.coverageStart) s.coverageStart = w.start;
      if (s.coverageEnd === null || w.end > s.coverageEnd) s.coverageEnd = w.end;
    }
    tx.update(importBatches)
      .set({
        status: "committed",
        committedAt: ts,
        insertedCount: toInsert.length,
        exactDuplicateCount: s.counts.exact_duplicate,
        probableDuplicateCount: s.counts.probable_duplicate,
        pendingSkippedCount: s.counts.pending_skipped,
        coverageStart: s.coverageStart,
        coverageEnd: s.coverageEnd,
        updatedAt: ts,
      })
      .where(eq(importBatches.id, batchId))
      .run();
  });

  // Post-commit annotation. Never inserts or deletes transactions.
  for (const h of hinted) {
    const cat = resolveCategoryHint(db, h.hint);
    if (cat)
      db.update(transactions)
        .set({ categoryId: cat.id, updatedAt: ts })
        .where(eq(transactions.id, h.id))
        .run();
  }
  for (const b of prev.balances) {
    const accountId =
      b.accountLabel != null ? prev.accountMap[b.accountLabel] : prev.singleAccountId;
    if (accountId) addSnapshot(db, accountId, b.asOfDate, b.balanceCents, "ofx", batchId);
  }
  // Learn account labels so the next file from this account maps itself.
  for (const [label, accountId] of Object.entries(prev.accountMap)) {
    if (!accountId) continue;
    const a = getAccount(db, accountId);
    if (!a.externalLabel) updateAccount(db, accountId, { externalLabel: label });
  }
  // Override rules (e.g. "Starting Balance" → Ignore) beat file hints; ordinary rules fill in the rest.
  applyRulesToTransactions(
    db,
    hinted.map((h) => h.id),
    { overridesOnly: true },
  );
  const categorized = applyRulesToTransactions(db, insertedIds);
  const { linked } = runTransferDetection(db, insertedIds);
  logAudit(db, "import_batch", batchId, "commit", undefined, {
    inserted: insertedIds.length,
    categorized,
    transfersLinked: linked,
  });
  return {
    batch: getBatch(db, batchId),
    inserted: insertedIds.length,
    categorized,
    transfersLinked: linked,
  };
}

/** Per-account coverage windows: rows' posted dates widened by any statement range for that account. */
export function coverageByAccount(
  labeled: Array<{ candidate: { accountId: string; postedDate: string } }>,
  ranges: ParsedRange[],
  accountMap: Record<string, string | null>,
  singleAccountId: string | null,
): Map<string, { start: string; end: string }> {
  const out = new Map<string, { start: string; end: string }>();
  const widen = (accountId: string, start: string, end: string) => {
    const cur = out.get(accountId);
    if (!cur) out.set(accountId, { start, end });
    else {
      if (start < cur.start) cur.start = start;
      if (end > cur.end) cur.end = end;
    }
  };
  for (const l of labeled)
    widen(l.candidate.accountId, l.candidate.postedDate, l.candidate.postedDate);
  for (const r of ranges) {
    const accountId = r.accountLabel != null ? accountMap[r.accountLabel] : singleAccountId;
    if (accountId) widen(accountId, r.start, r.end);
  }
  return out;
}

/** Remove everything a batch inserted. Annotations on those rows go with them. */
export function rollbackBatch(db: Db, batchId: string): { removed: number } {
  const batch = getBatch(db, batchId);
  if (batch.status !== "committed")
    throw new AppError("Only committed imports can be rolled back", "invalid");
  const rows = db
    .select({ id: transactions.id, transferId: transactions.transferId })
    .from(transactions)
    .where(eq(transactions.batchId, batchId))
    .all();
  const ts = nowIso();
  db.transaction((tx) => {
    const transferIds = rows.map((r) => r.transferId).filter((x): x is string => !!x);
    if (transferIds.length) {
      // The other half of each transfer stays, unlinked and uncategorized again.
      tx.update(transactions)
        .set({ transferId: null, categoryId: null, updatedAt: ts })
        .where(inArray(transactions.transferId, transferIds))
        .run();
      tx.delete(transfers).where(inArray(transfers.id, transferIds)).run();
    }
    tx.delete(transactions).where(eq(transactions.batchId, batchId)).run();
    tx.delete(batchCoverage).where(eq(batchCoverage.batchId, batchId)).run();
    tx.update(importBatches)
      .set({ status: "rolled_back", insertedCount: 0, updatedAt: ts })
      .where(eq(importBatches.id, batchId))
      .run();
  });
  logAudit(db, "import_batch", batchId, "rollback", { removed: rows.length }, undefined);
  return { removed: rows.length };
}

/** Rows a rollback would remove that you have annotated — shown before confirming. */
export function annotatedRowsInBatch(db: Db, batchId: string): number {
  return db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.batchId, batchId), eq(transactions.isReviewed, true)))
    .all().length;
}

export function validateCsvConfig(config: unknown): CsvProfileInput {
  return csvProfileSchema.parse(config);
}

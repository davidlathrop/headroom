import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { dedupe, summarize } from "./dedupe";
import { computeFingerprint } from "./fingerprint";
import { normalizePayee } from "./payee";
import type { CandidateTransaction, StoredTransactionLite } from "./types";

const A = "acct-a";

function cand(p: Partial<CandidateTransaction> & { sourceRow: number }): CandidateTransaction {
  return {
    accountId: A,
    postedDate: "2026-03-04",
    txnDate: "2026-03-04",
    amountCents: -450,
    currency: "USD",
    payeeRaw: "SQ *BLUE BOTTLE",
    memoRaw: "",
    externalId: null,
    isPending: false,
    categoryHint: null,
    ...p,
  };
}

/** Simulate a commit: the labeled rows that would be inserted become stored rows. */
function commit(
  labeled: ReturnType<typeof dedupe>,
  stored: StoredTransactionLite[],
  force = false,
): StoredTransactionLite[] {
  const next = [...stored];
  for (const l of labeled) {
    if (l.status === "new" || (force && l.status === "probable_duplicate")) {
      next.push({
        id: `s${next.length + 1}`,
        accountId: l.candidate.accountId,
        postedDate: l.candidate.postedDate,
        amountCents: l.candidate.amountCents,
        payeeRaw: l.candidate.payeeRaw,
        payeeKey: normalizePayee(l.candidate.payeeRaw),
        externalId: l.candidate.externalId,
        fingerprint: l.fingerprint,
        fingerprintSeq: l.fingerprintSeq!,
      });
    }
  }
  return next;
}

describe("dedupe — layers", () => {
  it("skips pending rows by default, imports them on request", () => {
    const c = [cand({ sourceRow: 0, isPending: true })];
    expect(dedupe(c, { stored: [] })[0]!.status).toBe("pending_skipped");
    expect(dedupe(c, { stored: [] }, { importPending: true })[0]!.status).toBe("new");
  });

  it("L1: a stored bank ID is an exact duplicate regardless of content", () => {
    const stored = commit(dedupe([cand({ sourceRow: 0, externalId: "FIT1" })], { stored: [] }), []);
    const again = dedupe(
      [
        cand({
          sourceRow: 0,
          externalId: "FIT1",
          payeeRaw: "TOTALLY DIFFERENT",
          amountCents: -999,
        }),
      ],
      { stored },
    );
    expect(again[0]!.status).toBe("exact_duplicate");
    expect(again[0]!.reason).toMatch(/FIT1/);
  });

  it("L1: a bank ID repeated within one file is a duplicate", () => {
    const out = dedupe(
      [cand({ sourceRow: 0, externalId: "X" }), cand({ sourceRow: 1, externalId: "X" })],
      { stored: [] },
    );
    expect(out.map((l) => l.status)).toEqual(["new", "exact_duplicate"]);
  });

  it("L2: two identical coffees on one day both import; re-import inserts none; a third inserts one", () => {
    const file2 = [cand({ sourceRow: 0 }), cand({ sourceRow: 1 })];
    const first = dedupe(file2, { stored: [] });
    expect(first.map((l) => l.status)).toEqual(["new", "new"]);
    expect(first.map((l) => l.fingerprintSeq)).toEqual([1, 2]);
    const stored = commit(first, []);

    const again = dedupe(file2, { stored });
    expect(again.map((l) => l.status)).toEqual(["exact_duplicate", "exact_duplicate"]);

    const file3 = [...file2, cand({ sourceRow: 2 })];
    const third = dedupe(file3, { stored });
    expect(third.map((l) => l.status)).toEqual(["exact_duplicate", "exact_duplicate", "new"]);
    expect(third[2]!.fingerprintSeq).toBe(3);
  });

  it("L3: pending→posted description drift is flagged as probable, not inserted, not dropped", () => {
    const stored = commit(
      dedupe(
        [cand({ sourceRow: 0, payeeRaw: "SQ *BLUE BOTTLE COFFEE", postedDate: "2026-03-04" })],
        { stored: [] },
      ),
      [],
    );
    const out = dedupe(
      [cand({ sourceRow: 0, payeeRaw: "SQUARE BLUE BOTTLE COFFEE #12", postedDate: "2026-03-06" })],
      { stored },
    );
    expect(out[0]!.status).toBe("probable_duplicate");
    expect(out[0]!.matchedTransactionId).toBe("s1");
    expect(out[0]!.similarity).toBeGreaterThanOrEqual(0.85);
    expect(out[0]!.fingerprintSeq).toBe(1); // it can still be forced in
  });

  it("L3: does not flag a legitimately different merchant or a different amount", () => {
    const stored = commit(
      dedupe([cand({ sourceRow: 0, payeeRaw: "BLUE BOTTLE COFFEE" })], { stored: [] }),
      [],
    );
    expect(dedupe([cand({ sourceRow: 0, payeeRaw: "PHILZ COFFEE" })], { stored })[0]!.status).toBe(
      "new",
    );
    expect(
      dedupe([cand({ sourceRow: 0, payeeRaw: "BLUE BOTTLE COFFEE", amountCents: -451 })], {
        stored,
      })[0]!.status,
    ).toBe("new");
    expect(
      dedupe([cand({ sourceRow: 0, payeeRaw: "BLUE BOTTLE COFFEE", postedDate: "2026-03-09" })], {
        stored,
      })[0]!.status,
    ).toBe("new");
  });

  it("L3: each stored row can absorb only one probable duplicate", () => {
    const stored = commit(
      dedupe([cand({ sourceRow: 0, payeeRaw: "BLUE BOTTLE COFFEE" })], { stored: [] }),
      [],
    );
    const out = dedupe(
      [
        cand({ sourceRow: 0, payeeRaw: "BLUE BOTTLE CAFE", postedDate: "2026-03-05" }),
        cand({ sourceRow: 1, payeeRaw: "BLUE BOTTLE CAFE", postedDate: "2026-03-05" }),
      ],
      { stored },
    );
    expect(out.map((l) => l.status)).toEqual(["probable_duplicate", "new"]);
  });

  it("is scoped per account: the same content in another account is new", () => {
    const stored = commit(dedupe([cand({ sourceRow: 0 })], { stored: [] }), []);
    expect(dedupe([cand({ sourceRow: 0, accountId: "acct-b" })], { stored })[0]!.status).toBe(
      "new",
    );
  });

  it("summarize counts and coverage", () => {
    const s = summarize(
      dedupe(
        [
          cand({ sourceRow: 0, postedDate: "2026-03-01" }),
          cand({ sourceRow: 1, postedDate: "2026-03-09", isPending: true }),
        ],
        { stored: [] },
      ),
    );
    expect(s.counts).toEqual({
      new: 1,
      exact_duplicate: 0,
      probable_duplicate: 0,
      pending_skipped: 1,
    });
    expect(s.coverageStart).toBe("2026-03-01");
    expect(s.coverageEnd).toBe("2026-03-09");
  });
});

describe("dedupe — properties", () => {
  const payees = [
    "BLUE BOTTLE",
    "SAFEWAY #1234",
    "NETFLIX.COM",
    "ACME PAYROLL",
    "SHELL OIL",
    "AMZN MKTP",
  ];
  const arbCandidate = fc
    .record({
      day: fc.integer({ min: 1, max: 28 }),
      amount: fc.integer({ min: -20000, max: 20000 }).filter((n) => n !== 0),
      payee: fc.constantFrom(...payees),
      ext: fc.option(fc.integer({ min: 1, max: 40 }), { nil: null }),
    })
    .map(({ day, amount, payee, ext }) =>
      cand({
        sourceRow: 0,
        postedDate: `2026-03-${String(day).padStart(2, "0")}`,
        amountCents: amount,
        payeeRaw: payee,
        externalId: ext == null ? null : `E${ext}`,
      }),
    );
  const arbFile = fc
    .array(arbCandidate, { minLength: 0, maxLength: 25 })
    .map((rows) => rows.map((r, i) => ({ ...r, sourceRow: i })));

  const insertedKeys = (stored: StoredTransactionLite[]) =>
    stored.map((s) => `${s.fingerprint}#${s.fingerprintSeq}`).sort();

  it("idempotence: import(F); import(F) inserts nothing the second time", () => {
    fc.assert(
      fc.property(arbFile, (file) => {
        const stored = commit(dedupe(file, { stored: [] }), []);
        const again = dedupe(file, { stored });
        return again.every((l) => l.status !== "new");
      }),
    );
  });

  it("coverage-additive: import(A); import(B) == import(A ∪ B) for overlapping halves", () => {
    fc.assert(
      fc.property(arbFile, fc.integer({ min: 0, max: 25 }), (file, cut) => {
        const k = Math.min(cut, file.length);
        // A = first k rows plus some of the rest; B = rows from k/2 onward → overlapping
        const a = file.slice(0, k);
        const b = file.slice(Math.floor(k / 2)).map((r, i) => ({ ...r, sourceRow: i }));
        const sequential = commit(
          dedupe(b, { stored: commit(dedupe(a, { stored: [] }), []) }),
          commit(dedupe(a, { stored: [] }), []),
        );
        const union = commit(dedupe(file, { stored: [] }), []);
        // Rows that were only flagged probable are not inserted in either path; compare the multiset of inserted rows.
        return JSON.stringify(insertedKeys(sequential)) === JSON.stringify(insertedKeys(union));
      }),
    );
  });

  it("n identical rows insert n; the same n again insert 0; n+1 inserts exactly 1", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (n) => {
        const rows = Array.from({ length: n }, (_, i) => cand({ sourceRow: i }));
        const first = dedupe(rows, { stored: [] });
        const stored = commit(first, []);
        const again = dedupe(rows, { stored });
        const more = dedupe([...rows, cand({ sourceRow: n })], { stored });
        return (
          first.filter((l) => l.status === "new").length === n &&
          again.filter((l) => l.status === "new").length === 0 &&
          more.filter((l) => l.status === "new").length === 1
        );
      }),
    );
  });

  it("a stored external_id is never inserted again", () => {
    fc.assert(
      fc.property(arbFile, (file) => {
        const stored = commit(dedupe(file, { stored: [] }), []);
        const ids = new Set(stored.filter((s) => s.externalId).map((s) => s.externalId));
        const mutated = file.map((c, i) => ({
          ...c,
          payeeRaw: c.payeeRaw + " X",
          amountCents: c.amountCents - 1,
          sourceRow: i,
        }));
        return dedupe(mutated, { stored }).every(
          (l) => !(l.candidate.externalId && ids.has(l.candidate.externalId) && l.status === "new"),
        );
      }),
    );
  });

  it("fingerprint is stable and independent of whitespace/case in the payee", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 30 }), (p) => {
        const a = computeFingerprint({
          accountId: A,
          postedDate: "2026-03-04",
          amountCents: -100,
          payeeRaw: p,
        });
        const b = computeFingerprint({
          accountId: A,
          postedDate: "2026-03-04",
          amountCents: -100,
          payeeRaw: `  ${p.toLowerCase()}  `,
        });
        return a === b;
      }),
    );
  });
});

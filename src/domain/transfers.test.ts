import { describe, expect, it } from "vitest";
import { detectTransfers, type TransferCandidateTxn } from "./transfers";
import type { AccountKind } from "./types";

const kinds = new Map<string, AccountKind>([
  ["chk", "checking"],
  ["sav", "savings"],
  ["cc", "credit_card"],
]);

function t(
  p: Partial<TransferCandidateTxn> & { id: string; accountId: string; amountCents: number },
): TransferCandidateTxn {
  return { postedDate: "2026-03-05", payeeKey: "", transferId: null, ...p };
}

describe("detectTransfers", () => {
  it("auto-links a card payment from checking", () => {
    const fresh = [
      t({ id: "a", accountId: "chk", amountCents: -240000, payeeKey: "PAYMENT TO CHASE CARD" }),
    ];
    const pool = [
      t({
        id: "b",
        accountId: "cc",
        amountCents: 240000,
        postedDate: "2026-03-07",
        payeeKey: "AUTOMATIC PAYMENT - THANK YOU",
      }),
    ];
    const { auto, suggested } = detectTransfers(fresh, pool, kinds, new Map());
    expect(auto).toEqual([{ fromTxnId: "a", toTxnId: "b", score: 0.8 }]);
    expect(suggested).toEqual([]);
  });

  it("only suggests when the evidence is weak", () => {
    const fresh = [t({ id: "a", accountId: "chk", amountCents: -5000, payeeKey: "SOMETHING" })];
    const pool = [t({ id: "b", accountId: "sav", amountCents: 5000, payeeKey: "SOMETHING ELSE" })];
    const { auto, suggested } = detectTransfers(fresh, pool, kinds, new Map(), {
      suggestThreshold: 0.1,
    });
    expect(auto).toEqual([]);
    expect(suggested[0]!.score).toBe(0.1);
  });

  it("ignores same-account, wrong-amount, out-of-window, and already-linked rows", () => {
    const fresh = [t({ id: "a", accountId: "chk", amountCents: -100, payeeKey: "TRANSFER" })];
    const pool = [
      t({ id: "same", accountId: "chk", amountCents: 100, payeeKey: "TRANSFER" }),
      t({ id: "amt", accountId: "sav", amountCents: 101, payeeKey: "TRANSFER" }),
      t({
        id: "late",
        accountId: "sav",
        amountCents: 100,
        postedDate: "2026-03-20",
        payeeKey: "TRANSFER",
      }),
      t({
        id: "linked",
        accountId: "sav",
        amountCents: 100,
        payeeKey: "TRANSFER",
        transferId: "x",
      }),
    ];
    expect(detectTransfers(fresh, pool, kinds, new Map()).auto).toEqual([]);
  });

  it("uses each transaction at most once and prefers the best score", () => {
    const fresh = [
      t({ id: "a", accountId: "chk", amountCents: -100, payeeKey: "TRANSFER TO SAVINGS" }),
    ];
    const pool = [
      t({ id: "weak", accountId: "sav", amountCents: 100, payeeKey: "DEPOSIT" }),
      t({ id: "strong", accountId: "sav", amountCents: 100, payeeKey: "TRANSFER FROM CHECKING" }),
    ];
    const hist = new Map([["chk|sav", 5]]);
    const { auto } = detectTransfers(fresh, pool, kinds, hist);
    expect(auto).toHaveLength(1);
    expect(auto[0]!.toTxnId).toBe("strong");
  });
});

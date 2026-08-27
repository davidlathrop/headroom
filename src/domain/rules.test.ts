import { describe, expect, it } from "vitest";
import { applyRules, type CategoryRule } from "./rules";

function rule(
  p: Partial<CategoryRule> & { id: string; pattern: string; setCategoryId: string },
): CategoryRule {
  return {
    priority: 100,
    matchField: "payee_key",
    matchType: "contains",
    amountMinCents: null,
    amountMaxCents: null,
    accountId: null,
    setPayeeDisplay: null,
    enabled: true,
    ...p,
  };
}
const subject = {
  accountId: "chk",
  amountCents: -1200,
  payeeKey: "NETFLIX.COM",
  payeeRaw: "Netflix.com 866-579-7172",
  memoRaw: "",
};

describe("applyRules", () => {
  it("first match by priority wins", () => {
    const rules = [
      rule({ id: "b", pattern: "NETFLIX", setCategoryId: "sub", priority: 50 }),
      rule({ id: "a", pattern: "NET", setCategoryId: "other", priority: 10 }),
    ];
    expect(applyRules(rules, subject)?.categoryId).toBe("other");
  });
  it("respects disabled, account, amount range, exact, regex", () => {
    expect(
      applyRules(
        [rule({ id: "x", pattern: "NETFLIX", setCategoryId: "c", enabled: false })],
        subject,
      ),
    ).toBeNull();
    expect(
      applyRules(
        [rule({ id: "x", pattern: "NETFLIX", setCategoryId: "c", accountId: "cc" })],
        subject,
      ),
    ).toBeNull();
    expect(
      applyRules(
        [rule({ id: "x", pattern: "NETFLIX", setCategoryId: "c", amountMinCents: -1000 })],
        subject,
      ),
    ).toBeNull();
    expect(
      applyRules(
        [
          rule({
            id: "x",
            pattern: "NETFLIX",
            setCategoryId: "c",
            amountMinCents: -2000,
            amountMaxCents: -1000,
          }),
        ],
        subject,
      )?.categoryId,
    ).toBe("c");
    expect(
      applyRules(
        [rule({ id: "x", pattern: "netflix.com", setCategoryId: "c", matchType: "exact" })],
        subject,
      )?.categoryId,
    ).toBe("c");
    expect(
      applyRules(
        [rule({ id: "x", pattern: "^net.*\\.com$", setCategoryId: "c", matchType: "regex" })],
        subject,
      )?.categoryId,
    ).toBe("c");
    expect(
      applyRules(
        [rule({ id: "x", pattern: "(", setCategoryId: "c", matchType: "regex" })],
        subject,
      ),
    ).toBeNull();
    expect(
      applyRules(
        [rule({ id: "x", pattern: "866-579", setCategoryId: "c", matchField: "payee_raw" })],
        subject,
      )?.categoryId,
    ).toBe("c");
  });
});

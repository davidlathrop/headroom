import type { Cents } from "./types";

export type MatchField = "payee_key" | "payee_raw" | "memo";
export type MatchType = "contains" | "exact" | "regex";

export interface CategoryRule {
  id: string;
  priority: number;
  matchField: MatchField;
  matchType: MatchType;
  pattern: string;
  amountMinCents: Cents | null;
  amountMaxCents: Cents | null;
  accountId: string | null;
  setCategoryId: string;
  setPayeeDisplay: string | null;
  enabled: boolean;
}

export interface RuleSubject {
  accountId: string;
  amountCents: Cents;
  payeeKey: string;
  payeeRaw: string;
  memoRaw: string;
}

export interface RuleOutcome {
  ruleId: string;
  categoryId: string;
  payeeDisplay: string | null;
}

const regexCache = new Map<string, RegExp | null>();

function compileRegex(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern)!;
  let re: RegExp | null = null;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    re = null;
  }
  regexCache.set(pattern, re);
  return re;
}

export function ruleMatches(rule: CategoryRule, t: RuleSubject): boolean {
  if (!rule.enabled) return false;
  if (rule.accountId && rule.accountId !== t.accountId) return false;
  if (rule.amountMinCents != null && t.amountCents < rule.amountMinCents) return false;
  if (rule.amountMaxCents != null && t.amountCents > rule.amountMaxCents) return false;
  const subject =
    rule.matchField === "payee_key"
      ? t.payeeKey
      : rule.matchField === "payee_raw"
        ? t.payeeRaw
        : t.memoRaw;
  const hay = subject.toUpperCase();
  const needle = rule.pattern.toUpperCase();
  switch (rule.matchType) {
    case "exact":
      return hay === needle;
    case "contains":
      return needle.length > 0 && hay.includes(needle);
    case "regex": {
      const re = compileRegex(rule.pattern);
      return re ? re.test(subject) : false;
    }
  }
}

/** First enabled rule by ascending priority that matches wins. */
export function applyRules(rules: CategoryRule[], t: RuleSubject): RuleOutcome | null {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const r of sorted) {
    if (ruleMatches(r, t))
      return { ruleId: r.id, categoryId: r.setCategoryId, payeeDisplay: r.setPayeeDisplay };
  }
  return null;
}

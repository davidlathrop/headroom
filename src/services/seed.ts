import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { categories, categoryRules, importProfiles } from "@/db/schema";
import { BUILTIN_PROFILES } from "@/importers/csv/builtins";
import type { Flow, SpendType } from "@/domain/types";
import { nowIso } from "./context";

interface SeedCategory {
  id: string;
  name: string;
  flow: Flow;
  spendType?: SpendType;
  children?: Array<{ id: string; name: string; spendType?: SpendType; flow?: Flow }>;
  isSystem?: boolean;
}

/** Deterministic ids so rules, tests and docs can refer to them. */
export const SEED_CATEGORIES: SeedCategory[] = [
  {
    id: "cat-income",
    name: "Income",
    flow: "income",
    children: [
      { id: "cat-income-salary", name: "Salary" },
      { id: "cat-income-bonus", name: "Bonus" },
      { id: "cat-income-interest", name: "Interest" },
      { id: "cat-income-reimbursement", name: "Reimbursement" },
      { id: "cat-income-other", name: "Other income" },
    ],
  },
  {
    id: "cat-housing",
    name: "Housing",
    flow: "expense",
    spendType: "fixed",
    children: [
      { id: "cat-housing-rent", name: "Rent / Mortgage", spendType: "fixed" },
      { id: "cat-housing-utilities", name: "Utilities", spendType: "fixed" },
      { id: "cat-housing-internet", name: "Internet & Phone", spendType: "fixed" },
      { id: "cat-housing-insurance", name: "Home Insurance", spendType: "fixed" },
      { id: "cat-housing-maintenance", name: "Home Maintenance", spendType: "variable" },
    ],
  },
  {
    id: "cat-transport",
    name: "Transport",
    flow: "expense",
    spendType: "variable",
    children: [
      { id: "cat-transport-fuel", name: "Fuel", spendType: "variable" },
      { id: "cat-transport-car-payment", name: "Car Payment", spendType: "fixed" },
      { id: "cat-transport-insurance", name: "Car Insurance", spendType: "fixed" },
      { id: "cat-transport-transit", name: "Transit & Rideshare", spendType: "variable" },
      { id: "cat-transport-maintenance", name: "Car Maintenance", spendType: "variable" },
      { id: "cat-transport-parking", name: "Parking & Tolls", spendType: "variable" },
    ],
  },
  {
    id: "cat-food",
    name: "Food",
    flow: "expense",
    spendType: "variable",
    children: [
      { id: "cat-food-groceries", name: "Groceries", spendType: "variable" },
      { id: "cat-food-dining", name: "Dining Out", spendType: "variable" },
      { id: "cat-food-coffee", name: "Coffee", spendType: "variable" },
    ],
  },
  {
    id: "cat-health",
    name: "Health",
    flow: "expense",
    spendType: "variable",
    children: [
      { id: "cat-health-medical", name: "Medical", spendType: "variable" },
      { id: "cat-health-pharmacy", name: "Pharmacy", spendType: "variable" },
      { id: "cat-health-fitness", name: "Fitness", spendType: "fixed" },
      { id: "cat-health-insurance", name: "Health Insurance", spendType: "fixed" },
    ],
  },
  {
    id: "cat-subscriptions",
    name: "Subscriptions",
    flow: "expense",
    spendType: "fixed",
    children: [
      { id: "cat-subscriptions-streaming", name: "Streaming", spendType: "fixed" },
      { id: "cat-subscriptions-software", name: "Software", spendType: "fixed" },
      { id: "cat-subscriptions-other", name: "Other Subscriptions", spendType: "fixed" },
    ],
  },
  {
    id: "cat-lifestyle",
    name: "Lifestyle",
    flow: "expense",
    spendType: "variable",
    children: [
      { id: "cat-lifestyle-shopping", name: "Shopping", spendType: "variable" },
      { id: "cat-lifestyle-clothing", name: "Clothing", spendType: "variable" },
      { id: "cat-lifestyle-travel", name: "Travel", spendType: "variable" },
      { id: "cat-lifestyle-gifts", name: "Gifts & Donations", spendType: "variable" },
      { id: "cat-lifestyle-personal", name: "Personal Care", spendType: "variable" },
      { id: "cat-lifestyle-entertainment", name: "Entertainment", spendType: "variable" },
      { id: "cat-lifestyle-education", name: "Education", spendType: "variable" },
      { id: "cat-lifestyle-pets", name: "Pets", spendType: "variable" },
      { id: "cat-lifestyle-kids", name: "Kids", spendType: "variable" },
    ],
  },
  {
    id: "cat-financial",
    name: "Financial",
    flow: "expense",
    spendType: "variable",
    children: [
      { id: "cat-financial-fees", name: "Fees & Interest", spendType: "variable" },
      { id: "cat-financial-taxes", name: "Taxes", spendType: "variable" },
      { id: "cat-financial-cash", name: "Cash & ATM", spendType: "variable" },
    ],
  },
  {
    id: "cat-saving",
    name: "Saving",
    flow: "saving",
    children: [
      { id: "cat-saving-brokerage", name: "Brokerage" },
      { id: "cat-saving-retirement", name: "Retirement" },
      { id: "cat-saving-emergency", name: "Emergency Fund" },
    ],
  },
  { id: "cat-transfer", name: "Transfer", flow: "transfer", isSystem: true },
  { id: "cat-ignore", name: "Ignore", flow: "ignore", isSystem: true },
];

const SEED_RULES: Array<{
  id: string;
  matchField: "payee_key" | "payee_raw" | "memo";
  matchType: "contains" | "exact" | "regex";
  pattern: string;
  categoryId: string;
  display?: string;
  priority?: number;
}> = [
  {
    id: "rule-starting-balance",
    matchField: "payee_raw",
    matchType: "regex",
    pattern: "^(Starting|Opening|Beginning) Balance",
    categoryId: "cat-ignore",
    priority: 1,
  },
  {
    id: "rule-interest",
    matchField: "payee_key",
    matchType: "regex",
    pattern: "\\bINTEREST (PAID|PAYMENT|EARNED|CREDIT)\\b",
    categoryId: "cat-income-interest",
    priority: 20,
  },
  {
    id: "rule-payroll",
    matchField: "payee_key",
    matchType: "regex",
    pattern: "\\b(PAYROLL|DIRECT DEP|DIRECTDEP|SALARY|DIR DEP)\\b",
    categoryId: "cat-income-salary",
    priority: 20,
  },
  {
    id: "rule-netflix",
    matchField: "payee_key",
    matchType: "contains",
    pattern: "NETFLIX",
    categoryId: "cat-subscriptions-streaming",
    display: "Netflix",
  },
  {
    id: "rule-spotify",
    matchField: "payee_key",
    matchType: "contains",
    pattern: "SPOTIFY",
    categoryId: "cat-subscriptions-streaming",
    display: "Spotify",
  },
  {
    id: "rule-atm",
    matchField: "payee_key",
    matchType: "regex",
    pattern: "\\bATM\\b",
    categoryId: "cat-financial-cash",
  },
  {
    id: "rule-fee",
    matchField: "payee_key",
    matchType: "regex",
    pattern: "\\b(FEE|INTEREST CHARGE|LATE CHARGE)\\b",
    categoryId: "cat-financial-fees",
  },
  {
    id: "rule-amazon",
    matchField: "payee_key",
    matchType: "regex",
    pattern: "^(AMZN|AMAZON)",
    categoryId: "cat-lifestyle-shopping",
    display: "Amazon",
  },
  {
    id: "rule-uber",
    matchField: "payee_key",
    matchType: "regex",
    pattern: "^(UBER|LYFT)\\b(?! EATS)",
    categoryId: "cat-transport-transit",
  },
  {
    id: "rule-fuel",
    matchField: "payee_key",
    matchType: "regex",
    pattern: "\\b(SHELL|CHEVRON|EXXON|MOBIL|ARCO|76|BP|VALERO|SUNOCO|CIRCLE K)\\b",
    categoryId: "cat-transport-fuel",
  },
  {
    id: "rule-groceries",
    matchField: "payee_key",
    matchType: "regex",
    pattern:
      "\\b(SAFEWAY|WHOLEFDS|WHOLE FOODS|TRADER JOE|KROGER|COSTCO|ALDI|PUBLIX|WEGMANS|SPROUTS|H-E-B|HEB|ALBERTSONS)\\b",
    categoryId: "cat-food-groceries",
  },
  {
    id: "rule-coffee",
    matchField: "payee_key",
    matchType: "regex",
    pattern: "\\b(STARBUCKS|BLUE BOTTLE|PEET|PHILZ|DUNKIN|COFFEE)\\b",
    categoryId: "cat-food-coffee",
  },
  {
    id: "rule-rent",
    matchField: "payee_key",
    matchType: "regex",
    pattern: "\\b(RENT|MORTGAGE|APARTMENTS|PROPERTY MGMT|PROPERTY MANAGEMENT)\\b",
    categoryId: "cat-housing-rent",
  },
  {
    id: "rule-utilities",
    matchField: "payee_key",
    matchType: "regex",
    pattern:
      "\\b(PG&E|PGE|CON ED|CONED|COMED|DUKE ENERGY|ELECTRIC|UTILITY|UTILITIES|WATER DIST|GAS CO|SDG&E|SOCALGAS|NATIONAL GRID|XCEL)\\b",
    categoryId: "cat-housing-utilities",
  },
  {
    id: "rule-internet",
    matchField: "payee_key",
    matchType: "regex",
    pattern:
      "\\b(COMCAST|XFINITY|VERIZON|AT&T|T-MOBILE|TMOBILE|SPECTRUM|GOOGLE FIBER|MINT MOBILE)\\b",
    categoryId: "cat-housing-internet",
  },
  {
    id: "rule-brokerage",
    matchField: "payee_key",
    matchType: "regex",
    pattern:
      "\\b(BROKERAGE|VANGUARD|FIDELITY|SCHWAB|ROBINHOOD|BETTERMENT|WEALTHFRONT|ETRADE|M1 FINANCE)\\b",
    categoryId: "cat-saving-brokerage",
  },
  {
    id: "rule-dining",
    matchField: "payee_key",
    matchType: "regex",
    pattern:
      "\\b(RESTAURANT|PIZZA|SUSHI|TACO|BURGER|CAFE|BISTRO|GRILL|DOORDASH|GRUBHUB|UBER EATS)\\b",
    categoryId: "cat-food-dining",
  },
];

/** Idempotent: safe to run on every boot. */
export function ensureSeeded(db: Db): void {
  const ts = nowIso();
  const count =
    db
      .select({ n: sql<number>`count(*)` })
      .from(categories)
      .get()?.n ?? 0;
  if (count === 0) {
    let sort = 0;
    for (const c of SEED_CATEGORIES) {
      db.insert(categories)
        .values({
          id: c.id,
          parentId: null,
          name: c.name,
          flow: c.flow,
          spendType: c.spendType ?? null,
          sortOrder: sort++,
          isSystem: c.isSystem ?? false,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      for (const ch of c.children ?? []) {
        db.insert(categories)
          .values({
            id: ch.id,
            parentId: c.id,
            name: ch.name,
            flow: ch.flow ?? c.flow,
            spendType: ch.spendType ?? c.spendType ?? null,
            sortOrder: sort++,
            isSystem: false,
            createdAt: ts,
            updatedAt: ts,
          })
          .run();
      }
    }
    for (const r of SEED_RULES) {
      db.insert(categoryRules)
        .values({
          id: r.id,
          priority: r.priority ?? 100,
          matchField: r.matchField,
          matchType: r.matchType,
          pattern: r.pattern,
          setCategoryId: r.categoryId,
          setPayeeDisplay: r.display ?? null,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
    }
  }
  // Built-in profiles are upserted so new ones appear after upgrades.
  for (const p of BUILTIN_PROFILES) {
    const existing = db
      .select({ id: importProfiles.id })
      .from(importProfiles)
      .where(eq(importProfiles.id, p.id))
      .get();
    const row = {
      name: p.name,
      format: p.format,
      institution: p.institution,
      configJson: p.config ? JSON.stringify(p.config) : null,
      isBuiltin: true,
      updatedAt: ts,
    };
    if (existing) db.update(importProfiles).set(row).where(eq(importProfiles.id, p.id)).run();
    else
      db.insert(importProfiles)
        .values({ id: p.id, ...row, createdAt: ts })
        .run();
  }
}

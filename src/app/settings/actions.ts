"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseCents } from "@/domain/money";
import { FLOWS, SPEND_TYPES } from "@/domain/types";
import { archiveCategory, createCategory } from "@/services/categories";
import { getDb } from "@/services/context";
import { deleteProfile } from "@/services/profiles";
import { applyRulesToTransactions, createRule, deleteRule } from "@/services/rules";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
function refresh() {
  for (const p of ["/", "/settings", "/transactions", "/months"]) revalidatePath(p);
}

export async function createCategoryAction(fd: FormData) {
  const db = getDb();
  createCategory(db, {
    name: str(fd, "name"),
    parentId: str(fd, "parentId") || null,
    flow: z.enum(FLOWS).parse(str(fd, "flow")),
    spendType: z.enum(SPEND_TYPES).catch("variable").parse(str(fd, "spendType")),
  });
  refresh();
}

export async function archiveCategoryAction(fd: FormData) {
  archiveCategory(getDb(), str(fd, "id"));
  refresh();
}

export async function createRuleAction(fd: FormData) {
  const db = getDb();
  const min = str(fd, "amountMin");
  const max = str(fd, "amountMax");
  createRule(db, {
    priority: Number(str(fd, "priority") || "100"),
    matchField: z.enum(["payee_key", "payee_raw", "memo"]).parse(str(fd, "matchField")),
    matchType: z.enum(["contains", "exact", "regex"]).parse(str(fd, "matchType")),
    pattern: str(fd, "pattern"),
    amountMinCents: min ? parseCents(min) : null,
    amountMaxCents: max ? parseCents(max) : null,
    accountId: str(fd, "accountId") || null,
    setCategoryId: str(fd, "setCategoryId"),
    setPayeeDisplay: str(fd, "setPayeeDisplay") || null,
    enabled: true,
  });
  applyRulesToTransactions(db, null);
  refresh();
}

export async function deleteRuleAction(fd: FormData) {
  deleteRule(getDb(), str(fd, "id"));
  refresh();
}

export async function applyRulesAction() {
  applyRulesToTransactions(getDb(), null);
  refresh();
}

export async function deleteProfileAction(fd: FormData) {
  deleteProfile(getDb(), str(fd, "id"));
  revalidatePath("/settings");
  revalidatePath("/import");
}

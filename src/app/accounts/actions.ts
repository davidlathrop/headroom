"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseCents } from "@/domain/money";
import { ACCOUNT_KINDS } from "@/domain/types";
import { archiveAccount, createAccount, updateAccount } from "@/services/accounts";
import { getDb } from "@/services/context";
import { addSnapshot } from "@/services/reconcile";
import { setPaymentCategory } from "@/services/transfers";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function createAccountAction(fd: FormData) {
  const db = getDb();
  const opening = parseCents(str(fd, "openingBalance") || "0") ?? 0;
  createAccount(db, {
    name: str(fd, "name"),
    institution: str(fd, "institution") || null,
    kind: z.enum(ACCOUNT_KINDS).parse(str(fd, "kind")),
    onBudget: fd.get("onBudget") === "on",
    currency: "USD",
    openingBalanceCents: opening,
    openingBalanceDate: str(fd, "openingBalanceDate") || null,
    externalLabel: str(fd, "externalLabel") || null,
  });
  revalidatePath("/accounts");
  revalidatePath("/");
}

export async function archiveAccountAction(fd: FormData) {
  archiveAccount(getDb(), str(fd, "id"));
  revalidatePath("/accounts");
}

export async function toggleOnBudgetAction(fd: FormData) {
  updateAccount(getDb(), str(fd, "id"), { onBudget: str(fd, "onBudget") === "1" });
  revalidatePath("/accounts");
  revalidatePath("/");
}

export async function addSnapshotAction(fd: FormData) {
  const cents = parseCents(str(fd, "balance"));
  const date = str(fd, "asOfDate");
  if (cents == null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  addSnapshot(getDb(), str(fd, "id"), date, cents, "statement");
  revalidatePath("/accounts");
  revalidatePath("/");
}

export async function setPaymentCategoryAction(fd: FormData) {
  setPaymentCategory(getDb(), str(fd, "id"), str(fd, "paymentCategoryId") || null);
  for (const p of [
    "/",
    "/accounts",
    "/transactions",
    "/months",
    "/budgets",
    "/trends",
    "/forecast",
  ])
    revalidatePath(p);
}

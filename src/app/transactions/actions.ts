"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/services/context";
import { setCategory, setOutlier, setPayeeDisplay } from "@/services/transactions";
import { linkTransfer, unlinkTransfer } from "@/services/transfers";

function refresh() {
  for (const p of [
    "/",
    "/transactions",
    "/months",
    "/accounts",
    "/trends",
    "/forecast",
    "/budgets",
  ])
    revalidatePath(p);
}

export async function setCategoryAction(
  txnId: string,
  categoryId: string | null,
  always: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    setCategory(getDb(), txnId, categoryId, { alwaysForPayee: always });
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function renamePayeeAction(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  const name = String(fd.get("payeeDisplay") ?? "").trim();
  if (id && name) setPayeeDisplay(getDb(), id, name);
  refresh();
}

export async function linkTransferAction(fd: FormData) {
  const a = String(fd.get("id") ?? "");
  const b = String(fd.get("otherId") ?? "");
  if (a && b) linkTransfer(getDb(), a, b, "user");
  refresh();
}

export async function unlinkTransferAction(fd: FormData) {
  const id = String(fd.get("transferId") ?? "");
  if (id) unlinkTransfer(getDb(), id);
  refresh();
}

export async function setOutlierAction(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  if (id) setOutlier(getDb(), id, String(fd.get("isOutlier")) === "1");
  refresh();
}

"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { BudgetItem } from "@/domain/budget";
import { parseCents } from "@/domain/money";
import { createBudget, deleteBudget, updateBudget } from "@/services/budgets";
import { getDb } from "@/services/context";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Ticked categories plus their optional monthly targets (`target:<categoryId>`). */
function readItems(fd: FormData): BudgetItem[] {
  return fd
    .getAll("category")
    .map(String)
    .filter(Boolean)
    .map((categoryId) => {
      const raw = str(fd, `target:${categoryId}`);
      const cents = raw === "" ? null : parseCents(raw);
      return { categoryId, targetCents: cents == null ? null : Math.abs(cents) };
    });
}

function refresh(id?: string) {
  revalidatePath("/");
  revalidatePath("/budgets");
  if (id) revalidatePath(`/budgets/${id}`);
}

export async function createBudgetAction(fd: FormData) {
  let id: string;
  try {
    id = createBudget(getDb(), {
      name: str(fd, "name"),
      note: str(fd, "note"),
      items: readItems(fd),
    }).id;
  } catch (e) {
    redirect("/budgets?error=" + encodeURIComponent(message(e)));
  }
  refresh(id);
  redirect(`/budgets/${id}`);
}

export async function updateBudgetAction(fd: FormData) {
  const id = str(fd, "id");
  const month = str(fd, "month");
  try {
    updateBudget(getDb(), id, {
      name: str(fd, "name"),
      note: str(fd, "note"),
      items: readItems(fd),
    });
  } catch (e) {
    redirect(`/budgets/${id}?month=${month}&edit=1&error=` + encodeURIComponent(message(e)));
  }
  refresh(id);
  redirect(`/budgets/${id}?month=${month}`);
}

export async function deleteBudgetAction(fd: FormData) {
  deleteBudget(getDb(), str(fd, "id"));
  refresh();
  redirect("/budgets");
}

function message(e: unknown): string {
  // Zod reports its issues as JSON; keep only the human part.
  const m = (e as Error).message;
  try {
    const issues = JSON.parse(m) as Array<{ message: string }>;
    if (Array.isArray(issues) && issues[0]?.message) return issues[0].message;
  } catch {
    /* not zod */
  }
  return m;
}

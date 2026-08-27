import { asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { categories, type Category } from "@/db/schema";
import { FLOWS, SPEND_TYPES } from "@/domain/types";
import { logAudit } from "./audit";
import { AppError, newId, nowIso } from "./context";

export const categoryInput = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: z.string().nullable().optional(),
  flow: z.enum(FLOWS),
  spendType: z.enum(SPEND_TYPES).nullable().optional(),
});
export type CategoryInput = z.infer<typeof categoryInput>;

export interface CategoryNode extends Category {
  children: Category[];
}

export function listCategories(db: Db, opts: { includeArchived?: boolean } = {}): Category[] {
  const q = db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name));
  return opts.includeArchived ? q.all() : q.where(isNull(categories.archivedAt)).all();
}

export function categoryTree(db: Db): CategoryNode[] {
  const all = listCategories(db);
  const roots = all
    .filter((c) => c.parentId == null)
    .map((c) => ({ ...c, children: [] as Category[] }));
  const byId = new Map(roots.map((r) => [r.id, r]));
  for (const c of all) {
    if (c.parentId) byId.get(c.parentId)?.children.push(c);
  }
  return roots;
}

export function getCategory(db: Db, id: string): Category {
  const c = db.select().from(categories).where(eq(categories.id, id)).get();
  if (!c) throw new AppError(`Category ${id} not found`, "not_found");
  return c;
}

export function createCategory(db: Db, input: CategoryInput): Category {
  const ts = nowIso();
  const parent = input.parentId ? getCategory(db, input.parentId) : null;
  const maxSort = listCategories(db, { includeArchived: true }).reduce(
    (m, c) => Math.max(m, c.sortOrder),
    0,
  );
  const row = {
    id: newId(),
    name: input.name,
    parentId: parent?.id ?? null,
    flow: input.flow,
    spendType:
      input.flow === "expense" ? (input.spendType ?? parent?.spendType ?? "variable") : null,
    sortOrder: maxSort + 1,
    isSystem: false,
    createdAt: ts,
    updatedAt: ts,
  };
  db.insert(categories).values(row).run();
  logAudit(db, "category", row.id, "create", undefined, row);
  return getCategory(db, row.id);
}

export function updateCategory(db: Db, id: string, patch: Partial<CategoryInput>): Category {
  const before = getCategory(db, id);
  if (before.isSystem && (patch.flow || patch.parentId))
    throw new AppError("System categories cannot change flow or parent", "forbidden");
  db.update(categories)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(categories.id, id))
    .run();
  const after = getCategory(db, id);
  logAudit(db, "category", id, "update", before, after);
  return after;
}

export function archiveCategory(db: Db, id: string): void {
  const c = getCategory(db, id);
  if (c.isSystem) throw new AppError("System categories cannot be archived", "forbidden");
  db.update(categories)
    .set({ archivedAt: nowIso(), updatedAt: nowIso() })
    .where(eq(categories.id, id))
    .run();
  logAudit(db, "category", id, "archive", c, undefined);
}

/**
 * Resolve a category name carried by a file (YNAB "Group: Name", "Group/Name", or a bare name).
 * Creates missing groups/categories so imported history keeps its categorization.
 * Returns null for empty/uncategorized hints.
 */
export function resolveCategoryHint(db: Db, hint: string): Category | null {
  const h = hint.trim();
  if (!h) return null;
  const lower = h.toLowerCase();
  if (lower === "uncategorized" || lower === "(uncategorized)" || lower === "category not needed")
    return null;
  if (lower.startsWith("inflow") || lower === "ready to assign" || lower === "to be budgeted")
    return getCategory(db, "cat-income-other");
  if (lower.startsWith("transfer")) return getCategory(db, "cat-transfer");

  const parts = h.split(/\s*[:/]\s*/).filter(Boolean);
  const groupName = parts.length > 1 ? parts[0]! : null;
  const leafName = parts[parts.length - 1]!;
  const all = listCategories(db, { includeArchived: true });
  const ci = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

  let group: Category | null = null;
  if (groupName) {
    group = all.find((c) => c.parentId == null && ci(c.name, groupName)) ?? null;
    if (!group) {
      const isIncome = /income|inflow|paycheck/i.test(groupName);
      const isSaving = /saving|invest|retire/i.test(groupName);
      group = createCategory(db, {
        name: groupName,
        parentId: null,
        flow: isIncome ? "income" : isSaving ? "saving" : "expense",
        spendType: isIncome || isSaving ? null : "variable",
      });
    }
  }
  const existing = all.find(
    (c) => ci(c.name, leafName) && (group ? c.parentId === group.id : true),
  );
  if (existing) return existing;
  return createCategory(db, {
    name: leafName,
    parentId: group?.id ?? null,
    flow: group?.flow ?? "expense",
    spendType: group?.flow === "expense" || !group ? (group?.spendType ?? "variable") : null,
  });
}

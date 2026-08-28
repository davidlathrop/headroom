import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "@/db/client";
import { getImportDir } from "@/db/client";
import { auditLog, batchCoverage, importBatches } from "@/db/schema";
import { parseOfx } from "@/importers/ofx/parse";
import { getSetting, setSetting } from "./settings";

const RANGES_VERSION = 1;

/**
 * Statement ranges (OFX DTSTART/DTEND) were not part of coverage at first, so batches committed
 * before then only cover the dates of the transactions they held — an idle account looked
 * uncovered. This re-reads every committed OFX batch's stored file once and widens its coverage
 * windows to the statement range. Idempotent; skipped once recorded in settings.
 * (Kept free of the import service so the app bootstrap can call it without an import cycle.)
 */
export function ensureCoverageRanges(db: Db): { widened: number; batches: number } {
  if (getSetting<number>(db, "coverage.rangesVersion", 0) >= RANGES_VERSION)
    return { widened: 0, batches: 0 };
  let widened = 0;
  let batches = 0;
  const dir = getImportDir();
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  const committed = db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.status, "committed"), eq(importBatches.format, "ofx")))
    .all();
  for (const b of committed) {
    const file = files.find((f) => f.startsWith(b.fileSha256));
    if (!file || !b.previewJson) continue;
    let preview: { accountMap?: Record<string, string | null>; singleAccountId?: string | null };
    try {
      preview = JSON.parse(b.previewJson) as typeof preview;
    } catch {
      continue;
    }
    let text = fs.readFileSync(path.join(dir, file), "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const { ranges } = parseOfx(text);
    if (ranges.length === 0) continue;
    batches++;
    for (const r of ranges) {
      const accountId =
        r.accountLabel != null
          ? (preview.accountMap?.[r.accountLabel] ?? null)
          : (preview.singleAccountId ?? b.accountId);
      if (!accountId) continue;
      const rows = db
        .select()
        .from(batchCoverage)
        .where(and(eq(batchCoverage.batchId, b.id), eq(batchCoverage.accountId, accountId)))
        .all();
      if (rows.length === 0) {
        db.insert(batchCoverage)
          .values({
            id: ulid(),
            batchId: b.id,
            accountId,
            coverageStart: r.start,
            coverageEnd: r.end,
          })
          .run();
        widened++;
        continue;
      }
      for (const row of rows) {
        const start = r.start < row.coverageStart ? r.start : row.coverageStart;
        const end = r.end > row.coverageEnd ? r.end : row.coverageEnd;
        if (start === row.coverageStart && end === row.coverageEnd) continue;
        db.update(batchCoverage)
          .set({ coverageStart: start, coverageEnd: end })
          .where(eq(batchCoverage.id, row.id))
          .run();
        widened++;
      }
    }
  }
  setSetting(db, "coverage.rangesVersion", RANGES_VERSION);
  if (widened > 0)
    db.insert(auditLog)
      .values({
        id: ulid(),
        entity: "batch_coverage",
        entityId: "*",
        action: "widen_to_statement_ranges",
        beforeJson: null,
        afterJson: JSON.stringify({ widened, batches }),
        at: new Date().toISOString(),
      })
      .run();
  return { widened, batches };
}

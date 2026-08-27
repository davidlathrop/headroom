import type { Db } from "@/db/client";
import { auditLog } from "@/db/schema";
import { newId, nowIso } from "./context";

export function logAudit(
  db: Db,
  entity: string,
  entityId: string,
  action: string,
  before: unknown,
  after: unknown,
): void {
  db.insert(auditLog)
    .values({
      id: newId(),
      entity,
      entityId,
      action,
      beforeJson: before === undefined ? null : JSON.stringify(before),
      afterJson: after === undefined ? null : JSON.stringify(after),
      at: nowIso(),
    })
    .run();
}

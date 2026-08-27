import { and, eq, gte, isNull, lte, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, transactions } from "@/db/schema";
import { addDays } from "@/domain/dates";
import { getTransaction } from "./transactions";

/** Unlinked transactions in other accounts that could be the other half of a transfer. */
export function transferCandidatesFor(db: Db, txnId: string, maxDays = 7) {
  const t = getTransaction(db, txnId);
  return db
    .select({
      id: transactions.id,
      postedDate: transactions.postedDate,
      payeeDisplay: transactions.payeeDisplay,
      amountCents: transactions.amountCents,
      accountName: accounts.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(
      and(
        isNull(transactions.deletedAt),
        isNull(transactions.transferId),
        ne(transactions.accountId, t.accountId),
        eq(transactions.amountCents, -t.amountCents),
        gte(transactions.postedDate, addDays(t.postedDate, -maxDays)),
        lte(transactions.postedDate, addDays(t.postedDate, maxDays)),
      ),
    )
    .all();
}

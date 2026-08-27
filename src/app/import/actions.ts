"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError, getDb } from "@/services/context";
import {
  assignProfile,
  commitBatch,
  rollbackBatch,
  stageImport,
  updateAccountMapping,
} from "@/services/imports";
import { AMOUNT_CONVENTIONS } from "@/importers/csv/profile";
import { DATE_FORMATS, type DateFormat } from "@/domain/dates";
import { ACCOUNT_KINDS } from "@/domain/types";
import { z } from "zod";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function uploadAction(fd: FormData) {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0)
    redirect("/import?error=" + encodeURIComponent("Choose a file to import."));
  if (file.size > 25 * 1024 * 1024)
    redirect("/import?error=" + encodeURIComponent("That file is larger than 25 MB."));
  const bytes = Buffer.from(await file.arrayBuffer());
  const accountId = str(fd, "accountId") || null;
  const profileId = str(fd, "profileId") || null;
  let batchId: string;
  try {
    batchId = stageImport(getDb(), { fileName: file.name, bytes, accountId, profileId }).id;
  } catch (e) {
    const msg =
      e instanceof AppError ? e.message : `Could not read that file: ${(e as Error).message}`;
    redirect("/import?error=" + encodeURIComponent(msg));
  }
  revalidatePath("/import");
  redirect(`/import/${batchId}`);
}

export async function commitAction(fd: FormData) {
  const id = str(fd, "batchId");
  const force = fd
    .getAll("force")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n));
  try {
    commitBatch(getDb(), id, { forceRows: force });
  } catch (e) {
    redirect(`/import/${id}?error=` + encodeURIComponent((e as Error).message));
  }
  revalidatePath("/");
  revalidatePath("/import");
  revalidatePath("/transactions");
  revalidatePath("/months");
  revalidatePath("/accounts");
  redirect(`/import/${id}?done=1`);
}

export async function rollbackAction(fd: FormData) {
  const id = str(fd, "batchId");
  rollbackBatch(getDb(), id);
  revalidatePath("/");
  revalidatePath("/import");
  revalidatePath("/transactions");
  revalidatePath("/months");
  revalidatePath("/accounts");
  redirect(`/import/${id}`);
}

export async function mapAccountsAction(fd: FormData) {
  const id = str(fd, "batchId");
  const labels = fd.getAll("label").map(String);
  const mapping: Record<string, string | null> = {};
  const create: Record<string, { name: string; kind: (typeof ACCOUNT_KINDS)[number] }> = {};
  for (const label of labels) {
    const choice = str(fd, `map:${label}`);
    if (choice === "__create__") {
      mapping[label] = null;
      create[label] = {
        name: str(fd, `name:${label}`) || label,
        kind: z
          .enum(ACCOUNT_KINDS)
          .catch("checking")
          .parse(str(fd, `kind:${label}`)),
      };
    } else mapping[label] = choice || null;
  }
  const single = str(fd, "singleAccountId") || null;
  try {
    updateAccountMapping(getDb(), id, mapping, single, create);
  } catch (e) {
    redirect(`/import/${id}?error=` + encodeURIComponent((e as Error).message));
  }
  redirect(`/import/${id}`);
}

export async function assignProfileAction(fd: FormData) {
  const id = str(fd, "batchId");
  const convention = z.enum(AMOUNT_CONVENTIONS).parse(str(fd, "amountConvention"));
  const dateFormat = z.enum(DATE_FORMATS).parse(str(fd, "dateFormat")) as DateFormat;
  const opt = (k: string) => str(fd, k) || null;
  try {
    assignProfile(getDb(), id, str(fd, "profileName") || "Custom CSV", {
      hasHeader: true,
      skipRows: Number(str(fd, "skipRows") || "0"),
      delimiter: ",",
      dateFormat,
      dateColumn: str(fd, "dateColumn"),
      postedDateColumn: opt("postedDateColumn"),
      amountConvention: convention,
      amountColumn: opt("amountColumn"),
      debitColumn: opt("debitColumn"),
      creditColumn: opt("creditColumn"),
      payeeColumn: str(fd, "payeeColumn"),
      memoColumn: opt("memoColumn"),
      idColumn: opt("idColumn"),
      accountColumn: opt("accountColumn"),
      categoryColumn: opt("categoryColumn"),
      statusColumn: opt("statusColumn"),
      pendingValues: str(fd, "pendingValues")
        ? str(fd, "pendingValues")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      signature: [
        str(fd, "dateColumn"),
        str(fd, "payeeColumn"),
        ...(opt("amountColumn") ? [opt("amountColumn")!] : []),
        ...(opt("debitColumn") ? [opt("debitColumn")!] : []),
      ],
    });
  } catch (e) {
    redirect(`/import/${id}?error=` + encodeURIComponent((e as Error).message));
  }
  revalidatePath("/settings");
  redirect(`/import/${id}`);
}

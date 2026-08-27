"use server";
import { revalidatePath } from "next/cache";
import { parseCents } from "@/domain/money";
import { getDb } from "@/services/context";
import { addPlanned, deletePlanned } from "@/services/planned";
import { setSeriesAmount, setSeriesStatus } from "@/services/recurring";
import { setSetting } from "@/services/settings";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const refresh = () => {
  revalidatePath("/forecast");
  revalidatePath("/");
};

/**
 * Bound per button (`seriesStatusAction.bind(null, id, "confirmed")`): a submit button's own name/value is
 * not part of the form data React sends to a server action, so the choice travels as a bound argument.
 */
export async function seriesStatusAction(
  id: string,
  status: "confirmed" | "dismissed" | "detected",
) {
  setSeriesStatus(getDb(), id, status);
  refresh();
}

export async function seriesAmountAction(fd: FormData) {
  const cents = parseCents(str(fd, "amount"));
  if (cents != null) setSeriesAmount(getDb(), str(fd, "id"), cents, str(fd, "categoryId") || null);
  refresh();
}

export async function addPlannedAction(fd: FormData) {
  const cents = parseCents(str(fd, "amount"));
  const date = str(fd, "date");
  const name = str(fd, "name");
  if (cents == null || !name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  addPlanned(getDb(), {
    name,
    amountCents: str(fd, "direction") === "in" ? Math.abs(cents) : -Math.abs(cents),
    date,
    categoryId: null,
  });
  refresh();
}

export async function deletePlannedAction(fd: FormData) {
  deletePlanned(getDb(), str(fd, "id"));
  refresh();
}

export async function setBufferAction(fd: FormData) {
  const raw = str(fd, "buffer");
  const cents = raw === "" ? null : parseCents(raw);
  if (raw !== "" && cents == null) return;
  setSetting(getDb(), "forecast.bufferCents", cents);
  const trailing = Number(str(fd, "trailingMonths"));
  if (trailing === 3 || trailing === 6) setSetting(getDb(), "forecast.trailingMonths", trailing);
  refresh();
}

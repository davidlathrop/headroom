"use client";
import { useMemo, useSyncExternalStore } from "react";
import { formatCents, formatCompactCents, formatShare } from "@/domain/money";
import { PRIVACY_KEY } from "./privacy-boot";

/*
 * Hide amounts. The single source of truth is the `data-privacy` attribute on <html>: the boot
 * script sets it before paint, CSS masks every <Amount> off it, and this store lets client
 * components (the charts, the switch) react to it. localStorage remembers the choice.
 */

const ATTR = "data-privacy";
const listeners = new Set<() => void>();
let storageBound = false;

function read(): boolean {
  return (
    typeof document !== "undefined" && document.documentElement.getAttribute(ATTR) === "hidden"
  );
}

function readServer(): boolean {
  return false;
}

function apply(hidden: boolean) {
  const root = document.documentElement;
  if (hidden) root.setAttribute(ATTR, "hidden");
  else root.removeAttribute(ATTR);
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!storageBound) {
    storageBound = true;
    // Another tab or window flipped the switch.
    window.addEventListener("storage", (e) => {
      if (e.key === PRIVACY_KEY) apply(e.newValue === "1");
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

export function useAmountsHidden(): boolean {
  return useSyncExternalStore(subscribe, read, readServer);
}

export function setAmountsHidden(hidden: boolean) {
  apply(hidden);
  try {
    localStorage.setItem(PRIVACY_KEY, hidden ? "1" : "0");
  } catch {
    // Storage unavailable (private window, blocked): the choice lasts for this page only.
  }
}

/** What a chart's amounts are expressed against when hidden: "Income", "target", "Mar 2026". */
export interface Basis {
  value: number;
  label: string;
}

export interface AmountFormat {
  hidden: boolean;
  /** Full precision, for tooltips and tables. */
  full: (cents: number, opts?: { sign?: boolean }) => string;
  /** Axis ticks and direct labels. */
  short: (cents: number) => string;
  /** Class for any element whose text is a dollar figure; CSS hides it before hydration catches up. */
  cls: string | undefined;
  /** Divide the y domain by this so ticks land on round percents. */
  unit: number;
  /** Said once in the chart head: "as % of Income". */
  note: string | null;
}

/** Dollar formatting, or percentages of `basis` when amounts are hidden. */
export function useAmountFormat(basis: Basis | null | undefined): AmountFormat {
  const hidden = useAmountsHidden();
  const value = basis?.value ?? 0;
  const label = basis?.label ?? "";
  return useMemo<AmountFormat>(() => {
    if (!hidden) {
      return {
        hidden: false,
        full: (c, opts) => formatCents(c, "USD", opts),
        short: formatCompactCents,
        cls: "amt-v",
        unit: 1,
        note: null,
      };
    }
    const share = (c: number, opts?: { sign?: boolean }) => formatShare(c, value, opts);
    return {
      hidden: true,
      full: share,
      short: share,
      cls: undefined,
      unit: value > 0 ? value / 100 : 1,
      note: value > 0 ? `as % of ${label}` : "amounts hidden",
    };
  }, [hidden, value, label]);
}

/** The sidebar switch. Its look follows the <html> attribute so it is right before hydration too. */
export function PrivacyToggle() {
  const hidden = useAmountsHidden();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={hidden}
      className="switch"
      onClick={() => setAmountsHidden(!hidden)}
      title={hidden ? "Show dollar amounts" : "Hide dollar amounts; charts switch to percentages"}
    >
      <span className="track" aria-hidden="true">
        <span className="knob" />
      </span>
      <span>Hide amounts</span>
    </button>
  );
}

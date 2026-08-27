import { parseOfx } from "./ofx/parse";
import { parseCsv, readHeader } from "./csv/parse";
import type { ImportProfileRecord } from "./csv/profile";
import type { ParseResult } from "./types";

export function detectFormat(text: string): "ofx" | "csv" {
  const head = text.slice(0, 2048);
  return /OFXHEADER|<OFX>/i.test(head) ? "ofx" : "csv";
}

/**
 * Pick the CSV profile whose signature columns are all present in the header.
 * Prefers the largest signature; ties go to the earlier profile. `skipRows` is the header's
 * line index so files with a preamble parse correctly regardless of the profile's default.
 */
export function matchCsvProfile(
  text: string,
  profiles: ImportProfileRecord[],
): { profile: ImportProfileRecord; skipRows: number } | null {
  let best: { profile: ImportProfileRecord; skipRows: number; size: number } | null = null;
  for (const profile of profiles) {
    if (profile.format !== "csv" || !profile.config) continue;
    const header = readHeader(text, profile.config.delimiter);
    if (!header) continue;
    const have = new Set(header.headers.map((h) => h.trim().toLowerCase()));
    const sig = profile.config.signature;
    if (sig.length === 0) continue;
    if (!sig.every((s) => have.has(s.trim().toLowerCase()))) continue;
    if (!best || sig.length > best.size)
      best = { profile, skipRows: header.headerLineIndex, size: sig.length };
  }
  return best ? { profile: best.profile, skipRows: best.skipRows } : null;
}

export function parseWithProfile(
  text: string,
  profile: ImportProfileRecord,
  skipRowsOverride?: number,
): ParseResult {
  if (profile.format === "ofx") return parseOfx(text);
  if (!profile.config) throw new Error(`Profile ${profile.id} has no CSV configuration`);
  const config =
    skipRowsOverride == null ? profile.config : { ...profile.config, skipRows: skipRowsOverride };
  return parseCsv(text, config);
}

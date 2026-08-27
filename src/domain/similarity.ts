/** Jaro-Winkler similarity in [0,1]. Case-sensitive; callers pass normalized keys. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - matchWindow);
    const hi = Math.min(b.length - 1, i + matchWindow);
    for (let j = lo; j <= hi; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Sørensen–Dice over word tokens, ignoring purely numeric tokens. */
export function diceTokens(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter((w) => w && !/^\d+$/.test(w)));
  const tb = new Set(b.split(" ").filter((w) => w && !/^\d+$/.test(w)));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

/**
 * Similarity between two payee keys for near-duplicate detection.
 * Character-level (Jaro-Winkler) catches typos and truncation; token-level catches a processor
 * word added or dropped when a pending charge posts ("SQUARE BLUE BOTTLE" vs "BLUE BOTTLE").
 */
export function payeeSimilarity(a: string, b: string): number {
  return Math.max(jaroWinkler(a, b), diceTokens(a, b));
}

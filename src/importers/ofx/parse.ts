import { parseCents } from "@/domain/money";
import { toISO, isISODate } from "@/domain/dates";
import type { ParsedBalance, ParsedRow, ParseIssue, ParseResult } from "../types";

/**
 * Minimal OFX reader for both dialects:
 *  - OFX 1.x is SGML: leaf tags have no closing tag (`<FITID>123`), aggregates do.
 *  - OFX 2.x is XML: every tag closes.
 * Both are handled by one rule: an open tag followed by text is a leaf; an open tag followed by
 * nothing is an aggregate; a close tag pops the stack back to its matching aggregate.
 */

export interface OfxNode {
  name: string;
  text: string | null;
  children: OfxNode[];
}

const TAG_RE = /<(\/?)([A-Za-z0-9._]+)>([^<]*)/g;

function unescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/** Parse the OFX body into a tree. The root wraps the top-level <OFX> element. */
export function parseOfxTree(text: string): OfxNode {
  const start = text.search(/<OFX>/i);
  const body = start >= 0 ? text.slice(start) : text;
  const root: OfxNode = { name: "#root", text: null, children: [] };
  const stack: OfxNode[] = [root];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(body)) !== null) {
    const closing = m[1] === "/";
    const name = m[2]!.toUpperCase();
    const content = m[3]!.trim();
    if (closing) {
      // Pop to the matching aggregate (tolerates unclosed SGML leaves above it).
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.name === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const parent = stack[stack.length - 1]!;
    if (content.length > 0) {
      parent.children.push({ name, text: unescape(content), children: [] });
    } else {
      const node: OfxNode = { name, text: null, children: [] };
      parent.children.push(node);
      stack.push(node);
    }
  }
  return root;
}

function child(node: OfxNode, name: string): OfxNode | undefined {
  return node.children.find((c) => c.name === name);
}

function leaf(node: OfxNode, ...path: string[]): string | null {
  let cur: OfxNode | undefined = node;
  for (const p of path) {
    cur = cur ? child(cur, p) : undefined;
  }
  return cur?.text ?? null;
}

/** Depth-first search for every node with the given name. */
function findAll(node: OfxNode, name: string, out: OfxNode[] = []): OfxNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

/** OFX dates look like 20260304, 20260304120000, 20260304120000.000[-5:EST]. Only the day matters. */
export function parseOfxDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const iso = toISO(Number(m[1]), Number(m[2]), Number(m[3]));
  return isISODate(iso) ? iso : null;
}

export function parseOfx(text: string): ParseResult {
  const tree = parseOfxTree(text);
  const rows: ParsedRow[] = [];
  const issues: ParseIssue[] = [];
  const balances: ParsedBalance[] = [];
  const accountsInFile: string[] = [];

  const statements = [...findAll(tree, "STMTRS"), ...findAll(tree, "CCSTMTRS")];
  let rowIndex = 0;
  for (const stmt of statements) {
    const currency = leaf(stmt, "CURDEF") ?? "USD";
    const acctFrom = child(stmt, "BANKACCTFROM") ?? child(stmt, "CCACCTFROM");
    const accountLabel = acctFrom ? leaf(acctFrom, "ACCTID") : null;
    if (accountLabel && !accountsInFile.includes(accountLabel)) accountsInFile.push(accountLabel);

    const tranList = child(stmt, "BANKTRANLIST");
    const txns = tranList ? tranList.children.filter((c) => c.name === "STMTTRN") : [];
    for (const t of txns) {
      const idx = rowIndex++;
      const posted = parseOfxDate(leaf(t, "DTPOSTED"));
      if (!posted) {
        issues.push({ row: idx, message: `Unreadable DTPOSTED "${leaf(t, "DTPOSTED") ?? ""}"` });
        continue;
      }
      const amountRaw = leaf(t, "TRNAMT");
      const amount = amountRaw == null ? null : parseCents(amountRaw);
      if (amount == null) {
        issues.push({ row: idx, message: `Unreadable TRNAMT "${amountRaw ?? ""}"` });
        continue;
      }
      const txnDate = parseOfxDate(leaf(t, "DTUSER")) ?? posted;
      const name = leaf(t, "NAME") ?? leaf(t, "PAYEE", "NAME") ?? "";
      rows.push({
        accountId: "",
        accountLabel,
        postedDate: posted,
        txnDate,
        amountCents: amount, // OFX already signs debits negative
        currency,
        payeeRaw: name,
        memoRaw: leaf(t, "MEMO") ?? "",
        externalId: leaf(t, "FITID"),
        isPending: false,
        categoryHint: null,
        sourceRow: idx,
      });
    }

    const ledger = child(stmt, "LEDGERBAL");
    if (ledger) {
      const bal = leaf(ledger, "BALAMT");
      const asOf = parseOfxDate(leaf(ledger, "DTASOF"));
      const cents = bal == null ? null : parseCents(bal);
      if (cents != null && asOf)
        balances.push({ accountLabel, asOfDate: asOf, balanceCents: cents });
    }
  }

  return { format: "ofx", rows, issues, accountsInFile, balances };
}

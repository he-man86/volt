/**
 * THE OPERATOR TABLE — the binary operators and their precedence, the prefix operators, and the IEC operators neither
 * vendor has. Read by the expression parser (`expression.ts`), the operand parser (`primary.ts`, an operator word where
 * an operand belongs) and the printer. Split from `expression.ts` (openspec lsp-same-standard design.md §2.2).
 */
import type { Token } from "../lex/tokens.js"

// ─── Precedence table (task 1.3) — lowest binding first ──────────────
// Exported for `test/conformance/suite.test.ts`, which requires every operator here to appear in at least one
// conformance fixture — so an operator the grammar accepts can never again go unmeasured, the way `**` did.
export const BINARY_PRECEDENCE: ReadonlyArray<{
  ops: readonly string[]
  prec: number
}> = [
  // ONE level, not IEC's two: `TRUE OR TRUE XOR TRUE` runs FALSE and `TRUE XOR TRUE OR TRUE` TRUE — left to right
  // (`expr_xor_between_or_and`, `expr_xor_then_or`, `expr_or_else_then_xor`, `expr_xor_then_or_else`, CODESYS run values
  // 2026-10-01). This table had XOR between them, as IEC 61131-3 does.
  { ops: ["OR", "OR_ELSE", "XOR"], prec: 1 },
  { ops: ["AND", "AND_THEN"], prec: 2 },
  { ops: ["=", "<>"], prec: 3 },
  { ops: ["<", ">", "<=", ">="], prec: 4 },
  { ops: ["+", "-"], prec: 5 },
  { ops: ["*", "/", "MOD"], prec: 6 },
]

/**
 * THE IEC OPERATORS NEITHER VENDOR HAS — `**` (EXPT is the only power) and `&` (AND is the only and). Not operators, so
 * an expression ENDS before one, and the reader of the expression says what it expected instead: a statement "';'
 * expected instead of '**'" and the resync after a missing `;`, parentheses "')' expected instead of '&'", a call "',' or
 * ')' expected instead of '&'", an IF "'THEN' expected instead of '&'" (`cc_power_operator`, `cc_fp_op_ampersand`,
 * `expr_power_*`, `expr_ampersand_*`, both vendors). A prefix `&` is no operand (`expr_prefix_ampersand`). Exported so
 * the operator-coverage test still asks a fixture for each (`test/conformance/suite.test.ts`).
 */
export const REFUSED_OPERATORS: readonly string[] = ["**", "&"]

const OP_INFO: ReadonlyMap<string, number> = new Map(BINARY_PRECEDENCE.flatMap((row) => row.ops.map((op) => [op, row.prec] as const)))

/** Canonical operator string for a token, or undefined if it's not a binary operator. */
export function binaryOp(t: Token): { op: string; prec: number } | undefined {
  const key = t.kind === "keyword" ? t.keyword : t.kind === "punct" ? t.text : undefined
  if (key === undefined) return undefined
  const prec = OP_INFO.get(key)
  return prec === undefined ? undefined : { op: key, prec }
}

/** Prefix unary operator text, or undefined — `-`, `+` and NOT, stacked in any order (`- -a`, `--a`, `+ +a`, `NOT NOT a`,
 *  `-NOT a`, `NOT -a`: every one builds on both vendors, `expr_*` 2026-10-01). */
export function unaryOp(t: Token): string | undefined {
  if (t.kind === "keyword" && t.keyword === "NOT") return "NOT"
  if (t.kind === "punct" && (t.text === "-" || t.text === "+")) return t.text
  return undefined
}

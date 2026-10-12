/**
 * THE CONSTANT OPERATORS — a folded unary or binary operator on constant values: arithmetic, the boolean operators and
 * the comparisons. Split from `fold.ts` (openspec lsp-same-standard design.md §2.2).
 */
import type { ConstValue } from "./fold.js"

// ─── operators ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function foldUnary(op: string, v: ConstValue): ConstValue {
  if (v === undefined) return undefined
  if (op === "-") {
    if (typeof v === "bigint") return -v
    if (typeof v === "number") return -v
  }
  if (op === "+") return typeof v === "boolean" ? undefined : v
  return undefined
}

export function foldBinary(op: string, l: ConstValue, r: ConstValue): ConstValue {
  if (l === undefined || r === undefined) return undefined
  if (typeof l === "boolean" && typeof r === "boolean") return foldBool(op, l, r)
  if (typeof l === "boolean" || typeof r === "boolean") return undefined
  const rule = ARITHMETIC.get(op)
  if (rule === undefined) return foldCompare(op, l, r)
  // two integers fold exactly as bigint (`/` truncates); a real on either side folds both as a number
  return typeof l === "bigint" && typeof r === "bigint" ? rule.int(l, r) : rule.real?.(Number(l), Number(r))
}

/** THE ONE NUMERIC FOLD (lean 10.2): each arithmetic operator once, its integer and its real rule side by side. An operator
 *  with no `real` rule does not fold on a real. The width a binary folds in is the wider operand's (`fold`'s `binary`). */
const ARITHMETIC: ReadonlyMap<string, { int: (l: bigint, r: bigint) => bigint | undefined; real?: (l: number, r: number) => number | undefined }> = new Map([
  ["+", { int: (l, r) => l + r, real: (l, r) => l + r }],
  ["-", { int: (l, r) => l - r, real: (l, r) => l - r }],
  ["*", { int: (l, r) => l * r, real: (l, r) => l * r }],
  ["/", { int: (l, r) => (r === 0n ? undefined : l / r), real: (l, r) => (r === 0 ? undefined : l / r) }],
  // no real MOD: on a REAL it is refused, "MOD is not defined for REAL" (`tr_a20_real_mod_in_initializer`, 6.A.20)
  ["MOD", { int: (l, r) => (r === 0n ? undefined : l % r) }],
  // the bit operators on two non-negative integers (`cfold_paren_shl_or`: `SHL(…) OR 16#1` is 196609); a negative
  // operand's pattern is its type's, which an untyped fold does not carry
  ["AND", { int: (l, r) => (l >= 0n && r >= 0n ? l & r : undefined) }],
  ["OR", { int: (l, r) => (l >= 0n && r >= 0n ? l | r : undefined) }],
  ["XOR", { int: (l, r) => (l >= 0n && r >= 0n ? l ^ r : undefined) }],
])

function foldBool(op: string, l: boolean, r: boolean): ConstValue {
  switch (op) {
    case "AND":
    case "AND_THEN":
      return l && r
    case "OR":
    case "OR_ELSE":
      return l || r
    case "XOR":
      return l !== r
    case "=":
      return l === r
    case "<>":
      return l !== r
    default:
      return undefined
  }
}

function foldCompare(op: string, l: bigint | number, r: bigint | number): ConstValue {
  switch (op) {
    case "<":
      return l < r
    case ">":
      return l > r
    case "<=":
      return l <= r
    case ">=":
      return l >= r
    case "=":
      return l === r
    case "<>":
      return l !== r
    default:
      return undefined
  }
}

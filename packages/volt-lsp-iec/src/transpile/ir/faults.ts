/**
 * THE FAULTS A PROGRAM STOPS ON, and the one message text each — what the interpreter throws and the emitted Rust panics
 * with, so the two backends name a fault the same way (transpile-restructure design.md §2.2, P1 "fault messages"). Texts
 * are written once here; a backend that needs one imports it rather than spelling it again. And which IR could raise one
 * (`cannotFault`), for lowering and a backend alike.
 */

import type { IrBuiltin } from "./expr.js"
import { type IrNode, isPlace, someNode } from "./walk.js"

/** A fault with one fixed text. */
export type FaultKind =
  | "null-dereference"
  | "no-instance"
  | "unbound-inout"
  | "division-by-zero"
  | "division-overflow"
  | "logarithm-of-zero"
  | "zero-to-negative-power"
  | "address-outside-image"
  | "address-across-frames"

/** The text of each fixed fault, as both backends print it. */
export const FAULT_TEXT: Readonly<Record<FaultKind, string>> = {
  "null-dereference": "dereference of a null pointer",
  "no-instance": "call through an interface that holds no instance",
  "unbound-inout": "a METHOD or ACTION reached its FB's VAR_IN_OUT before any call of the FB bound it",
  "division-by-zero": "division by zero",
  "division-overflow": "a division overflowed its type, which stops the task on CODESYS",
  "logarithm-of-zero": "the logarithm of zero stops the task on CODESYS",
  "zero-to-negative-power": "zero to a negative power stops the task on CODESYS",
  "address-outside-image": "an access through an address outside every variable whose address the program took",
  "address-across-frames": "an order of two addresses in different variables, which the vendor's layout decides",
}

/** An index outside its array's bounds — `index` as the ST wrote it (the dimension's lower bound added back). */
export const indexOutOfBounds = (index: number): string => `array index ${index} is outside its bounds`

/** A character position outside a string's buffer. (The Rust runtime's `IecString` prints the same text through its own
 *  `panic!` format string, `"character {} of a string of capacity {}"`.) */
export const characterOutOfRange = (at: number, capacity: number): string => `character ${at} of a string of capacity ${capacity}`

/** A fault text as a Rust string literal, for a `panic!` in the emitted code. */
export const rustFaultLiteral = (kind: FaultKind): string => JSON.stringify(FAULT_TEXT[kind])

/** The builtins that never stop the task, each named — a new one fails to compile here until it says (`cannotFault`). */
const BUILTIN_NEVER_FAULTS: Readonly<Record<IrBuiltin["name"], boolean>> = {
  max: true, min: true, limit: true, sel: true, trunc: true, abs: true, shl: true, shr: true, rol: true, ror: true, mux: true,
  sqrt: true, exp: true, sin: true, cos: true, tan: true, asin: true, acos: true, atan: true, length: true,
  // zero to a negative power, the logarithm of zero, a character outside the buffer, two addresses in two regions
  expt: false, ln: false, log: false, char: false, setchar: false, address_order: false,
}

/**
 * WHETHER EVALUATING `root` CANNOT STOP THE TASK — where it runs then shows in no fault either. An ALLOWLIST, so what it
 * does not name counts as one that could: a constant, a load of a place with no runtime index, dereference or image
 * address, and the arithmetic, comparisons, conversions and builtins over them that never fault — a division only where
 * lowering proved its divisor harmless (`nonzeroDivisor`). A call of any kind could fault inside.
 */
export function cannotFault(root: IrNode | readonly IrNode[]): boolean {
  return !someNode(root, (n) => {
    if (isPlace(n)) return n.guard !== undefined || n.at !== undefined || n.path.some((s) => s.kind === "index" && s.index.kind !== "const")
    switch (n.kind) {
      case "const":
      case "fresh":
      case "load":
      case "unary":
      case "convert":
      case "count":
      case "copy":
        return false
      case "binary":
        return (n.op === "div" || n.op === "mod") && n.nonzeroDivisor !== true
      case "builtin":
        return !BUILTIN_NEVER_FAULTS[n.name]
      default:
        return true
    }
  })
}

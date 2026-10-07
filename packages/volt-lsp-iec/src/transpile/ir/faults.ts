/**
 * THE FAULTS A PROGRAM STOPS ON, and the one message text each — what the interpreter throws and the emitted Rust panics
 * with, so the two backends name a fault the same way (transpile-restructure design.md §2.2, P1 "fault messages"). Texts
 * are written once here; a backend that needs one imports it rather than spelling it again.
 */

/** A fault with one fixed text. */
export type FaultKind =
  | "null-dereference"
  | "no-instance"
  | "division-by-zero"
  | "division-overflow"
  | "logarithm-of-zero"
  | "zero-to-negative-power"

/** The text of each fixed fault, as both backends print it. */
export const FAULT_TEXT: Readonly<Record<FaultKind, string>> = {
  "null-dereference": "dereference of a null pointer",
  "no-instance": "call through an interface that holds no instance",
  "division-by-zero": "division by zero",
  "division-overflow": "a division overflowed its type, which stops the task on CODESYS",
  "logarithm-of-zero": "the logarithm of zero stops the task on CODESYS",
  "zero-to-negative-power": "zero to a negative power stops the task on CODESYS",
}

/** An index outside its array's bounds — `index` as the ST wrote it (the dimension's lower bound added back). */
export const indexOutOfBounds = (index: number): string => `array index ${index} is outside its bounds`

/** A character position outside a string's buffer. (The Rust runtime's `IecString` prints the same text through its own
 *  `panic!` format string, `"character {} of a string of capacity {}"`.) */
export const characterOutOfRange = (at: number, capacity: number): string => `character ${at} of a string of capacity ${capacity}`

/** A fault text as a Rust string literal, for a `panic!` in the emitted code. */
export const rustFaultLiteral = (kind: FaultKind): string => JSON.stringify(FAULT_TEXT[kind])

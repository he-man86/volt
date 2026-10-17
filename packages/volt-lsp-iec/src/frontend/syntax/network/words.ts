/**
 * The spelling rules the network-text reader holds the text to (openspec ld-fbd-coverage 2R.3, `readability.md`) — the
 * bridge's `NetworkSpelling`, one home for the reader's files and the editor: the words of the text (P1), the box words
 * (B1, B2), the split pattern (B6), the slot facts the call form is judged by (P5), and the one sentence every reader
 * meets v1 text with.
 */

/**
 * THE RESERVED WORDS (P1), compared case-insensitively: the text's own grammar gives each a meaning, so a variable, pin,
 * FB, global or enum value spelled like one is backticked — a reference never falls back to a variable. `IF THEN END_IF
 * LET VAR_TEMP FEED PARALLEL INTO BRANCHES` are not words of the text.
 */
export const NETWORK_TEXT_WORDS: ReadonlySet<string> = new Set([
  "EN",
  "ENO",
  "BRANCH",
  "SHORTCIRCUIT",
  "JMP",
  "RETURN",
  "EXECUTE",
  "END_EXECUTE",
  "NOT",
  "R_EDGE",
  "F_EDGE",
  "NETWORK",
  "END_NETWORK",
  "UNSUPPORTED",
  "AND",
  "OR",
  "XOR",
  "ADD",
  "SUB",
  "MUL",
  "DIV",
  "MOD",
  "GT",
  "GE",
  "EQ",
  "NE",
  "LE",
  "LT",
  "MOVE",
])

/** The words the editor colours as keywords inside a graphical body: the grammar's words and the header's fields. */
export const NETWORK_TEXT_KEYWORDS: ReadonlySet<string> = new Set([...NETWORK_TEXT_WORDS, "LABEL", "TITLE", "DISABLED"])

/** B1: the operator boxes written as their WORD, infix — the box's name as CODESYS draws it. */
export const OPERATOR_WORDS: ReadonlySet<string> = new Set(["AND", "OR", "XOR", "ADD", "SUB", "MUL", "DIV", "MOD", "GT", "GE", "EQ", "NE", "LE", "LT"])

/** B1's guard (C3): the operators that take exactly two inputs — the build refuses a third. */
export const TWO_INPUT_OPERATORS: ReadonlySet<string> = new Set(["SUB", "DIV", "MOD", "GT", "GE", "EQ", "NE", "LE", "LT"])

/** The comparisons: a BOOL result whatever their operands, and no ENO (N21). */
export const COMPARISONS: ReadonlySet<string> = new Set(["GT", "GE", "LT", "LE", "EQ", "NE"])

/** The bit operators: the boxes the vendor stores no main output index for (census 1.6). */
export const BIT_OPERATORS: ReadonlySet<string> = new Set(["AND", "OR", "XOR", "NOT"])

/** The boxes a word or a call form names that are the vendor's own (`CallKind.Operator`): the box words, MOVE and NOT. */
export const BOX_WORDS: ReadonlySet<string> = new Set([...OPERATOR_WORDS, "MOVE", "NOT"])

/** The names a POU or FB instance may not carry as a CALL, because the text spells a construct with them. */
export const CONSTRUCT_WORDS: ReadonlySet<string> = new Set(["R_EDGE", "F_EDGE"])

/** A split point's name (B6): `split` plus the vendor's VarId. The PATTERN is reserved (P1), case-insensitively. */
export const SPLIT_SHAPE = /^split[0-9]+$/i
export const SPLIT_PREFIX = "split"

export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/

/** A name or a dotted path to one — what a POU or a declared instance is called. */
export const isName = (t: string): boolean => IDENTIFIER.test(t) || PATH.test(t)

/** Whether `t` is reserved: a word of the text, or the split pattern. */
export const isReserved = (t: string): boolean => NETWORK_TEXT_WORDS.has(t.toUpperCase()) || SPLIT_SHAPE.test(t)

/** An ST literal the text writes bare (P12): a number (its minus touching it), a typed literal, a string. */
export function isLiteral(t: string): boolean {
  return (
    /^-?[0-9][0-9_]*(\.[0-9][0-9_]*)?([eE][+-]?[0-9]+)?$/.test(t) ||
    /^-?[A-Za-z0-9_]+#[A-Za-z0-9_.:+-]+$/.test(t) ||
    /^'([^'$\r\n]|\$[^\r\n])*'$/.test(t) ||
    /^"([^"$\r\n]|\$[^\r\n])*"$/.test(t)
  )
}

/** The default formal of an operator's input: `IN<n>` on the box words, `IN` on the NOT box and MOVE — read back as no
 *  name, the vendor's own (`NetworkSpelling.DefaultFormal`). */
export function defaultFormal(type: string, pin: number): string | undefined {
  const t = type.toUpperCase()
  if (OPERATOR_WORDS.has(t)) return `IN${pin + 1}`
  if (t === "MOVE" || t === "NOT") return "IN"
  return undefined
}

/** The UNSUPPORTED line's quoted shape: the refusal's name, words separated by one space (`NetworkSpelling.UnsupportedShape`). */
export const UNSUPPORTED_SHAPE = /^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$/

/** The bridge's v1 refusal, one sentence for every place that meets v1 text (`NetworkText.V1Refusal`). */
export function v1Refusal(what: string): string {
  return `this is network text v1 (${what}), which Volt no longer reads and does not translate: re-pull the POU to get the current form, and redo the edit on it.`
}

/** The modifiers 2R.5's composition would spell and no store, build and run measures (design "2R.5": measured per row
 *  before its spelling ships) — the bridge's reader and writer refuse the same shapes (`NetworkSpelling.Unmeasured*`). */
export const UNMEASURED_FLOW =
  "a modified jump or return: NOT, R_EDGE, F_EDGE and R= on JMP or RETURN are not measured — `JMP l S=` and `RETURN S=` are the ones stored and built (2R.5)."
export const UNMEASURED_EDGE_COIL =
  "an edge on a negated, set or reset coil: not measured — `R_EDGE x :=` is the one stored and built (2R.5)."
export const UNMEASURED_MODIFIED_FAN_OUT =
  "a negated or edge coil beside another coil: not measured — `NOT x :=`, `R_EDGE x :=` and `F_EDGE x :=` are each stored and built alone on their item (2R.5)."
export const UNMEASURED_EDGE_EN = "an edge on the EN pin: not measured — `NOT EN c` is the one stored and built (2R.5)."
export const UNMEASURED_EDGE_PIN =
  "an edge on a negated pin: not measured — `R_EDGE IN1 :=` and `NOT IN1 :=` are each stored and built, together they are not (2R.5)."
export const UNMEASURED_NEGATED_EMPTY =
  "a negated empty slot outside a lone plain coil's value: not measured — `x := NOT ;` is the one stored and built (2R.5)."

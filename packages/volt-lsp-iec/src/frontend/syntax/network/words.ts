/**
 * The spelling rules the network-text reader holds the text to (openspec ld-fbd-coverage 2R.6b, `v2-spec.md`) — the
 * bridge's `NetworkSpelling`, one home for the reader's files and the editor: the reserved words, the box words, the split
 * pattern, the slot facts a box's connection is numbered by, IEC's one escape, and the one sentence every reader meets v1
 * text with.
 */

/**
 * THE RESERVED WORDS, compared case-insensitively: the text's own grammar gives each a meaning, so a variable, pin, FB,
 * global or enum value spelled like one is backticked.
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

/** The operator boxes written as their WORD, between their inputs. */
export const OPERATOR_WORDS: ReadonlySet<string> = new Set(["AND", "OR", "XOR", "ADD", "SUB", "MUL", "DIV", "MOD", "GT", "GE", "EQ", "NE", "LE", "LT"])

/** The operators that take exactly two inputs — the build refuses a third ("needs exactly '2' operands"). */
export const TWO_INPUT_OPERATORS: ReadonlySet<string> = new Set(["SUB", "DIV", "MOD", "GT", "GE", "EQ", "NE", "LE", "LT"])

/** The comparisons: a BOOL result whatever their operands. */
export const COMPARISONS: ReadonlySet<string> = new Set(["GT", "GE", "LT", "LE", "EQ", "NE"])

/** The boxes a word or a backticked call names that are the vendor's own operators: the box words, MOVE and NOT. */
export const BOX_WORDS: ReadonlySet<string> = new Set([...OPERATOR_WORDS, "MOVE", "NOT"])

/** A split point's name: `split` plus the vendor's VarId. The PATTERN is reserved, case-insensitively. */
export const SPLIT_SHAPE = /^split[0-9]+$/i
export const SPLIT_PREFIX = "split"

export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Whether `t` is reserved: a word of the text, or the split pattern. */
export const isReserved = (t: string): boolean => NETWORK_TEXT_WORDS.has(t.toUpperCase()) || SPLIT_SHAPE.test(t)

/** Whether a box type is one of the operators the text names by a word (the table, MOVE, the NOT box). */
export const isOperatorBox = (type: string): boolean => BOX_WORDS.has(type.toUpperCase())

/** An ST literal the text writes bare: a number (its minus touching it), a typed literal, a string. */
export function isLiteral(t: string): boolean {
  return (
    /^-?[0-9][0-9_]*(\.[0-9][0-9_]*)?([eE][+-]?[0-9]+)?$/.test(t) ||
    /^-?[A-Za-z0-9_]+#[A-Za-z0-9_.:+-]+$/.test(t) ||
    /^'([^'$\r\n]|\$[^\r\n])*'$/.test(t) ||
    /^"([^"$\r\n]|\$[^\r\n])*"$/.test(t)
  )
}

/** Whether a pin's formal is its operator's default — `IN<n>` on the box words, `IN` on the NOT box and MOVE — a fact
 *  the text does not carry (`NetworkSpelling.IsDefaultFormal`). */
export function isDefaultFormal(type: string, pin: number, formal: string | undefined): boolean {
  if (formal === undefined) return true
  const t = type.toUpperCase()
  const d = OPERATOR_WORDS.has(t) ? `IN${pin + 1}` : t === "MOVE" || t === "NOT" ? "IN" : undefined
  return d !== undefined && formal.toUpperCase() === d
}

/** The UNSUPPORTED line's quoted shape: the refusal's name, words separated by one space. */
export const UNSUPPORTED_SHAPE = /^[A-Za-z0-9_]+( [A-Za-z0-9_]+)*$/

/** The hash an UNSUPPORTED line carries: 8 lower-case hex digits. */
export const UNSUPPORTED_HASH = /^[0-9a-f]{8}$/

/** The bridge's v1 refusal, one sentence for every place that meets v1 text (`NetworkText.V1Refusal`). */
export function v1Refusal(what: string): string {
  return `this is network text v1 (${what}), which Volt no longer reads and does not translate: re-pull the POU to get the current form, and redo the edit on it.`
}

/** Delimited text's one escape, IEC's (`NetworkSpelling.Unescape`): `$$ $' $" $L $N $R $T`, case-insensitive letters,
 *  `$N` the IDE's line end CR LF. An error for any other escape or a `$` at the end. */
export function unescapeText(text: string): { value: string } | { error: string } {
  let out = ""
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c !== "$") {
      out += c
      continue
    }
    const e = i + 1 < text.length ? text[i + 1]! : ""
    const v = ({ $: "$", "'": "'", '"': '"', L: "\n", N: "\r\n", R: "\r", T: "\t" } as Record<string, string>)[e.toUpperCase()]
    if (v === undefined)
      return {
        error:
          e === ""
            ? "a `$` at the end of delimited text: a `$` is written `$$`."
            : `the escape '$${e}': delimited text spells $$ $' $" $L $N $R $T (IEC's escapes), and a \`$\` is written \`$$\`.`,
      }
    out += v
    i++
  }
  return { value: out }
}

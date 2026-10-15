/**
 * The words of the network text's own grammar (`NetworkSpelling.TextWords`), and the one sentence every reader meets v1
 * text with. One home for the reader's files (`parser.ts`, `statements.ts`, `values.ts`, `calls.ts`) and the editor.
 */

/**
 * Words the text's own grammar gives a meaning at operand position (`NetworkSpelling.TextWords`); an operand spelled
 * like one is backticked. Exported so the editor colours them: they are syntax of the network sublanguage, and the ST
 * lexer hands most of them back as plain identifiers.
 */
export const NETWORK_TEXT_WORDS: ReadonlySet<string> = new Set([
  "NOT",
  "AND",
  "OR",
  "XOR",
  "MOD",
  "R_EDGE",
  "F_EDGE",
  "PARALLEL",
  "EXECUTE",
  "END_EXECUTE",
  "IF",
  "THEN",
  "END_IF",
  "JMP",
  "RETURN",
  "NETWORK",
  "END_NETWORK",
  "VAR_TEMP",
  "END_VAR",
  "LET",
  "UNSUPPORTED",
])

/** The words the editor colours as keywords inside a graphical body: the grammar's words, the header's fields, and the
 *  suffix and pin words that only the network text gives a meaning. `LET` is not among them — it is refused. */
export const NETWORK_TEXT_KEYWORDS: ReadonlySet<string> = new Set([
  ...[...NETWORK_TEXT_WORDS].filter((w) => w !== "LET"),
  "LABEL",
  "TITLE",
  "DISABLED",
  "ENO",
  "MODE",
])

/** The names a POU or FB instance may not carry, because the text spells a construct with them. */
export const CONSTRUCT_WORDS: ReadonlySet<string> = new Set(["R_EDGE", "F_EDGE", "PARALLEL"])

/** The bridge's v1 refusal, one sentence for every place that meets v1 text (`NetworkText.V1Refusal`). */
export function v1Refusal(what: string): string {
  return `this is network text v1 (${what}), which Volt no longer reads and does not translate: re-pull the POU to get the current form, and redo the edit on it.`
}

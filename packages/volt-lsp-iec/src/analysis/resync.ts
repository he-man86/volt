/**
 * resync — what the compiler does with the REST of a statement it has already refused. It demands a `;`, and what
 * follows the offending token then stands on its own: an IDENTIFIER can start a statement, so `NS;` / `b;` is re-read
 * as one and warned about as having no effect; a literal or an operator cannot, and is simply named.
 *
 * Shared by the checks that model such a refusal (`time-literal-unit`, `unsupported-operator`), each with its own
 * recording (conformance `cc_time_nanosecond_literal`, `cc_fp_op_ampersand`, `cc_power_operator`).
 */
const LINE_END_AFTER = /^[^\S\r\n]*(\r?\n)/

/** The orphaned tail as the statement it becomes — through its `;` and the line break, as the IDE quotes it. */
export function leftoverStatement(source: string, from: number): string | undefined {
  const rest = source.slice(from)
  const end = rest.indexOf(";")
  if (end < 0) return undefined
  const br = LINE_END_AFTER.exec(rest.slice(end + 1))
  return rest.slice(0, end + 1) + (br?.[1] ?? "")
}

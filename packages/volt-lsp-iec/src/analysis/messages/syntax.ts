/**
 * DIAGNOSTIC WORDING — the parser's errors in vendor wording (`checks/syntax/`).
 *
 * One slice of `Messages` (`index.ts`); every template is written once for both vendors — a vendor difference is a
 * switch on `tc` inside it, never a second copy (openspec lsp-same-standard design.md §2.2).
 */
import type { VendorWording } from "./shared.js"

export interface SyntaxMessages {
  /** A conditional-compile pragma (`{ELSE}`/`{ELSIF}`/`{END_IF}`) with no matching `{IF}`: TwinCAT "Pragma", CODESYS "pragma". */
  orphanPragma(directive: string): string
  /** A `{IF}` conditional-compile block never closed by `{END_IF}`. Byte-identical on both vendors (confirmed against live). */
  unterminatedConditional(): string
  /** A CASE whose first arm has no label: CODESYS "CASE", TwinCAT "case" (`rec_refused_word_case_label_first`, 2026-10-02). */
  noCaseLabel(): string
  /** An `AT` clause whose operand is not a direct address (`i AT ABC`) — C0030. verified live CODESYS; TC pending. */
  directAddressExpectedAt(found: string): string
  /** A token the parser cannot use where it stands — the compiler echoes the token AS WRITTEN: `r : INT;` reports
   *  `Unexpected token 'r' found` (lowercase). Recorded live on CODESYS SP21 (conformance `cc_reserved_name_r`,
   *  `cc_power_operator`); unmeasured on TwinCAT, so the checks that use it are CODESYS-only. */
  unexpectedToken(token: string): string
  /** A parameter section inside a STRUCT, by its CamelCase kind (`VarInput`, `VarOutput`, `VarInOut`) — both vendors alike
   *  (`decl_<kw>_inside_struct`, 2026-10-01). */
  parameterSectionNotAllowed(kind: string): string
  /** A VAR section inside a STRUCT, read back as the compiler echoes it (`echo`: the keyword, each declaration on its own
   *  tab-indented line, END_VAR — `decl_var_inside_struct`, `_init`, `_names`, CODESYS 2026-10-01). */
  variableDeclarationExpectedInsteadOf(echo: string): string
}

export function syntaxMessages({ tc }: VendorWording): SyntaxMessages {
  return {
    // The same finding, capitalised differently: CODESYS "token", TwinCAT "Token". Measured on both
    // recordings 2026-09-20 (`echo_*`, and every reserved-name cascade).
    unexpectedToken: (token) => `Unexpected ${tc ? "Token" : "token"} '${token}' found`,
    parameterSectionNotAllowed: (kind) => `'${kind}' not allowed in this place`,
    variableDeclarationExpectedInsteadOf: (echo) => `Variable declaration expected instead of ${echo}`,
    orphanPragma: (directive) => `Unexpected ${tc ? "Pragma" : "pragma"}: '${directive}' found without matching 'if'`,
    // Confirmed byte-identical on both vendors via live /build (CODESYS + TwinCAT, 2026-07-07).
    unterminatedConditional: () => `Unexpected End-of-file found: 'ELSIF', 'ELSE' or 'END_IF' expected`,
    noCaseLabel: () => `No ${tc ? "case" : "CASE"} label found`,
    directAddressExpectedAt: (found) =>
      tc ? `Direct Address expected after "AT" instead of ${found}` : `Direct address expected after AT instead of ${found}`,
  }
}

/**
 * A body that states no language (`checks/syntax/missing-language.ts`) — the push's own refusal of the file
 * (`StReader.Unmarked`, `StReader.DeclarationOnly`), Volt's text and no compiler's, so a plain builder beside the slice
 * (see `workspace.ts`). A file written before the line was renamed holds the retired `IMPLEMENTATION` line (`retired`),
 * and is told to pull again; a member's code with no line is told the line to state.
 */
export function missingLanguageMessage(
  what: string,
  member: boolean,
  line: { key: string; st: string; retired: string | undefined; hasCode: boolean },
): string {
  const head = `'${what}' states no language: `
  if (line.retired !== undefined) return head + line.retired
  if (member && line.hasCode)
    return (
      head +
      `code stands after its declaration and no '${line.key} <ST|LD|FBD>' line opens it, so neither reader reads it. ` +
      `State '${line.st}' above the code, or run \`volt pull\` to get the line the IDE's member has (only a member ` +
      "with no body slot has no line, and nothing after its declaration)."
    )
  if (member)
    return (
      head +
      `no '${line.key} <ST|LD|FBD>' line opens its body, and only a member with no body slot has none — a CODESYS ` +
      "ABSTRACT method, or an accessor of a CODESYS ABSTRACT property; the push refuses any other without one. State " +
      `'${line.st}' (an empty body is an empty member's), or run \`volt pull\` to get the line the IDE's member has.`
    )
  return (
    head +
    `its body opens with no '${line.key} <ST|LD|FBD>' line, so the file does not say where its declaration ends or ` +
    "what language its body is in, and neither reader reads it. Run `volt pull` once to rewrite the workspace in the " +
    "current format."
  )
}

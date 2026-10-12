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

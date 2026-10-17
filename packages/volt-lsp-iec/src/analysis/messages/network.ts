/**
 * DIAGNOSTIC WORDING — the network-text pass's (outside the registry while its design is parked).
 *
 * One slice of `Messages` (`index.ts`); every template is written once for both vendors — a vendor difference is a
 * switch on `tc` inside it, never a second copy (openspec lsp-same-standard design.md §2.2).
 */
import { sharedMessages, type VendorWording } from "./shared.js"
import { callMessages } from "./calls.js"

export interface NetworkMessages {
  /**
   * The `???` MARKER, in an OPERAND position — an input pin, a group operand, or a call box whose
   * instance was never named. CODESYS writes `???` into a graphical slot nobody filled and then chokes on it
   * as raw text, so this is its PARSER talking rather than a semantic check.
   *
   * MEASURED LIVE (SP21, scripts/audit-check.ts): each of those positions answers with this message AND
   * `Unexpected token '?' found`; an unnamed INSTANCE adds two more (a second copy of this one, and
   * `Program name, function or function block instance expected instead of '!!!'ERROR'!!!'`). The LSP emits
   * ONE per marker — a SUBSET of what the compiler says, never a message it does not say — because the
   * corpus gate forbids two diagnostics sharing a (range, code), and a parse cascade is noise in an editor.
   *
   * PROVISIONAL ON TWINCAT: `???` is CODESYS's marker (DIALECT), and no live XAE was available to record
   * TwinCAT's wording. The CODESYS string stands for both rather than a guessed second spelling.
   */
  unresolvedOperand(): string
  /**
   * The SECOND message CODESYS emits for a `???` in an operand position, about the TOKEN rather than the
   * position. Both are emitted for the same marker, so the LSP emits both too — a marker in an operand slot
   * is one of the few places the compiler's answer can be reproduced EXACTLY rather than as a subset.
   *
   * PROVISIONAL ON TWINCAT, as {@link unresolvedOperand}.
   */
  unresolvedOperandToken(): string
  /**
   * The `???` MARKER as an ASSIGNMENT TARGET — a coil or output variable with no name. A different
   * message from the operand case, and a SEMANTIC one rather than a parse error, which is why these are two
   * members and not one string.
   *
   * MEASURED LIVE (SP21): `??? := a;` answers exactly this. Behind an unconnected enable the compiler adds
   * two more about an implicit temp it invents (`__FB__ImpVar15`), whose NAME cannot be reproduced offline
   * — so the LSP emits this one alone and stays a subset.
   *
   * PROVISIONAL ON TWINCAT, for the same reason as {@link unresolvedOperand}.
   */
  unresolvedAssignTarget(): string
  /**
   * ENO read on a LIBRARY function's box that has no EN (`LEN(t)` ⏎ `x := ENO;`): CODESYS reads the ENO as a member of
   * the result — "'ENO' is no component of 'LEN'", the function's own name even when the head is qualified
   * (`ng_m_library_function_eno`, `…_qualified_eno`, SP21). Undefined on TwinCAT: its driver refuses the box before a
   * build (`TcEnoRefusal`). A PROJECT function's box is built with its output list since 2R.4 and builds clean.
   */
  enoOfALibraryFunction(name: string): string | undefined
  /**
   * A METHOD box of an instance given a POSITIONAL pin (`fbm.M(v)`): the push names no method's pins (it holds no
   * declaration of the method), and each vendor's build says so its own way (`ng_m_method_positional`, 2R.4 gate):
   * CODESYS counts the unnamed pin as no input — "Function 'M' requires exactly '1' inputs", the call slice's wording;
   * TwinCAT names the empty input — "'' is no input of 'M'" (the shared wording; its "Identifier '' not defined" after it
   * is an accepted loss, `baseline-c.ts`).
   */
  methodBoxPositionalPins(method: string, count: number): string
}

export function networkMessages(w: VendorWording): NetworkMessages {
  const { tc } = w
  return {
    // MEASURED on both vendors now (`network_unnamed_*`, 2026-09-20) — this note used to say TwinCAT was
    // unverified and the CODESYS wording stood for both. It does not: they agree on the operand message
    // word for word, and disagree on the other two in nothing but capitalisation and a full stop.
    unresolvedOperand: () => "Expression expected instead of '?'",
    unresolvedOperandToken: () => (tc ? "Unexpected Token '?' found" : "Unexpected token '?' found"),
    unresolvedAssignTarget: () => (tc ? "Assignment target not specified" : "The assignment target is not specified."),
    enoOfALibraryFunction: (name) => (tc ? undefined : `'ENO' is no component of '${name}'`),
    methodBoxPositionalPins: (method, count) =>
      tc ? sharedMessages(w).noInput("", method.toUpperCase()) : callMessages(w).functionRequiresInputs(method, count),
  }
}

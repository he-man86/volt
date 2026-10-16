/**
 * DIAGNOSTIC WORDING — the network-text pass's (outside the registry while its design is parked).
 *
 * One slice of `Messages` (`index.ts`); every template is written once for both vendors — a vendor difference is a
 * switch on `tc` inside it, never a second copy (openspec lsp-same-standard design.md §2.2).
 */
import type { VendorWording } from "./shared.js"

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
   * ENO read on a FUNCTION's box that has no EN (`F(a, b)` ⏎ `x := ENO;`): CODESYS reads the ENO as a member of the
   * function's result — "'ENO' is no component of 'F'" and, where a coil takes it, the shared "Cannot convert type
   * 'Unknown type: 'F.ENO'' to type '<the coil's>'" (`rcc_network_eno_function_without_en`, SP21, re-recorded 2026-10-16
   * on the box 2R.3's push builds). Undefined on TwinCAT: its driver refuses the box before a build (`TcEnoRefusal`).
   */
  enoOfAFunction(head: string): string | undefined
}

export function networkMessages({ tc }: VendorWording): NetworkMessages {
  return {
    // MEASURED on both vendors now (`network_unnamed_*`, 2026-09-20) — this note used to say TwinCAT was
    // unverified and the CODESYS wording stood for both. It does not: they agree on the operand message
    // word for word, and disagree on the other two in nothing but capitalisation and a full stop.
    unresolvedOperand: () => "Expression expected instead of '?'",
    unresolvedOperandToken: () => (tc ? "Unexpected Token '?' found" : "Unexpected token '?' found"),
    unresolvedAssignTarget: () => (tc ? "Assignment target not specified" : "The assignment target is not specified."),
    enoOfAFunction: (head) => (tc ? undefined : `'ENO' is no component of '${head}'`),
  }
}

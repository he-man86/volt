/**
 * DIAGNOSTIC WORDING — the `checks/flow/` group's.
 *
 * One slice of `Messages` (`index.ts`); every template is written once for both vendors — a vendor difference is a
 * switch on `tc` inside it, never a second copy (openspec lsp-same-standard design.md §2.2).
 */
import type { VendorWording } from "./shared.js"

export interface FlowMessages {
  /** A `__NEW` assignment-expression used inside another expression (C0454). Env-gated: live IDE masks it with the no-memory-pool error; conservative check, no FP. */
  newInExpression(): string
  /** Two identical single CASE labels (C0216). verified both vendors. */
  caseLabelDuplicate(): string
  /** A single CASE label that also falls inside a CASE range (C0217). verified both vendors. */
  caseLabelInRange(label: string, lo: string, hi: string): string
  /** A CASE range whose lower bound, read in the selector's type, is above its upper (`5..1`, `0..200` on a SINT).
   *  Measured on CODESYS only (`tr_37_case_range_*`); the CODESYS string stands for both. */
  caseRangeInverted(): string
  /** A CASE label that is a non-constant variable (C0218). verified both vendors. */
  caseLabelNonConst(): string
  /** A FOR whose end bound is beyond the counter's type range → unreachable exit test (C0266). verified both vendors. */
  loopExitConstantFalse(condition: string): string
  /** An `EXIT` statement outside any loop (C0132). verified both vendors. */
  noEnclosingLoop(verb: "exit" | "continue"): string
  /** `__NEW` used in a chained (multiple) assignment (C0509). verified both vendors. */
  multipleAssignmentNew(): string
  /** A statement expression with no side effect — a WARNING (C0139). verified both vendors. */
  codeHasNoEffect(code: string): string
  /** A binary operation as a statement, echoed with its `;` and line break (C0020). verified both vendors. */
  noValidStatement(code: string): string
  /** A FUNCTION's name alone as a statement. verified both vendors. */
  functionWithoutParens(name: string): string
  /** `THIS` used in a POU where it is not valid (C0045). verified both vendors. */
  thisNotAllowed(): string
  /** `SUPER` used in a POU where it is not valid (C0122). verified both vendors. */
  superNotAllowed(): string
  /** An empty control-flow block or CASE arm (C0013/C0426) — a body with no statements. verified live CODESYS; TC pending. */
  emptyStatementBlock(): string
  /** Two overlapping CASE ranges, rendered lowest-first (C0219). verified both vendors. */
  caseOverlappingRanges(lo1: string, hi1: string, lo2: string, hi2: string): string
  /** `JMP` to a non-label destination — a numeric literal or expression (C0114). verified both vendors. */
  jumpInvalidDestination(dest: string): string
}

export function flowMessages({ tc }: VendorWording): FlowMessages {
  return {
    // JMP/label wording is PROVISIONAL (no live-bridge recording yet). CODESYS renders labels uppercased in
    // these messages (observed: source `i` → 'I'), matching IEC case-insensitivity; both vendors support JMP.
    // Live-verified both vendors (2026-07-11): TC renders the keyword as JUMP + trailing periods; CS uses JMP, no period.
    jumpInvalidDestination: (dest) => `Invalid destination ${dest} for ${tc ? "JUMP" : "JMP"}`,
    newInExpression: () =>
      `It is not possible to use an assignment expression with the __NEW operator in another expression. Use the pointer variable instead.`,
    caseLabelDuplicate: () => (tc ? `Case label duplicate` : `CASE label duplicate`),
    caseLabelInRange: (label, lo, hi) => (tc ? `Case label ${label} also contained in range ${lo} .. ${hi}` : `CASE label ${label} also contained in range ${lo} .. ${hi}`),
    caseRangeInverted: () => `Lower border must be lower than upper border${tc ? "." : ""}`,
    caseLabelNonConst: () => (tc ? `Case label requires literal or symbolic integer constant` : `CASE label requires literal or symbolic integer constant`),
    // Live-verified both vendors (2026-07-11): CODESYS ends "loop.", TwinCAT ends "loop!". Cond `<counter> <op> <bound>`.
    loopExitConstantFalse: (condition) => `Loop exit condition '${condition}' is constant FALSE. Possible endless loop${tc ? "!" : "."}`,
    noEnclosingLoop: (verb) => `No enclosing loop of which to ${verb}`,
    multipleAssignmentNew: () => `Multiple assignments are not allowed for operator '__New'.`,
    codeHasNoEffect: (code) => `The code '${code}' has no effect. Is this the intent?`,
    noValidStatement: (code) => `'${code}' is no valid statement`,
    functionWithoutParens: (name) => `FUNCTION '${name}' referenced without parentheses '()'`,
    thisNotAllowed: () => (tc ? `Expression 'THIS' is not allowed in this context` : `Expression THIS is not allowed in this context`),
    superNotAllowed: () => (tc ? `Expression 'SUPER' is not allowed in this context` : `Expression SUPER is not allowed in this context`),
    emptyStatementBlock: () => `At least one statement is expected`,
    caseOverlappingRanges: (lo1, hi1, lo2, hi2) => (tc ? `Case contains overlapping range ${lo1} .. ${hi1} and ${lo2} .. ${hi2}` : `CASE contains overlapping range ${lo1} .. ${hi1} and ${lo2} .. ${hi2}`),
  }
}

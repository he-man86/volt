/**
 * THE REFUSAL REGISTRY — every code lowering can answer with, and which of three things it means.
 *
 * **Why this exists.** 82% of corpus bodies end in a refusal (`lower-completeness.ts`: blocked 249 of 304), so
 * for anyone who did not write this compiler **the refusal IS the product**. It was a bare `string` on
 * `LowerDiagnostic` with no registry, ~98 literal codes and five templated families, and — worse — nothing
 * carried the three-way taxonomy `index.ts` declares as the whole contract:
 *
 *   - **invalid** — the ST does not compile in CODESYS either. Fix the code.
 *   - **not-modelled** — valid ST, understood, not built. Wait for a release, or ask for it.
 *   - **not-measured** — valid ST that compiles, whose behaviour is unrecorded, so it is not guessed at.
 *
 * Those three demand completely different things of a user, and a slug tells them apart from none of them.
 *
 * **`unclassified` is deliberate, and it is counted.** Classifying 98 codes by reading their call sites would
 * be exactly the confident guessing this component keeps paying for; a code is classified here only where
 * `index.ts` names it or the refusal is unambiguous. The rest say so, the count is a ratchet in
 * `lower-codes.test.ts`, and it may only go down. An honest "not yet sorted" beats a plausible wrong answer,
 * because a wrong `kind` sends a user to fix ST that is already correct.
 *
 * **Generated once from the call sites, maintained by hand.** The gate is that every code lowering actually
 * emits resolves here — a new `bail` with a new slug fails the suite rather than quietly becoming a 99th
 * unregistered code.
 */

import type { Span } from "../../syntax/index.js"
import type { LowerDiagnostic } from "./ir.js"

/** What a refusal asks of the person who hit it. */
export type LowerCodeKind = "invalid" | "not-modelled" | "not-measured" | "unclassified"

/** Exact codes. */
export const LOWER_CODES: Readonly<Record<string, LowerCodeKind>> = {
  "adr-offset": "unclassified",
  "aggregate-init": "not-modelled",
  "any-input": "unclassified",
  "array-bound": "invalid",
  "assign-op": "unclassified",
  "attr-init-inputs": "unclassified",
  "attr-init-unreached": "unclassified",
  "attr-instance-path": "unclassified",
  "bad-literal": "invalid",
  "binary-op": "invalid",
  "bit-index": "invalid",
  "call-arity": "invalid",
  "call-base": "unclassified",
  "call-body": "unclassified",
  "call-fb-inout": "unclassified",
  "call-global-instance": "unclassified",
  "call-inout-alias": "unclassified",
  "call-inout-bit": "not-modelled",
  "call-inout-derived": "unclassified",
  "call-inout-global": "not-modelled",
  "call-inout-missing": "invalid",
  "call-inout-order": "unclassified",
  "call-inout-shadowed": "unclassified",
  "call-input-missing": "invalid",
  "call-library": "not-modelled",
  "call-method": "unclassified",
  "call-named-args": "unclassified",
  "call-nested": "unclassified",
  "call-no-result": "invalid",
  "call-open-array": "unclassified",
  "call-output": "unclassified",
  "call-output-type": "unclassified",
  "call-param": "unclassified",
  "call-positional": "unclassified",
  "call-program-member": "unclassified",
  "call-program-method": "unclassified",
  "call-program-property": "unclassified",
  "call-program-reentrant": "unclassified",
  "call-recursive": "invalid",
  "call-super": "unclassified",
  "call-target": "unclassified",
  "case-label": "unclassified",
  "conversion-type": "not-measured",
  "enum-default": "unclassified",
  "enum-value": "unclassified",
  "expr-call": "unclassified",
  "fb-init-argument": "unclassified",
  "fb-init-order": "unclassified",
  "fb-init-program": "unclassified",
  "for-bound-call": "unclassified",
  "graphical-body": "unclassified",
  "init-not-constant": "unclassified",
  "inout-constant-write": "unclassified",
  "interface-call-shape": "unclassified",
  "interface-context": "unclassified",
  "interface-any-input": "not-modelled",
  "interface-input": "unclassified",
  "interface-instance": "unclassified",
  "interface-instance-relative": "unclassified",
  "interface-lend-alias": "unclassified",
  "interface-place": "unclassified",
  "interface-query": "unclassified",
  "interface-store": "unclassified",
  "interface-type": "unclassified",
  "interface-value": "unclassified",
  "layout-base": "unclassified",
  "layout-union": "unclassified",
  "no-scope": "unclassified",
  "no-unit": "unclassified",
  "open-array-value": "unclassified",
  "parse": "unclassified",
  "partial-access": "unclassified",
  "place-not-local": "unclassified",
  "place-shape": "unclassified",
  "pointer-index": "unclassified",
  "pointer-order": "unclassified",
  "pointer-outlives": "unclassified",
  "pointer-place": "unclassified",
  "pointer-runtime-index": "unclassified",
  "pointer-shape": "unclassified",
  "pointer-step": "unclassified",
  "pointer-targets": "unclassified",
  "pointer-type": "unclassified",
  "pointer-value": "unclassified",
  "property-accessor": "unclassified",
  "property-store": "unclassified",
  "root-inout": "unclassified",
  "root-type": "invalid",
  "routine-var_output": "unclassified",
  "sizeof-unmeasured": "unclassified",
  "stmt-call_stmt": "unclassified",
  "string-escape": "not-measured",
  "string-op": "unclassified",
  "this-in-program": "unclassified",
  "type-unknown": "unclassified",
  "unary-op": "unclassified",
  // A character outside the measured set. Both of these reach a user through a STRING literal, and both were
  // UNREGISTERED: they are written as a ternary inside one `bail`, which the registry gate could not see.
  "string-non-ascii": "not-measured",
  "wstring-surrogate": "not-measured",
  "union-write": "unclassified",
  "unit-kind": "unclassified",
  "var-at": "unclassified",
  "var-at-instances": "unclassified",
  "var-temp-composite": "unclassified",
}

/** Templated families — `expr-${kind}` and friends expand over AST kinds, so they cannot be enumerated. */
export const LOWER_CODE_PREFIXES: ReadonlyArray<{ prefix: string; kind: LowerCodeKind; note: string }> = [
  { prefix: "expr-", kind: "not-modelled", note: "an expression KIND lowering does not model yet (`expr-call`, `expr-member`)" },
  { prefix: "stmt-", kind: "not-modelled", note: "a statement KIND lowering does not model yet (`stmt-call_stmt`, `stmt-try`)" },
  { prefix: "slot-", kind: "not-modelled", note: "a VAR section kind with no runtime representation yet" },
  { prefix: "routine-", kind: "not-measured", note: "an FB section on a routine whose behaviour is unrecorded" },
  { prefix: "bit-on-", kind: "not-modelled", note: "a bit access on a type whose layout is not modelled" },
  { prefix: "layout-", kind: "not-modelled", note: "a type kind with no declaration lowering can lay out (storage.ts)" },
]

/**
 * A refusal, with its taxonomy filled in from the registry.
 *
 * Every `LowerDiagnostic` in the transpiler is built here or by `Lowering.bail`, which calls the same lookup.
 * That is the whole point: `kind` answers a question the user asks ("is this my bug or yours?"), and a field
 * assembled independently at a hundred call sites answers it a hundred slightly different ways.
 */
export function lowerDiagnostic(code: string, message: string, span: Span): LowerDiagnostic {
  return { code, kind: lowerCodeKind(code) ?? "unclassified", message, span }
}

/** The kind for one code, or undefined when it is registered nowhere — which is a gate failure, not a default. */
export function lowerCodeKind(code: string): LowerCodeKind | undefined {
  const exact = LOWER_CODES[code]
  if (exact !== undefined) return exact
  for (const p of LOWER_CODE_PREFIXES) if (code.startsWith(p.prefix)) return p.kind
  return undefined
}

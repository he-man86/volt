/**
 * THE REFUSAL REGISTRY — every code lowering can answer with, and which of three things it means.
 *
 * **Why this exists.** 82% of corpus bodies end in a refusal (`lower-completeness.ts`: blocked 249 of 304), so
 * for anyone who did not write this compiler **the refusal IS the product**. It was a bare `string` on
 * `LowerDiagnostic` with no registry, ~98 literal codes and its templated families, and — worse — nothing
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
 * `codes.test.ts` beside this, and it may only go down. An honest "not yet sorted" beats a plausible wrong answer,
 * because a wrong `kind` sends a user to fix ST that is already correct.
 *
 * **Generated once from the call sites, maintained by hand.** The gate is that every code lowering actually
 * emits resolves here — a new `bail` with a new slug fails the suite rather than quietly becoming a 99th
 * unregistered code.
 */

import { LoweringBug } from "../../semantics/faults.js"


/** What a refusal asks of the person who hit it. */
export type LowerCodeKind = "invalid" | "not-modelled" | "not-measured" | "unclassified"

/** Exact codes. */
export const LOWER_CODES: Readonly<Record<string, LowerCodeKind>> = {
  "adr-offset": "unclassified",
  "aggregate-init": "not-modelled",
  "any-input": "unclassified",
  "array-bound": "invalid",
  "array-reversed": "invalid",
  "assign-op": "unclassified",
  "attr-init-inputs": "unclassified",
  "attr-init-unreached": "unclassified",
  "attr-instance-path": "unclassified",
  "bad-literal": "invalid",
  "binary-op": "invalid",
  "bit-index": "invalid",
  "bool-byte": "not-measured",
  "call-arity": "invalid",
  "call-base": "unclassified",
  "call-body": "unclassified",
  "call-fb-inout": "unclassified",
  "call-global-instance": "unclassified",
  "call-inout-alias": "unclassified",
  "call-inout-bit": "not-modelled",
  "call-inout-capacity": "not-modelled",
  "call-inout-derived": "unclassified",
  "call-inout-type": "invalid",
  "call-inout-global": "not-modelled",
  "call-inout-missing": "invalid",
  "call-inout-order": "unclassified",
  "call-inout-shadowed": "unclassified",
  "call-inout-short": "invalid",
  "call-input-missing": "invalid",
  "call-library": "not-modelled",
  "call-method": "unclassified",
  "call-named-args": "unclassified",
  "call-nested": "unclassified",
  "call-no-result": "invalid",
  "call-open-array": "unclassified",
  "call-output": "unclassified",
  "call-output-convert": "not-modelled",
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
  "calendar-width": "invalid",
  "case-label": "unclassified",
  "case-label-type": "invalid",
  "conversion-type": "not-measured",
  // a duration scaled by a WIDER integer converts the duration into it — refused by both vendors (6.B.5)
  "duration-scale": "invalid",
  "enum-value": "unclassified",
  "expr-call": "unclassified",
  "fb-init-argument": "unclassified",
  // Not a construct and not a gap: `lowerUnit` lowers a POU by synthesizing `inst : ThatPOU;`, and that bare
  // declaration passes no FB_Init argument — so an FB whose inherited FB_Init takes one can never lower as a
  // ROOT, however complete the transpiler becomes. The vendor never sees the scaffold; measured 2026-09-24,
  // every corpus project builds with zero errors. Kept apart from `fb-init-argument` for the reason
  // `pointer-root-input` is kept apart from `pointer-order` — a harness limit is not a work item.
  "fb-init-root": "not-measured",
  "fb-init-order": "unclassified",
  "fb-init-program": "unclassified",
  "exit-outside-loop": "invalid",
  "copy-instance-pointer": "not-modelled",
  "cursor-overrun": "not-modelled",
  // `__NEW` / `__DELETE`: the recording project has no memory pool, so what an allocation answers is unrecorded
  // (the `newdel_*` fixtures are unaskable) — refused by name before a byte address could stand for one (4.4)
  "dynamic-memory": "not-measured",
  // an instance whose data lives in the program's byte image, held where a region per call would be needed — a
  // METHOD's or FUNCTION's local, a VAR_TEMP (design.md §3.3 step 4d)
  "image-stack": "not-modelled",
  // a type whose byte layout the program observes and no recording measured — a derived FB, an FB with a VAR_IN_OUT
  // or a METHOD's VAR_INST, whose data an address is stored into (design.md §3.3, 4.4)
  "layout-unmeasured": "not-measured",
  "for-bound-call": "unclassified",
  "for-limit-type": "invalid",
  "for-step-type": "invalid",
  "graphical-body": "unclassified",
  // An initial value that READS an FB instance. A sibling instance's FB_Init runs in the same step, at its own
  // declaration's position, and these go in as one block — so only the instance-declared-first case would be right.
  "init-reads-instance": "not-measured",
  // An initial value that reads a LATER declaration, whose own initializer has not run — measured as the default.
  "init-reads-later": "not-measured",
  "init-frame-order": "not-measured",
  "init-slot-order": "not-measured",
  // A BACKSTOP, not a construct: an initializer that lowered to nothing and reported nothing. It names a lowering
  // bug rather than a language feature, so a program producing it is a defect to fix here, not a gap to build.
  "init-dropped": "unclassified",
  "init-nan": "not-measured",
  "init-not-constant": "unclassified",
  "init-composite-scalar": "invalid",
  "inout-constant-write": "unclassified",
  // a Standard FUNCTION's STRING input borrowed read-only (`calls/string-inputs.ts`) that the library repo's body writes, lends
  // writable or takes the address of: a defect of the repo's body, never a silent copy (7.4.6)
  "input-borrow-written": "not-modelled",
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
  // Not a construct gap and not unmeasured: the CALLER hands `ADR(x)` to another instance's pointer field, and the
  // callee cannot reach x — its body is lowered once per FB type, so the target must be LENT per call the way
  // `interfaces/lend.ts` lends an instance. Form 3's foreign half (`pointer-model.md` §5). Kept apart from
  // `pointer-order`, whose message — "before any address was stored into it" — was false here: one is stored.
  "pointer-foreign": "unclassified",
  // Not a construct and not a gap: the POU being lowered is the ROOT, so its `POINTER TO T` VAR_INPUT has no
  // caller to fill it. A harness limit, exactly like `fb-init-argument` — kept apart from `pointer-order` so the
  // work list does not count it as a pointer the model cannot follow (pointer-model.md D5). `fb-init-root` is
  // the same split, made 2026-09-24 — this note said "exactly like `fb-init-argument`" while that one still
  // carried both meanings.
  "pointer-root-input": "not-measured",
  "pointer-step": "unclassified",
  "pointer-targets": "unclassified",
  "pointer-type": "unclassified",
  "pointer-value": "unclassified",
  "property-accessor": "unclassified",
  "property-store": "unclassified",
  "root-inout": "unclassified",
  "root-type": "invalid",
  // a routine VAR_OUTPUT of a non-elementary type, "not measured" in its own message: the `routine-` family's kind (6.A.8)
  "routine-var_output": "not-measured",
  // SHL / SHR / ROL / ROR by a count that is no integer (a REAL): what CODESYS does with one is unrecorded (6Aa+6Ae gate review)
  "shift-count": "not-measured",
  // a CONSTANT whose expression initializer folds past every 64-bit integer of its signedness: CODESYS builds it and
  // fails to log in (code generation), TwinCAT refuses it (`tr_a29_lint_constant_expression_overflow`, 6.A.29)
  "constant-overflow": "invalid",
  // a CONSTANT of an unsigned type whose expression initializer folds below 0 (`U : USINT := K - 1`, K = 0): what the
  // monitor shows and what a read of it is are unrecorded (6.A.29)
  "constant-unsigned-negative": "not-measured",
  // a NOT, shift or rotation of a CONSTANT held past its type whose operand the constant fold does not fold (an operand
  // mixing it with a variable): CODESYS folds the recorded shapes on the held value; this one is unrecorded (6Af gate)
  "held-constant-operand": "not-measured",
  // SHL / SHR of an untyped literal in a shape 6.A.14 did not record — a negative literal, a named constant count, a variable
  // count anywhere but a store's whole value (`builtins/value-functions.ts` `untypedShiftOperand`)
  "shift-untyped-width": "not-measured",
  "sizeof-unmeasured": "unclassified",
  "stmt-call_stmt": "unclassified",
  "string-escape": "not-measured",
  // a STRING(n) whose n the declaring scope cannot fold: the buffer's size is a missing fact (`Lowering.sized`)
  "string-capacity": "not-modelled",
  // LEN_INTERNAL of a STRING longer than its UINT result counts: the count would wrap (7.4.6)
  "string-length-width": "not-modelled",
  "string-op": "unclassified",
  "this-in-program": "unclassified",
  "type-unknown": "unclassified",
  "unary-op": "unclassified",
  // A character outside the measured set. Both of these reach a user through a STRING literal, and both were
  // UNREGISTERED: they are written as a ternary inside one `bail`, which the registry gate could not see.
  "string-non-ascii": "not-measured",
  "wstring-surrogate": "not-measured",
  "layout-recursive": "invalid",
  "var-duplicate": "invalid",
  "assign-string": "invalid",
  "union-write": "unclassified",
  "unit-kind": "unclassified",
  "var-at": "unclassified",
  "var-at-instances": "unclassified",
  // A VAR_TEMP named outside the body that declares it (7.6.4: a VAR_TEMP is a local of that body's run). From a METHOD
  // or a derived body, or through an instance, the vendors refuse it (`var_temp_named_in_method`, `_in_derived_body`,
  // `oopa_write_var_temp`); from an ACTION or as `THIS^.x` they compile it and read a value that is not the body's
  // (`var_temp_named_in_action`, `_through_this`: 0, where the body stored 5) — which storage that is, nothing models.
  "var-temp-outside-body": "not-modelled",
}

/** Templated families — `expr-${kind}` and friends expand over AST kinds, so they cannot be enumerated. */
export const LOWER_CODE_PREFIXES: ReadonlyArray<{ prefix: string; kind: LowerCodeKind; note: string }> = [
  { prefix: "expr-", kind: "not-modelled", note: "an expression KIND lowering does not model yet (`expr-call`, `expr-member`)" },
  { prefix: "stmt-", kind: "not-modelled", note: "a statement KIND lowering does not model yet (`stmt-call_stmt`, `stmt-try`)" },
  { prefix: "slot-", kind: "not-modelled", note: "a VAR section kind with no runtime representation yet" },
  { prefix: "routine-", kind: "not-measured", note: "an FB section on a routine whose behaviour is unrecorded" },
  { prefix: "bit-on-", kind: "not-modelled", note: "a bit access on a type whose layout is not modelled" },
  { prefix: "layout-", kind: "not-modelled", note: "a type kind with no declaration lowering can lay out (storage/layout.ts)" },
]


/**
 * THE EXACT CODES WHOSE KIND IS NOT THEIR FAMILY'S (transpile-restructure 6.A.8): a code that begins with a family's prefix
 * and means something else, with the reason. `codes.test.ts` holds every other prefixed code to its family's kind, and
 * every entry here to a code that still differs — a reason left behind by a reclassified code fails.
 */
export const FAMILY_EXCEPTIONS: Readonly<Record<string, string>> = {
  "expr-call":
    "a CALL is modelled; the code refuses one call SHAPE (no project FUNCTION of that name, a namespace member that is none, a call of an expression, __POUNAME in a nameless POU) — not an expression kind lowering lacks, and not yet sorted",
  "stmt-call_stmt":
    "a call statement is modelled; the code refuses a call of something that is no callable instance — not a statement kind lowering lacks, and not yet sorted",
  "layout-base":
    "the base type has no layout because its own declaration was refused, under its own code; this one says only that the derived type inherits that, so it has no kind of its own",
  "layout-union":
    "two refusals under one code — a member whose overlaid bytes are unmeasured, and a member with an initial value — which the call site does not tell apart",
  "layout-unmeasured": "a type the layout model DOES lay out, whose bytes the program observes and no recording measured: unmeasured, not unmodelled",
  "layout-recursive": "a type that holds itself, which CODESYS refuses: invalid ST, not a type kind the layout model lacks",
}

/** The kind for one code, or undefined when it is registered nowhere — which is a gate failure, not a default. */
export function lowerCodeKind(code: string): LowerCodeKind | undefined {
  const exact = LOWER_CODES[code]
  if (exact !== undefined) return exact
  for (const p of LOWER_CODE_PREFIXES) if (code.startsWith(p.prefix)) return p.kind
  return undefined
}

/**
 * The kind of a code lowering EMITS (`Lowering.bail`, `lowerDiagnostic`) — which must be registered. An unregistered one
 * is a LOWERING BUG and is thrown (design.md P8; it was filed `"unclassified"`, a kind the registry never gave it, and only
 * `codes.test.ts` noticed). `lowerCodeKind` stays the question "is this registered?" for the gates that ask it.
 */
export function emittedKind(code: string): LowerCodeKind {
  const kind = lowerCodeKind(code)
  if (kind === undefined) throw new LoweringBug(`lowering emitted the unregistered refusal code '${code}' — register it in lower/diagnostics/codes.ts`)
  return kind
}

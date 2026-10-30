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
 * **Every kind is decided by evidence, never by reading alone** (openspec transpile-refusal-classification). There was an
 * `unclassified` kind, counted down by a ratchet from 83: each of those codes got its kind from its call sites, the
 * fixtures whose lowering reaches each site and what the vendor did with them (a single-use probe, deleted once its table
 * was recorded in the change's tasks.md: `git show f5a189cb83:packages/volt-lsp-iec/scripts/probe-refusal-evidence.ts`), and
 * the six corpora (every corpus project builds, so a corpus hit is valid ST). Where none of that decided a site, a fixture
 * asked CODESYS first (`calls/`, `memory/`, `oop/`, `operators/refusal-kinds.ts`). The rules, per call site:
 *
 *   - a site only vendor-refused ST reaches, refused there for the site's own reason, is `invalid`;
 *   - a site valid ST reaches (a vendor-run fixture, a corpus POU) is never `invalid` — a wrong `invalid` sends a user to
 *     fix ST that is already correct, while invalid ST that reaches a not-`invalid` site is reported by the front-end with
 *     CODESYS's own error beside it;
 *   - valid ST whose behaviour a recording states is `not-modelled`; valid ST whose behaviour no recording settles — a
 *     fact of the layout, an order, a project or device fact Volt is not given, a harness limit — is `not-measured`;
 *   - a code whose sites refuse two of these is SPLIT, one code per kind (`diagnostics/classification.test.ts`).
 *
 * **The rules were applied to the 83 codes that change classified, not re-applied to the codes classified before it.**
 * Five of those older `invalid` codes are reached by corpus POUs (valid ST) and so break the second rule; they stand as filed
 * until a change re-reads them (counted 2026-10-11, lowering every corpus POU): `var-duplicate` (189 diagnostics),
 * `layout-recursive` (168), `call-arity` (66: `__ISVALIDREF` of pro2193 `MapperBase`'s REFERENCE fields),
 * `call-input-missing` (16: its default not measured) and `bad-literal` (2); vendor-built fixtures reach two more,
 * `constant-overflow` (3) and `case-label-type` (`lt_literal_case_label_out_of_range`).
 *
 * **One site this change classified stays mixed, not split:** `pointer-value` at `access-guards.ts`'s `loadValue` — a
 * pointer's value used as a number. CODESYS refuses 22 fixtures there ("Cannot convert type 'POINTER TO INT' to type
 * 'DINT'", `ptrsc_into_*`, `cmpop_pointer_vs_dint`) and builds 14 (`cmpop_pointer_vs_lint`, …), deciding by the DESTINATION
 * type as `integer-into-pointer` does the other way; `loadValue` is not given that type, so the refused half is
 * `not-modelled` with the built half until a change carries it there (4 corpus diagnostics, all valid ST). And
 * `reference-type` is reached only through a tagged reference: a REFERENCE that holds addresses binds through
 * `imageAddressOf`, which compares no types, so `REF=` to a variable of another type lowers silently there
 * (`refdecl_target_wrong_type`) — a missing refusal older than this change, which adds none.
 *
 * **Generated once from the call sites, maintained by hand.** The gate is that every code lowering actually
 * emits resolves here — a new `bail` with a new slug fails the suite rather than quietly becoming a 99th
 * unregistered code.
 */

import { LoweringBug } from "../../semantics/faults.js"


/** What a refusal asks of the person who hit it. */
export type LowerCodeKind = "invalid" | "not-modelled" | "not-measured"

/** Exact codes. */
export const LOWER_CODES: Readonly<Record<string, LowerCodeKind>> = {
  "adr-offset": "not-measured",
  "aggregate-init": "not-modelled",
  "any-input": "not-measured",
  "array-bound": "invalid",
  "array-reversed": "invalid",
  "assign-op": "invalid",
  "attr-init-inputs": "not-modelled",
  "attr-init-unreached": "not-modelled",
  "attr-instance-path": "not-measured",
  "bad-literal": "invalid",
  "binary-op": "invalid",
  "bit-index": "invalid",
  "bool-byte": "not-measured",
  "call-arity": "invalid",
  "call-body": "not-modelled",
  "call-fb-inout": "not-modelled",
  "call-global-instance": "not-modelled",
  // a call on a GVL instance whose run could reach that variable while it is moved out of `Globals` (`globalReentrant`)
  "call-global-reentrant": "not-modelled",
  "call-inout-alias": "not-modelled",
  "call-inout-bit": "not-modelled",
  "call-inout-capacity": "not-modelled",
  "call-inout-derived": "not-modelled",
  "call-inout-type": "invalid",
  "call-inout-global": "not-modelled",
  "call-inout-missing": "invalid",
  "call-inout-order": "not-measured",
  "call-inout-shadowed": "not-modelled",
  "call-inout-short": "invalid",
  "call-input-missing": "invalid",
  "call-library": "not-modelled",
  "call-method": "invalid",
  "call-named-args": "invalid",
  "call-nested": "not-modelled",
  "call-no-result": "invalid",
  "call-open-array": "not-modelled",
  "call-output": "invalid",
  "call-output-convert": "not-modelled",
  "call-output-type": "invalid",
  "call-param": "invalid",
  "call-positional": "invalid",
  "call-program-member": "not-modelled",
  "call-program-method": "not-modelled",
  "call-program-property": "not-modelled",
  "call-program-reentrant": "not-modelled",
  // a FUNCTION or METHOD naming itself in its own body, where its name is its result (`cc2_call_recursion`); reached again
  // through another routine or a PROGRAM's own call it runs — `call-recursion` (transpile-refusal-classification 2.2)
  "call-recursive": "invalid",
  "call-recursion": "not-modelled",
  // a PROGRAM lowered as the root calling itself: CODESYS warns "Call recursion" and runs it (`rk_program_calls_itself`: 3)
  "call-program": "not-modelled",
  // a METHOD or ACTION named bare where lowering finds no frame to run it on — Volt's own gap: reached by no fixture and no
  // corpus POU; registered so the site refuses rather than throws (it threw as unregistered, like `call-program`)
  "call-this": "not-modelled",
  "call-super": "invalid",
  "call-target": "not-modelled",
  "calendar-width": "invalid",
  "case-label": "invalid",
  "case-label-type": "invalid",
  "conversion-type": "not-measured",
  // a duration scaled by a WIDER integer converts the duration into it — refused by both vendors (6.B.5)
  "duration-scale": "invalid",
  "enum-value": "invalid",
  "expr-call": "not-modelled",
  "fb-init-argument": "invalid",
  // Not a construct and not a gap: `lowerUnit` lowers a POU by synthesizing `inst : ThatPOU;`, and that bare
  // declaration passes no FB_Init argument — so an FB whose inherited FB_Init takes one can never lower as a
  // ROOT, however complete the transpiler becomes. The vendor never sees the scaffold; measured 2026-09-24,
  // every corpus project builds with zero errors. Kept apart from `fb-init-argument` for the reason
  // `pointer-root-input` is kept apart from `pointer-order` — a harness limit is not a work item.
  "fb-init-root": "not-measured",
  "fb-init-order": "not-measured",
  "fb-init-program": "not-measured",
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
  "for-bound-call": "not-measured",
  "for-limit-type": "invalid",
  "for-step-type": "invalid",
  "graphical-body": "not-modelled",
  // An initial value that READS an FB instance. A sibling instance's FB_Init runs in the same step, at its own
  // declaration's position, and these go in as one block — so only the instance-declared-first case would be right.
  "init-reads-instance": "not-measured",
  // An initial value that reads a LATER declaration, whose own initializer has not run — measured as the default.
  "init-reads-later": "not-measured",
  "init-frame-order": "not-measured",
  "init-slot-order": "not-measured",
  // A BACKSTOP, not a construct: an initializer that lowered to nothing and reported nothing. It names a lowering
  // bug rather than a language feature, so a program producing it is a defect to fix here, not a gap to build.
  "init-dropped": "not-modelled",
  "init-nan": "not-measured",
  "init-not-constant": "not-modelled",
  "init-composite-scalar": "invalid",
  "inout-constant-write": "invalid",
  // a Standard FUNCTION's STRING input borrowed read-only (`calls/string-inputs.ts`) that the library repo's body writes, lends
  // writable or takes the address of: a defect of the repo's body, never a silent copy (7.4.6)
  "input-borrow-written": "not-modelled",
  "interface-call-shape": "not-modelled",
  "interface-context": "not-modelled",
  "interface-any-input": "not-modelled",
  "interface-input": "not-modelled",
  "interface-instance": "not-modelled",
  "interface-instance-relative": "not-modelled",
  "interface-lend-alias": "not-modelled",
  "interface-place": "not-modelled",
  "interface-query": "not-modelled",
  "interface-store": "not-modelled",
  "interface-type": "invalid",
  "interface-value": "not-modelled",
  "layout-base": "not-modelled",
  "layout-union": "not-modelled",
  "no-scope": "not-modelled",
  "no-unit": "invalid",
  "open-array-value": "invalid",
  "parse": "not-modelled",
  "partial-access": "invalid",
  "place-not-local": "not-modelled",
  "place-shape": "not-modelled",
  "pointer-index": "not-modelled",
  "pointer-order": "not-modelled",
  "pointer-outlives": "not-modelled",
  "pointer-place": "not-modelled",
  "pointer-runtime-index": "not-modelled",
  "pointer-shape": "not-modelled",
  // Not a construct gap and not unmeasured: the CALLER hands `ADR(x)` to another instance's pointer field, and the
  // callee cannot reach x — its body is lowered once per FB type, so the target must be LENT per call the way
  // `interfaces/lend.ts` lends an instance. Form 3's foreign half (`pointer-model.md` §5). Kept apart from
  // `pointer-order`, whose message — "before any address was stored into it" — was false here: one is stored.
  "pointer-foreign": "not-modelled",
  // Not a construct and not a gap: the POU being lowered is the ROOT, so its `POINTER TO T` VAR_INPUT has no
  // caller to fill it. A harness limit, exactly like `fb-init-argument` — kept apart from `pointer-order` so the
  // work list does not count it as a pointer the model cannot follow (pointer-model.md D5). `fb-init-root` is
  // the same split, made 2026-09-24 — this note said "exactly like `fb-init-argument`" while that one still
  // carried both meanings.
  "pointer-root-input": "not-measured",
  "pointer-step": "not-modelled",
  "pointer-targets": "not-modelled",
  "pointer-type": "not-modelled",
  "pointer-value": "not-modelled",
  "property-accessor": "invalid",
  "property-store": "not-modelled",
  "root-inout": "not-measured",
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
  "sizeof-unmeasured": "not-measured",
  "stmt-call_stmt": "not-modelled",
  "string-escape": "not-measured",
  // a STRING(n) whose n the declaring scope cannot fold: the buffer's size is a missing fact (`Lowering.sized`)
  "string-capacity": "not-modelled",
  // LEN_INTERNAL of a STRING longer than its UINT result counts: the count would wrap (7.4.6)
  "string-length-width": "not-modelled",
  "string-op": "invalid",
  "this-in-program": "invalid",
  "type-unknown": "not-modelled",
  "unary-op": "invalid",
  // A character outside the measured set. Both of these reach a user through a STRING literal, and both were
  // UNREGISTERED: they are written as a ternary inside one `bail`, which the registry gate could not see.
  "string-non-ascii": "not-measured",
  "wstring-surrogate": "not-measured",
  "layout-recursive": "invalid",
  "var-duplicate": "invalid",
  "assign-string": "invalid",
  "union-write": "not-modelled",
  "unit-kind": "not-modelled",
  "var-at": "not-modelled",
  "var-at-instances": "not-modelled",
  // A VAR_TEMP named outside the body that declares it (7.6.4: a VAR_TEMP is a local of that body's run). From a METHOD
  // or a derived body, or through an instance, the vendors refuse it (`var_temp_named_in_method`, `_in_derived_body`,
  // `oopa_write_var_temp`); from an ACTION or as `THIS^.x` they compile it and read a value that is not the body's
  // (`var_temp_named_in_action`, `_through_this`: 0, where the body stored 5) — which storage that is, nothing models.
  "var-temp-outside-body": "not-modelled",

  // ── THE SPLITS of transpile-refusal-classification 2.1–2.2: one code per kind where a code's sites refused two ──────────
  // a base no FB declaration resolves, or an EXTENDS back to the type — out of `call-base` (gone) and `layout-base`: "No
  // definition found for base class", "Recursion in base function block list" (`inh_unresolved_base`, `inh_extends_cycle`)
  "base-unresolved": "invalid",
  // a library element whose MATERIALIZED declaration lacks what CODESYS knows: an interface's METHODs written after its
  // END_INTERFACE (pro2193 `IADDLOG.itf`), an FB with no IMPLEMENTS list (`L_IMHP_MODULEHANDLER.pou`) — out of
  // `call-method` and `interface-type`, whose 115 and 175 corpus hits were all this (every corpus project builds)
  "library-declaration": "not-modelled",
  // `F(a := , b := 2)`: the empty argument builds and runs on its default (`rk_function_empty_argument`: 6) — out of `call-output`
  "call-empty-argument": "not-modelled",
  // `SUPER^(o => got)` builds (`rk_super_call_output_argument`: got 7) — out of `call-positional`
  "call-super-output": "not-modelled",
  // a PROPERTY of an FB instance inside a PROGRAM written from outside it: "'cell' is no input of …"
  // (`rk_program_instance_property_written`) — out of `call-program-property`
  "program-property-written": "invalid",
  // a call of a name that resolves to something no call reaches — a variable, a constant, a type, a GVL: "Program name,
  // function or function block instance expected" (`calls_constant_called`, `cc5_invalid_call_target`,
  // `dt_struct_type_name_called`) — out of `expr-call` and `stmt-call_stmt`, whose unresolved names stay theirs
  "call-not-callable": "invalid",
  // an FB_Init argument CODESYS builds that lowering cannot pass: positional (`rk_fb_init_positional_argument`: 5), into an
  // FB_Init VAR_IN_OUT (`rk_fb_init_with_inout`), an expression judged in no struct scope, THIS^ (`init_this_in_initializer_argument`)
  "fb-init-argument-shape": "not-modelled",
  // an implementation's METHOD whose parameters are not the interface's: "Interface of overridden method 'M' … doesn't
  // match declaration" (`rk_interface_impl_method_inout`) — out of `interface-call-shape`
  "interface-impl-signature": "invalid",
  // `__QUERYINTERFACE` of other than two operands, or of an operand that is no interface or FB instance: "First operand of
  // __QueryInterface must be …" (`calls_queryinterface_int_first`, `_second`) — out of `interface-query`
  "interface-query-operand": "invalid",
  // an interface given a value that is neither an FB instance nor an interface: "Cannot convert type 'INT' to type 'ITF…'"
  // (`rk_interface_given_integer`) — out of `interface-value`
  "interface-given-value": "invalid",
  // a UNION member whose overlaid bytes no recording measured (corpus: 19 POUs) — out of `layout-union`, which keeps the
  // member declared with an initial value (`rk_union_member_initial_value` builds)
  "union-overlay": "not-measured",
  // a body whose conditional pragma asks what Volt is not given — a project option, a device fact, a compile define
  // (`prag_if_hasconstanttype`: CODESYS runs it) — out of `parse`
  "pragma-undecided": "not-measured",
  // `GVL.x` naming no variable of the list: "'nope' is no component of 'GVL…'" (`sym_gvl_unknown_member`) — out of `place-not-local`
  "gvl-member-unknown": "invalid",
  // a dereference of what is no pointer (`place-shape`'s `^` on an INT): both vendors refuse it
  "deref-not-pointer": "invalid",
  // a STRING or a POINTER indexed in more than one dimension: "Variable of type … requires exactly 1 Index"
  // (`rk_string_indexed_two_dims`, `cc3_pointer_conversions`) — out of `place-shape` and `pointer-index`
  "index-dims": "invalid",
  // a REFERENCE bound to a variable of another type than its own, not an FB derived from it: "Cannot convert type 'STRING'
  // to type 'REFERENCE TO INT'" (`refdecl_target_wrong_type`, `cv_reference_to_other_reference`) — out of `pointer-type`
  "reference-type": "invalid",
  // an integer stored into a pointer that the assignment table refuses — a 32-bit one on the 64-bit target (rule CV6,
  // `pointer_to_dword_roundtrip`); an LWORD builds (`pointer_to_lword_roundtrip`) — out of `pointer-value`
  "integer-into-pointer": "invalid",
  // a pointer stepped by what is no number: "Cannot convert type 'DUT…' to type 'LWORD'" (`rk_pointer_stepped_by_struct`)
  "pointer-operand": "invalid",
  // operands or arguments with no common type: "Cannot compare type 'TIME' with type 'INT'" (`cmpop_time_vs_int`,
  // `rk_builtin_mixed_types`) — out of `type-unknown`, which keeps a type lowering cannot resolve
  "operand-types": "invalid",
  // an AT address CODESYS calls malformed — not an incomplete `%I*` (`lit_address_unsized`, "Direct address '%MX3'
  // malformed") — out of `var-at`
  "var-at-address": "invalid",
  // a call_after_global_init_slot METHOD with any input but one `bInitRetains`: "… must either have no arguments or a single
  // input named 'bInitRetains'" (`rk_init_slot_method_with_input`) — out of `attr-init-inputs`, which keeps that one input
  // (`rk_init_slot_method_binitretains` builds)
  "attr-init-signature": "invalid",
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

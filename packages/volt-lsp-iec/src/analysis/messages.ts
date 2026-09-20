/**
 * Per-vendor diagnostic message builders (Layer D, D.1). Every diagnostic the LSP shares with a
 * compiler must read BYTE-IDENTICAL to it, per vendor — that parity is enforced by the conformance
 * oracle (T.1). Routing all wording through this one module is what makes a new check parity-correct
 * by construction. Vendor differences are data here, not scattered `if (vendor === …)` in the checks.
 */
import type { Scope } from "../symbols/index.js"
import { constEval, renderType, type ArrayTypeInfo, type Type } from "../types/index.js"
import type { Vendor } from "./config.js"

// ─── type text as the COMPILERS print it inside a message ─────────────────────────────────────────────────────────
// Distinct from `types/renderType`, which keeps a user's spelling for hover. Each was built inline by the check that
// needed it (consolidate-lsp-structure B7).

/** A type's name in a message: an enum's upper-cased — `DUT_LANG_cc_enum_byte` is "Cannot convert type
 *  'DUT_LANG_CC_ENUM_BYTE' to type 'BYTE'" (conformance `cc_enum_into_*`, `cc_enum_compare_two_enums`). */
export function compilerTypeName(t: Type): string {
  return t.kind === "enum" ? t.name.toUpperCase() : renderType(t)
}

/** An array type: `ARRAY [1..2] OF INT` (CODESYS-verified), or undefined when a bound does not fold. */
export function compilerArrayText(t: ArrayTypeInfo, scope: Scope): string | undefined {
  const parts: string[] = []
  for (const d of t.dims) {
    if (d.lower === undefined || d.upper === undefined) return undefined
    const lo = constEval(d.lower, scope)
    const hi = constEval(d.upper, scope)
    if (typeof lo !== "bigint" || typeof hi !== "bigint") return undefined
    parts.push(`${lo}..${hi}`)
  }
  return `ARRAY [${parts.join(",")}] OF ${renderType(t.element)}`
}

/** A subrange type: `INT (1..100)` — the base type's name, a space before the paren (both vendors, verified live). */
export function compilerSubrangeText(base: string, lo: bigint, hi: bigint): string {
  return `${base} (${lo}..${hi})`
}

/** A string LITERAL's type: `STRING(INT#3)`, sized by its DECODED length (conformance `cc_string_escape_literal_into_int`). */
export function compilerStringLiteralText(length: number, wide: boolean): string {
  return `${wide ? "WSTRING" : "STRING"}(INT#${length})`
}

export interface Messages {
  /**
   * The compilers' uniform type-mismatch message — BOTH vendors render every implicit-conversion
   * failure (assignment narrowing, wrong conversion source, BOOL-in-arithmetic) as this exact string.
   * `from`/`to` are bare type names.
   */
  cannotConvert(from: string, to: string): string
  /** An expression the compiler could not type, as it names it in a message (C0032 family). CODESYS SP21. */
  unknownType(expr: string): string
  /** A member read off something with no members — `'THIS^' is no structured variable` (C0037). CODESYS SP21. */
  notStructuredVariable(base: string): string
  /** Implicit narrowing (`LREAL`→`REAL`): CODESYS capitalizes "Possible", TwinCAT lowercases it; no period. */
  narrowing(fromType: string, toType: string): string
  /** A same-width signed↔unsigned conversion — WARNING "change of sign". `sign` is "signed"/"unsigned". */
  signChange(fromSign: string, fromType: string, toSign: string, toType: string): string
  /** Writing an FB's non-input member from outside — identical wording on both vendors. */
  noInput(member: string, fb: string): string
  /** A lifecycle method (`FB_Init`/`FB_Exit`/`FB_ReInit`) with the wrong signature — wording differs per vendor. */
  lifecycle(method: LifecycleMethod): string
  /** `MOD` on a non-integer: TwinCAT quotes both operator and type, CODESYS quotes neither. */
  modNotDefined(type: string): string
  /** A math operator (`ABS`, `SQRT`, …) applied to a non-numeric type (C0072). verified both vendors. */
  operatorNotPossible(op: string, type: string): string
  /** Same name declared twice in one scope — identical wording on both vendors. */
  duplicateDeclaration(name: string, scope: string): string
  /** Two methods with the same name in one FB (C0582) — an unmarked overload. Volt can't push it either way.
   *  PROVISIONAL, and UNVERIFIABLE on SP21: the object tree itself refuses a second same-named method at create
   *  ("An object with the name '…' already exists within the corresponding namespace", measured by
   *  `volt-cli/scripts/probe-duplicate-method.py`), so the compiler never sees the repro by ANY path. */
  duplicateMethod(name: string): string
  /** A bare identifier that resolves in no reachable scope — byte-identical on both vendors. */
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
   * The `???` MARKER as an ASSIGNMENT TARGET — a coil or output variable with no name. A different
   * message from the operand case, and a SEMANTIC one rather than a parse error, which is why these are two
   * members and not one string.
   *
   * MEASURED LIVE (SP21): `??? := a;` answers exactly this. Behind an unconnected enable the compiler adds
   * two more about an implicit temp it invents (`__FB__ImpVar15`), whose NAME cannot be reproduced offline
   — so the LSP emits this one alone and stays a subset.
   *
   * PROVISIONAL ON TWINCAT, for the same reason as {@link unresolvedOperand}.
   */
  /**
   * The SECOND message CODESYS emits for a `???` in an operand position, about the TOKEN rather than the
   * position. Both are emitted for the same marker, so the LSP emits both too — a marker in an operand slot
   * is one of the few places the compiler's answer can be reproduced EXACTLY rather than as a subset.
   *
   * PROVISIONAL ON TWINCAT, as {@link unresolvedOperand}.
   */
  unresolvedOperandToken(): string
  unresolvedAssignTarget(): string
  undefinedIdentifier(name: string): string
  /** A bare global declared in 2+ GVLs — ambiguous unqualified reference (C0136). verified both vendors. */
  ambiguousGlobalName(name: string): string
  /** A type name used where a value is expected — `value := MyEnum` (C0230). verified both vendors. */
  typeNameNotExpected(name: string): string
  /** `x^` where `x` is not a pointer: CODESYS "a pointer" (lowercase article), TwinCAT "Pointer" (no article). */
  dereferenceRequiresPointer(): string
  /** Member access `base.member` where `member` is not declared on the base's (project) type. PROVISIONAL —
   *  no bridge recording yet, so byte-identical wording is locked at the T.1 record pass (like overflow). */
  notAMember(member: string, type: string): string
  /** Instantiating an ABSTRACT FB: "Function block" (CODESYS) vs "Functionblock" (TwinCAT, one word). */
  abstractInstantiation(fb: string): string
  /** Value-assigning to an abstract-FB target (C0511). The message names the FB TYPE. CODESYS-verified. */
  abstractAssignTarget(fb: string): string
  /** A VAR section not allowed for the containing POU: TwinCAT quotes the section name, CODESYS doesn't. */
  sectionNotAllowed(sectionKind: string): string
  /** An interface member with no implementation — identical both vendors; member + interface UPPERCASED. */
  missingInterfaceImpl(kind: "method" | "property", member: string, iface: string): string
  /** A conditional-compile pragma (`{ELSE}`/`{ELSIF}`/`{END_IF}`) with no matching `{IF}`: TwinCAT "Pragma", CODESYS "pragma". */
  orphanPragma(directive: string): string
  /** A `{IF}` conditional-compile block never closed by `{END_IF}`. Byte-identical on both vendors (confirmed against live). */
  unterminatedConditional(): string
  /**
   * An `{attribute '<name>'}` the compiler doesn't recognize. CODESYS's exact wording — note the DOUBLE
   * space before "compiler" and the unquoted name (a compiler quirk, matched byte-for-byte). TwinCAT has no
   * recording; its wording is provisional (best-effort, bridge-gated).
   */
  unknownAttribute(name: string): string
  /** An invalid VALUE for the `{attribute 'symbol'}` pragma — C0351, the symbol-export access mode. Only
   *  `none/read/write/readwrite` are legal; a typo (`'noe'`) breaks the whole PROGRAM's symbol export, so
   *  downstream C0564 init warnings cascade from it. Verified live CODESYS (SymbolConfig-prefixed wording). */
  invalidSymbolAttributeValue(value: string): string
  /** A constant array index outside the dimension's `lo..hi` bounds. PROVISIONAL (bridge-gated). */
  arrayIndexOutOfBounds(index: string, lo: string, hi: string): string
  /** A FUNCTION/METHOD called with the wrong number of inputs (C0040). verified both vendors. */
  functionRequiresInputs(callee: string, count: number): string
  /** The same rule when some inputs have DEFAULTS, so the count is a range (CODESYS SP21). */
  functionRequiresInputRange(callee: string, min: number, max: number): string
  /** An FB call with a positional argument past its last input — no input to assign it to (C0044). verified both vendors. */
  inputAssignmentMissing(param: string, callee: string): string
  /** A `name := value` naming no input of the callee (C0037). verified both vendors. */
  unknownNamedArgument(name: string, callee: string): string
  /** Component/index/call access performed directly on a function-call result (C0185). verified both vendors. */
  callResultAccess(): string
  /** A `__NEW` assignment-expression used inside another expression (C0454). Env-gated: live IDE masks it with the no-memory-pool error; conservative check, no FP. */
  newInExpression(): string
  /** A `name => target` binding naming no output of the callee (C0038). verified both vendors. */
  unknownNamedOutput(name: string, callee: string): string
  /** A VAR_IN_OUT parameter passed a non-writable (literal/constant) argument (C0041). verified both vendors. */
  inOutNeedsWritable(param: string, callee: string): string
  /** A VAR_IN_OUT CONSTANT parameter passed an integer literal or constant (conformance `inout_const_bound_forms_1`,
   *  `inout_const_fb_literal_6`). CODESYS only — TwinCAT is not recorded, so undefined there and the check stays silent. */
  inOutConstantNeedsVariable(param: string, callee: string): string | undefined
  /** A VAR_IN_OUT parameter left unassigned in a call (C0039). verified both vendors. */
  inOutMustBeAssigned(param: string, callee: string): string
  /** A VAR_IN_OUT parameter bound to an argument of a non-identical type (C0201). verified both vendors. */
  inOutTypeMismatch(argType: string, paramType: string, param: string): string
  /** A property read in a context where it has no get accessor (C0143). verified both vendors. */
  propertyLacksGetter(name: string): string
  /** A literal constant whose value can't be represented by its own/inferred type (C0001). verified both vendors. */
  constantTooLarge(value: string, type: string): string
  /** A dot-bit-access index past the accessed variable's bit width (C0003). verified both vendors. */
  invalidBitNumber(value: string, variable: string): string
  /** `[]` indexing applied to a non-array, non-pointer scalar (C0047). verified both vendors. */
  indexingNonArray(type: string): string
  /** A relational operator between two mutually-incompatible scalar types (C0066). verified both vendors. */
  cannotCompare(left: string, right: string): string
  /** An array-literal `[…]` initializer on a non-array declared type (C0074). verified both vendors. */
  unexpectedArrayInit(): string
  /** Too many elements in an array initializer (C0075). CODESYS-verified. */
  tooManyArrayInit(): string
  /** A struct-literal `(field := …)` initializer on an elementary declared type (C0076). verified both vendors. */
  unexpectedStructInit(): string
  /** A flat scalar where a nested array literal is expected — array-of-array init (C0232). verified both vendors. */
  arrayInitExpected(): string
  /** A scalar where a struct-initializer list is expected — array-of-struct init (C0233). verified both vendors. */
  initListExpected(type: string): string
  /** Two identical single CASE labels (C0216). verified both vendors. */
  caseLabelDuplicate(): string
  /** A single CASE label that also falls inside a CASE range (C0217). verified both vendors. */
  caseLabelInRange(label: string, lo: string, hi: string): string
  /** A CASE label that is a non-constant variable (C0218). verified both vendors. */
  caseLabelNonConst(): string
  /** A FOR whose end bound is beyond the counter's type range → unreachable exit test (C0266). verified both vendors. */
  loopExitConstantFalse(condition: string): string
  /** An array-initializer repeat count `n(v)` where `n` is a non-constant variable (C0162). verified both vendors. */
  arrayInitCountNonConst(count: string): string
  /** A non-constant array dimension bound (C0161). verified both vendors. */
  arrayBoundNonConst(bound: string): string
  /** A `VAR CONSTANT` variable initialized with a non-constant value (C0227). verified both vendors. */
  constInitNonConst(name: string): string
  /** A `VAR_INPUT` default value that is not a constant (C0526). verified both vendors. */
  defaultNotConstant(): string
  /** `ADR(<literal>)` — a literal has no address (C0131). verified both vendors. */
  invalidAdrOperand(value: string): string
  /** `__QueryPointer`'s first operand is not an interface reference / FB instance (C0240). verified both vendors. */
  queryPointerFirst(): string
  /** `__QueryPointer`'s second operand is not a pointer (C0241). verified both vendors. */
  queryPointerSecond(): string
  /** `__QueryInterface`'s first operand is not an interface reference / FB instance (C0234). verified both vendors. */
  queryInterfaceFirst(): string
  /** `__QueryInterface`'s second operand is not an interface reference (C0235). verified both vendors. */
  queryInterfaceSecond(): string
  /** An intrinsic operator called with the wrong exact number of operands (C0022). verified both vendors. */
  operatorNeedsExactly(op: string, count: number): string
  /** An intrinsic operator called with fewer than its minimum operands (C0023). verified both vendors. */
  operatorNeedsAtLeast(op: string, count: number): string
  /** `__DELETE(x)` where `x` is not a pointer (C0242). verified both vendors. */
  deleteOperandNotPointer(): string
  /** A pointer value implicitly assigned to a non-pointer type — a WARNING (C0033). verified both vendors. */
  pointerNotConvertible(from: string, to: string): string
  /** An assignment whose target cannot be written (e.g. a `VAR CONSTANT`) (C0018). verified both vendors. */
  notAssignmentTarget(target: string): string
  /** `REF=` whose target is not a `REFERENCE TO` variable (C0140). verified both vendors. */
  referenceAssignTarget(): string
  /** An `EXIT` statement outside any loop (C0132). verified both vendors. */
  noEnclosingLoop(verb: "exit" | "continue"): string
  /** `__NEW` used in a chained (multiple) assignment (C0509). verified both vendors. */
  multipleAssignmentNew(): string
  /** A string literal longer than its declared `STRING(n)` destination (C0198). verified both vendors. */
  /**
   * A string literal longer than its STRING(n) destination (C0198, a WARNING). The compiler prints a prefix of the literal
   * AS WRITTEN — opening quote included — cut so prefix + `...` fills n characters: n − 3 of them, or all n when n < 3
   * leaves no room. Recorded for n = 1…7 (conformance `cc_string_prefix_len_*`, `cc_string_*_too_long`): STRING(7) of
   * 'abcdefghij' prints `''abc...'`, STRING(3) prints `'...'`, STRING(2) prints `''a...'`. TwinCAT unrecorded.
   */
  stringConstantTooLong(literalText: string, destLength: number, type: string): string
  /** A relational operator applied to a composite (array) type (C0068). verified both vendors. */
  compareNotPossible(type: string): string
  /** A relational operator between two differently-typed arrays (C0069). verified both vendors. */
  compareNotPossibleTwo(left: string, right: string): string
  /** A BIT variable in a POU other than a struct/FB (C0203). verified both vendors. */
  bitInWrongContainer(): string
  /** A BIT variable in a disallowed VAR block (C0204). verified both vendors. */
  bitInWrongBlock(): string
  /** `POINTER TO BIT` (C0205). verified both vendors. */
  pointerToBit(): string
  /** `ARRAY OF BIT` (C0206). verified both vendors. */
  bitArrayBase(): string
  /** `ADR` of a BIT variable — a WARNING (C0355). verified both vendors. */
  adrOnBit(): string
  /** A statement expression with no side effect — a WARNING (C0139). verified both vendors. */
  codeHasNoEffect(code: string): string
  /** A `VAR_CONFIG` block outside a config list (C0168). verified both vendors. */
  varConfigOnlyInList(): string
  /** A function block invoked by its type name instead of an instance (C0080). verified both vendors. */
  fbMustBeInstantiated(name: string): string
  /** An interface invoked by its type name instead of an instance (C0199). verified both vendors. */
  interfaceMustBeInstantiated(name: string): string
  /** Bit access on a function-call result (C0061). verified both vendors. */
  bitAccessOnCall(): string
  /** A pointer indexed with a count other than 1 (C0126). verified both vendors. */
  pointerIndexArity(type: string): string
  /** An array indexed with the wrong number of indices (C0048). verified both vendors. */
  arrayIndexCount(dims: number): string
  /** `RETAIN`/`PERSISTENT` on a VAR block in a POU that doesn't allow it (C0175). verified both vendors. */
  retainNotAllowedHere(): string
  /** `THIS` used in a POU where it is not valid (C0045). verified both vendors. */
  thisNotAllowed(): string
  /** `SUPER` used in a POU where it is not valid (C0122). verified both vendors. */
  superNotAllowed(): string
  /** `SUPER^` in a function block that EXTENDS nothing — there is no base to name. */
  superWithoutBase(): string
  /** `INDEXOF`, which SP21 removed outright. */
  indexofRemoved(): string
  /** A `VAR_OUTPUT` declared as `REFERENCE TO` (C0222). verified both vendors. */
  outputCantBeReference(): string
  /** A variable declared with the type of a FUNCTION POU, which can't be instantiated (C0177). verified both vendors. */
  notInstantiable(typeName: string): string
  /** Use of a POU marked `{attribute 'obsolete' := 'msg'}` (C0357). verified live CODESYS; TC pending. */
  pouObsolete(name: string, message: string): string
  /** An `AT` clause whose operand is not a direct address (`i AT ABC`) — C0030. verified live CODESYS; TC pending. */
  directAddressExpectedAt(found: string): string
  /** An empty control-flow block or CASE arm (C0013/C0426) — a body with no statements. verified live CODESYS; TC pending. */
  emptyStatementBlock(): string
  /** An identifier named after an IEC-reserved keyword CODESYS soft-allows (CHAR/WCHAR/USING) — C0543. verified live CODESYS; TC pending. */
  reservedKeyword(name: string): string
  /** A `REF=` whose RHS is not a writable variable (a non-zero literal / constant) — C0141. verified live CODESYS; TC pending. */
  referenceAssignWriteAccess(): string
  /** A `hasattribute(...)` conditional-pragma whose attribute operand is unquoted — C0051. verified live CODESYS; TC pending. */
  attributeValueString(found: string): string
  abstractKeywordMissing(): string
  /** A function block that EXTENDS itself (C0091). verified both vendors. */
  circularInheritance(chain: string): string
  /** An `EXTENDS` base class that resolves to no definition (C0090). verified both vendors. */
  baseClassNotFound(name: string): string
  /** An `IMPLEMENTS` interface that resolves to no definition (C0086). verified both vendors. */
  interfaceNotFound(name: string): string
  /** An object kind that cannot be invoked at all — `Cannot call object of type 'INTERFACE'` (CODESYS SP21). */
  cannotCallObjectOfType(kind: string): string
  /** A VAR section declared directly in an INTERFACE (C0149). CODESYS SP21. */
  varInInterface(): string
  /** A POU whose signature names something other than its object (CODESYS SP21, measured 2026-09-17). */
  signatureNameMismatch(): string
  /**
   * A subrange as the target of an ASSIGNMENT, which CODESYS spells with a typed LOWER bound — `INT (INT#1..100)`
   * — where its own DECLARATION form says `INT (1..100)`. TwinCAT says the bare form in both. Recorded, not chosen
   * (conformance `subrange_assign_const_out` vs `subrange_init_above_range`).
   */
  subrangeAssignTarget(base: string, lo: bigint, hi: bigint): string
  /** An enumeration member's initial value the compiler will not take, named as written (CODESYS SP21). */
  invalidEnumInitialisation(value: string): string
  /** A known attribute given a value outside its published set (CODESYS SP21, a warning). */
  invalidAttributeValue(value: string, attribute: string, allowed: readonly string[]): string
  /** A PROPERTY declaring neither accessor (CODESYS SP21, a warning). */
  propertyWithoutAccessor(): string
  /** An FB EXTENDS-list naming more than one base FB — single inheritance only (C0096). verified both vendors. */
  multipleInheritance(): string
  /** A return type declared on a POU that is not a FUNCTION/METHOD, e.g. a PROGRAM (C0182). verified both vendors. */
  returnTypeNotAllowed(): string
  /** An interface using IMPLEMENTS where interface inheritance needs EXTENDS (C0421). verified both vendors. */
  interfaceImplementsMisused(): string
  /** `EXTENDS` on an enum/alias DUT — inheritance is only legal on FB/interface/struct (C0144). Bridge-blocked: the push is rejected before the IDE compiles it (live-confirmed). */
  inheritanceNotAllowed(): string
  /** `EXTENDS` on a UNION DUT — unions cannot inherit (C0542). verified both vendors. */
  unionInheritance(name: string): string
  /** `IMPLEMENTS` on a FUNCTION — only FBs implement interfaces (C0145). Bridge-blocked: the push is rejected before the IDE compiles it (live-confirmed). */
  functionImplements(): string
  /** A `{attribute 'pack_mode'}` pragma on a FUNCTION/METHOD (only valid on data structures) (C0550). verified both vendors. */
  packModeNotAllowed(kind: string): string
  /** A derived FB redeclares a variable already declared in a base FB (C0097). verified both vendors. */
  duplicateInheritedVariable(name: string, fb: string, base: string): string
  /** An FB/struct that (transitively) contains an instance of itself as a member (C0101). verified both vendors. */
  dataRecursion(path: string): string
  /** An enum member initialized with a value whose type can't convert to the enum's (integer) base (C0124). verified both vendors. */
  enumInitNotConvertible(fromType: string, enumName: string): string
  /** A `CONSTANT` variable declared without an initial value (C0228). verified both vendors. */
  constantNoInitialValue(name: string): string
  /** A `VAR_EXTERNAL` declaration supplying an initial value (it must come from the GVL) (C0238). verified both vendors. */
  noInitForExternal(name: string): string
  /** A `VAR_EXTERNAL` with no matching `VAR_GLOBAL` anywhere (C0237). CODESYS-verified. */
  externalNoGlobal(name: string): string
  /** A VAR_IN_OUT variable referenced in another declaration's initializer (C0441). verified both vendors. */
  inoutInInitializer(): string
  /** A composite-typed input parameter (e.g. an array) declared with a default value (C0525). verified both vendors. */
  noDefaultForType(typeName: string): string
  /** A comparison between two different enumeration types (C0354). verified both vendors. */
  enumComparison(left: string, right: string): string
  /** `INI` whose first operand is not an FB / DUT instance (C0070). verified both vendors. */
  iniNeedsInstance(): string
  /** Two overlapping CASE ranges, rendered lowest-first (C0219). verified both vendors. */
  caseOverlappingRanges(lo1: string, hi1: string, lo2: string, hi2: string): string
  /** An FB_ReInit method with any input or a non-BOOL return — it must have neither (C0566). verified both vendors. */
  fbReInitShape(): string
  /** An FB method whose signature differs from the interface method it implements (C0089). verified both vendors. */
  overrideMismatchInterface(method: string, iface: string): string
  /** An overriding method whose signature differs from the base FB's method (C0094/C0568). PROVISIONAL. */
  overrideMismatchBase(method: string, base: string): string
  /** A VAR_OUTPUT with an initializer in an abstract/interface method — the default is never used (C0533). verified both vendors. */
  defaultOutputUnused(): string
  /** `JMP` to a non-label destination — a numeric literal or expression (C0114). verified both vendors. */
  jumpInvalidDestination(dest: string): string
  /** The same jump label declared twice in one POU body (C0116). verified both vendors. */
  jumpLabelDuplicate(name: string): string
  /** `JMP` to a label that isn't declared in the POU body (C0117). verified both vendors. */
  jumpLabelUndefined(name: string): string
  /** A network-text `JMP` to an undefined label: CODESYS words it as `jumpLabelUndefined`; TwinCAT does NOT report it at
   *  all (confirmed live, conformance `cc_vg_undefined_label`) — so undefined there, and the check stays silent. */
  networkJumpLabelUndefined(name: string): string | undefined
  /** A jump label declared but never targeted by any `JMP` (C0118). verified both vendors. */
  jumpLabelUnreferenced(name: string): string
  /** External access to an FB instance's VAR_IN_OUT member — forbidden, it's a call-bound reference (C0178). verified both vendors. */
  inoutNoExternalAccess(param: string, fb: string): string
  /** A method/action touching its own FB's VAR_IN_OUT — a WARNING (modern CODESYS allows it) (C0371). */
  inoutOwnAccess(param: string, fb: string, context: string): string
  /** Inline FB-init field targets a VAR_IN_OUT (only inputs are assignable at declaration) (C0179). verified both vendors. */
  fbInitNoOutput(id: string, fb: string): string
  /** An FB whose FB_Init takes extra inputs, instantiated without them. CODESYS-measured; TwinCAT unasked. */
  fbInitInstantiation(fb: string, inputs: number, syntax: string): string
  /** Calling a GVL block — not callable (C0036). Verified live: the GVL case renders the type as 'VAR_GLOBAL'. */
  cannotCallType(type: string): string
  /** Calling a plain value (a scalar/struct var) — CODESYS asks for a program/function/FB instead (C0035). */
  callTargetExpected(name: string): string
  /** A token the parser cannot use where it stands — the compiler echoes the token AS WRITTEN: `r : INT;` reports
   *  `Unexpected token 'r' found` (lowercase). Recorded live on CODESYS SP21 (conformance `cc_reserved_name_r`,
   *  `cc_power_operator`); unmeasured on TwinCAT, so the checks that use it are CODESYS-only. */
  unexpectedToken(token: string): string
  /** The parse error that precedes `unexpectedToken` for an unknown operator: `';' expected instead of '**'`. */
  semicolonExpectedInsteadOf(token: string): string
  /** A token where an expression must start: `Expression expected instead of 'T#1500'` — a TIME literal cut at a `US`
   *  unit (conformance `cc_time_*`). Recorded on CODESYS SP21; unmeasured on TwinCAT. */
  expressionExpectedInsteadOf(token: string): string
  /** `__NEW` of an FB/struct that lacks `{attribute 'enable_dynamic_creation'}` (CODESYS-measured). */
  dynamicCreationPragma(): string
  /** `CALC` is the IL conditional call; its second parameter must be a call statement (CODESYS-measured). */
  conditionalCallSecondParameter(): string
  /** The parser wanted an opening parenthesis — `CALC` without one (CODESYS-measured). */
  parenExpectedInsteadOf(token: string): string
  /** A statement where a declaration belongs, which is what a bad `calc : INT;` leaves behind. */
  notSupportedInDeclaration(): string
  /** What a DECLARATION wanted after a name — the doubled comma is the compiler's own (CODESYS SP21). */
  commaAtOrColonExpected(token: string): string
}

export type LifecycleMethod = "FB_Init" | "FB_Exit" | "FB_ReInit"

export function messagesFor(vendor: Vendor): Messages {
  const tc = vendor === "twincat"
  const possible = tc ? "possible" : "Possible"
  return {
    cannotConvert: (from, to) => `Cannot convert type '${from}' to type '${to}'`,
    unknownType: (expr) => `Unknown type: '${expr}'`,
    narrowing: (fromType, toType) =>
      `Implicit conversion from '${fromType}' to '${toType}': ${possible} loss of information`,
    // Confirmed live both vendors (only "Possible"/"possible" differs) — note the SPACE before the colon.
    signChange: (fromSign, fromType, toSign, toType) =>
      `Implicit conversion from ${fromSign} Type '${fromType}' to ${toSign} Type '${toType}' : ${possible} change of sign`,
    noInput: (member, fb) => `'${member}' is no input of '${fb}'`,
    // JMP/label wording is PROVISIONAL (no live-bridge recording yet). CODESYS renders labels uppercased in
    // these messages (observed: source `i` → 'I'), matching IEC case-insensitivity; both vendors support JMP.
    // Live-verified both vendors (2026-07-11): TC renders the keyword as JUMP + trailing periods; CS uses JMP, no period.
    jumpInvalidDestination: (dest) => `Invalid destination ${dest} for ${tc ? "JUMP" : "JMP"}`,
    jumpLabelDuplicate: (name) => `The label '${name.toUpperCase()}' is a duplicate`,
    jumpLabelUndefined: (name) => `No such label '${name.toUpperCase()}' within the scope of the JMP statement${tc ? "." : ""}`,
    networkJumpLabelUndefined: (name) => (tc ? undefined : `No such label '${name.toUpperCase()}' within the scope of the JMP statement`),
    jumpLabelUnreferenced: (name) => `The label '${name.toUpperCase()}' has not been referenced`,
    // PROVISIONAL (no live recording yet). Object name is the FB TYPE name, matching the doc example.
    // Byte-identical both vendors (2026-07-11), incl. the trailing stray quote (`…of 'FB'."`). TC quotes
    // 'VAR_IN_OUT', CS does not — a genuine per-vendor divergence like the double-space in unknownAttribute.
    inoutNoExternalAccess: (param, fb) =>
      tc ? `No external access to 'VAR_IN_OUT' parameter '${param}' of '${fb}'."` : `No external access to VAR_IN_OUT parameter '${param}' of '${fb}'."`,
    // C0371 WARNING. Verified live: CODESYS omits the trailing period, TwinCAT adds one.
    inoutOwnAccess: (param, fb, context) =>
      `Access to VAR_IN_OUT '${param}' declared in '${fb}' from external context '${context}'${tc ? "." : ""}`,
    // CODESYS-verified (2026-07-11 live): the IDE reports the inline-init VAR_IN_OUT field as "is no input of".
    fbInitNoOutput: (id, fb) => `'${id}' is no input of '${fb}'`,
    // CODESYS SP21, measured (`fb_init_argument_left_out`). "1 inputs" is the vendor's own wording, unpluralized.
    fbInitInstantiation: (fb, inputs, syntax) =>
      `No matching 'FB_Init' method found for instantiation of ${fb}. Specified 'FB_Init' method requires exactly ${inputs} inputs. Check syntax '${syntax}'`,
    cannotCallType: (type) => `Cannot call object of type '${type}'`,
    callTargetExpected: (name) => `Program name, function or function block instance expected instead of '${name}'`,
    // The same finding, capitalised differently: CODESYS "token", TwinCAT "Token". Measured on both
    // recordings 2026-09-20 (`echo_*`, and every reserved-name cascade).
    unexpectedToken: (token) => `Unexpected ${tc ? "Token" : "token"} '${token}' found`,
    semicolonExpectedInsteadOf: (token) => `';' expected instead of '${token}'`,
    expressionExpectedInsteadOf: (token) => `Expression expected instead of '${token}'`,
    // CODESYS SP21, measured with the pragma as the only variable (`newdel_without_pragma` / `newdel_with_pragma`).
    dynamicCreationPragma: () =>
      "A function block or structure needs the pragma '{attribute 'enable_dynamic_creation'}' to be created with __NEW",
    // CODESYS SP21, measured in all five `CALC` shapes (`cc_il_name_calc`, `ilc_calc_*`).
    conditionalCallSecondParameter: () => "Second parameter of conditional call must be a valid call statement",
    parenExpectedInsteadOf: (token) => `'(' expected instead of '${token}'`,
    notSupportedInDeclaration: () => "This code is not supported in declaration part",
    commaAtOrColonExpected: (token) => `',, AT or :' expected instead of '${token}'`,
    lifecycle: (method) => {
      if (method === "FB_Init") {
        return tc
          ? "An 'FB_Init'-Method of a functionblock or struct needs two inputs 'bInitRetains' and 'bInCopyCode' of type BOOL."
          : "The FB_Init method of a function block or struct needs two inputs 'bInitRetains' and 'bInCopyCode' of type BOOL"
      }
      if (method === "FB_Exit") {
        return tc
          ? "An 'FB_Exit'-Method of a functionblock or struct needs an input 'bInCopyCode' of type BOOL."
          : "The FB_Exit method of a function block or struct must have a single input 'bInCopyCode' of type BOOL and a return value of type BOOL."
      }
      return tc ? `An '${method}'-Method has an invalid signature.` : `The ${method} method has an invalid signature.`
    },
    fbReInitShape: () =>
      `The FB_ReInit method of a function block or struct must have no inputs and a return value of type BOOL. The FB_ReInit will not be called automatically!`,
    overrideMismatchInterface: (method, iface) =>
      `Interface of overridden method '${method}' of interface '${iface}' doesn't match declaration`,
    overrideMismatchBase: (method, base) =>
      `Interface of overridden method '${method}' of base '${base}' doesn't match declaration`,
    defaultOutputUnused: () => `The default value for a VAR_OUTPUT is not used in abstract or interface methods`,
    modNotDefined: (type) => (tc ? `'MOD' is not defined for '${type}'` : `MOD is not defined for ${type}`),
    operatorNotPossible: (op, type) => `Operation '${op}' is not possible on type '${type}'`,
    duplicateDeclaration: (name, scope) => `A local variable named '${name}' is already defined in '${scope}'`,
    // PROVISIONAL doc wording (C0582) — unverifiable: the object tree refuses the duplicate at create, before any build.
    duplicateMethod: (name) =>
      `There is another method with the name '${name}'. Use the Attribute {attribute 'overloaded'} if you want to define overloaded methods.`,
    // MEASURED on both vendors now (`network_unnamed_*`, 2026-09-20) — this note used to say TwinCAT was
    // unverified and the CODESYS wording stood for both. It does not: they agree on the operand message
    // word for word, and disagree on the other two in nothing but capitalisation and a full stop.
    unresolvedOperand: () => "Expression expected instead of '?'",
    unresolvedOperandToken: () => (tc ? "Unexpected Token '?' found" : "Unexpected token '?' found"),
    unresolvedAssignTarget: () => (tc ? "Assignment target not specified" : "The assignment target is not specified."),
    undefinedIdentifier: (name) => `Identifier '${name}' not defined`,
    // Live-verified both vendors (2026-07-11): CODESYS capital "Ambiguous", TwinCAT lowercase "ambiguous".
    ambiguousGlobalName: (name) => `${tc ? "ambiguous" : "Ambiguous"} use of name '${name}'`,
    typeNameNotExpected: (name) => `Type name '${name}' not expected in this place`,
    dereferenceRequiresPointer: () => (tc ? "Dereference requires Pointer" : "Dereference requires a pointer"),
    // Confirmed via live /build: both say "is no component of"; TwinCAT uppercases the type name.
    notAMember: (member, type) => `'${member}' is no component of '${tc ? type.toUpperCase() : type}'`,
    abstractInstantiation: (fb) =>
      `${tc ? "Functionblock" : "Function block"} ${fb} is ABSTRACT and cannot be instantiated`,
    // CODESYS-verified (2026-07-11 live): names the FB TYPE, no "The"/quotes/period. TwinCAT PROVISIONAL
    // (mirrors abstractInstantiation's one-word "Functionblock").
    abstractAssignTarget: (fb) =>
      `${tc ? "Functionblock" : "Function block"} ${fb} is ABSTRACT and cannot be used as a target for an assignment`,
    sectionNotAllowed: (sectionKind) =>
      sectionKind === "VAR_GLOBAL" // C0169 — both vendors verified, different wording
        ? tc
          ? `'VAR_GLOBAL' declaration only allowed in Global variable list`
          : `VAR_GLOBAL declaration only allowed in global variable list`
        : tc
          ? `'${sectionKind}' declaration not allowed in this place`
          : `${sectionKind} declaration not allowed in this place`,
    missingInterfaceImpl: (kind, member, iface) =>
      `There is no implementation for ${kind} '${member.toUpperCase()}' defined in interface '${iface.toUpperCase()}'`,
    orphanPragma: (directive) => `Unexpected ${tc ? "Pragma" : "pragma"}: '${directive}' found without matching 'if'`,
    // Confirmed byte-identical on both vendors via live /build (CODESYS + TwinCAT, 2026-07-07).
    unterminatedConditional: () => `Unexpected End-of-file found: 'ELSIF', 'ELSE' or 'END_IF' expected`,
    // CODESYS byte-identical (double space + unquoted name). TwinCAT never emits this (live /build: compiles
    // an unknown attribute clean), so the lint is CODESYS-gated and this builder is CODESYS-only in practice.
    unknownAttribute: (name) => `The attribute ${name} is unknown and will be ignored by the  compiler.`,
    // CODESYS wording (live /build): "SymbolConfig:" prefix + the legal set. TwinCAT recording pending.
    invalidSymbolAttributeValue: (value) =>
      `SymbolConfig: Invalid value '${value}' for attribute 'symbol'. Should be one of: none, read, write, readwrite`,
    // Confirmed byte-identical on both vendors via live /build (2026-07-07).
    arrayIndexOutOfBounds: (index, lo, hi) =>
      `The constant index '${index}' is not within the range from '${lo}' to '${hi}'`,
    // Call-argument wording is PROVISIONAL — no live-bridge recording yet (like arrayIndexOutOfBounds was).
    functionRequiresInputs: (callee, count) => `Function '${callee}' requires exactly '${count}' inputs`,
    functionRequiresInputRange: (callee, min, max) => `Function '${callee}' requires at least '${min}' and maximum '${max}' inputs`,
    inputAssignmentMissing: (param, callee) => `Assignment to input missing for parameter '${param}' in call of '${callee}'`,
    unknownNamedArgument: (name, callee) => `'${name}' is no input of '${callee}'`,
    callResultAccess: () =>
      `It is not possible to perform component access '.', index access '[]' or call '()' on result of function call. Assign result to help variable first.`,
    newInExpression: () =>
      `It is not possible to use an assignment expression with the __NEW operator in another expression. Use the pointer variable instead.`,
    unknownNamedOutput: (name, callee) => `'${name}' is no output of '${callee}'`,
    inOutNeedsWritable: (param, callee) =>
      tc
        ? `VAR_IN_OUT parameter '${param}' of '${callee}' needs variable with write access as input`
        : `VAR_IN_OUT respectively REFERENCE parameter '${param}' of '${callee}' needs variable with write access as input`,
    inOutConstantNeedsVariable: (param, callee) => (tc ? undefined : `VAR_IN_OUT CONSTANT parameter '${param}' of '${callee}' needs variable as input`),
    inOutMustBeAssigned: (param, callee) => `VAR_IN_OUT '${param}' must be assigned in call of '${callee}'`,
    inOutTypeMismatch: (argType, paramType, param) =>
      tc
        ? `Type '${argType}' is not equal to type '${paramType}' of VAR_IN_OUT '${param}'`
        : `Type '${argType}' is not equal to type '${paramType}' of VAR_IN_OUT respectively REFERENCE '${param}'`,
    propertyLacksGetter: (name) => `The property '${name}' cannot be used in this context because it lacks the get accessor`,
    // Docs wording (13-error-messages #C0001); byte-identical on both vendors until a live recording locks it.
    constantTooLarge: (value, type) => `Constant '${value}' too large for type '${type}'`,
    invalidBitNumber: (value, variable) => `'${value}' is no valid bit number for '${variable}'`,
    indexingNonArray: (type) => `Cannot apply indexing with [] to an expression of type '${type}'`,
    cannotCompare: (left, right) => `Cannot compare type '${left}' with type '${right}'`,
    unexpectedArrayInit: () => `Unexpected array initialisation`,
    tooManyArrayInit: () => `Too many initializers for array`,
    unexpectedStructInit: () => `Unexpected structure initialisation`,
    arrayInitExpected: () => `Array initialisation expected`,
    initListExpected: (type) => `Initialisation list for ${type} expected`,
    caseLabelDuplicate: () => (tc ? `Case label duplicate` : `CASE label duplicate`),
    caseLabelInRange: (label, lo, hi) => (tc ? `Case label ${label} also contained in range ${lo} .. ${hi}` : `CASE label ${label} also contained in range ${lo} .. ${hi}`),
    caseLabelNonConst: () => (tc ? `Case label requires literal or symbolic integer constant` : `CASE label requires literal or symbolic integer constant`),
    // Live-verified both vendors (2026-07-11): CODESYS ends "loop.", TwinCAT ends "loop!". Cond `<counter> <op> <bound>`.
    loopExitConstantFalse: (condition) => `Loop exit condition '${condition}' is constant FALSE. Possible endless loop${tc ? "!" : "."}`,
    arrayInitCountNonConst: (count) => `Number '${count}' of array initialisations is no constant value`,
    arrayBoundNonConst: (bound) => `Border '${bound}' of array is no constant value`,
    constInitNonConst: (name) => `Initialisation of constant variable '${name}' not constant`,
    defaultNotConstant: () => `Default value is not constant`,
    invalidAdrOperand: (value) => `'${value}' is not allowed as operand for ADR`,
    // TwinCAT capitalizes "Operand"; CODESYS uses lowercase (both live-verified). C0241's TC form also drops
    // the article ("must be pointer") and keeps CODESYS's __QueryInterface typo.
    queryPointerFirst: () =>
      tc
        ? `First Operand of __QueryPointer must be an interface reference or the instance of a function block`
        : `First operand of __QueryPointer must be an interface reference or the instance of a function block`,
    queryPointerSecond: () =>
      tc ? `Second Operand of __QueryInterface must be pointer` : `Second operand of __QueryInterface must be a pointer`,
    queryInterfaceFirst: () =>
      tc
        ? `First Operand of __QueryInterface must be an interface reference or the instance of a function block`
        : `First operand of __QueryInterface must be an interface reference or the instance of a function block`,
    queryInterfaceSecond: () =>
      tc ? `Second Operand of __QueryInterface must be an interface reference` : `Second operand of __QueryInterface must be an interface reference`,
    operatorNeedsExactly: (op, count) => (tc ? `'${op}' needs exactly '${count}' Operands` : `'${op}' needs exactly '${count}' operands`),
    operatorNeedsAtLeast: (op, count) => (tc ? `'${op}' needs at least '${count}' Operands` : `'${op}' needs at least '${count}' operands`),
    deleteOperandNotPointer: () => `Operand of __DELETE must be pointer`,
    // Mirror the IDE: it reports a non-convertible pointer with the same "Cannot convert" wording as C0032
    // (both vendors, live-verified) — not a distinct "possibly not convertible" phrasing.
    pointerNotConvertible: (from, to) => `Cannot convert type '${from}' to type '${to}'`,
    notAssignmentTarget: (target) => `'${target}' is no valid assignment target`,
    notStructuredVariable: (base) => `'${base}' is no structured variable`,
    referenceAssignTarget: () => (tc ? `Reference assign is only allowed to variables of Reference type` : `Reference assign is only allowed to variables of reference type`),
    noEnclosingLoop: (verb) => `No enclosing loop of which to ${verb}`,
    multipleAssignmentNew: () => `Multiple assignments are not allowed for operator '__New'.`,
    // Mirror the IDE: it elides the actual string content to `'...'` (both vendors), so we do too rather than
    // echoing the value (the goal is byte-identical IDE parity, not a more-informative message).
    stringConstantTooLong: (literalText, destLength, type) =>
      `String constant '${literalText.slice(0, destLength >= 3 ? destLength - 3 : destLength)}...' too long for destination type '${type}'`,
    compareNotPossible: (type) => `Compare not possible on objects of type '${type}'`,
    compareNotPossibleTwo: (left, right) => `Compare not possible on objects of type '${left}' or '${right}'`,
    bitInWrongContainer: () => (tc ? `Only Structures and Function Blocks can contain variables of type BIT.` : `Only structures and function blocks can contain variables of type BIT`),
    bitInWrongBlock: () => (tc ? `Variables of type BIT must be declared within a VAR_INPUT, VAR_OUTPUT or VAR-block` : `Variables of type BIT must be declared within a VAR_INPUT, VAR_OUTPUT, or VAR section`),
    pointerToBit: () => `POINTER TO BIT is not allowed`,
    bitArrayBase: () => `BIT is not allowed as base type of an array`,
    adrOnBit: () => `A single bit cannot be referenced. A reference to the complete byte will be stored.`,
    codeHasNoEffect: (code) => `The code '${code}' has no effect. Is this the intent?`,
    varConfigOnlyInList: () => (tc ? `'VAR_CONFIG' declaration only allowed in VAR_CONFIG - list` : `VAR_CONFIG declaration only allowed in VAR_CONFIG  list`),
    fbMustBeInstantiated: (name) => (tc ? `Functionblock '${name}' must be instantiated to be accessed` : `Function block '${name}' must be instantiated to be accessed`),
    interfaceMustBeInstantiated: (name) => `Interface '${name}' must be instantiated to be accessed`,
    bitAccessOnCall: () => (tc ? `Bitaccess on function call is not allowed` : `Bit access on function call is not allowed`),
    pointerIndexArity: (type) => `Variable of type '${type}' requires exactly 1 Index`,
    arrayIndexCount: (dims) => `Array requires exactly ${dims} indexes`,
    retainNotAllowedHere: () => (tc ? `'RETAIN' or 'PERSISTENT' not allowed in this place` : `RETAIN or PERSISTENT not allowed in this place`),
    thisNotAllowed: () => (tc ? `Expression 'THIS' is not allowed in this context` : `Expression THIS is not allowed in this context`),
    superNotAllowed: () => (tc ? `Expression 'SUPER' is not allowed in this context` : `Expression SUPER is not allowed in this context`),
    // Measured on CODESYS (`refuse_super_without_base`): the compiler does not say "there is no base", it says the
    // thing in call position is not callable — because with nothing to extend, `SUPER^` names nothing at all.
    superWithoutBase: () => `Program name, function or function block instance expected instead of 'SUPER^'`,
    // Both vendors removed it and both say so; they disagree on nothing but capitalisation (`atomic_indexof_variable`,
    // `operand_indexof`, measured on both recordings 2026-09-20).
    indexofRemoved: () =>
      tc
        ? `the operator 'INDEXOF' is no longer supported. Use ADR instead. ADR on a POU-Name returns a Pointer to a Pointer to the function code.`
        : `The operator INDEXOF is no longer supported. Use ADR instead. ADR on a POU name returns a pointer to a pointer to the function code.`,
    outputCantBeReference: () => (tc ? `Outputs can't be of type 'REFERENCE TO'` : `Outputs can't be of type REFERENCE TO`),
    notInstantiable: (typeName) => `'${typeName}' is of type FUNCTION and cannot be instantiated`,
    pouObsolete: (name, message) => `POU '${name}' has been marked as obsolete: ${message}`,
    directAddressExpectedAt: (found) =>
      tc ? `Direct Address expected after "AT" instead of ${found}` : `Direct address expected after AT instead of ${found}`,
    emptyStatementBlock: () => `At least one statement is expected`,
    reservedKeyword: (name) =>
      `The name '${name.toUpperCase()}' is a reserved keyword in the IEC61131-3 standard. An error will be reported in future versions.`,
    referenceAssignWriteAccess: () => `Reference assign needs variable with write access`,
    attributeValueString: (found) => `Single byte string expected for an attribute value instead of '${found}'`,
    abstractKeywordMissing: () => `The ABSTRACT keyword is missing`,
    // TwinCAT UPPER-CASES the names in the chain, CODESYS echoes them as declared — the only difference between
    // the two recordings of `cc2_circular_inheritance` (2026-09-20).
    circularInheritance: (chain) => `Recursion in base function block list: ${tc ? chain.toUpperCase() : chain}`,
    baseClassNotFound: (name) => `No definition found for base class '${name}'`,
    interfaceNotFound: (name) => `No definition found for interface '${name}'`,
    cannotCallObjectOfType: (kind) => `Cannot call object of type '${kind}'`,
    varInInterface: () => `Variable declarations are not allowed in interfaces`,
    signatureNameMismatch: () => `The name used in the signature is not identical to the object name`,
    subrangeAssignTarget: (base, lo, hi) => `${base} (${tc ? lo : `INT#${lo}`}..${hi})`,
    invalidEnumInitialisation: (value) => `${value} is no valid initialisation for an enumeration`,
    invalidAttributeValue: (value, attribute, allowed) =>
      `Invalid value '${value}' for attribute '${attribute}' should be one of: [${allowed.map((a) => `'${a}'`).join(", ")}]`,
    propertyWithoutAccessor: () => `The property defines neither a get nor a set accessor.`,
    multipleInheritance: () =>
      tc ? `Only one base function block may be defined in EXTENDS-list` : `Only one base function block may be defined in EXTENDS list`,
    returnTypeNotAllowed: () =>
      tc ? `Return type is only possible for POUs of Type FUNCTION and METHOD` : `Return type is only possible for POUs of type FUNCTION and METHOD`,
    interfaceImplementsMisused: () =>
      tc
        ? `Use Keyword EXTENDS for inheritance of Interfaces instead of IMPLEMENTS.`
        : `Use keyword EXTENDS for inheritance of interfaces instead of IMPLEMENTS`,
    inheritanceNotAllowed: () => `Inheritance only allowed in function blocks, Interfaces and Structures`,
    unionInheritance: (name) => `Inheritance is not intended for data type "UNION": ${name}`,
    functionImplements: () => `Interfaces can only be implemented by function blocks`,
    packModeNotAllowed: (kind) => `Attribute 'pack_mode' not allowed for '${kind}'`,
    duplicateInheritedVariable: (name, fb, base) =>
      `Duplicate definition of variable '${name}' in function block '${fb}' and in base '${base}'`,
    dataRecursion: (path) => (tc ? `Data Recursion: ${path}` : `Data recursion: ${path}`),
    enumInitNotConvertible: (fromType, enumName) => `Cannot convert type '${fromType}' to type '${enumName}'`,
    constantNoInitialValue: (name) => `No initial value for constant variable '${name}'`,
    noInitForExternal: (name) => `No initial value allowed for VAR_EXTERNAL ${name}`,
    // CODESYS-verified (2026-07-11 live): no quotes around the name.
    externalNoGlobal: (name) => `No global definition found for VAR_EXTERNAL ${name}`,
    inoutInInitializer: () => `Access to uninitialized VAR_IN_OUT variable`,
    noDefaultForType: (typeName) => `The type ${typeName} cannot have a default value in this context`,
    enumComparison: (left, right) => `Comparison of one enumeration type (${left}) with another (${right})`,
    iniNeedsInstance: () => (tc ? `'INI' operator needs function block instance or data unit type instance` : `INI operator needs function block instance or data unit type instance`),
    caseOverlappingRanges: (lo1, hi1, lo2, hi2) => (tc ? `Case contains overlapping range ${lo1} .. ${hi1} and ${lo2} .. ${hi2}` : `CASE contains overlapping range ${lo1} .. ${hi1} and ${lo2} .. ${hi2}`),
  }
}

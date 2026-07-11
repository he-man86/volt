/**
 * Per-vendor diagnostic message builders (Layer D, D.1). Every diagnostic the LSP shares with a
 * compiler must read BYTE-IDENTICAL to it, per vendor — that parity is enforced by the conformance
 * oracle (T.1). Routing all wording through this one module is what makes a new check parity-correct
 * by construction. Vendor differences are data here, not scattered `if (vendor === …)` in the checks.
 */
import type { Vendor } from "./config.js"

export interface Messages {
  /**
   * The compilers' uniform type-mismatch message — BOTH vendors render every implicit-conversion
   * failure (assignment narrowing, wrong conversion source, BOOL-in-arithmetic) as this exact string.
   * `from`/`to` are bare type names.
   */
  cannotConvert(from: string, to: string): string
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
   *  PROVISIONAL: the bridge rejects the push, so this wording can't be live-verified. */
  duplicateMethod(name: string): string
  /** A bare identifier that resolves in no reachable scope — byte-identical on both vendors. */
  undefinedIdentifier(name: string): string
  /** A bare global declared in 2+ GVLs — ambiguous unqualified reference (C0136). verified both vendors. */
  ambiguousGlobalName(name: string): string
  /** A declared type name that resolves nowhere (`x : BOL`). PROVISIONAL — no bridge recording yet (bridge-gated). */
  unknownType(name: string): string
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
  /** A `{IF}` conditional-compile block never closed by `{END_IF}`. Byte-identical on both vendors (confirmed against live :8556/:8555). */
  unterminatedConditional(): string
  /**
   * An `{attribute '<name>'}` the compiler doesn't recognize. CODESYS's exact wording — note the DOUBLE
   * space before "compiler" and the unquoted name (a compiler quirk, matched byte-for-byte). TwinCAT has no
   * recording; its wording is provisional (best-effort, bridge-gated).
   */
  unknownAttribute(name: string): string
  /** A constant array index outside the dimension's `lo..hi` bounds. PROVISIONAL (bridge-gated). */
  arrayIndexOutOfBounds(index: string, lo: string, hi: string): string
  /** A FUNCTION/METHOD called with the wrong number of inputs (C0040). verified both vendors. */
  functionRequiresInputs(callee: string, count: number): string
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
  /** A VAR_IN_OUT parameter left unassigned in a call (C0039). verified both vendors. */
  inOutMustBeAssigned(param: string, callee: string): string
  /** A VAR_IN_OUT parameter bound to an argument of a non-identical type (C0201). verified both vendors. */
  inOutTypeMismatch(argType: string, paramType: string, param: string): string
  /** A property read in a context where it has no get accessor (C0143). verified both vendors. */
  propertyLacksGetter(name: string): string
  /** A method referenced as a value without a call `()` (C0130). Semantic-alias: IDE errors under a different code (live-confirmed) — real detection. */
  methodReferencedWithoutParens(name: string): string
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
  noEnclosingLoop(): string
  /** `__NEW` used in a chained (multiple) assignment (C0509). verified both vendors. */
  multipleAssignmentNew(): string
  /** A string literal longer than its declared `STRING(n)` destination (C0198). verified both vendors. */
  stringConstantTooLong(value: string, type: string): string
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
  /** A `VAR_OUTPUT` declared as `REFERENCE TO` (C0222). verified both vendors. */
  outputCantBeReference(): string
  /** A variable declared with the type of a FUNCTION POU, which can't be instantiated (C0177). verified both vendors. */
  notInstantiable(typeName: string): string
  /** A function block that EXTENDS itself (C0091). verified both vendors. */
  circularInheritance(chain: string): string
  /** An `EXTENDS` base class that resolves to no definition (C0090). verified both vendors. */
  baseClassNotFound(name: string): string
  /** An `IMPLEMENTS` interface that resolves to no definition (C0086). verified both vendors. */
  interfaceNotFound(name: string): string
  /** An FB EXTENDS-list naming more than one base FB — single inheritance only (C0096). verified both vendors. */
  multipleInheritance(): string
  /** A return type declared on a POU that is not a FUNCTION/METHOD, e.g. a PROGRAM (C0182). verified both vendors. */
  returnTypeNotAllowed(): string
  /** An interface using IMPLEMENTS where interface inheritance needs EXTENDS (C0421). verified both vendors. */
  interfaceImplementsMisused(): string
  /** A VAR section declared directly in an INTERFACE body — signatures only (C0149). Bridge-blocked: the push is rejected before the IDE compiles it (live-confirmed). */
  varInInterface(): string
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
  /** A FUNCTION that calls itself (recursion, without the `recursive` attribute) (C0224). Semantic-alias: IDE errors as a type/resolution error (live-confirmed) — real detection. */
  callRecursion(path: string): string
  /** An enum member initialized with a value whose type can't convert to the enum's (integer) base (C0124). verified both vendors. */
  enumInitNotConvertible(fromType: string, enumName: string): string
  /** A `CONSTANT` variable declared without an initial value (C0228). verified both vendors. */
  constantNoInitialValue(name: string): string
  /** A `VAR_EXTERNAL` declaration supplying an initial value (it must come from the GVL) (C0238). verified both vendors. */
  noInitForExternal(name: string): string
  /** A `VAR_EXTERNAL` with no matching `VAR_GLOBAL` anywhere (C0237). CODESYS-verified. */
  externalNoGlobal(name: string): string
  /** The deprecated `FUNCTIONBLOCK` keyword (use `FUNCTION_BLOCK`) (C0098). Bridge-blocked: the push is rejected (unrecognized header) before compile (live-confirmed). */
  deprecatedFunctionBlock(): string
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
  /** A jump label declared but never targeted by any `JMP` (C0118). verified both vendors. */
  jumpLabelUnreferenced(name: string): string
  /** External access to an FB instance's VAR_IN_OUT member — forbidden, it's a call-bound reference (C0178). verified both vendors. */
  inoutNoExternalAccess(param: string, fb: string): string
  /** A method/action touching its own FB's VAR_IN_OUT — a WARNING (modern CODESYS allows it) (C0371). */
  inoutOwnAccess(param: string, fb: string, context: string): string
  /** Inline FB-init field targets a VAR_IN_OUT (only inputs are assignable at declaration) (C0179). verified both vendors. */
  fbInitNoOutput(id: string, fb: string): string
  /** Calling a GVL block — not callable (C0036). Verified live: the GVL case renders the type as 'VAR_GLOBAL'. */
  cannotCallType(type: string): string
  /** Calling a plain value (a scalar/struct var) — CODESYS asks for a program/function/FB instead (C0035). */
  callTargetExpected(name: string): string
}

export type LifecycleMethod = "FB_Init" | "FB_Exit" | "FB_ReInit"

export function messagesFor(vendor: Vendor): Messages {
  const tc = vendor === "twincat"
  const possible = tc ? "possible" : "Possible"
  return {
    cannotConvert: (from, to) => `Cannot convert type '${from}' to type '${to}'`,
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
    jumpLabelUnreferenced: (name) => `The label '${name.toUpperCase()}' has not been referenced`,
    // PROVISIONAL (no live recording yet). Object name is the FB TYPE name, matching the doc example.
    // Byte-identical both vendors (2026-07-11), incl. the trailing stray quote (`…of 'FB'."`). TC quotes
    // 'VAR_IN_OUT', CS does not — a genuine per-vendor divergence like the double-space in unknownAttribute.
    inoutNoExternalAccess: (param, fb) =>
      tc ? `No external access to 'VAR_IN_OUT' parameter '${param}' of '${fb}'."` : `No external access to VAR_IN_OUT parameter '${param}' of '${fb}'."`,
    // Live-verify pending (bridge up) — from the lenze-mid build the exact form is this. WARNING severity.
    inoutOwnAccess: (param, fb, context) =>
      `Access to VAR_IN_OUT '${param}' declared in '${fb}' from external context '${context}'`,
    // CODESYS-verified (2026-07-11 live :8556): the IDE reports the inline-init VAR_IN_OUT field as "is no input of".
    fbInitNoOutput: (id, fb) => `'${id}' is no input of '${fb}'`,
    cannotCallType: (type) => `Cannot call object of type '${type}'`,
    callTargetExpected: (name) => `Program name, function or function block instance expected instead of '${name}'`,
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
    // PROVISIONAL — bridge rejects the push (CreateChild name collision), so unverifiable. Doc wording (C0582).
    duplicateMethod: (name) =>
      `There is another method with the name '${name}'. Use the Attribute {attribute 'overloaded'} if you want to define overloaded methods.`,
    undefinedIdentifier: (name) => `Identifier '${name}' not defined`,
    // Live-verified both vendors (2026-07-11): CODESYS capital "Ambiguous", TwinCAT lowercase "ambiguous".
    ambiguousGlobalName: (name) => `${tc ? "ambiguous" : "Ambiguous"} use of name '${name}'`,
    // PROVISIONAL — CODESYS emits `Unknown type: '<name>'`; TwinCAT wording unconfirmed (locked at the T.1 record pass).
    unknownType: (name) => `Unknown type: '${name}'`,
    typeNameNotExpected: (name) => `Type name '${name}' not expected in this place`,
    dereferenceRequiresPointer: () => (tc ? "Dereference requires Pointer" : "Dereference requires a pointer"),
    // Confirmed via live /build (:8556 + :8555): both say "is no component of"; TwinCAT uppercases the type name.
    notAMember: (member, type) => `'${member}' is no component of '${tc ? type.toUpperCase() : type}'`,
    abstractInstantiation: (fb) =>
      `${tc ? "Functionblock" : "Function block"} ${fb} is ABSTRACT and cannot be instantiated`,
    // CODESYS-verified (2026-07-11 live :8556): names the FB TYPE, no "The"/quotes/period. TwinCAT PROVISIONAL
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
    // Confirmed byte-identical on both vendors via live /build (:8556 CODESYS + :8555 TwinCAT, 2026-07-07).
    unterminatedConditional: () => `Unexpected End-of-file found: 'ELSIF', 'ELSE' or 'END_IF' expected`,
    // CODESYS byte-identical (double space + unquoted name). TwinCAT never emits this (live /build: compiles
    // an unknown attribute clean), so the lint is CODESYS-gated and this builder is CODESYS-only in practice.
    unknownAttribute: (name) => `The attribute ${name} is unknown and will be ignored by the  compiler.`,
    // Confirmed byte-identical on both vendors via live /build (2026-07-07).
    arrayIndexOutOfBounds: (index, lo, hi) =>
      `The constant index '${index}' is not within the range from '${lo}' to '${hi}'`,
    // Call-argument wording is PROVISIONAL — no live-bridge recording yet (like arrayIndexOutOfBounds was).
    functionRequiresInputs: (callee, count) => `Function '${callee}' requires exactly '${count}' inputs`,
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
    inOutMustBeAssigned: (param, callee) => `VAR_IN_OUT '${param}' must be assigned in call of '${callee}'`,
    inOutTypeMismatch: (argType, paramType, param) =>
      tc
        ? `Type '${argType}' is not equal to type '${paramType}' of VAR_IN_OUT '${param}'`
        : `Type '${argType}' is not equal to type '${paramType}' of VAR_IN_OUT respectively REFERENCE '${param}'`,
    propertyLacksGetter: (name) => `The property '${name}' cannot be used in this context because it lacks the get accessor`,
    methodReferencedWithoutParens: (name) => `METHOD '${name}' referenced without parentheses '()'`,
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
    referenceAssignTarget: () => (tc ? `Reference assign is only allowed to variables of Reference type` : `Reference assign is only allowed to variables of reference type`),
    noEnclosingLoop: () => `No enclosing loop of which to exit`,
    multipleAssignmentNew: () => `Multiple assignments are not allowed for operator '__New'.`,
    // Mirror the IDE: it elides the actual string content to `'...'` (both vendors), so we do too rather than
    // echoing the value (the goal is byte-identical IDE parity, not a more-informative message).
    stringConstantTooLong: (_value, type) => `String constant ''...' too long for destination type '${type}'`,
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
    outputCantBeReference: () => (tc ? `Outputs can't be of type 'REFERENCE TO'` : `Outputs can't be of type REFERENCE TO`),
    notInstantiable: (typeName) => `'${typeName}' is of type FUNCTION and cannot be instantiated`,
    circularInheritance: (chain) => `Recursion in base function block list: ${chain}`,
    baseClassNotFound: (name) => `No definition found for base class '${name}'`,
    interfaceNotFound: (name) => `No definition found for interface '${name}'`,
    multipleInheritance: () =>
      tc ? `Only one base function block may be defined in EXTENDS-list` : `Only one base function block may be defined in EXTENDS list`,
    returnTypeNotAllowed: () =>
      tc ? `Return type is only possible for POUs of Type FUNCTION and METHOD` : `Return type is only possible for POUs of type FUNCTION and METHOD`,
    interfaceImplementsMisused: () =>
      tc
        ? `Use Keyword EXTENDS for inheritance of Interfaces instead of IMPLEMENTS.`
        : `Use keyword EXTENDS for inheritance of interfaces instead of IMPLEMENTS`,
    varInInterface: () => `Variable declarations are not allowed in interfaces`,
    inheritanceNotAllowed: () => `Inheritance only allowed in function blocks, Interfaces and Structures`,
    unionInheritance: (name) => `Inheritance is not intended for data type "UNION": ${name}`,
    functionImplements: () => `Interfaces can only be implemented by function blocks`,
    packModeNotAllowed: (kind) => `Attribute 'pack_mode' not allowed for '${kind}'`,
    duplicateInheritedVariable: (name, fb, base) =>
      `Duplicate definition of variable '${name}' in function block '${fb}' and in base '${base}'`,
    dataRecursion: (path) => (tc ? `Data Recursion: ${path}` : `Data recursion: ${path}`),
    callRecursion: (path) => `Call Recursion: ${path}`,
    enumInitNotConvertible: (fromType, enumName) => `Cannot convert type '${fromType}' to type '${enumName}'`,
    constantNoInitialValue: (name) => `No initial value for constant variable '${name}'`,
    noInitForExternal: (name) => `No initial value allowed for VAR_EXTERNAL ${name}`,
    // CODESYS-verified (2026-07-11 live :8556): no quotes around the name.
    externalNoGlobal: (name) => `No global definition found for VAR_EXTERNAL ${name}`,
    deprecatedFunctionBlock: () => `The keyword "FUNCTIONBLOCK" is no longer supported. Use "FUNCTION_BLOCK" instead.`,
    inoutInInitializer: () => `Access to uninitialized VAR_IN_OUT variable`,
    noDefaultForType: (typeName) => `The type ${typeName} cannot have a default value in this context`,
    enumComparison: (left, right) => `Comparison of one enumeration type (${left}) with another (${right})`,
    iniNeedsInstance: () => (tc ? `'INI' operator needs function block instance or data unit type instance` : `INI operator needs function block instance or data unit type instance`),
    caseOverlappingRanges: (lo1, hi1, lo2, hi2) => (tc ? `Case contains overlapping range ${lo1} .. ${hi1} and ${lo2} .. ${hi2}` : `CASE contains overlapping range ${lo1} .. ${hi1} and ${lo2} .. ${hi2}`),
  }
}

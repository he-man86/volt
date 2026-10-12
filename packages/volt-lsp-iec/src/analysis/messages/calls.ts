/**
 * DIAGNOSTIC WORDING — the `checks/calls/` group's.
 *
 * One slice of `Messages` (`index.ts`); every template is written once for both vendors — a vendor difference is a
 * switch on `tc` inside it, never a second copy (openspec lsp-same-standard design.md §2.2).
 */
import type { VendorWording } from "./shared.js"

export interface CallMessages {
  /** A math operator (`ABS`, `SQRT`, …) applied to a non-numeric type (C0072). verified both vendors. */
  operatorNotPossible(op: string, type: string): string
  /** `LOWER_BOUND`/`UPPER_BOUND` on an array whose bounds are FIXED — a TwinCAT rule; CODESYS folds them. */
  boundsNeedVariableLength(): string
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
  /** A `name => target` binding naming no output of the callee (C0038). verified both vendors. */
  unknownNamedOutput(name: string, callee: string): string
  /** A VAR_IN_OUT parameter passed a non-writable (literal/constant) argument (C0041). verified both vendors. */
  inOutNeedsWritable(param: string, callee: string): string
  /** An ANY / ANY_* input passed a literal (C0041's sentence for a generic parameter): both vendors alike,
   *  `lt_literal_any_int_argument` (frontend-conformance 4.2, 2026-10-03). */
  anyNeedsWritable(param: string, callee: string): string
  /** A VAR_IN_OUT CONSTANT parameter passed an integer literal or constant (conformance `inout_const_bound_forms_1`,
   *  `inout_const_fb_literal_6`). Both vendors, identical (TwinCAT's recording of both, read in analysis-conformance 3.8 —
   *  this said TwinCAT was not recorded and stayed silent there). */
  inOutConstantNeedsVariable(param: string, callee: string): string
  /** A property bound to a VAR_IN_OUT — CODESYS's own sentence (`calls_inout_bound_to_property`, 2026-10-06); TwinCAT says
   *  `inOutNeedsWritable`'s, so undefined there. */
  propertyBoundToInOut(): string | undefined
  /** A VAR_IN_OUT parameter left unassigned in a call (C0039). verified both vendors. */
  inOutMustBeAssigned(param: string, callee: string): string
  /** A VAR_IN_OUT parameter bound to an argument of a non-identical type (C0201). verified both vendors. */
  inOutTypeMismatch(argType: string, paramType: string, param: string): string
  /** A STRING bound to a VAR_IN_OUT that declares more units (`string_inout_narrower`, both vendors 2026-10-11): TwinCAT
   *  names the parameter and the variable the other way round. */
  stringTooShortForInOut(variable: string, param: string, callee: string): string
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
  /** `__DELETE(x)` where `x` is not a pointer (C0242). verified both vendors. */
  deleteOperandNotPointer(): string
  /** `ADR` of a BIT variable — a WARNING (C0355). verified both vendors. */
  adrOnBit(): string
  /** A function block invoked by its type name instead of an instance (C0080). verified both vendors. */
  fbMustBeInstantiated(name: string): string
  /** An interface invoked by its type name instead of an instance (C0199). verified both vendors. */
  interfaceMustBeInstantiated(name: string): string
  /** `INDEXOF`, which SP21 removed outright. */
  indexofRemoved(): string
  /** An object kind that cannot be invoked at all — `Cannot call object of type 'INTERFACE'` (CODESYS SP21). */
  cannotCallObjectOfType(kind: string): string
  /** `INI` whose first operand is not an FB / DUT instance (C0070). verified both vendors. */
  iniNeedsInstance(): string
  /** Calling a GVL block — not callable (C0036). Verified live: the GVL case renders the type as 'VAR_GLOBAL'. */
  cannotCallType(type: string): string
}

export function callMessages({ tc }: VendorWording): CallMessages {
  return {
    cannotCallType: (type) => `Cannot call object of type '${type}'`,
    operatorNotPossible: (op, type) => `Operation '${op}' is not possible on type '${type}'`,
    // TwinCAT alone: `LOWER_BOUND(grid, 1)` on an `ARRAY[-1..1, 3..9]` is refused there and folded by CODESYS
    // (`callshape_bounds_of_sized_array`, and `callshape_array_star_*` clean on both, 2026-09-20).
    boundsNeedVariableLength: () => "The Operators LOWER_BOUND and UPPER_BOUND are only supported for arrays of variable length",
    // Call-argument wording is PROVISIONAL — no live-bridge recording yet (like arrayIndexOutOfBounds was).
    functionRequiresInputs: (callee, count) => `Function '${callee}' requires exactly '${count}' inputs`,
    functionRequiresInputRange: (callee, min, max) => `Function '${callee}' requires at least '${min}' and maximum '${max}' inputs`,
    inputAssignmentMissing: (param, callee) => `Assignment to input missing for parameter '${param}' in call of '${callee}'`,
    unknownNamedArgument: (name, callee) => `'${name}' is no input of '${callee}'`,
    callResultAccess: () =>
      `It is not possible to perform component access '.', index access '[]' or call '()' on result of function call. Assign result to help variable first.`,
    unknownNamedOutput: (name, callee) => `'${name}' is no output of '${callee}'`,
    anyNeedsWritable: (param, callee) => `ANY parameter '${param}' of '${callee}' needs variable with write access as input`,
    inOutNeedsWritable: (param, callee) =>
      tc
        ? `VAR_IN_OUT parameter '${param}' of '${callee}' needs variable with write access as input`
        : `VAR_IN_OUT respectively REFERENCE parameter '${param}' of '${callee}' needs variable with write access as input`,
    inOutConstantNeedsVariable: (param, callee) => `VAR_IN_OUT CONSTANT parameter '${param}' of '${callee}' needs variable as input`,
    propertyBoundToInOut: () => (tc ? undefined : `Properties can't be assigned to VAR_IN_OUT.`),
    inOutMustBeAssigned: (param, callee) => `VAR_IN_OUT '${param}' must be assigned in call of '${callee}'`,
    inOutTypeMismatch: (argType, paramType, param) =>
      tc
        ? `Type '${argType}' is not equal to type '${paramType}' of VAR_IN_OUT '${param}'`
        : `Type '${argType}' is not equal to type '${paramType}' of VAR_IN_OUT respectively REFERENCE '${param}'`,
    stringTooShortForInOut: (variable, param, callee) =>
      `String variable '${tc ? param : variable}' too short for the VAR_IN_OUT parameter '${tc ? variable : param}' of '${callee}'`,
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
    deleteOperandNotPointer: () => `Operand of __DELETE must be pointer`,
    adrOnBit: () => `A single bit cannot be referenced. A reference to the complete byte will be stored.`,
    fbMustBeInstantiated: (name) => (tc ? `Functionblock '${name}' must be instantiated to be accessed` : `Function block '${name}' must be instantiated to be accessed`),
    interfaceMustBeInstantiated: (name) => `Interface '${name}' must be instantiated to be accessed`,
    // Both vendors removed it and both say so; they disagree on nothing but capitalisation (`atomic_indexof_variable`,
    // `operand_indexof`, measured on both recordings 2026-09-20).
    indexofRemoved: () =>
      tc
        ? `the operator 'INDEXOF' is no longer supported. Use ADR instead. ADR on a POU-Name returns a Pointer to a Pointer to the function code.`
        : `The operator INDEXOF is no longer supported. Use ADR instead. ADR on a POU name returns a pointer to a pointer to the function code.`,
    cannotCallObjectOfType: (kind) => `Cannot call object of type '${kind}'`,
    iniNeedsInstance: () => (tc ? `'INI' operator needs function block instance or data unit type instance` : `INI operator needs function block instance or data unit type instance`),
  }
}

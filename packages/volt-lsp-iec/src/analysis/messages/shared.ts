/**
 * DIAGNOSTIC WORDING — the builders more than one group's checks call.
 *
 * One slice of `Messages` (`index.ts`); every template is written once for both vendors — a vendor difference is a
 * switch on `tc` inside it, never a second copy (openspec lsp-same-standard design.md §2.2).
 */

/** The vendor facts every template switches on — decided ONCE, in `messagesFor`. */
export interface VendorWording {
  /** The vendor is TwinCAT. */
  tc: boolean
  /** "Possible" (CODESYS) / "possible" (TwinCAT), the one word of the conversion warnings that differs. */
  possible: string
}

// ─── type text as the COMPILERS print it inside a message ─────────────────────────────────────────────────────────
// Distinct from `types/renderType`, which keeps a user's spelling for hover. Each was built inline by the check that
// needed it (consolidate-lsp-structure B7). An array is named by `types/renderType` itself, bounds as written (`ARRAY [0..N]
// OF INT`, analysis-conformance 3.1 `cmpop_array_constant_bound`) — the folding `compilerArrayText` that stood here is gone.

/** A string LITERAL's type: `STRING(INT#3)`, sized by its DECODED length (conformance `cc_string_escape_literal_into_int`). */
export function compilerStringLiteralText(length: number, wide: boolean): string {
  return `${wide ? "WSTRING" : "STRING"}(INT#${length})`
}

export interface SharedMessages {
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
  /** `MOD` on a non-integer: TwinCAT quotes both operator and type, CODESYS quotes neither. */
  modNotDefined(type: string): string
  /** A bare identifier that resolves in no reachable scope — byte-identical on both vendors. */
  undefinedIdentifier(name: string): string
  /** Member access `base.member` where `member` is not declared on the base's (project) type. PROVISIONAL —
   *  no bridge recording yet, so byte-identical wording is locked at the T.1 record pass (like overflow). */
  notAMember(member: string, type: string): string
  /** A VAR section not allowed for the containing POU: TwinCAT quotes the section name, CODESYS doesn't. */
  sectionNotAllowed(sectionKind: string): string
  /** An intrinsic operator called with the wrong exact number of operands (C0022). verified both vendors. */
  operatorNeedsExactly(op: string, count: number): string
  /** An intrinsic operator called with fewer than its minimum operands (C0023). verified both vendors. */
  operatorNeedsAtLeast(op: string, count: number): string
  /** An assignment whose target cannot be written (e.g. a `VAR CONSTANT`) (C0018). verified both vendors. */
  notAssignmentTarget(target: string): string
  /** A `VAR_CONFIG` block outside a config list (C0168). verified both vendors. */
  varConfigOnlyInList(): string
  /** A `hasattribute(...)` conditional-pragma whose attribute operand is unquoted — C0051. verified live CODESYS; TC pending. */
  attributeValueString(found: string): string
  /** An `EXTENDS` base class that resolves to no definition (C0090). verified both vendors. */
  baseClassNotFound(name: string): string
  /**
   * A subrange as the target of an ASSIGNMENT, which CODESYS spells with a POSITIVE lower bound typed by its base —
   * `INT (INT#1..100)`, `UINT (UINT#1..10)` — and a zero or negative one bare, `INT (0..10)`, `INT (-10..10)`, a variable
   * and a STRUCT member alike; its DECLARATION form says `INT (1..100)`. TwinCAT says the bare form in both. Recorded, not
   * chosen (conformance `subrange_assign_const_out` vs `subrange_init_above_range`; `dt_subrange_assign_*`,
   * `dt_subrange_member_assign*`, 2026-10-03).
   */
  subrangeAssignTarget(base: string, lo: bigint, hi: bigint): string
  /** A value of one enumeration type stored into another — a WARNING (`cv_enum_into_other_enum`, `unit_enum_extends_enum`).
   *  verified both vendors. */
  enumConversion(from: string, to: string): string
  /** A value that is not the enum's own stored into a `{attribute 'strict'}` enum — named by its source text
   *  (`prag_strict_enum_int_assign`, `cv_scalars_into_strict_enum`, `cv_literals_into_strict_enum`). verified both vendors. */
  strictEnumValue(text: string, enumName: string): string
  /** Arithmetic on a `{attribute 'strict'}` enum (`prag_strict_enum_add_literal`, `cv_strict_enum_arithmetic`). verified both vendors. */
  strictEnumArithmetic(enumName: string): string
  /** A pointer minus a REAL: CODESYS converts the REAL into the pointer, TwinCAT the pointer into the REAL
   *  (`dt_pointer_arithmetic_refused`). verified both vendors. */
  pointerMinusReal(real: string, pointer: string): string
  /** The same jump label declared twice in one POU body (C0116). verified both vendors. */
  jumpLabelDuplicate(name: string): string
  /** `JMP` to a label that isn't declared in the POU body (C0117). verified both vendors. */
  jumpLabelUndefined(name: string): string
  /** A jump label declared but never targeted by any `JMP` (C0118). verified both vendors. */
  jumpLabelUnreferenced(name: string): string
  /** Calling a plain value (a scalar/struct var) — CODESYS asks for a program/function/FB instead (C0035). */
  callTargetExpected(name: string): string
}

export function sharedMessages({ tc, possible }: VendorWording): SharedMessages {
  return {
    cannotConvert: (from, to) => `Cannot convert type '${from}' to type '${to}'`,
    unknownType: (expr) => `Unknown type: '${expr}'`,
    narrowing: (fromType, toType) =>
      `Implicit conversion from '${fromType}' to '${toType}': ${possible} loss of information`,
    // Confirmed live both vendors (only "Possible"/"possible" differs) — note the SPACE before the colon.
    signChange: (fromSign, fromType, toSign, toType) =>
      `Implicit conversion from ${fromSign} Type '${fromType}' to ${toSign} Type '${toType}' : ${possible} change of sign`,
    noInput: (member, fb) => `'${member}' is no input of '${fb}'`,
    jumpLabelDuplicate: (name) => `The label '${name.toUpperCase()}' is a duplicate`,
    jumpLabelUndefined: (name) => `No such label '${name.toUpperCase()}' within the scope of the JMP statement${tc ? "." : ""}`,
    jumpLabelUnreferenced: (name) => `The label '${name.toUpperCase()}' has not been referenced`,
    callTargetExpected: (name) => `Program name, function or function block instance expected instead of '${name}'`,
    modNotDefined: (type) => (tc ? `'MOD' is not defined for '${type}'` : `MOD is not defined for ${type}`),
    undefinedIdentifier: (name) => `Identifier '${name}' not defined`,
    // Confirmed via live /build: both say "is no component of"; TwinCAT uppercases the type name.
    notAMember: (member, type) => `'${member}' is no component of '${tc ? type.toUpperCase() : type}'`,
    sectionNotAllowed: (sectionKind) =>
      sectionKind === "VAR_GLOBAL" // C0169 — both vendors verified, different wording
        ? tc
          ? `'VAR_GLOBAL' declaration only allowed in Global variable list`
          : `VAR_GLOBAL declaration only allowed in global variable list`
        : tc
          ? `'${sectionKind}' declaration not allowed in this place`
          : `${sectionKind} declaration not allowed in this place`,
    operatorNeedsExactly: (op, count) => (tc ? `'${op}' needs exactly '${count}' Operands` : `'${op}' needs exactly '${count}' operands`),
    operatorNeedsAtLeast: (op, count) => (tc ? `'${op}' needs at least '${count}' Operands` : `'${op}' needs at least '${count}' operands`),
    notAssignmentTarget: (target) => `'${target}' is no valid assignment target`,
    notStructuredVariable: (base) => `'${base}' is no structured variable`,
    varConfigOnlyInList: () => (tc ? `'VAR_CONFIG' declaration only allowed in VAR_CONFIG - list` : `VAR_CONFIG declaration only allowed in VAR_CONFIG  list`),
    attributeValueString: (found) => `Single byte string expected for an attribute value instead of '${found}'`,
    baseClassNotFound: (name) => `No definition found for base class '${name}'`,
    subrangeAssignTarget: (base, lo, hi) => `${base} (${tc || lo <= 0n ? lo : `${base}#${lo}`}..${hi})`,
    enumConversion: (from, to) => `Implicit conversion from one enumeration type (${from}) to another (${to})`,
    strictEnumValue: (text, enumName) => `'${text}' is not a valid value for strict ENUM type '${enumName}'`,
    strictEnumArithmetic: (enumName) => `Arithmetics not allowed on strict ENUM type '${enumName}'`,
    pointerMinusReal: (real, pointer) => (tc ? `Cannot convert type '${pointer}' to type '${real}'` : `Cannot convert type '${real}' to type '${pointer}'`),
  }
}

/**
 * DIAGNOSTIC WORDING — the `checks/types/` group's.
 *
 * One slice of `Messages` (`index.ts`); every template is written once for both vendors — a vendor difference is a
 * switch on `tc` inside it, never a second copy (openspec lsp-same-standard design.md §2.2).
 */
import type { VendorWording } from "./shared.js"

export interface TypeMessages {
  /** `x^` where `x` is not a pointer: CODESYS "a pointer" (lowercase article), TwinCAT "Pointer" (no article). */
  dereferenceRequiresPointer(): string
  /** A constant array index outside the dimension's `lo..hi` bounds. PROVISIONAL (bridge-gated). */
  arrayIndexOutOfBounds(index: string, lo: string, hi: string): string
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
  /** An array-initializer repeat count `n(v)` where `n` is a non-constant variable (C0162). verified both vendors. */
  arrayInitCountNonConst(count: string): string
  /** `REF=` whose target is not a `REFERENCE TO` variable (C0140). verified both vendors. */
  referenceAssignTarget(): string
  refInitNeedsReference(): string
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
  /** A `REF=` of a literal or a variable of another type into a reference — TwinCAT names the pair reversed (`cc3_reference_assign`,
   *  `dt_ref_assign_wrong_type`, `dt_ref_assign_struct_mismatch`, `cv_pointer_to_reference`). verified both vendors. */
  refAssignCannotConvert(from: string, to: string): string
  /** Bit access on a function-call result (C0061). verified both vendors. */
  bitAccessOnCall(): string
  /** A pointer indexed with a count other than 1 (C0126). verified both vendors. */
  pointerIndexArity(type: string): string
  /** An array indexed with the wrong number of indices (C0048). verified both vendors. */
  arrayIndexCount(dims: number): string
  /** A `REF=` whose RHS is not a writable variable (a non-zero literal / constant) — C0141. verified live CODESYS; TC pending. */
  referenceAssignWriteAccess(): string
  /** An enumeration member's initial value the compiler will not take, named as written (CODESYS SP21). */
  invalidEnumInitialisation(value: string): string
  /** An enumeration member holding a value an earlier member holds (C0125, a warning) — both vendors alike, no full stop
   *  (`enumdup_*`, `eninit_explicit_duplicate`, analysis-conformance 3.11). */
  enumDuplicateValue(value: string): string
  /** A REFERENCE TO BIT, or (CODESYS) a BIT in a VAR_IN_OUT — both vendors alike (`ty_reference_to_bit`, `refbit_*`,
   *  analysis-conformance 3.11). */
  referenceToBit(): string
  /** An FB/struct that (transitively) contains an instance of itself as a member (C0101). verified both vendors. */
  dataRecursion(path: string): string
  /** A comparison between two different enumeration types (C0354). verified both vendors. */
  enumComparison(left: string, right: string): string
}

export function typeMessages({ tc }: VendorWording): TypeMessages {
  return {
    dereferenceRequiresPointer: () => (tc ? "Dereference requires Pointer" : "Dereference requires a pointer"),
    // Confirmed byte-identical on both vendors via live /build (2026-07-07).
    arrayIndexOutOfBounds: (index, lo, hi) =>
      `The constant index '${index}' is not within the range from '${lo}' to '${hi}'`,
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
    arrayInitCountNonConst: (count) => `Number '${count}' of array initialisations is no constant value`,
    // Mirror the IDE: it reports a non-convertible pointer with the same "Cannot convert" wording as C0032
    // (both vendors, live-verified) — not a distinct "possibly not convertible" phrasing.
    // a declaration's `REF=` on a type that is no reference — both vendors, the same words (`decl_ref_init_on_value`)
    refInitNeedsReference: () => `Initialisation with REF= is only allowed for variables of type REFERENCE TO`,
    referenceAssignTarget: () => (tc ? `Reference assign is only allowed to variables of Reference type` : `Reference assign is only allowed to variables of reference type`),
    // Mirror the IDE: it elides the actual string content to `'...'` (both vendors), so we do too rather than
    // echoing the value (the goal is byte-identical IDE parity, not a more-informative message).
    stringConstantTooLong: (literalText, destLength, type) =>
      `String constant '${literalText.slice(0, destLength >= 3 ? destLength - 3 : destLength)}...' too long for destination type '${type}'`,
    compareNotPossible: (type) => `Compare not possible on objects of type '${type}'`,
    compareNotPossibleTwo: (left, right) => `Compare not possible on objects of type '${left}' or '${right}'`,
    refAssignCannotConvert: (from, to) => (tc ? `Cannot convert type '${to}' to type '${from}'` : `Cannot convert type '${from}' to type '${to}'`),
    bitAccessOnCall: () => (tc ? `Bitaccess on function call is not allowed` : `Bit access on function call is not allowed`),
    pointerIndexArity: (type) => `Variable of type '${type}' requires exactly 1 Index`,
    arrayIndexCount: (dims) => `Array requires exactly ${dims} indexes`,
    referenceAssignWriteAccess: () => `Reference assign needs variable with write access`,
    invalidEnumInitialisation: (value) => `${value} is no valid initialisation for an enumeration`,
    enumDuplicateValue: (value) => `The constant ${value} is assigned to more than one enumeration`,
    referenceToBit: () => `References to bits are not possible`,
    dataRecursion: (path) => (tc ? `Data Recursion: ${path}` : `Data recursion: ${path}`),
    enumComparison: (left, right) => `Comparison of one enumeration type (${left}) with another (${right})`,
  }
}

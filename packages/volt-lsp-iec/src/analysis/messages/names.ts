/**
 * DIAGNOSTIC WORDING — the `checks/names/` group's.
 *
 * One slice of `Messages` (`index.ts`); every template is written once for both vendors — a vendor difference is a
 * switch on `tc` inside it, never a second copy (openspec lsp-same-standard design.md §2.2).
 */
import type { VendorWording } from "./shared.js"

export interface NameMessages {
  /** Same name declared twice in one scope — identical wording on both vendors. */
  duplicateDeclaration(name: string, scope: string): string
  /** Two methods with the same name in one FB (C0582) — an unmarked overload. Volt can't push it either way.
   *  PROVISIONAL, and UNVERIFIABLE on SP21: the object tree itself refuses a second same-named method at create
   *  ("An object with the name '…' already exists within the corresponding namespace", measured by
   *  `probe-duplicate-method.py` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/probe-duplicate-method.py`)), so the compiler never sees the repro by ANY path. */
  duplicateMethod(name: string): string
  /** `.name` (the global-namespace operator) that no GLOBAL declares, a local of that name or not — both vendors alike
   *  (`expr_global_namespace_undefined`, `_local_only`, 2026-10-02). */
  noGlobalDefinition(name: string): string
  /** A bare global declared in 2+ GVLs — ambiguous unqualified reference (C0136). verified both vendors. */
  ambiguousGlobalName(name: string): string
  /** A type name used where a value is expected — `value := MyEnum` (C0230). verified both vendors. */
  typeNameNotExpected(name: string): string
  /** An identifier named after an IEC-reserved keyword CODESYS soft-allows (CHAR/WCHAR/USING) — C0543. verified live CODESYS; TC pending. */
  reservedKeyword(name: string): string
  /** A token where an expression must start: `Expression expected instead of 'T#1500'` — a TIME literal cut at a `US`
   *  unit (conformance `cc_time_*`). Recorded on CODESYS SP21; unmeasured on TwinCAT. */
  expressionExpectedInsteadOf(token: string): string
  /** `CALC` is the IL conditional call; its second parameter must be a call statement (CODESYS-measured). */
  conditionalCallSecondParameter(): string
  /** The parser wanted an opening parenthesis — `CALC` without one (CODESYS-measured). */
  parenExpectedInsteadOf(token: string): string
  /** A statement where a declaration belongs, which is what a bad `calc : INT;` leaves behind. */
  notSupportedInDeclaration(): string
}

export function nameMessages({ tc }: VendorWording): NameMessages {
  return {
    expressionExpectedInsteadOf: (token) => `Expression expected instead of '${token}'`,
    // CODESYS SP21, measured in all five `CALC` shapes (`cc_il_name_calc`, `ilc_calc_*`).
    // TwinCAT hyphenates "call-statement" and capitalises "Declaration part" (`cc_il_name_calc`, `ilc_calc_*`,
    // both recordings 2026-09-20).
    conditionalCallSecondParameter: () =>
      tc
        ? "Second parameter of conditional call must be a valid call-statement"
        : "Second parameter of conditional call must be a valid call statement",
    parenExpectedInsteadOf: (token) => `'(' expected instead of '${token}'`,
    notSupportedInDeclaration: () => (tc ? "This code is not supported in Declaration part" : "This code is not supported in declaration part"),
    duplicateDeclaration: (name, scope) => `A local variable named '${name}' is already defined in '${scope}'`,
    // PROVISIONAL doc wording (C0582) — unverifiable: the object tree refuses the duplicate at create, before any build.
    duplicateMethod: (name) =>
      `There is another method with the name '${name}'. Use the Attribute {attribute 'overloaded'} if you want to define overloaded methods.`,
    noGlobalDefinition: (name) => `There is no global definition for '${name}'`,
    // Live-verified both vendors (2026-07-11): CODESYS capital "Ambiguous", TwinCAT lowercase "ambiguous".
    ambiguousGlobalName: (name) => `${tc ? "ambiguous" : "Ambiguous"} use of name '${name}'`,
    typeNameNotExpected: (name) => `Type name '${name}' not expected in this place`,
    reservedKeyword: (name) =>
      `The name '${name.toUpperCase()}' is a reserved keyword in the IEC61131-3 standard. An error will be reported in future versions.`,
  }
}

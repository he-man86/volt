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
  /** Same name declared twice in one scope — identical wording on both vendors. */
  duplicateDeclaration(name: string, scope: string): string
  /** A bare identifier that resolves in no reachable scope — byte-identical on both vendors. */
  undefinedIdentifier(name: string): string
  /** A declared type name that resolves nowhere (`x : BOL`). PROVISIONAL — no bridge recording yet (bridge-gated). */
  unknownType(name: string): string
  /** `x^` where `x` is not a pointer: CODESYS "a pointer" (lowercase article), TwinCAT "Pointer" (no article). */
  dereferenceRequiresPointer(): string
  /** Member access `base.member` where `member` is not declared on the base's (project) type. PROVISIONAL —
   *  no bridge recording yet, so byte-identical wording is locked at the T.1 record pass (like overflow). */
  notAMember(member: string, type: string): string
  /** Instantiating an ABSTRACT FB: "Function block" (CODESYS) vs "Functionblock" (TwinCAT, one word). */
  abstractInstantiation(fb: string): string
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
  /** More positional arguments than the callee declares inputs. PROVISIONAL (no bridge recording yet). */
  tooManyArguments(callee: string, max: number): string
  /** A `name := value` naming no declared parameter of the callee. PROVISIONAL (no bridge recording yet). */
  unknownNamedArgument(name: string, callee: string): string
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
    modNotDefined: (type) => (tc ? `'MOD' is not defined for '${type}'` : `MOD is not defined for ${type}`),
    duplicateDeclaration: (name, scope) => `A local variable named '${name}' is already defined in '${scope}'`,
    undefinedIdentifier: (name) => `Identifier '${name}' not defined`,
    // PROVISIONAL — CODESYS emits `Unknown type: '<name>'`; TwinCAT wording unconfirmed (locked at the T.1 record pass).
    unknownType: (name) => `Unknown type: '${name}'`,
    dereferenceRequiresPointer: () => (tc ? "Dereference requires Pointer" : "Dereference requires a pointer"),
    // Confirmed via live /build (:8556 + :8555): both say "is no component of"; TwinCAT uppercases the type name.
    notAMember: (member, type) => `'${member}' is no component of '${tc ? type.toUpperCase() : type}'`,
    abstractInstantiation: (fb) =>
      `${tc ? "Functionblock" : "Function block"} ${fb} is ABSTRACT and cannot be instantiated`,
    sectionNotAllowed: (sectionKind) =>
      tc
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
    tooManyArguments: (callee, max) => `Too many arguments for '${callee}' (expected at most ${max})`,
    unknownNamedArgument: (name, callee) => `'${name}' is not a parameter of '${callee}'`,
  }
}

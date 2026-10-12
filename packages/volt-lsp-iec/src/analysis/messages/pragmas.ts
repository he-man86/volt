/**
 * DIAGNOSTIC WORDING — the `checks/pragmas/` group's.
 *
 * One slice of `Messages` (`index.ts`); every template is written once for both vendors — a vendor difference is a
 * switch on `tc` inside it, never a second copy (openspec lsp-same-standard design.md §2.2).
 */
import type { VendorWording } from "./shared.js"

export interface PragmaMessages {
  /**
   * An `{attribute '<name>'}` the compiler doesn't recognize. CODESYS's exact wording — note the DOUBLE
   * space before "compiler" and the unquoted name (a compiler quirk, matched byte-for-byte). TwinCAT has no
   * recording; its wording is provisional (best-effort, bridge-gated).
   */
  unknownAttribute(name: string): string
  /** An invalid VALUE for the `{attribute 'symbol'}` pragma — C0351, the symbol-export access mode. Only
   *  `none/read/write/readwrite` are legal; a typo (`'noe'`) says this once per attribute and nothing more (no C0564 —
   *  `initord_chain4_symbol_noe`, analysis-conformance 3.12). Verified live CODESYS (SymbolConfig-prefixed wording). */
  invalidSymbolAttributeValue(value: string): string
  abstractKeywordMissing(): string
  /** An attribute that belongs on a variable declaration written on a unit (`pingroup`, `pragma_conflicting_pair`). CODESYS. */
  attributeOnlyOnVariables(name: string): string
  /** A known attribute given a value outside its published set (CODESYS SP21, a warning). */
  invalidAttributeValue(value: string, attribute: string, allowed: readonly string[]): string
}

export function pragmaMessages(_: VendorWording): PragmaMessages {
  return {
    // CODESYS byte-identical (double space + unquoted name). TwinCAT never emits this (live /build: compiles
    // an unknown attribute clean), so the lint is CODESYS-gated and this builder is CODESYS-only in practice.
    unknownAttribute: (name) => `The attribute ${name} is unknown and will be ignored by the  compiler.`,
    // CODESYS wording (live /build): "SymbolConfig:" prefix + the legal set. TwinCAT recording pending.
    invalidSymbolAttributeValue: (value) =>
      `SymbolConfig: Invalid value '${value}' for attribute 'symbol'. Should be one of: none, read, write, readwrite`,
    abstractKeywordMissing: () => `The ABSTRACT keyword is missing`,
    attributeOnlyOnVariables: (name) => `The attribute '${name}' can only be added to variable declarations. It will be ignored here.`,
    invalidAttributeValue: (value, attribute, allowed) =>
      `Invalid value '${value}' for attribute '${attribute}' should be one of: [${allowed.map((a) => `'${a}'`).join(", ")}]`,
  }
}

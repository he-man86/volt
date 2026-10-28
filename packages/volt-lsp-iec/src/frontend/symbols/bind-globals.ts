/**
 * BINDING GLOBALS AND DECLARATIONS — a GVL's list and its variables, the device instances, and the VAR sections every
 * unit's scope is filled from. Split from `binder.ts` (openspec lsp-same-standard design.md §2.2).
 */
import {
  baseNameOf,
  type GlobalVarList,
  hasFrontendAttribute,
  type VarDecl,
  type VarSection,
  type VarSectionKind,
  zeroSpan,
} from "../syntax/index.js"
import type { Scope, DeviceInstance, SymbolKind } from "./model.js"
import { defineSymbol } from "./scope.js"

export function ingestGlobalVarList(project: Scope, gvl: GlobalVarList, uri: string): void {
  // a commented-out `//{attribute 'qualified_only'}` is a comment and no attribute (the lenze `LST_General` case: bare
  // `FF100ms` must still resolve) — read per unit, from the AST (2.7.2)
  const qualifiedOnly = hasFrontendAttribute(gvl, "qualified_only")

  // Register the GVL block itself under the URI basename — ST has no in-source name for the block,
  // the file basename IS the identifier (CODESYS convention). Lets `GvlName.field` resolve.
  // A VAR_ACCESS list binds NOTHING — no access name, and no list name either: both vendors build `GVL.accD` as
  // "Identifier 'GVL' not defined" when the object holds only access paths (`decl_var_access_used`, 2026-10-01).
  const sections = gvl.varSections.filter((s) => s.sectionKind !== "VAR_ACCESS")
  const blockName = sections.length > 0 ? gvlName(uri) : undefined
  if (blockName !== undefined) {
    defineSymbol(project, {
      kind: "gvl_block",
      name: blockName,
      span: gvl.span,
      declarationSpan: gvl.span,
      owner: project,
      uri,
      ast: gvl,
    })
  }

  for (const section of sections) {
    for (const decl of section.decls) {
      if (decl.atRefused === true) continue // dropped by the vendor, as in a POU (`ingestVarDecl`)
      for (const name of decl.names) {
        defineSymbol(project, {
          kind: "gvl_var",
          name: name.text,
          span: name.span,
          declarationSpan: decl.span,
          owner: project,
          uri,
          typeExpr: decl.type,
          varSection: section.sectionKind,
          ...(section.constant ? { constant: true } : {}),
          ...(qualifiedOnly ? { qualifiedOnly: true } : {}),
          ast: decl,
        })
      }
    }
  }
}

/**
 * The project's device-tree instances, each a project-level symbol of its name (rule Y24) — what the search order reaches
 * a bare device name through (`types/names` `resolveBareName`). Its descriptor is no ST: the symbol has no span in any
 * source and no type.
 */
export function ingestDevices(project: Scope, devices: readonly DeviceInstance[]): void {
  for (const device of devices) {
    const span = zeroSpan()
    defineSymbol(project, { kind: "device", name: device.name, span, declarationSpan: span, owner: project, uri: device.uri, ast: device })
  }
}

/** A GVL's name — ST has none in the source, so it is the file's: the document's file name (`baseNameOf` — decoded, never
 *  the URI's percent-encoding) minus its extension. Undefined for an empty URI (a test's). The document outline names a
 *  GVL by it too. */
export function gvlName(uri: string): string | undefined {
  if (uri.length === 0) return undefined
  const last = baseNameOf(uri)
  if (last.length === 0) return undefined
  const dot = last.lastIndexOf(".")
  const name = dot > 0 ? last.slice(0, dot) : last
  return name.length > 0 ? name : undefined
}

export function ingestVarSections(scope: Scope, sections: readonly VarSection[], uri: string, asParams = false): void {
  for (const section of sections) {
    for (const decl of section.decls) {
      ingestVarDecl(scope, decl, section.sectionKind, uri, false, asParams, section.constant === true)
    }
  }
}

export function ingestVarDecl(
  scope: Scope,
  decl: VarDecl,
  sectionKind: VarSectionKind | undefined,
  uri: string,
  asField: boolean,
  asParam = false,
  constant = false,
): void {
  // a declaration whose AT operand is no address is DROPPED by both vendors (`VarDecl.atRefused`): it binds nothing, so
  // every use of it is "not defined" as on the vendor (`cc5_at_address_not_direct`, `decl_at_*`)
  if (decl.atRefused === true) return
  const kind: SymbolKind = asField
    ? "struct_field"
    : asParam && (sectionKind === "VAR_INPUT" || sectionKind === "VAR_OUTPUT" || sectionKind === "VAR_IN_OUT")
      ? "method_param"
      : "var"
  for (const name of decl.names) {
    defineSymbol(scope, {
      kind,
      ...(constant ? { constant: true } : {}),
      name: name.text,
      span: name.span,
      declarationSpan: decl.span,
      owner: scope,
      uri,
      typeExpr: decl.type,
      ...(sectionKind !== undefined ? { varSection: sectionKind } : {}),
      ast: decl,
    })
  }
  // Implicit enumeration `iState : (Idle, Running, Halted)` declares the var AND introduces each
  // value as a bare constant in the enclosing scope (CODESYS Implicit Enumeration rule) — as the element type of an
  // ARRAY too (`decl_implicit_enum_in_array`: `a[1] := ia_b` builds and runs, both vendors 2026-10-01).
  let element = decl.type
  while (element.kind === "array_type") element = element.element
  if (element.kind === "implicit_enum_type") {
    for (const value of element.values) {
      defineSymbol(scope, {
        kind: "enum_value",
        name: value.name.text,
        span: value.name.span,
        declarationSpan: value.name.span,
        owner: scope,
        uri,
        ast: decl,
      })
    }
  }
}

/**
 * document-symbol (Layer E · E.3 · structure). The file outline: each top-level unit → a nested
 * `DocumentSymbol` whose children are its declared members (VAR decls, struct fields, enum values).
 * Pure AST walk — no resolution needed.
 */
import { SymbolKind as Lsp, type DocumentSymbol } from "vscode-languageserver-protocol"
import type { TopLevel, VarSection } from "../../syntax/index.js"
import { rangeFromSpan, type Document } from "../shared/index.js"

export function documentSymbols(doc: Document): DocumentSymbol[] {
  const out: DocumentSymbol[] = []
  for (const unit of doc.parseResult.units) {
    const sym = unitSymbol(unit, doc.uri)
    if (sym !== undefined) out.push(sym)
  }
  return out
}

function unitSymbol(unit: TopLevel, uri: string): DocumentSymbol | undefined {
  if (unit.kind === "global_var_list") {
    const name = basename(uri)
    return {
      name,
      kind: Lsp.Namespace,
      range: rangeFromSpan(unit.span),
      selectionRange: rangeFromSpan(unit.span),
      children: varMembers(unit.varSections),
    }
  }
  if (!("name" in unit)) return undefined
  return {
    name: unit.name.text,
    kind: unitKind(unit.kind),
    range: rangeFromSpan(unit.span),
    selectionRange: rangeFromSpan(unit.name.span),
    children: memberSymbols(unit),
  }
}

function memberSymbols(unit: TopLevel): DocumentSymbol[] {
  if ("varSections" in unit) return varMembers(unit.varSections)
  if (unit.kind === "type_decl") {
    const body = unit.body
    if (body.kind === "struct" || body.kind === "union") return varMembers([{ decls: body.fields } as VarSection])
    if (body.kind === "enum") {
      return body.values.map((v) => ({
        name: v.name.text,
        kind: Lsp.EnumMember,
        range: rangeFromSpan(v.span),
        selectionRange: rangeFromSpan(v.name.span),
      }))
    }
  }
  if (unit.kind === "interface") {
    return unit.methods.map((m) => ({
      name: m.name.text,
      kind: Lsp.Method,
      range: rangeFromSpan(m.span),
      selectionRange: rangeFromSpan(m.name.span),
    }))
  }
  return []
}

function varMembers(sections: readonly Pick<VarSection, "decls">[]): DocumentSymbol[] {
  const out: DocumentSymbol[] = []
  for (const section of sections) {
    for (const decl of section.decls) {
      for (const id of decl.names) {
        out.push({
          name: id.text,
          kind: Lsp.Variable,
          range: rangeFromSpan(decl.span),
          selectionRange: rangeFromSpan(id.span),
        })
      }
    }
  }
  return out
}

function unitKind(kind: TopLevel["kind"]): Lsp {
  switch (kind) {
    case "function_block":
    case "program":
      return Lsp.Class
    case "function":
      return Lsp.Function
    case "method":
    case "action":
      return Lsp.Method
    case "property":
      return Lsp.Property
    case "interface":
      return Lsp.Interface
    case "type_decl":
      return Lsp.Struct
    default:
      return Lsp.Object
  }
}

function basename(uri: string): string {
  const last = uri.split(/[\\/]/).pop() ?? uri
  const dot = last.lastIndexOf(".")
  return dot > 0 ? last.slice(0, dot) : last
}

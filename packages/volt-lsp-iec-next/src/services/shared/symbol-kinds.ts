/**
 * symbol-kinds (Layer E · shared). The ONE mapping from our `SymbolKind` to the LSP `SymbolKind` enum
 * and to a human label. `humanKind` is used by BOTH hover and completion, so the label reads identically
 * everywhere (the hover↔completion parity test guards it).
 */
import { SymbolKind as Lsp } from "vscode-languageserver-protocol"
import type { SymbolKind } from "../../symbols/index.js"

export function lspSymbolKind(kind: SymbolKind): Lsp {
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
    case "interface_property":
      return Lsp.Property
    case "interface":
      return Lsp.Interface
    case "interface_method":
      return Lsp.Method
    case "type":
      return Lsp.Struct
    case "enum_value":
      return Lsp.EnumMember
    case "struct_field":
      return Lsp.Field
    case "var":
    case "gvl_var":
      return Lsp.Variable
    case "method_param":
      return Lsp.Variable
    case "gvl_block":
      return Lsp.Namespace
    case "namespace":
      return Lsp.Namespace
  }
}

export function humanKind(kind: SymbolKind): string {
  switch (kind) {
    case "function_block":
      return "function block"
    case "program":
      return "program"
    case "function":
      return "function"
    case "method":
      return "method"
    case "action":
      return "action"
    case "property":
    case "interface_property":
      return "property"
    case "interface":
      return "interface"
    case "interface_method":
      return "method"
    case "type":
      return "type"
    case "var":
      return "variable"
    case "method_param":
      return "parameter"
    case "struct_field":
      return "field"
    case "enum_value":
      return "enum value"
    case "gvl_var":
      return "global variable"
    case "gvl_block":
      return "global variable list"
    case "namespace":
      return "namespace"
  }
}

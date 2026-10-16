/**
 * symbol-kinds (Layer E · shared). The ONE table from our `SymbolKind` to everything a service shows for it: the LSP
 * `SymbolKind`, the human label, the completion kind, the semantic-token type and the declaration keyword hover writes
 * for a symbol without a type. A `Record` over `SymbolKind`, so a new kind does not compile until every column has its
 * answer. `humanKind` is read by BOTH hover and completion, so the label reads identically everywhere (the
 * hover↔completion parity test guards it).
 */
import { CompletionItemKind, SymbolKind as Lsp } from "vscode-languageserver-protocol"
import type { SymbolKind } from "../../frontend/symbols/index.js"

export const SYMBOL_KINDS = {
  function_block: { lsp: Lsp.Class, human: "function block", completion: CompletionItemKind.Class, token: "class", keyword: "FUNCTION_BLOCK" },
  program: { lsp: Lsp.Class, human: "program", completion: CompletionItemKind.Class, token: "class", keyword: "PROGRAM" },
  function: { lsp: Lsp.Function, human: "function", completion: CompletionItemKind.Function, token: "function", keyword: "FUNCTION" },
  method: { lsp: Lsp.Method, human: "method", completion: CompletionItemKind.Method, token: "method", keyword: "METHOD" },
  action: { lsp: Lsp.Method, human: "action", completion: CompletionItemKind.Method, token: "method", keyword: "ACTION" },
  property: { lsp: Lsp.Property, human: "property", completion: CompletionItemKind.Property, token: "property", keyword: "PROPERTY" },
  interface: { lsp: Lsp.Interface, human: "interface", completion: CompletionItemKind.Interface, token: "interface", keyword: "INTERFACE" },
  interface_method: { lsp: Lsp.Method, human: "method", completion: CompletionItemKind.Method, token: "method", keyword: "METHOD" },
  interface_property: { lsp: Lsp.Property, human: "property", completion: CompletionItemKind.Property, token: "property", keyword: "PROPERTY" },
  type: { lsp: Lsp.Struct, human: "type", completion: CompletionItemKind.Struct, token: "type", keyword: "TYPE" },
  var: { lsp: Lsp.Variable, human: "variable", completion: CompletionItemKind.Variable, token: "variable", keyword: "VARIABLE" },
  method_param: { lsp: Lsp.Variable, human: "parameter", completion: CompletionItemKind.Variable, token: "parameter", keyword: "PARAMETER" },
  struct_field: { lsp: Lsp.Field, human: "field", completion: CompletionItemKind.Field, token: "property", keyword: "FIELD" },
  enum_value: { lsp: Lsp.EnumMember, human: "enum value", completion: CompletionItemKind.EnumMember, token: "enumMember", keyword: "ENUM VALUE" },
  gvl_var: { lsp: Lsp.Variable, human: "global variable", completion: CompletionItemKind.Variable, token: "variable", keyword: "GLOBAL VARIABLE" },
  gvl_block: { lsp: Lsp.Namespace, human: "global variable list", completion: CompletionItemKind.Variable, token: "namespace", keyword: "VAR_GLOBAL" },
  namespace: { lsp: Lsp.Namespace, human: "namespace", completion: CompletionItemKind.Variable, token: "namespace", keyword: "NAMESPACE" },
  device: { lsp: Lsp.Object, human: "device", completion: CompletionItemKind.Variable, token: "variable", keyword: "DEVICE" },
} as const satisfies Record<SymbolKind, { lsp: Lsp; human: string; completion: CompletionItemKind; token: string; keyword: string }>

export const lspSymbolKind = (kind: SymbolKind): Lsp => SYMBOL_KINDS[kind].lsp

export const humanKind = (kind: SymbolKind): string => SYMBOL_KINDS[kind].human

/**
 * symbol-kinds — the one SymbolKind → LSP-kind / human-label mapping. Exhaustive: every SymbolKind must map
 * (a missing case is a TS error, but this locks the ACTUAL values + guards the hover↔completion label parity).
 */
import { test, expect } from "bun:test"
import { SymbolKind as Lsp } from "vscode-languageserver-protocol"
import { lspSymbolKind, humanKind } from "./symbol-kinds.js"
import type { SymbolKind } from "../../symbols/index.js"

const CASES: [SymbolKind, Lsp, string][] = [
  ["function_block", Lsp.Class, "function block"],
  ["program", Lsp.Class, "program"],
  ["function", Lsp.Function, "function"],
  ["method", Lsp.Method, "method"],
  ["action", Lsp.Method, "action"],
  ["property", Lsp.Property, "property"],
  ["interface_property", Lsp.Property, "property"],
  ["interface", Lsp.Interface, "interface"],
  ["interface_method", Lsp.Method, "method"],
  ["type", Lsp.Struct, "type"],
  ["enum_value", Lsp.EnumMember, "enum value"],
  ["struct_field", Lsp.Field, "field"],
  ["var", Lsp.Variable, "variable"],
  ["gvl_var", Lsp.Variable, "global variable"],
  ["method_param", Lsp.Variable, "parameter"],
  ["gvl_block", Lsp.Namespace, "global variable list"],
  ["namespace", Lsp.Namespace, "namespace"],
]

test("every SymbolKind maps to the expected LSP kind and human label", () => {
  for (const [kind, lsp, label] of CASES) {
    expect(lspSymbolKind(kind)).toBe(lsp)
    expect(humanKind(kind)).toBe(label)
  }
})

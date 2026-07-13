import { test, expect } from "bun:test"
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver-protocol/node.js"
import { countDiagnostics } from "./diagnostics.js"

const diag = (severity: number, source?: string): Diagnostic => ({
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  message: "x",
  severity,
  source,
})

test("countDiagnostics counts errors + warnings, ignores other sources", () => {
  const got = countDiagnostics([
    diag(DiagnosticSeverity.Error, "volt-lsp-iec"),
    diag(DiagnosticSeverity.Error, "volt-lsp-iec"),
    diag(DiagnosticSeverity.Warning, "volt-lsp-iec"),
    diag(DiagnosticSeverity.Warning, "eslint"), // other source — ignored
    diag(DiagnosticSeverity.Information, "volt-lsp-iec"), // not error/warning — ignored
    diag(DiagnosticSeverity.Error, undefined), // no source — counted (server may omit it)
  ])
  expect(got).toEqual({ errors: 3, warnings: 1 })
})


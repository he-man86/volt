import { test, expect } from "bun:test"
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver-protocol/node.js"
import { countDiagnostics, describeDiagnostics } from "./diagnostics.js"

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


// Pluralization at the boundaries, because that is the whole reason this is one function: it was two identical
// copies, and a copy that drifts to "1 errors" in one shell and not the other is a bug nobody notices for months.
test("the summary pluralizes each count independently", () => {
  expect(describeDiagnostics({ errors: 0, warnings: 0 })).toBe("0 errors, 0 warnings")
  expect(describeDiagnostics({ errors: 1, warnings: 1 })).toBe("1 error, 1 warning")
  expect(describeDiagnostics({ errors: 2, warnings: 1 })).toBe("2 errors, 1 warning")
})

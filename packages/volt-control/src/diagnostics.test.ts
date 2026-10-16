import { test, expect } from "bun:test"
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver-protocol/node"
import { byFileRank, countDiagnostics, describeDiagnostics, setLspServer } from "./diagnostics.js"

// A host's configured server path that does not exist is refused by name, at the moment it is configured — not left
// unset to surface later as a vaguer "server not set" from whichever collect ran first.
test("setLspServer refuses a path that does not exist, naming it", () => {
  const missing = "C:/no-such-dir/volt-lsp-iec.exe"
  expect(() => setLspServer(missing)).toThrow(missing)
})

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

// openspec environment-dependency-audit 2.8: the order is the same on every machine — ordinal on the path, never the
// default locale's collation (which puts "a" before "B", and under tr-TR orders "I"/"ı" its own way).
test("files rank by errors, then warnings, then the path ordinally", () => {
  const f = (path: string, errors = 1, warnings = 0) => ({ path, errors, warnings })
  const ranked = [f("/p/b.st"), f("/p/B.st"), f("/p/a.st"), f("/p/I.st"), f("/p/z.st", 2), f("/p/y.st", 1, 1)].sort(byFileRank)
  expect(ranked.map((x) => x.path)).toEqual(["/p/z.st", "/p/y.st", "/p/B.st", "/p/I.st", "/p/a.st", "/p/b.st"])
})

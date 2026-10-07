import { test, expect } from "bun:test"
import { parseSource } from "../frontend/syntax/index.js"
import { build } from "../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig, projectDiagnosticsFrom } from "./index.js"
import { CONFIGURABLE_CHECKS } from "./config.js"
import { CODESYS_CODE_MAP } from "./error-code-map.js"
import { uriFor } from "./test-uri.js"

/**
 * CODESYS's "Compiler warnings" dialog model: each configurable code is a 3-state control (off / warning /
 * error), defaulting to warning; errors that aren't in the dialog are untoggleable. The central filter drops
 * an "off" code and FORCES the chosen severity on the rest.
 */
const diag = (src: string, opts?: Parameters<typeof resolveConfig>[0]) => {
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig(opts) })
}

// C0139 no-op-statement: `i;` (a bare expression) has no effect — a configurable code Volt emits as warning.
const noOp = `FUNCTION_BLOCK F\nVAR i : INT; END_VAR\ni;\nEND_FUNCTION_BLOCK`
const noOpD = (src: string, opts?: Parameters<typeof resolveConfig>[0]) => diag(src, opts).filter((d) => d.code === "no-op-statement")

test("every configurable code defaults to warning (CODESYS's default)", () => {
  const d = resolveConfig().diagnostics
  for (const { code } of CONFIGURABLE_CHECKS) expect(d[code]).toBe("warning")
})

test("a configurable code fires as a warning by default", () => {
  const [d] = noOpD(noOp)
  expect(d?.severity).toBe("warning")
})

test("state 'off' drops the diagnostic entirely", () => {
  expect(noOpD(noOp, { diagnostics: { "no-op-statement": "off" } })).toEqual([])
})

test("state 'error' FORCES the diagnostic to error severity", () => {
  const [d] = noOpD(noOp, { diagnostics: { "no-op-statement": "error" } })
  expect(d?.severity).toBe("error")
})

test("one code's state does not affect another", () => {
  expect(noOpD(noOp, { diagnostics: { "adr-on-bit": "off" } })[0]?.severity).toBe("warning")
})

test("a code Volt emits as ERROR but CODESYS defaults to warning is corrected to warning", () => {
  // C0118 jump-label-unreferenced — Volt's check emits it as error; the filter forces the configured warning.
  const src = `FUNCTION_BLOCK F\nlbl: ;\nEND_FUNCTION_BLOCK`
  const labels = diag(src).filter((d) => d.code === "jump-label-unreferenced")
  // NOT `if (labels.length > 0)`. Guarding the assertion made this pass when the check emitted NOTHING — and
  // "the check still fires" is half of what the test is for: the correction is only meaningful if there is
  // something to correct.
  expect(labels, "the unreferenced-label check must still fire — there is nothing to correct otherwise").toHaveLength(1)
  expect(labels[0]?.severity).toBe("warning") // CODESYS's default state for C0118
})

test("a non-configurable ERROR is never affected by the dialog states", () => {
  const src = `FUNCTION_BLOCK F\nVAR a : INT; END_VAR\na := nope;\nEND_FUNCTION_BLOCK` // unresolved-identifier (error)
  // Even with every configurable code turned off, the error still rides through.
  const allOff = Object.fromEntries(CONFIGURABLE_CHECKS.map((w) => [w.code, "off"]))
  const d = diag(src, { diagnostics: allOff as never }).filter((x) => x.code === "unresolved-identifier")
  expect(d[0]?.severity).toBe("error")
})

// ─── project settings (`.projectsettings`) ───────────────────────────────────
// A compiler warning's state is a PROJECT fact. pro2193 disables C0371, and the LSP reporting it anyway is
// why that project's VAR_IN_OUT conformance failed — the check was right, the input was missing.

test("a disabled warning from the project turns its check off", () => {
  const body = ["Disabled warnings:     C0371", "Replace constants:     on", "Max compiler warnings: 100"].join("\n")
  expect(projectDiagnosticsFrom(body)).toEqual({ "inout-own-access": "off" })
})

test("warnings-as-errors raise severity", () => {
  expect(projectDiagnosticsFrom("Warnings as errors:    C0118, C0139")).toEqual({
    "jump-label-unreferenced": "error",
    "no-op-statement": "error",
  })
})

test("both lists apply at once", () => {
  const body = "Disabled warnings:     C0371\nWarnings as errors:    C0139"
  expect(projectDiagnosticsFrom(body)).toEqual({ "inout-own-access": "off", "no-op-statement": "error" })
})

test("a paired control resolves from EITHER compiler code", () => {
  // C0195/C0196 is one dialog row, two compiler codes — the file may carry either.
  expect(projectDiagnosticsFrom("Disabled warnings: C0195")).toEqual({ "sign-change-conversion": "off" })
  expect(projectDiagnosticsFrom("Disabled warnings: C0196")).toEqual({ "sign-change-conversion": "off" })
})

test("a code Volt does not implement is skipped, not rejected", () => {
  // The file lists the PROJECT's configuration; it may configure warnings this LSP has no check for.
  expect(projectDiagnosticsFrom("Disabled warnings: C0999, C0371")).toEqual({ "inout-own-access": "off" })
})

test("a settings file with no warning lines configures nothing", () => {
  expect(projectDiagnosticsFrom("Replace constants: on\nUTF-8 encoding: off")).toEqual({})
  expect(projectDiagnosticsFrom("")).toEqual({})
})

test("the project's state overrides the editor's, which is the whole point", () => {
  const editor = { "inout-own-access": "error" } as const
  const project = projectDiagnosticsFrom("Disabled warnings: C0371")
  const resolved = resolveConfig({ vendor: "codesys", diagnostics: { ...editor, ...project } })
  expect(resolved.diagnostics["inout-own-access"]).toBe("off")
})

test("codes the project leaves alone keep their default", () => {
  const resolved = resolveConfig({ vendor: "codesys", diagnostics: projectDiagnosticsFrom("Disabled warnings: C0371") })
  expect(resolved.diagnostics["no-op-statement"]).toBe("warning")
  expect(resolved.diagnostics["inout-own-access"]).toBe("off")
})

// THE SAME SLUG→Cnnnn MAPPING IS WRITTEN TWICE, and nothing linked them. `CONFIGURABLE_CHECKS[].c` is what the
// compiler-warnings dialog keys on; `CODESYS_CODE_MAP` is what a diagnostic is STAMPED with, and its own header
// calls itself "the authoritative RUNTIME source … NOT derived from any test file". Both are hand-kept, both
// name the same codes, and the only consistency test in the package compares `CODESYS_CODE_MAP` against the
// catalog fixture — `w.c` was read by no test at all. All 21 rows agree today; the failure this guards is
// prospective, which is the only kind a second table has. Found by a review of `consolidate-lsp-structure`.
test("the two slug→Cnnnn tables agree on every configurable code", () => {
	const disagree: string[] = []
	for (const w of CONFIGURABLE_CHECKS) {
		const stamped = CODESYS_CODE_MAP[w.code]?.[0]
		if (stamped === undefined) continue // a control with no stamped code is not this test's business
		// `c` is occasionally a pair (`C0195/C0196` — one control, two compiler codes); the stamp is one of them
		const declared = w.c.split("/").map((c) => c.trim().toUpperCase())
		if (!declared.includes(stamped.toUpperCase())) disagree.push(`${w.code}: dialog ${w.c}, stamped ${stamped}`)
	}
	expect(disagree).toEqual([])
})

// openspec `twincat-project-settings` 3.1 — the descriptor a LIVE TwinCAT bridge materialized after C0371 was unchecked
// on the Compiler Warnings page and saved (TcXaeShell 15.0 / TwinCAT 3.1.4024.74, a Project14 fixture copy, pulled by
// `volt init` 2026-10-03), byte for byte. The LSP is vendor-blind: the TwinCAT file turns the C0371 check off exactly
// as pro2193's CODESYS file does.
test("the pulled TwinCAT descriptor with C0371 disabled stops the VAR_IN_OUT own-access warning", () => {
  const pulled = "Disabled warnings:     C0371\nReplace constants:     off\nMax compiler warnings: 100\n"
  const src = `FUNCTION_BLOCK FB_Test\nVAR_IN_OUT\n io : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD METH : BOOL\nVAR\n x : INT;\nEND_VAR\nio := x;\nEND_METHOD`
  const parseResult = parseSource(src, { networkText: true }, "twincat")
  const project = build.buildSymbolTable([{ uri: "FB_Test.pou", parseResult, source: src }], undefined, "twincat")
  const run = (diagnostics: ReturnType<typeof projectDiagnosticsFrom>) =>
    computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "twincat", diagnostics }) }).map((d) => d.code)
  expect(run({}), "the trigger must fire without the project's settings").toEqual(["inout-own-access"])
  expect(projectDiagnosticsFrom(pulled)).toEqual({ "inout-own-access": "off" })
  expect(run(projectDiagnosticsFrom(pulled))).toEqual([])
})

// analysis-conformance 4 (gate review): C0125 is a row of CODESYS's Compiler-warnings dialog (scripts/coverage-doc.ts
// DIALOG), so a project can switch it off or raise it. Before 3.11 Volt had no check for it; once it shipped, a
// `.projectsettings` naming C0125 was skipped as "not implemented" and the warning fired regardless.
const dupEnum = `TYPE E : (A := 0, B := 0); END_TYPE`
const dupEnumD = (opts?: Parameters<typeof resolveConfig>[0]) => diag(dupEnum, opts).filter((d) => d.code === "enum-duplicate-value")

test("a project that disables C0125 turns the duplicate-enum-value warning off", () => {
  expect(projectDiagnosticsFrom("Disabled warnings:     C0125")).toEqual({ "enum-duplicate-value": "off" })
  expect(dupEnumD()).toHaveLength(1)
  expect(dupEnumD({ diagnostics: projectDiagnosticsFrom("Disabled warnings:     C0125") })).toEqual([])
})

test("a project that raises C0125 makes the duplicate enum value an error", () => {
  const [d] = dupEnumD({ diagnostics: projectDiagnosticsFrom("Warnings as errors:    C0125") })
  expect(d?.severity).toBe("error")
})

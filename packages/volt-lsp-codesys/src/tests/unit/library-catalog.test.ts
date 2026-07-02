/**
 * Library signature index — Phase 1 (namespace catalog): the loader + the unresolved-identifier skip.
 */
import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parseSource } from "../../parser/parser.js"
import { buildSymbolTable } from "../../semantic/symbol-table-build.js"
import { computeSemanticDiagnostics } from "../../semantic/diagnostics.js"
import { buildBodyModelsForParseResult } from "../../semantic/body.js"
import { DEFAULT_DIAGNOSTIC_CONFIG } from "../../lsp/config/index.js"
import { loadLibraryNamespaces } from "../../semantic/library-catalog.js"

/** Materialize a workspace with `.library` reference files nested under a Library Manager folder. */
function withLibraries(files: { name: string; body: string }[] | null): string {
	const root = mkdtempSync(join(tmpdir(), "volt-libcat-"))
	if (files !== null) {
		const dir = join(root, "src", "09 Misc", "Library Manager")
		mkdirSync(dir, { recursive: true })
		for (const f of files) writeFileSync(join(dir, f.name), f.body, "utf-8")
	}
	return root
}
const lib = (namespace: string) => ({ name: `${namespace}.library`, body: `LIBRARY ${namespace}\nNAMESPACE ${namespace}\nRESOLUTION x, 1 (v)\n` })

describe("loadLibraryNamespaces", () => {
	it("scans .library files and lowercases their namespaces", () => {
		const root = withLibraries([lib("PACK_ML"), lib("L_MC4P"), lib("Stu")])
		try {
			const ns = loadLibraryNamespaces(root)
			expect(ns.has("pack_ml")).toBe(true)
			expect(ns.has("l_mc4p")).toBe(true)
			expect(ns.has("stu")).toBe(true)
			expect(ns.size).toBe(3)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("returns empty when there are no .library files, and skips a ref with no NAMESPACE", () => {
		const none = withLibraries(null)
		const noNs = withLibraries([{ name: "Weird.library", body: "LIBRARY Weird\nRESOLUTION x\n" }])
		try {
			expect(loadLibraryNamespaces(none).size).toBe(0)
			expect(loadLibraryNamespaces(noNs).size).toBe(0)
		} finally {
			rmSync(none, { recursive: true, force: true })
			rmSync(noNs, { recursive: true, force: true })
		}
	})
})

describe("unresolved-identifier: library namespace", () => {
	const src = `FUNCTION_BLOCK FB_X
VAR
	mode : INT;
END_VAR
mode := PACK_ML.UnitMode;
END_FUNCTION_BLOCK`

	function diagnose(libraryNamespaces?: ReadonlySet<string>) {
		const parseResult = parseSource(src)
		return computeSemanticDiagnostics({
			parseResult,
			source: src,
			project: buildSymbolTable([{ uri: "file:///t.st", parseResult }]),
			config: DEFAULT_DIAGNOSTIC_CONFIG,
			bodyModels: buildBodyModelsForParseResult(parseResult),
			libraryNamespaces,
		}).filter((d) => d.code === "unresolved-identifier")
	}

	it("flags a library-namespace reference with no catalog", () => {
		expect(diagnose().some((d) => d.message.includes("PACK_ML"))).toBe(true)
	})

	it("resolves the reference when the namespace is in the catalog", () => {
		expect(diagnose(new Set(["pack_ml"])).some((d) => d.message.includes("PACK_ML"))).toBe(false)
	})
})

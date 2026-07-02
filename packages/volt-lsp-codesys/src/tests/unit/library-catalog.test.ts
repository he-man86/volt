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

function withCatalog(content: string | null): string {
	const root = mkdtempSync(join(tmpdir(), "volt-libcat-"))
	if (content !== null) {
		mkdirSync(join(root, "libs"), { recursive: true })
		writeFileSync(join(root, "libs", "namespaces.json"), content, "utf-8")
	}
	return root
}

describe("loadLibraryNamespaces", () => {
	it("reads the catalog and lowercases the namespaces", () => {
		const root = withCatalog(JSON.stringify(["PACK_ML", "L_MC4P", "Stu"]))
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

	it("returns empty for a missing or malformed catalog", () => {
		const missing = withCatalog(null)
		const malformed = withCatalog("{ not an array }")
		try {
			expect(loadLibraryNamespaces(missing).size).toBe(0)
			expect(loadLibraryNamespaces(malformed).size).toBe(0)
		} finally {
			rmSync(missing, { recursive: true, force: true })
			rmSync(malformed, { recursive: true, force: true })
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

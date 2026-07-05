/**
 * Workspace reference catalogs (`.library` namespaces + `.device` instances): the loaders + the
 * unresolved-identifier skips they drive.
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
import { loadLibraryNamespaces, loadDeviceInstances } from "../../semantic/reference-catalog.js"

/** Run the unresolved-identifier check over `src`, optionally with the reference catalogs. */
function diagnose(src: string, extra: { libraryNamespaces?: ReadonlySet<string>; deviceInstances?: ReadonlySet<string> } = {}) {
	const parseResult = parseSource(src)
	return computeSemanticDiagnostics({
		parseResult,
		source: src,
		project: buildSymbolTable([{ uri: "file:///t.fb", parseResult, source: src }]),
		config: DEFAULT_DIAGNOSTIC_CONFIG,
		bodyModels: buildBodyModelsForParseResult(parseResult),
		...extra,
	}).filter((d) => d.code === "unresolved-identifier")
}

// ── .library namespaces ─────────────────────────────────────────────────────
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
	it("flags a library-namespace reference with no catalog", () => {
		expect(diagnose(src).some((d) => d.message.includes("PACK_ML"))).toBe(true)
	})
	it("resolves the reference when the namespace is in the catalog", () => {
		expect(diagnose(src, { libraryNamespaces: new Set(["pack_ml"]) }).some((d) => d.message.includes("PACK_ML"))).toBe(false)
	})
})

// ── .device instances ───────────────────────────────────────────────────────
function withDevices(names: string[] | null): string {
	const root = mkdtempSync(join(tmpdir(), "volt-devcat-"))
	if (names !== null) {
		const dir = join(root, "src", "Device", "Kinematics", "MagazineAxes")
		mkdirSync(dir, { recursive: true })
		for (const n of names) writeFileSync(join(dir, `${n}.device`), `Name: Axis\nVendor: Lenze\n`, "utf-8")
	}
	return root
}

describe("loadDeviceInstances", () => {
	it("scans .device files and lowercases their instance names (the filename stem)", () => {
		const root = withDevices(["MagazineAxes", "Axis_X", "EtherCAT_Master"])
		try {
			const d = loadDeviceInstances(root)
			expect(d.has("magazineaxes")).toBe(true)
			expect(d.has("axis_x")).toBe(true)
			expect(d.has("ethercat_master")).toBe(true)
			expect(d.size).toBe(3)
		} finally {
			rmSync(root, { recursive: true, force: true })
		}
	})

	it("returns empty when there are no .device files", () => {
		const none = withDevices(null)
		try {
			expect(loadDeviceInstances(none).size).toBe(0)
		} finally {
			rmSync(none, { recursive: true, force: true })
		}
	})
})

describe("unresolved-identifier: device instance", () => {
	// A BARE device reference (passed as an argument) is what gets flagged; member access on a device
	// already falls through (the qualifier resolves nowhere).
	const src = `FUNCTION_BLOCK FB_X
VAR
	grp : INT;
END_VAR
grp := MagazineAxes;
END_FUNCTION_BLOCK`
	it("flags a bare device reference with no catalog", () => {
		expect(diagnose(src).some((d) => d.message.includes("MagazineAxes"))).toBe(true)
	})
	it("resolves the reference when the instance is in the catalog", () => {
		expect(diagnose(src, { deviceInstances: new Set(["magazineaxes"]) }).some((d) => d.message.includes("MagazineAxes"))).toBe(false)
	})
})

// ── bare enum members (non-qualified_only enums expose members as global constants) ──────────────────
describe("bare enum-member resolution", () => {
	const ENUM = "TYPE sState :(\n\tStateInit,\n\tStateRun\n);\nEND_TYPE\n"
	// Reference the member bare in an INT context (not an enum-typed target), so ONLY bare-global resolution can
	// resolve it — isolating this skip from enum-context inference on an enum-typed assignment.
	const use = "FUNCTION_BLOCK FB\nVAR\n\tn : INT;\nEND_VAR\nn := StateRun;\nEND_FUNCTION_BLOCK"
	it("resolves a non-qualified_only enum's member referenced bare", () => {
		expect(diagnose(ENUM + use).some((d) => d.message.includes("StateRun"))).toBe(false)
	})
	it("still flags a bare member of a {attribute 'qualified_only'} enum (must be qualified)", () => {
		expect(diagnose("{attribute 'qualified_only'}\n" + ENUM + use).some((d) => d.message.includes("StateRun"))).toBe(true)
	})
})

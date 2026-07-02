/**
 * Device-tree instance catalog: the loader + the unresolved-identifier skip for bare device references.
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
import { loadDeviceInstances } from "../../semantic/device-catalog.js"

/** Materialize a workspace with `.device` descriptor files mirroring the device tree. */
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
	// A BARE device reference (passed as an argument) is what gets flagged; member access on a device falls
	// through already (the qualifier resolves nowhere).
	const src = `FUNCTION_BLOCK FB_X
VAR
	grp : INT;
END_VAR
grp := MagazineAxes;
END_FUNCTION_BLOCK`

	function diagnose(deviceInstances?: ReadonlySet<string>) {
		const parseResult = parseSource(src)
		return computeSemanticDiagnostics({
			parseResult,
			source: src,
			project: buildSymbolTable([{ uri: "file:///t.st", parseResult }]),
			config: DEFAULT_DIAGNOSTIC_CONFIG,
			bodyModels: buildBodyModelsForParseResult(parseResult),
			deviceInstances,
		}).filter((d) => d.code === "unresolved-identifier")
	}

	it("flags a bare device reference with no catalog", () => {
		expect(diagnose().some((d) => d.message.includes("MagazineAxes"))).toBe(true)
	})

	it("resolves the reference when the instance is in the catalog", () => {
		expect(diagnose(new Set(["magazineaxes"])).some((d) => d.message.includes("MagazineAxes"))).toBe(false)
	})
})

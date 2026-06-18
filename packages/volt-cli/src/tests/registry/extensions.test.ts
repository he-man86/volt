import { describe, test, expect } from "bun:test"
import { getByExt, getByPath, defFromName, sourceExtensions, defaultExtensionAccess, FOLDER_MARKER } from "../../registry/extensions.js"

describe("extension registry", () => {
	test("every extension resolves to itself via getByExt", () => {
		for (const ext of [".st", ".fbd", ".ld", ".itf", ".gvl", ".struct", ".union", ".enum", ".alias"]) {
			const def = getByExt(ext)
			expect(def).toBeDefined()
			expect(def!.defaultAccess).toBe("rw")
		}
		for (const ext of [".cfc", ".sfc"]) {
			expect(getByExt(ext)!.defaultAccess).toBe("r")
		}
	})

	test("read-only reference extensions resolve to 'r'", () => {
		for (const ext of [".library", ".task", ".image_pool", ".text_list", ".recipe_manager", ".visualization_manager", ".visualization", ".library_manager", ".class_diagram", ".external_types"]) {
			const def = getByExt(ext)
			expect(def).toBeDefined()
			expect(def!.defaultAccess).toBe("r")
		}
	})

	test("getByPath resolves from workspace paths", () => {
		expect(getByPath("POUs/FB_Motor.st")?.ext).toBe("st")
		expect(getByPath("Globals.gvl")?.ext).toBe("gvl")
		expect(getByPath("Types/DUT.scruct")).toBeUndefined()
	})

	test("defFromName resolves from full filenames", () => {
		expect(defFromName("FB_Motor.st")?.ext).toBe("st")
		expect(defFromName("PLC_PRG.fbd")?.ext).toBe("fbd")
		expect(defFromName("Globals.gvl")?.ext).toBe("gvl")
		expect(defFromName("FB_Noext")).toBeUndefined()
	})

	test("sourceExtensions lists all rw extensions", () => {
		const exts = sourceExtensions()
		expect(exts).toContain(".st")
		expect(exts).toContain(".fbd")
		expect(exts).toContain(".ld")
		expect(exts).toContain(".struct")
		expect(exts).toContain(".gvl")
		expect(exts).not.toContain(".library")
		expect(exts).not.toContain(".cfc")
	})

	test("defaultExtensionAccess return all tracked extensions", () => {
		const access = defaultExtensionAccess()
		expect(access[".st"]).toBe("rw")
		expect(access[".cfc"]).toBe("r")
		expect(access[".library"]).toBe("r")
	})

	test("folder marker has empty extension", () => {
		expect(FOLDER_MARKER).toBe(".gitkeep")
	})
})

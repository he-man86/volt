import { describe, expect, test } from "bun:test"

import {
	EXTENSIONS,
	FOLDER_MARKER,
	getByExt,
	getByKind,
	getByPath,
	gitattributesContent,
	isTrackedPath,
	nameFromPath,
	pickExtension,
	sourceExtensions,
	trackedExtensions,
} from "../../../registry/extensions.js"
import { effectiveAccess, isPullable, isPushable } from "../../../config/access.js"

describe("extension registry", () => {
	test("every kind is unique", () => {
		const seen = new Set<string>()
		for (const def of EXTENSIONS) {
			expect(seen.has(def.kind)).toBe(false)
			seen.add(def.kind)
		}
	})

	test("every reachable extension maps back to exactly one kind", () => {
		for (const ext of trackedExtensions()) {
			expect(getByExt(ext)).toBeDefined()
		}
	})

	test("getByPath finds the right family for any workspace path", () => {
		const st = getByPath("POUs/FB_Motor.st")
		expect(st?.family).toBe("source")
		expect(st?.defaultAccess).toBe("rw")
		expect(getByPath("Device/Plc Logic/Application/MainTask.task")?.kind).toBe("task")
		expect(getByPath("Library Manager/IoStandard.library")?.kind).toBe("library")
		expect(getByPath("Visu_X.visualization")?.kind).toBe("visualization")
		expect(getByPath("unknown.weird")).toBeUndefined()
	})

	test("pickExtension works for known kinds", () => {
		expect(pickExtension("function_block")).toBe("st")
		expect(pickExtension("gvl")).toBe("gvl")
		expect(pickExtension("interface")).toBe("itf")
	})

	test("pickExtension throws on unknown kind (no silent fallback)", () => {
		expect(() => pickExtension("not_a_kind")).toThrow(/unknown kind/)
	})

	test("nameFromPath recovers item name from any tracked ext", () => {
		expect(nameFromPath("POUs/FB_Motor.st")).toBe("FB_Motor")
		expect(nameFromPath("Library Manager/IoStandard.library")).toBe("IoStandard")
		expect(nameFromPath("Visu_X.visualization")).toBe("Visu_X")
		expect(nameFromPath("Application/SomeFolder/.gitkeep")).toBe("SomeFolder")
		expect(nameFromPath("notes.md")).toBeUndefined()
	})

	test("isTrackedPath recognizes every kind + .gitkeep + .gitattributes", () => {
		expect(isTrackedPath("POUs/FB_Motor.st")).toBe(true)
		expect(isTrackedPath("X.fbd")).toBe(false)
		expect(isTrackedPath("X.ld")).toBe(false)
		expect(isTrackedPath("MainTask.task")).toBe(true)
		expect(isTrackedPath("Project Information.projectinfo")).toBe(true)
		expect(isTrackedPath("a/b/.gitkeep")).toBe(true)
		expect(isTrackedPath(FOLDER_MARKER)).toBe(true)
		expect(isTrackedPath(".gitattributes")).toBe(true)
		expect(isTrackedPath("README.md")).toBe(false)
	})

	test("gitattributesContent enumerates every source ext", () => {
		const text = gitattributesContent()
		const sources = sourceExtensions()
		for (const ext of sources) {
			expect(text).toContain(`*${ext} text eol=lf`)
		}
		expect(text).not.toContain("*.library")
		expect(text).not.toContain("*.device")
		expect(text).not.toContain("*.task")
	})
})

describe("access mode resolution", () => {
	test("default access flows through when no overrides", () => {
		expect(effectiveAccess(".st", undefined)).toBe("rw")
		expect(isPullable(".st", undefined)).toBe(true)
		expect(isPushable(".st", undefined)).toBe(true)
		expect(effectiveAccess(".library", undefined)).toBe("r")
		expect(isPullable(".library", undefined)).toBe(true)
		expect(isPushable(".library", undefined)).toBe(false)
	})

	test("config override flips access mode", () => {
		const cfg = { extensionAccess: { ".library": "off" as const } }
		expect(effectiveAccess(".library", cfg)).toBe("off")
		expect(isPullable(".library", cfg)).toBe(false)
		expect(isPushable(".library", cfg)).toBe(false)
		const cfgSt = { extensionAccess: { ".st": "r" as const } }
		expect(effectiveAccess(".st", cfgSt)).toBe("r")
		expect(isPushable(".st", cfgSt)).toBe(false)
	})

	test("unknown extensions resolve to 'off' regardless of config", () => {
		expect(effectiveAccess(".weird", undefined)).toBe("off")
		expect(effectiveAccess(".weird", { extensionAccess: { ".weird": "rw" } })).toBe("off")
	})

	test("case-insensitive extension lookup", () => {
		expect(effectiveAccess(".ST", undefined)).toBe("rw")
		expect(effectiveAccess(".LIBRARY", undefined)).toBe("r")
	})
})

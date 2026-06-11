import { describe, expect, test } from "bun:test"

import { EXTENSIONS, getByKind } from "../../../registry/extensions.js"

const BRIDGE_KIND_VOCABULARY = [
	"function_block",
	"function",
	"program",
	"interface",
	"gvl",
	"structure",
	"union",
	"enumeration",
	"alias",
	"folder",
	"library",
	"task",
	"device",
	"trace",
	"image_pool",
	"text_list",
	"recipe_manager",
	"visualization",
	"visualization_manager",
	"symbol_config",
	"project_info",
	"library_manager",
	"class_diagram",
	"external_types",
	"tmc_file",
] as const

describe("bridge ↔ agent vocabulary contract", () => {
	test("every kind a bridge can emit is registered on the agent", () => {
		const missing: string[] = []
		for (const kind of BRIDGE_KIND_VOCABULARY) {
			if (getByKind(kind) === undefined) missing.push(kind)
		}
		expect(missing).toEqual([])
	})

	test("registry has no kinds the bridges DON'T emit (orphan registrations)", () => {
		const known = new Set<string>(BRIDGE_KIND_VOCABULARY)
		const orphans: string[] = []
		for (const def of EXTENSIONS) {
			if (!known.has(def.kind)) orphans.push(def.kind)
		}
		expect(orphans).toEqual([])
	})
})

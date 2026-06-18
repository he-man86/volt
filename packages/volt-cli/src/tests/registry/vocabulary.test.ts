/**
 * Cross-language extension vocabulary contract.
 *
 * Three definitions must agree:
 *   1. packages/volt-bridge/item-kinds.json   — the shared contract (source of truth)
 *   2. ItemKind.cs `Map()`                      — what the BRIDGE actually emits
 *   3. registry/extensions.ts `EXTENSIONS`      — what the CLI materializes as files
 *
 * No codegen, no live bridge — just three committed files compared as sets.
 */
import { describe, test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const BRIDGES = join(import.meta.dir, "..", "..", "..", "..", "volt-bridge")
const ITEMKIND_CS = join(BRIDGES, "src", "Volt.Bridge.Core", "Workspace", "ItemKind.cs")

interface KindDef { kind: string; family?: "inlined" | "container" }

const contract = (
	JSON.parse(readFileSync(join(BRIDGES, "item-kinds.json"), "utf-8")) as { kinds: KindDef[] }
).kinds

const contractKinds = contract.map((k) => k.kind)
const fileKinds = contract.filter((k) => k.family === undefined).map((k) => k.kind)

// Map() is the only place in ItemKind.cs that returns kind STRINGS.
const emittedKinds = [...readFileSync(ITEMKIND_CS, "utf-8").matchAll(/=>\s*"([a-z_]+)"/g)].map((m) => m[1]!)

const asSet = (xs: readonly string[]): string[] => [...new Set(xs)].sort()

describe("item-kind vocabulary contract", () => {
	test("the contract lists each kind exactly once", () => {
		const duplicates = contractKinds.filter((k, i) => contractKinds.indexOf(k) !== i)
		expect(duplicates).toEqual([])
	})

	test("the contract lists exactly the kinds the bridge's ItemKind.Map emits", () => {
		expect(asSet(contractKinds)).toEqual(asSet(emittedKinds))
	})
})

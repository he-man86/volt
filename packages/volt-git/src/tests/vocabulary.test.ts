/**
 * Cross-language item-kind vocabulary contract.
 *
 * Two committed definitions must agree (no codegen, no live bridge — compared as sets):
 *   1. packages/volt-bridge/item-kinds.json   — the shared contract (source of truth)
 *   2. ItemKind.cs `Map()`                     — what the BRIDGE actually emits
 *
 * (extensions.ts access is exercised by the sync tests.)
 */
import { describe, test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const BRIDGES = join(import.meta.dir, "..", "..", "..", "volt-bridge")
const ITEMKIND_CS = join(BRIDGES, "src", "Volt.Bridge.Core", "Workspace", "ItemKind.cs")

interface KindDef {
	kind: string
	family?: "inlined" | "container"
}

const contractKinds = (
	JSON.parse(readFileSync(join(BRIDGES, "item-kinds.json"), "utf-8")) as { kinds: KindDef[] }
).kinds.map((k) => k.kind)

// Map() is the only place in ItemKind.cs that returns kind STRINGS. Slice out just the Map method
// body (`=> code switch … };`) so other switches in the file (ExtFor, …) don't leak into the set.
const itemKindSrc = readFileSync(ITEMKIND_CS, "utf-8")
const mapStart = itemKindSrc.indexOf("=> code switch")
const mapEnd = itemKindSrc.indexOf("/// <summary>Top-level", mapStart)
const mapBody = mapStart > 0 && mapEnd > mapStart ? itemKindSrc.slice(mapStart, mapEnd) : itemKindSrc
const emittedKinds = [...mapBody.matchAll(/=>\s*"([a-z_]+)"/g)].map((m) => m[1]!)

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

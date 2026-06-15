/**
 * Cross-language item-kind vocabulary contract.
 *
 * Three definitions must agree, or kinds silently drift:
 *   1. packages/volt-bridges/item-kinds.json   — the shared contract (source of truth)
 *   2. ItemKind.cs `Map()`                      — what the BRIDGE actually emits
 *   3. registry/extensions.ts `EXTENSIONS`      — what the CLI materializes as files
 *
 * No codegen, no live bridge — just three committed files compared as sets, so a
 * failure names exactly which kind drifted on which side.
 */
import { describe, test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { knownKinds } from "../../registry/extensions.js"

const BRIDGES = join(import.meta.dir, "..", "..", "..", "..", "volt-bridges")
const ITEMKIND_CS = join(BRIDGES, "src", "VoltBridge.Core", "ItemKind.cs")

// A bare contract entry is a file-producing kind (needs a CLI registry entry);
// only the exceptions that never become files carry a `family` tag.
interface KindDef { kind: string; family?: "inlined" | "container" }

const contract = (
	JSON.parse(readFileSync(join(BRIDGES, "item-kinds.json"), "utf-8")) as { kinds: KindDef[] }
).kinds

const contractKinds = contract.map((k) => k.kind)
const fileKinds = contract.filter((k) => k.family === undefined).map((k) => k.kind)
// Every kind the registry recognizes — the POU kinds plus each row's resolved kind.
// (POU body languages .fbd/.ld/… are not kinds; knownKinds() already excludes them.)
const registryKinds = knownKinds()

// Map() is the only place in ItemKind.cs that returns kind STRINGS (the predicates
// compare int constants), so every `=> "kind"` arm is a kind the bridge can emit.
const emittedKinds = [...readFileSync(ITEMKIND_CS, "utf-8").matchAll(/=>\s*"([a-z_]+)"/g)].map((m) => m[1]!)

const asSet = (xs: readonly string[]): string[] => [...new Set(xs)].sort()

describe("item-kind vocabulary contract", () => {
	test("the contract lists each kind exactly once", () => {
		const duplicates = contractKinds.filter((k, i) => contractKinds.indexOf(k) !== i)
		expect(duplicates).toEqual([])
	})

	test("the CLI registry covers exactly the contract's file-producing kinds", () => {
		expect(asSet(registryKinds)).toEqual(asSet(fileKinds))
	})

	test("the contract lists exactly the kinds the bridge's ItemKind.Map emits", () => {
		expect(asSet(contractKinds)).toEqual(asSet(emittedKinds))
	})
})

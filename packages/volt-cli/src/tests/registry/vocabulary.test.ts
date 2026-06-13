/**
 * Cross-language item-kind vocabulary contract.
 *
 * Three definitions must agree:
 *   1. packages/volt-bridges/item-kinds.json   — the shared contract (source of truth)
 *   2. ItemKind.cs `Map()`                      — what the BRIDGE actually emits
 *   3. registry/extensions.ts `EXTENSIONS`      — what the CLI materializes as files
 *
 * This single test enforces all three so they can't silently drift: adding a kind
 * to the bridge without the contract, or a contract file-kind without a registry
 * entry, fails here. No codegen, no live bridge — just three files compared.
 */
import { describe, test, expect } from "bun:test"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { EXTENSIONS } from "../../registry/extensions.js"

const BRIDGES = join(import.meta.dir, "..", "..", "..", "..", "volt-bridges")
const CONTRACT = join(BRIDGES, "item-kinds.json")
const ITEMKIND_CS = join(BRIDGES, "src", "VoltBridge.Core", "ItemKind.cs")

type Family = "source" | "config" | "folder" | "inlined" | "container"
interface KindDef { kind: string; family: Family }

function loadContract(): KindDef[] {
	return (JSON.parse(readFileSync(CONTRACT, "utf-8")) as { kinds: KindDef[] }).kinds
}

/** Kinds the CLI materializes as workspace files (need a registry entry). */
function isFileFamily(f: Family): boolean {
	return f === "source" || f === "config" || f === "folder"
}

describe("item-kind vocabulary contract", () => {
	test("the contract file is well-formed and self-consistent", () => {
		const contract = loadContract()
		expect(contract.length).toBeGreaterThan(0)
		// no duplicate kinds
		expect(new Set(contract.map((k) => k.kind)).size).toBe(contract.length)
	})

	test("CLI registry covers EXACTLY the contract's file-producing kinds (same family)", () => {
		const contract = loadContract()
		const fileKinds = new Map(contract.filter((k) => isFileFamily(k.family)).map((k) => [k.kind, k.family]))
		const registry = new Map(EXTENSIONS.map((e) => [e.kind, e.family]))

		// every file kind in the contract has a registry entry, with the same family
		for (const [kind, family] of fileKinds) {
			expect(registry.has(kind)).toBe(true)
			expect(registry.get(kind)).toBe(family)
		}
		// the registry has no kind the contract doesn't list as a file kind
		for (const kind of registry.keys()) {
			expect(fileKinds.has(kind)).toBe(true)
		}
	})

	test("contract matches the bridge's ItemKind.Map outputs exactly", () => {
		if (!existsSync(ITEMKIND_CS) || !existsSync(CONTRACT)) {
			console.warn(`SKIP: bridge source not present (${ITEMKIND_CS}) — vocabulary cross-check not run`)
			return
		}
		const cs = readFileSync(ITEMKIND_CS, "utf-8")
		// Map() is the only place in ItemKind.cs that returns kind STRINGS
		// (the predicates compare int constants), so every `=> "kind"` is a Map arm.
		const emitted = new Set([...cs.matchAll(/=>\s*"([a-z_]+)"/g)].map((m) => m[1]!))
		const contractKinds = new Set(loadContract().map((k) => k.kind))

		// every kind the bridge can emit is in the contract
		for (const kind of emitted) expect(contractKinds.has(kind)).toBe(true)
		// the contract lists no phantom kind the bridge never emits
		for (const kind of contractKinds) expect(emitted.has(kind)).toBe(true)
	})
})

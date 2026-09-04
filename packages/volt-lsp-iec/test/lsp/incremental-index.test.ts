/**
 * Incremental-index equivalence (Phase B correctness gate). The whole point of the incremental symbol index
 * is that it must produce a project scope IDENTICAL to a from-scratch `buildSymbolTable` — otherwise a
 * keystroke silently changes navigation/diagnostics. After every mutation we assert
 * `store.project()  ≡  buildSymbolTable(store.workspace())` via an order-insensitive structural key (child
 * and same-name symbol order may differ — last-write-wins on duplicate names is by-design, per the protocol
 * invariant — but the resolvable content must match exactly).
 */
import { test, expect } from "bun:test"
import { buildSymbolTable, type Scope } from "../../src/symbols/index.js"
import { resolveConfig } from "../../src/analysis/index.js"
import { WorkspaceStore } from "../../src/server/workspace-store.js"

/** Order-insensitive structural key for a scope tree. baseScope is a pointer into a top-level child, so it's
 *  keyed by its identity (name+span), not recursed, to avoid cycles. */
function scopeKey(s: Scope): string {
  const symKey = (arr: { name: string; kind: string; uri: string; varSection?: string; constant?: boolean }[]) =>
    arr
      .map((x) => `${x.name.toLowerCase()}:${x.kind}:${x.uri}:${x.varSection ?? ""}:${x.constant ? "c" : ""}`)
      .sort()
      .join(",")
  const syms = [...s.symbols.entries()]
    .map(([k, arr]) => `${k}=[${symKey(arr as never)}]`)
    .sort()
    .join(";")
  const children = s.children.map(scopeKey).sort().join("|")
  const base = s.baseScope ? `${s.baseScope.name}@${JSON.stringify(s.baseScope.span)}` : ""
  return `{${s.kind}:${s.name}:${JSON.stringify(s.span)}:ext=${s.extendsName ?? ""}:base=${base}:qo=${
    s.qualifiedOnly ? 1 : 0
  }:syms=${syms}:children=[${children}]}`
}

/** Assert the store's incrementally-maintained project ≡ a full rebuild of the same merged docs. */
function assertEquivalent(store: WorkspaceStore, label: string) {
  const incremental = scopeKey(store.project())
  const fresh = scopeKey(buildSymbolTable(store.workspace()))
  expect(incremental, label).toBe(fresh)
}

const BASE = `FUNCTION_BLOCK Base\nVAR\n b : INT;\nEND_VAR\nb := 1;\nEND_FUNCTION_BLOCK`
const DERIVED = `FUNCTION_BLOCK Derived EXTENDS Base\nVAR\n d : INT;\nEND_VAR\nd := b;\nEND_FUNCTION_BLOCK`
const GVL = `VAR_GLOBAL\n g : BOOL;\nEND_VAR`
const ENUM = `TYPE Color : (Red, Green, Blue); END_TYPE`
const METHOD = `METHOD Compute : INT\nVAR\n x : INT;\nEND_VAR\nCompute := x + b;\nEND_METHOD` // parents onto Base

function seed(store: WorkspaceStore) {
  store.seedDisk([
    { uri: "file:///Base.fb", source: `${BASE}\n${METHOD}` }, // Base + its standalone method (same file)
    { uri: "file:///Derived.fb", source: DERIVED },
    { uri: "file:///GVL.gvl", source: GVL },
    { uri: "file:///Color.enum", source: ENUM },
  ])
}

test("incremental index ≡ full rebuild across a sequence of edits", () => {
  const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }))
  seed(store)
  assertEquivalent(store, "after seed")

  // Sanity: the cross-file EXTENDS actually linked (otherwise equivalence is trivially true on nothing).
  const derived = store.project().children.find((c) => c.name === "Derived")
  expect(derived?.baseScope?.name).toBe("Base")

  store.openDocument("file:///Derived.fb", "iecst", 1, DERIVED)
  assertEquivalent(store, "after open Derived")

  store.changeDocument("file:///Derived.fb", 2, [{ text: `${DERIVED}\nVAR x : REAL; END_VAR` }])
  assertEquivalent(store, "after change Derived (new var)")

  // Open a brand-new file not on disk.
  store.openDocument("file:///New.fb", "iecst", 1, `FUNCTION_BLOCK New EXTENDS Base\nEND_FUNCTION_BLOCK`)
  assertEquivalent(store, "after open New (new file, extends Base)")

  // Edit Base to drop `b` — Derived/New still EXTENDS it, the link must survive, and `b` must vanish.
  store.openDocument("file:///Base.fb", "iecst", 1, `FUNCTION_BLOCK Base\nEND_FUNCTION_BLOCK\n${METHOD}`)
  assertEquivalent(store, "after Base loses var b")

  store.closeDocument("file:///New.fb")
  assertEquivalent(store, "after close New (drops it)")

  store.closeDocument("file:///Base.fb") // reverts to the on-disk Base (with b + method)
  assertEquivalent(store, "after close Base (reverts to disk)")
  expect(store.project().children.find((c) => c.name === "Base")?.symbols.has("b")).toBe(true)

  store.closeDocument("file:///Derived.fb") // reverts to disk Derived
  assertEquivalent(store, "after close Derived (reverts to disk)")
})

test("incremental index ≡ full rebuild after a full disk reseed", () => {
  const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }))
  seed(store)
  store.project() // build once
  store.openDocument("file:///Derived.fb", "iecst", 1, `${DERIVED}\nVAR y : INT; END_VAR`)
  seed(store) // wholesale reseed while a buffer is open — open buffer must still win after rebuild
  assertEquivalent(store, "after reseed with an open buffer")
})

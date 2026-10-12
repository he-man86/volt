/**
 * WorkspaceStore (`workspace-store.ts`): the parse cache and the disk⊕open merge in isolation (the protocol path is the
 * server's `handlers/documents.test.ts`); the dead set it caches, equal to a fresh one across edits; and the incremental
 * index, equal to a full rebuild. The cache is the thing that stops the pre-extraction closure's double-parse per request.
 */
import { describe, expect, test } from "bun:test"
import { resolveConfig, deadMemberSpans, deadPous } from "../analysis/index.js"
import { WorkspaceStore } from "./workspace-store.js"
import { NETWORK_TEXT_ENABLED } from "../server/config.js"
import { parseSource } from "../frontend/syntax/index.js"
import { build, type Scope } from "../frontend/symbols/index.js"

const cfg = () => resolveConfig({ vendor: "codesys" })

const URI = "file:///F.pou"

const SRC = `FUNCTION_BLOCK F\nVAR i : INT; END_VAR\ni := i + 1;\nEND_FUNCTION_BLOCK`

test("store: an open document is parsed once per version (cached parseResult identity)", () => {
  const store = new WorkspaceStore(cfg(), { networkText: NETWORK_TEXT_ENABLED })
  store.openDocument(URI, "iecst", 1, SRC)
  const a = store.doc(URI)!
  const b = store.doc(URI)!
  expect(a.parseResult).toBe(b.parseResult) // same object → not reparsed

  // Editing bumps the version → a fresh parse, distinct identity.
  store.changeDocument(URI, 2, [{ text: SRC.replace("i", "j") }])
  const c = store.doc(URI)!
  expect(c.parseResult).not.toBe(a.parseResult)
})

test("store: an open buffer overrides its disk entry (open wins), close leaves disk intact", () => {
  const store = new WorkspaceStore(cfg(), { networkText: NETWORK_TEXT_ENABLED })
  store.seedDisk([{ uri: URI, source: SRC }])
  const disk = store.doc(URI)!
  store.openDocument(URI, "iecst", 1, SRC.replace("INT", "DINT"))
  expect(store.doc(URI)!.source).toContain("DINT") // buffer wins
  store.closeDocument(URI)
  expect(store.doc(URI)!.source).toBe(disk.source) // disk survives the close
})

test("store: disk and open for the same URI yield one merged entry", () => {
  const store = new WorkspaceStore(cfg(), { networkText: NETWORK_TEXT_ENABLED })
  store.seedDisk([{ uri: URI, source: SRC }])
  store.openDocument(URI, "iecst", 1, SRC)
  expect(store.workspace().length).toBe(1) // not duplicated across the two layers
})

describe("the cached dead set", () => {
  // A tiny multi-POU project: MAIN (task root) calls A; B is dead; A has a called + an uncalled method.
  const FILES = (aBody: string): { uri: string; source: string }[] => [
    { uri: "file:///P.pou", source: `PROGRAM PLC_PRG\nVAR a : A; END_VAR\na.Run();\nEND_PROGRAM` },
    {
      uri: "file:///A.pou",
      source: `FUNCTION_BLOCK A\n${aBody}\nEND_FUNCTION_BLOCK\nMETHOD Run\n;\nEND_METHOD\nMETHOD Unused\n;\nEND_METHOD`,
    },
    { uri: "file:///B.pou", source: `FUNCTION_BLOCK B\nEND_FUNCTION_BLOCK` },
  ]

  const freshDead = (files: { uri: string; source: string }[]) => {
    const inputs = files.map((f) => ({
      uri: f.uri,
      source: f.source,
      parseResult: parseSource(f.source, { networkText: true }, "codesys"),
    }))
    return {
      dead: [...deadPous(inputs, undefined)].sort(),
      members: deadMemberSpans(inputs, deadPous(inputs, undefined)).size,
    }
  }

  const storeDead = (store: WorkspaceStore) => ({
    dead: [...store.deadSet()].sort(),
    members: store.deadMembers().size,
  })

  test("cached dead == fresh dead across edit types (whitespace, add-call, revert)", () => {
    const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }), { networkText: NETWORK_TEXT_ENABLED })
    const files = FILES("VAR x : INT; END_VAR")
    store.seedDisk(files)
    store.project()
    store.openDocument("file:///A.pou", "iecst", 1, files[1]!.source)
    // baseline
    expect(storeDead(store)).toEqual(freshDead(files))

    // 1. whitespace edit inside A's body — reachability unchanged; cache MUST hold and stay correct
    const ws = files[1]!.source.replace("VAR x : INT;", "VAR x : INT;  ")
    store.changeDocument("file:///A.pou", 2, [{ text: ws }])
    expect(storeDead(store)).toEqual(freshDead([files[0]!, { uri: "file:///A.pou", source: ws }, files[2]!]))

    // 2. add a call to the previously-uncalled method Unused — dead MEMBERS must change
    const call = files[1]!.source.replace("VAR x : INT; END_VAR", "VAR x : INT; END_VAR\nUnused();")
    store.changeDocument("file:///A.pou", 3, [{ text: call }])
    const s2 = storeDead(store),
      f2 = freshDead([files[0]!, { uri: "file:///A.pou", source: call }, files[2]!])
    expect(s2).toEqual(f2)

    // 3. add a call to the dead FB B — dead POUS must change (B no longer dead)
    const callB = call.replace("Unused();", "Unused();\nVAR_INST b : B; END_VAR\nb();")
    store.changeDocument("file:///A.pou", 4, [{ text: callB }])
    expect(storeDead(store)).toEqual(freshDead([files[0]!, { uri: "file:///A.pou", source: callB }, files[2]!]))

    // 4. revert to baseline — dead set must return to baseline
    store.changeDocument("file:///A.pou", 5, [{ text: files[1]!.source }])
    expect(storeDead(store)).toEqual(freshDead(files))
  })
})

describe("the incremental index (Phase B correctness gate)", () => {
  /**
   * Incremental-index equivalence (Phase B correctness gate). The whole point of the incremental symbol index
   * is that it must produce a project scope IDENTICAL to a from-scratch `buildSymbolTable` — otherwise a
   * keystroke silently changes navigation/diagnostics. After every mutation we assert
   * `store.project()  ≡  build.buildSymbolTable(store.workspace())` via an order-insensitive structural key (child
   * and same-name symbol order may differ — last-write-wins on duplicate names is by-design, per the protocol
   * invariant — but the resolvable content must match exactly).
   */
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
    const fresh = scopeKey(build.buildSymbolTable(store.workspace(), [], "codesys"))
    expect(incremental, label).toBe(fresh)
  }

  const BASE = `FUNCTION_BLOCK Base\nVAR\n b : INT;\nEND_VAR\nb := 1;\nEND_FUNCTION_BLOCK`

  const DERIVED = `FUNCTION_BLOCK Derived EXTENDS Base\nVAR\n d : INT;\nEND_VAR\nd := b;\nEND_FUNCTION_BLOCK`

  const GVL = `VAR_GLOBAL\n g : BOOL;\nEND_VAR`

  const ENUM = `TYPE Color : (Red, Green, Blue); END_TYPE`

  const METHOD = `METHOD Compute : INT\nVAR\n x : INT;\nEND_VAR\nCompute := x + b;\nEND_METHOD` // parents onto Base

  function seed(store: WorkspaceStore) {
    store.seedDisk([
      { uri: "file:///Base.pou", source: `${BASE}\n${METHOD}` }, // Base + its standalone method (same file)
      { uri: "file:///Derived.pou", source: DERIVED },
      { uri: "file:///GVL.gvl", source: GVL },
      { uri: "file:///Color.dut", source: ENUM },
    ])
  }

  test("incremental index ≡ full rebuild across a sequence of edits", () => {
    const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }), { networkText: NETWORK_TEXT_ENABLED })
    seed(store)
    assertEquivalent(store, "after seed")

    // Sanity: the cross-file EXTENDS actually linked (otherwise equivalence is trivially true on nothing).
    const derived = store.project().children.find((c) => c.name === "Derived")
    expect(derived?.baseScope?.name).toBe("Base")

    store.openDocument("file:///Derived.pou", "iecst", 1, DERIVED)
    assertEquivalent(store, "after open Derived")

    store.changeDocument("file:///Derived.pou", 2, [{ text: `${DERIVED}\nVAR x : REAL; END_VAR` }])
    assertEquivalent(store, "after change Derived (new var)")

    // Open a brand-new file not on disk.
    store.openDocument("file:///New.pou", "iecst", 1, `FUNCTION_BLOCK New EXTENDS Base\nEND_FUNCTION_BLOCK`)
    assertEquivalent(store, "after open New (new file, extends Base)")

    // Edit Base to drop `b` — Derived/New still EXTENDS it, the link must survive, and `b` must vanish.
    store.openDocument("file:///Base.pou", "iecst", 1, `FUNCTION_BLOCK Base\nEND_FUNCTION_BLOCK\n${METHOD}`)
    assertEquivalent(store, "after Base loses var b")

    store.closeDocument("file:///New.pou")
    assertEquivalent(store, "after close New (drops it)")

    store.closeDocument("file:///Base.pou") // reverts to the on-disk Base (with b + method)
    assertEquivalent(store, "after close Base (reverts to disk)")
    expect(
      store
        .project()
        .children.find((c) => c.name === "Base")
        ?.symbols.has("b"),
    ).toBe(true)

    store.closeDocument("file:///Derived.pou") // reverts to disk Derived
    assertEquivalent(store, "after close Derived (reverts to disk)")
  })

  test("incremental index ≡ full rebuild after a full disk reseed", () => {
    const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }), { networkText: NETWORK_TEXT_ENABLED })
    seed(store)
    store.project() // build once
    store.openDocument("file:///Derived.pou", "iecst", 1, `${DERIVED}\nVAR y : INT; END_VAR`)
    seed(store) // wholesale reseed while a buffer is open — open buffer must still win after rebuild
    assertEquivalent(store, "after reseed with an open buffer")
  })
})

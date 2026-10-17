/**
 * WorkspaceStore (`workspace-store.ts`): the parse cache and the disk⊕open merge in isolation (the protocol path is the
 * server's `handlers/documents.test.ts`); the dead set it caches, equal to a fresh one across edits; and the incremental
 * index, equal to a full rebuild. The cache is the thing that stops the pre-extraction closure's double-parse per request.
 */
import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { resolveConfig, deadMemberSpans, deadPous } from "../analysis/index.js"
import { WorkspaceStore } from "./workspace-store.js"
import { normalizeKey } from "./document-key.js"
import { scanWorkspace } from "./workspace-refs.js"
import { failLoud } from "../../test/support/fail-loud.js"
import { THROWS_IN_PARSE } from "../../test/lsp/probes.js"
import { NETWORK_TEXT_ENABLED } from "../server/config.js"
import { parseSource } from "../frontend/syntax/index.js"
import { build, type Scope } from "../frontend/symbols/index.js"

const cfg = () => resolveConfig({ vendor: "codesys" })

const URI = "file:///F.pou"

const SRC = `FUNCTION_BLOCK F\nVAR i : INT; END_VAR\ni := i + 1;\nEND_FUNCTION_BLOCK`

test("store: an open document is parsed once per version (cached parseResult identity)", () => {
  const store = new WorkspaceStore(cfg(), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
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
  const store = new WorkspaceStore(cfg(), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
  store.seedDisk([{ uri: URI, source: SRC }])
  const disk = store.doc(URI)!
  store.openDocument(URI, "iecst", 1, SRC.replace("INT", "DINT"))
  expect(store.doc(URI)!.source).toContain("DINT") // buffer wins
  store.closeDocument(URI)
  expect(store.doc(URI)!.source).toBe(disk.source) // disk survives the close
})

test("store: disk and open for the same URI yield one merged entry", () => {
  const store = new WorkspaceStore(cfg(), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
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
    const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
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
    const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
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


  /**
   * THE DISK PATH ≡ A FRESH SEED (lsp-server-scheduling step 2 review) — a watched batch rebinds the files it names
   * (`upsertDisk` / `deleteDisk` / `deleteDiskUnder`, one at a time or as one `diskBatch`), files under `Library Manager/`
   * included, which before 2.2 always went through a reseed. On a real project WITH its manifests, devices and task
   * roots: the incremental project and dead set equal a store freshly seeded with the same final disk.
   */
  test("incremental index ≡ fresh seed across upserts, deletes and a folder delete, with the manifests", () => {
    const scan = scanWorkspace(resolve(import.meta.dir, "../../test-corpus/CodesysTestProject"))
    const files = scan.sources.map((s) => ({ uri: pathToFileURL(s.path).href, source: s.source }))
    const make = (seed: { uri: string; source: string }[]) => {
      const store = new WorkspaceStore(cfg(), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
      store.setRefs(scan.refs, scan.taskRoots)
      store.seedDisk(seed)
      return store
    }
    const store = make(files)
    store.project()
    store.deadSet()
    const disk = new Map(files.map((f) => [f.uri, f.source]))
    const check = (label: string) => {
      const fresh = make([...disk].map(([uri, source]) => ({ uri, source })))
      expect(scopeKey(store.project()), label).toBe(scopeKey(fresh.project()))
      expect([...store.deadSet()].sort(), label).toEqual([...fresh.deadSet()].sort())
    }
    const library = files.find((f) => f.uri.includes("/Library%20Manager/"))!.uri.replace(/\/[^/]+$/, "")
    expect(files.filter((f) => f.uri.startsWith(`${library}/`)).length).toBeGreaterThan(0) // a library folder with sources
    // one file at a time
    files.forEach((f, i) => {
      if (i % 7 === 0) (store.deleteDisk(f.uri), disk.delete(f.uri))
    })
    check("after deleting every 7th")
    files.forEach((f, i) => {
      if (i % 14 === 0) (store.upsertDisk(f.uri, f.source), disk.set(f.uri, f.source))
    })
    check("after restoring every 14th")
    // one batch
    store.diskBatch(() => {
      files.forEach((f, i) => {
        if (i % 5 === 0) (store.upsertDisk(f.uri, `${f.source}\n// x\n`), disk.set(f.uri, `${f.source}\n// x\n`))
      })
      store.deleteDiskUnder(library, () => false)
      for (const uri of [...disk.keys()]) if (uri.startsWith(`${library}/`)) disk.delete(uri)
    })
    check("after a batch: every 5th changed, a library folder deleted")
  })
  test("incremental index ≡ full rebuild after a full disk reseed", () => {
    const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
    seed(store)
    store.project() // build once
    store.openDocument("file:///Derived.pou", "iecst", 1, `${DERIVED}\nVAR y : INT; END_VAR`)
    seed(store) // wholesale reseed while a buffer is open — open buffer must still win after rebuild
    assertEquivalent(store, "after reseed with an open buffer")
  })
})

describe("generation, the per-file disk layer and the quarantine (openspec lsp-server-scheduling 2.2, 2.3)", () => {
  const at = (path: string) => pathToFileURL(resolve(path)).href // an absolute path on this platform
  const A = at("/w/POUs/Motor/A.pou")
  const B = at("/w/POUs/MotorControl/B.pou")
  const fresh = () => {
    const store = new WorkspaceStore(cfg(), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
    store.seedDisk([{ uri: A, source: SRC }, { uri: B, source: SRC.replace("F", "G") }])
    store.project()
    return store
  }

  test("what leaves the merged text as it was bumps no generation; what changes it does", () => {
    const store = fresh()
    const g = store.generation
    store.openDocument(A, "iecst", 1, SRC) // equal to its disk copy
    store.closeDocument(A) // unedited
    expect(store.upsertDisk(A, SRC)).toBe(false) // equal bytes: no parse either
    expect(store.generation).toBe(g)
    store.openDocument(A, "iecst", 2, SRC + "\n")
    expect(store.generation).toBeGreaterThan(g)
  })

  test("a disk change under an open buffer is kept for the close, and moves nothing until then", () => {
    const store = fresh()
    store.openDocument(A, "iecst", 1, SRC)
    const g = store.generation
    expect(store.upsertDisk(A, SRC.replace("INT", "DINT"))).toBe(true)
    expect(store.generation).toBe(g)
    expect(store.doc(A)!.source).toBe(SRC)
    store.closeDocument(A)
    expect(store.doc(A)!.source).toContain("DINT")
    expect(store.generation).toBeGreaterThan(g)
  })

  test("a folder delete drops the entries under it, never a sibling its name prefixes", () => {
    const store = fresh()
    expect(store.deleteDiskUnder(at("/w/POUs/Motor"), () => false)).toBe(true)
    expect([store.doc(A), store.doc(B)?.uri]).toEqual([undefined, B])
    expect(store.deleteDiskUnder(at("/w/POUs/Motor"), () => false)).toBe(false)
    expect(store.deleteDisk(B)).toBe(true)
    expect(store.workspace()).toEqual([])
  })

  test("a folder event keeps the entries the disk still holds under it, and drops the rest", () => {
    const store = fresh()
    const C = at("/w/POUs/Motor/C.pou")
    store.upsertDisk(C, SRC.replace("F", "H"))
    expect(store.deleteDiskUnder(at("/w/POUs"), (key) => key === normalizeKey(C))).toBe(true)
    expect(store.workspace().map((d) => d.uri)).toEqual([C])
  })

  test("a buffer's quarantine and its disk copy's are each their own", () => {
    const failures: string[] = []
    const store = new WorkspaceStore(cfg(), { networkText: NETWORK_TEXT_ENABLED }, (uri) => failures.push(uri))
    const bad = `${SRC}\n${THROWS_IN_PARSE}`
    store.seedDisk([{ uri: A, source: SRC }])
    store.openDocument(A, "iecst", 1, bad)
    store.workspace() // an open buffer is parsed when the merged set is asked for
    expect(store.quarantinedUris()).toEqual([A])
    store.upsertDisk(A, bad) // the buffer saved: the disk copy holds the content that threw, quarantined unparsed
    store.closeDocument(A)
    expect([store.quarantined(A), store.workspace(), failures]).toEqual([true, [], [A]])
    store.openDocument(A, "iecst", 2, SRC) // a clean buffer over it, closed unsaved: the disk copy's quarantine stands
    expect(store.quarantined(A)).toBe(false)
    store.closeDocument(A)
    expect(store.quarantined(A)).toBe(true)
  })

  test("a parse that throws quarantines the document by name until its content changes", () => {
    const failures: string[] = []
    const store = new WorkspaceStore(cfg(), { networkText: NETWORK_TEXT_ENABLED }, (uri) => failures.push(uri))
    store.seedDisk([{ uri: A, source: `${SRC}\n${THROWS_IN_PARSE}` }, { uri: B, source: SRC.replace("F", "G") }])
    expect({ failures, quarantined: store.quarantinedUris(), merged: store.workspace().map((d) => d.uri) }).toEqual({
      failures: [A],
      quarantined: [A],
      merged: [B],
    })
    expect(store.upsertDisk(A, `${SRC}\n${THROWS_IN_PARSE}`)).toBe(false) // the same content: still out, not re-reported
    expect(store.upsertDisk(A, SRC)).toBe(true)
    expect([store.quarantined(A), store.workspace().length, failures.length]).toEqual([false, 2, 1])
  })
})

// AN EDIT REACHES ITS APPLICATION'S TABLE INCREMENTALLY (openspec multi-application-tree, design §8): a document is
// rebound into the table of its own application and, a pool document, into every application's — never into another's.
test("store: an edit rebinds into its own application's table, and a pool document into every one", () => {
  const ws = resolve("/ws/src")
  const appA = resolve(ws, "Device/Plc Logic/Application")
  const appB = resolve(ws, "Device_1/Plc Logic/Application")
  const uri = (p: string) => pathToFileURL(p).href
  const store = new WorkspaceStore(cfg(), { networkText: NETWORK_TEXT_ENABLED }, failLoud)
  store.setRefs({ libraryManifests: [], devices: [], applications: [appA, appB] }, undefined)
  const gvlA = uri(resolve(appA, "GVL.gvl"))
  const pool = uri(resolve(ws, "FB_Pool.pou"))
  store.seedDisk([
    { uri: gvlA, source: "VAR_GLOBAL\n\tg_a : INT;\nEND_VAR\n" },
    { uri: uri(resolve(appB, "GVL.gvl")), source: "VAR_GLOBAL\n\tg_b : INT;\nEND_VAR\n" },
  ])
  const inA = uri(resolve(appA, "X.pou"))
  const inB = uri(resolve(appB, "X.pou"))
  const has = (at: string, name: string) => store.project(at).symbols.has(name)
  expect([has(inA, "g_a"), has(inA, "g_b"), has(inB, "g_b"), has(inB, "g_a")]).toEqual([true, false, true, false])

  store.upsertDisk(gvlA, "VAR_GLOBAL\n\tg_a : INT;\n\tg_a2 : INT;\nEND_VAR\n")
  store.upsertDisk(pool, "FUNCTION_BLOCK FB_Pool\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\n")
  expect([has(inA, "g_a2"), has(inB, "g_a2"), has(inA, "fb_pool"), has(inB, "fb_pool")]).toEqual([true, false, true, true])
  expect(store.workspace(inB).map((d) => d.uri).sort()).toEqual([pool, uri(resolve(appB, "GVL.gvl"))].sort())
})

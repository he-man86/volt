/**
 * Incremental-rebind scope integrity — the `scopeForUnit` span-index must be invalidated on every
 * `bindFile`/`unbindFile`, else a rebound file's fresh spans miss the cached index and `scopeForUnit`
 * name-walks into a SAME-NAMED sibling POU's member scope (cross-unit contamination).
 *
 * Live-found (awa-palletizer): dozens of hardware-unit FBs each `EXTENDS` a common base with identical
 * method names (`Cyclic`, `Reset`, …). On `didOpen` the opened FB's methods resolved against another unit's
 * scope, so every own member reported C0046 "not defined" + `.member` accesses cited the wrong unit's type.
 */
import { test, expect } from "bun:test"
import { parseSource, type FunctionBlock } from "../syntax/index.js"
import { childScopesByName, findScopeByName, lookup, scopeForUnit, type Scope } from "./index.js"
import { bindFile, buildSymbolTable, relink, unbindFile } from "./incremental.js"
import { spanIndex } from "./cache.js"
import type { LibraryManifest } from "../library/index.js"

// Two sibling FBs, each with a method named `Cyclic` touching its OWN member. Same shape, different members.
const A = `FUNCTION_BLOCK UnitA\nVAR aOwn : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Cyclic\naOwn := 1;\nEND_METHOD`
const B = `FUNCTION_BLOCK UnitB\nVAR bOwn : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Cyclic\nbOwn := 1;\nEND_METHOD`

/** The `Cyclic` method unit of a parsed file (the top-level unit after the FB). */
const cyclicUnit = (pr: ReturnType<typeof parseSource>) => pr.units.find((u) => u.kind === "method")!

test("a rebound file's method still resolves to its OWN FB, not a same-named sibling's", () => {
  const prB = parseSource(B, { networkText: true })
  const project = buildSymbolTable([
    { uri: "A.pou", parseResult: parseSource(A, { networkText: true }), source: A },
    { uri: "B.pou", parseResult: prB, source: B },
  ])

  // Prime the span index (what any diagnostic pass does before the first edit).
  expect(scopeForUnit(project, cyclicUnit(prB))!.parent!.name).toBe("UnitB")

  // Simulate didOpen on B as the server does it: unbind its disk contribution, bind a freshly-parsed buffer (new span
  // objects), relink (canonicalize + linkExtends). B is rebound because canonical order puts A.pou FIRST: a stale-index
  // name-walk for the fresh `Cyclic` would grab UnitA's.
  const prB2 = parseSource(B, { networkText: true })
  unbindFile(project, "B.pou")
  bindFile(project, { uri: "B.pou", parseResult: prB2, source: B })
  relink(project)

  const scope = scopeForUnit(project, cyclicUnit(prB2))
  expect(scope!.parent!.name).toBe("UnitB") // NOT "UnitA" — the bug bound it to the sibling
})

test("sanity: the two FBs really do share the method name (so the guard is load-bearing)", () => {
  expect((parseSource(A, { networkText: true }).units[0] as FunctionBlock).name.text).toBe("UnitA")
  expect(cyclicUnit(parseSource(A, { networkText: true })).kind).toBe("method")
  expect(cyclicUnit(parseSource(B, { networkText: true })).kind).toBe("method")
})

// A rebind costs the FILE (openspec frontend-conformance 2.P.2): the canonical order is restored by inserting what was
// appended, only the keys that gained a symbol are re-sorted, only the scopes whose base name was bound or unbound are
// re-linked, and the span, child and name indices of the project are kept rather than rebuilt. Each of those must leave
// EXACTLY what a fresh build of the same files leaves — order included, since every first-match lookup reads the order.
test("a project kept current through random rebinds is the project a fresh build makes, order and indices included", () => {
  const sources = new Map<string, string>()
  for (let i = 0; i < 24; i++) {
    const base = i % 5 === 0 ? "" : ` EXTENDS FB_${(i * 7) % 24}` // forward and backward bases, and a cycle or two
    const dup = i % 6 === 0 ? `\nFUNCTION_BLOCK Dup\nEND_FUNCTION_BLOCK` : "" // one name in several files
    sources.set(`file:///p/f${String(i).padStart(2, "0")}.pou`, `FUNCTION_BLOCK FB_${i}${base}\nVAR v${i} : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Run\nEND_METHOD${dup}`)
  }
  sources.set("file:///p/g.gvl", "VAR_GLOBAL\nv1 : INT;\nEND_VAR")
  sources.set("file:///p/a.dut", "TYPE Run : INT; END_TYPE")
  const parse = (uri: string) => ({ uri, source: sources.get(uri)!, parseResult: parseSource(sources.get(uri)!, { networkText: true }) })
  const uris = [...sources.keys()]
  const id = (s: Scope | undefined) => (s === undefined ? "-" : `${s.kind}|${s.name}|${s.defUri ?? ""}|${s.span?.start}`)
  const state = (p: Scope) => [
    ...p.children.map((c) => `${id(c)} base=${id(c.baseScope)}`),
    ...[...p.symbols].map(([k, arr]) => `${k}=${arr.map((s) => `${s.kind}|${s.uri}|${s.span.start}`).join(",")}`).sort(),
  ]
  const walk = (s: Scope, name: string): Scope | undefined => {
    for (const c of s.children) {
      if (c.name.toLowerCase() === name) return c
      const inner = walk(c, name)
      if (inner !== undefined) return inner
    }
    return undefined
  }

  const project = buildSymbolTable(uris.map(parse))
  const bound = new Set(uris)
  let seed = 7
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n)
  for (let op = 0; op < 150; op++) {
    // one to three files change between two relinks, as the server's open + change sequence does
    for (let k = 1 + rnd(3); k > 0; k--) {
      const uri = uris[rnd(uris.length)]
      if (bound.has(uri)) unbindFile(project, uri)
      if (!bound.has(uri) || rnd(4) !== 0) {
        bindFile(project, parse(uri))
        bound.add(uri)
      } else bound.delete(uri)
    }
    relink(project)
    const fresh = buildSymbolTable([...bound].map(parse))
    expect(state(project), `op ${op}`).toEqual(state(fresh))
    for (const name of ["fb_0", "fb_7", "run", "dup", "v1", "nothing"]) {
      expect(findScopeByName(project, name)).toBe(walk(project, name))
      expect(childScopesByName(project, name)).toEqual(project.children.filter((c) => c.name.toLowerCase() === name))
    }
    for (const c of project.children) if (c.span !== undefined) expect(spanIndex(project).get(c.span)).toBe(c)
  }
})

// A library NAMESPACE scope aliases its library's top-level scopes as its children (`library-namespaces.ts`); those
// scopes are project children already. Its subtree must not answer a BARE name: a namespace has no file, so it sorts to
// the front, and the alias would win over a project unit of the same name — `IMPLEMENTS I_Foo` checked against the
// library's interface, a false `missing-interface-implementation` (review of 2.P, 2026-10-02).
const MANIFESTS: LibraryManifest[] = [
  { uri: "file:///p/Library%20Manager/LibA.library", folder: "LibA", namespace: "LA", library: "Lib A", dependencies: [], materialization: 2 },
  { uri: "file:///p/Library%20Manager/LibB.library", folder: "LibB", namespace: "LB", library: "Lib B", dependencies: ["Lib A"], materialization: 2 },
]

test("a bare name a project unit and a library unit share finds the project's unit, not the namespace's alias", () => {
  const f = (uri: string, source: string) => ({ uri, source, parseResult: parseSource(source, { networkText: true }) })
  const project = buildSymbolTable(
    [
      f("file:///p/Application/I_Foo.itf", "INTERFACE I_Foo\nMETHOD Mine : BOOL\nEND_METHOD\nEND_INTERFACE"),
      f("file:///p/Library%20Manager/LibA/I_Foo.itf", "INTERFACE I_Foo\nMETHOD Theirs : BOOL\nEND_METHOD\nEND_INTERFACE"),
    ],
    MANIFESTS,
    "codesys",
  )
  expect(project.children.some((c) => c.kind === "namespace" && c.name === "LA")).toBe(true)
  const found = findScopeByName(project, "I_Foo")
  expect(found?.defUri).toBe("file:///p/Application/I_Foo.itf")
  expect([...(found?.symbols.keys() ?? [])]).toEqual(["mine"])
  // and the namespace itself is still found by its own name
  expect(findScopeByName(project, "la")?.kind).toBe("namespace")
})

// The rebind path with library namespaces: the namespace scopes the second relink of a build moves, the kept indices
// with namespace aliases, qualified `EXTENDS LA.X`, and a project unit named like a namespace.
test("with library namespaces, a project kept current through random rebinds is the project a fresh build makes", () => {
  const sources = new Map<string, string>()
  sources.set("file:///p/Library%20Manager/LibA/FB_Base.pou", "FUNCTION_BLOCK FB_Base\nVAR a : INT; END_VAR\nEND_FUNCTION_BLOCK")
  sources.set("file:///p/Library%20Manager/LibB/FB_Base.pou", "FUNCTION_BLOCK FB_Base\nVAR b : INT; END_VAR\nEND_FUNCTION_BLOCK")
  sources.set("file:///p/Library%20Manager/LibB/FB_Mid.pou", "FUNCTION_BLOCK FB_Mid EXTENDS FB_Base\nEND_FUNCTION_BLOCK")
  const projUris: string[] = []
  for (let i = 0; i < 16; i++) {
    const ext = [" EXTENDS FB_Base", " EXTENDS LA.FB_Base", " EXTENDS LB.FB_Mid", ` EXTENDS FB_${(i * 5) % 16}`, ""][i % 5]
    const extra = i % 4 === 0 ? `\nFUNCTION_BLOCK FB_Base\nEND_FUNCTION_BLOCK` : i % 4 === 1 ? `\nFUNCTION_BLOCK LA\nEND_FUNCTION_BLOCK` : ""
    const uri = `file:///p/src/f${String(i).padStart(2, "0")}.pou`
    sources.set(uri, `FUNCTION_BLOCK FB_${i}${ext}\nVAR v : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD M_${i % 3}\nEND_METHOD${extra}`)
    projUris.push(uri)
  }
  const parsed = new Map<string, { uri: string; source: string; parseResult: ReturnType<typeof parseSource> }>()
  const parse = (uri: string, fresh = false) => {
    const hit = parsed.get(uri)
    if (!fresh && hit !== undefined) return hit
    const d = { uri, source: sources.get(uri)!, parseResult: parseSource(sources.get(uri)!, { networkText: true }) }
    parsed.set(uri, d)
    return d
  }
  const id = (s: Scope | undefined) => (s === undefined ? "-" : `${s.kind}|${s.name}|${s.defUri ?? ""}|${s.span?.start}`)
  const tree = (s: Scope, d = 0): string[] =>
    s.children.flatMap((c) => [`${" ".repeat(d)}${id(c)} base=${id(c.baseScope)} syms=${[...c.symbols.keys()].join(",")}`, ...(d < 1 ? tree(c, d + 1) : [])])
  const state = (p: Scope) => [
    ...tree(p),
    ...[...p.symbols].map(([k, arr]) => `${k}=${arr.map((s) => `${s.kind}|${s.uri}|${s.span.start}`).join(",")}`).sort(),
  ]
  // the reference answer: first in pre-order over the project's own units — a namespace answers only its own name
  const walk = (s: Scope, name: string): Scope | undefined => {
    for (const c of s.children) {
      if (c.name.toLowerCase() === name) return c
      const inner = c.kind === "namespace" ? undefined : walk(c, name)
      if (inner !== undefined) return inner
    }
    return undefined
  }

  const libs = [...sources.keys()].filter((u) => u.includes("Library"))
  const bound = new Set([...libs, ...projUris])
  const project = buildSymbolTable([...bound].map((u) => parse(u)), MANIFESTS)
  let seed = 11
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n)
  for (let op = 0; op < 120; op++) {
    const uri = projUris[rnd(projUris.length)]
    if (bound.has(uri)) unbindFile(project, uri)
    if (!bound.has(uri) || rnd(3) !== 0) {
      bindFile(project, parse(uri, true))
      bound.add(uri)
    } else bound.delete(uri)
    relink(project, MANIFESTS)
    const fresh = buildSymbolTable([...bound].map((u) => parse(u)), MANIFESTS)
    expect(state(project), `op ${op}`).toEqual(state(fresh))
    for (const name of ["fb_base", "la", "lb", "fb_mid", "m_0", "fb_3", "a"]) {
      expect(id(findScopeByName(project, name)), `op ${op} ${name}`).toBe(id(walk(project, name)))
      expect(id(findScopeByName(fresh, name)), `op ${op} ${name}`).toBe(id(walk(fresh, name)))
      expect(childScopesByName(project, name).map(id)).toEqual(childScopesByName(fresh, name).map(id))
    }
    for (const u of bound)
      for (const unit of parse(u).parseResult.units) expect(id(scopeForUnit(project, unit))).toBe(id(scopeForUnit(fresh, unit)))
  }
})

// Rule Y19 (frontend-conformance 3.1.4): binding is ORDER-INDEPENDENT — a unit written after its user binds as one written
// before it (`sym_order_independent_use_first` / `_use_last`: both vendors build both and run 3 + 4), and the files a
// project holds give the same answer to every name whatever order they are handed over in — a name two files declare
// included, which canonical order (`canonicalize`) decides by file, never by arrival.
test("binding is order-independent: every unit order within a file and every file order answer every name alike (Y19)", () => {
  const user = "FUNCTION_BLOCK FB_U\nVAR bx : S_T; out : INT; END_VAR\nout := F_X() + bx.v;\nEND_FUNCTION_BLOCK\n"
  const fun = "FUNCTION F_X : INT\nF_X := 3;\nEND_FUNCTION\n"
  const dut = "TYPE S_T :\nSTRUCT\n\tv : INT := 4;\nEND_STRUCT\nEND_TYPE\n"
  const twice = "FUNCTION_BLOCK Twice\nVAR fromFile : INT; END_VAR\nEND_FUNCTION_BLOCK\n"
  const answer = (files: { uri: string; source: string }[]): string[] => {
    const project = buildSymbolTable(files.map((f) => ({ ...f, parseResult: parseSource(f.source, { networkText: true }) })))
    const fb = findScopeByName(project, "FB_U")!
    return [
      ...["bx", "out", "F_X", "S_T", "Twice"].map((n) => {
        const hit = lookup(fb, n)
        return `${n} -> ${hit?.symbol.kind} ${hit?.symbol.uri} in ${hit?.foundIn.name}`
      }),
      `Twice scope -> ${findScopeByName(project, "Twice")?.defUri}`,
      `children -> ${project.children.map((c) => `${c.name}@${c.defUri}`).join(",")}`,
    ]
  }
  const orders = [
    [user, fun, dut],
    [dut, fun, user],
    [fun, user, dut],
  ].map((units) => units.join("\n"))
  const expected = answer([{ uri: "a.pou", source: orders[0] }, { uri: "b.pou", source: twice }, { uri: "c.pou", source: twice }])
  expect(expected.slice(0, 5)).toEqual([
    "bx -> var a.pou in FB_U",
    "out -> var a.pou in FB_U",
    "F_X -> function a.pou in (project)",
    "S_T -> type a.pou in (project)",
    "Twice -> function_block b.pou in (project)",
  ])
  for (const [i, text] of orders.entries())
    for (const files of [
      [{ uri: "a.pou", source: text }, { uri: "b.pou", source: twice }, { uri: "c.pou", source: twice }],
      [{ uri: "c.pou", source: twice }, { uri: "a.pou", source: text }, { uri: "b.pou", source: twice }],
      [{ uri: "b.pou", source: twice }, { uri: "c.pou", source: twice }, { uri: "a.pou", source: text }],
    ]) {
      const got = answer(files)
      // the in-file order moves only the order of a.pou's own scopes among themselves
      expect(got.slice(0, 6)).toEqual(expected.slice(0, 6))
      if (i === 0) expect(got).toEqual(expected)
    }
})

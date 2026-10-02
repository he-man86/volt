/**
 * TWO LIBRARIES EXPORT THE SAME NAME, AND THE RIGHT BASE DEPENDS ON WHO IS ASKING.
 *
 * This is not a constructed edge case. Every corpus project references both `CAA Behaviour Model`
 * (namespace CBM, CAA Technical Workgroup) and `CBML` (Common Behaviour Model, 3S), and both export `ETRIG`,
 * `ETRIGA` and `ETRIGTL` with DIFFERENT declarations — `ETRIGTL` carries an `EXTENDS` in one and none in the
 * other. CODESYS tells them apart by namespace; Volt materializes both into `Library Manager/<folder>/` under
 * their bare names, so an unqualified `EXTENDS ETRIG` inside a library genuinely has two candidates.
 *
 * The manifests settle it: `CAA File` DEPENDS ON `CAA Behaviour Model`, `VisuUtils` DEPENDS ON `CBML`, and
 * the same three characters in those two files mean different base classes. `linkExtends` used to answer with
 * whichever candidate was bound LAST — bind order is file order, which is `readdirSync` order, so the answer
 * was a property of the developer's disk. It read one way on Windows and another in CI.
 *
 * The shapes below are the corpus's, with the bodies cut down to what the question needs.
 */
import { describe, expect, test } from "bun:test"
import { parseSource } from "../syntax/index.js"
import type { LibraryManifest } from "../library/index.js"
import { buildSymbolTable } from "./incremental.js"
import { ancestry, extendsCycle } from "./extends.js"

const LIB = (folder: string) => `file:///w/Library Manager/${folder}`

/** A manifest as `parseLibraryManifest` would produce it. */
const manifest = (folder: string, library: string, namespace: string, dependencies: string[] = []): LibraryManifest => ({
  uri: `${LIB(folder)}/${folder}.library`,
  folder: folder.toLowerCase(),
  namespace,
  library,
  dependencies,
  materialization: 2,
})

const file = (uri: string, source: string) => ({ uri, source, parseResult: parseSource(source, { networkText: true }) })

// Two libraries, each exporting an ETRIG — and they are not the same type.
const CBM_ETRIG = file(
  `${LIB("CAA Behaviour Model")}/ETRIG.pou`,
  "FUNCTION_BLOCK ETRIG\nVAR\n  fromCbm : BOOL;\nEND_VAR\n",
)
const CBML_ETRIG = file(
  `${LIB("CBML")}/ETRIG.pou`,
  "FUNCTION_BLOCK ETRIG\nVAR\n  fromCbml : BOOL;\nEND_VAR\n",
)
// One extender in a library that depends on CAA Behaviour Model…
const CAA_FILE_USER = file(
  `${LIB("CAA File")}/FileUser.pou`,
  "FUNCTION_BLOCK FileUser EXTENDS ETRIG\nVAR\nEND_VAR\n",
)
// …and one in a library that depends on CBML instead.
const VISU_USER = file(
  `${LIB("VisuUtils")}/VisuUser.pou`,
  "FUNCTION_BLOCK VisuUser EXTENDS ETRIG\nVAR\nEND_VAR\n",
)

const MANIFESTS = [
  manifest("CAA Behaviour Model", "CAA Behaviour Model", "CBM"),
  manifest("CBML", "CBML", "CBML"),
  manifest("CAA File", "CAA File", "FILE", ["CAA Types", "CAA Behaviour Model"]),
  manifest("VisuUtils", "VisuUtils", "VU", ["CmpVisuHandler", "CBML"]),
]

const ALL = [CBM_ETRIG, CBML_ETRIG, CAA_FILE_USER, VISU_USER]

/** The library folder a scope's base was resolved into. */
const baseFolder = (project: ReturnType<typeof buildSymbolTable>, name: string): string | undefined => {
  const scope = project.children.find((c) => c.name.toLowerCase() === name.toLowerCase())
  const uri = scope?.baseScope?.defUri
  return uri === undefined ? undefined : /Library Manager\/([^/]+)\//.exec(uri)?.[1]
}

describe("EXTENDS with two candidates", () => {
  test("resolves through the asker's OWN dependencies — the same name, two different bases", () => {
    const project = buildSymbolTable(ALL, MANIFESTS)
    expect(baseFolder(project, "FileUser")).toBe("CAA Behaviour Model")
    expect(baseFolder(project, "VisuUser")).toBe("CBML")
  })

  test("the answer does not depend on the order the files were bound", () => {
    // The bug in one line: reverse the walk and the last-write-wins map hands back the other library.
    const forward = buildSymbolTable(ALL, MANIFESTS)
    const reverse = buildSymbolTable([...ALL].reverse(), MANIFESTS)
    for (const name of ["FileUser", "VisuUser"])
      expect(baseFolder(reverse, name)).toBe(baseFolder(forward, name)!)
    expect(baseFolder(reverse, "VisuUser")).toBe("CBML")
  })

  test("a library's OWN export beats a dependency's — rank 0 before rank 1", () => {
    // CBML gains its own ETRIGA *and* depends on a library that has one; its own must win.
    const own = file(`${LIB("CBML")}/ETRIGA.pou`, "FUNCTION_BLOCK ETRIGA\nVAR\nEND_VAR\n")
    const dep = file(`${LIB("CAA Behaviour Model")}/ETRIGA.pou`, "FUNCTION_BLOCK ETRIGA\nVAR\nEND_VAR\n")
    const user = file(`${LIB("CBML")}/CbmlUser.pou`, "FUNCTION_BLOCK CbmlUser EXTENDS ETRIGA\nVAR\nEND_VAR\n")
    const project = buildSymbolTable(
      [own, dep, user],
      [...MANIFESTS.slice(0, 2), manifest("CBML", "CBML", "CBML", ["CAA Behaviour Model"])],
    )
    expect(baseFolder(project, "CbmlUser")).toBe("CBML")
  })

  test("PROJECT source beats a library of the same name", () => {
    const projectOwn = file("file:///w/POUs/ETRIG.pou", "FUNCTION_BLOCK ETRIG\nVAR\nEND_VAR\n")
    const user = file("file:///w/POUs/App.pou", "FUNCTION_BLOCK App EXTENDS ETRIG\nVAR\nEND_VAR\n")
    const project = buildSymbolTable([CBM_ETRIG, CBML_ETRIG, projectOwn, user], MANIFESTS)
    const scope = project.children.find((c) => c.name === "App")
    expect(scope?.baseScope?.defUri).toBe("file:///w/POUs/ETRIG.pou")
  })

  test("with no manifests at all it is still deterministic, just uninformed", () => {
    // Nothing says which library a bare name belongs to, so both candidates share the last rank and the URI
    // breaks the tie. The point is only that reversing the input cannot change the answer.
    const forward = buildSymbolTable([...ALL], [])
    const reverse = buildSymbolTable([...ALL].reverse(), [])
    expect(baseFolder(reverse, "FileUser")).toBe(baseFolder(forward, "FileUser")!)
    expect(baseFolder(reverse, "VisuUser")).toBe(baseFolder(forward, "VisuUser")!)
  })
})

// A QUALIFIED BASE — `EXTENDS Standard.TON` (conformance `unit_fb_extends_qualified`, CODESYS builds it and the derived FB
// reads the base's `PT`, 2026-10-01): the name before the dot is a library's NAMESPACE, the one after it a unit of it.
test("a qualified EXTENDS names a unit of a library namespace", () => {
  const ton = file(`${LIB("Standard")}/TON.pou`, "FUNCTION_BLOCK TON\nVAR_INPUT\n  PT : TIME;\nEND_VAR\nEND_FUNCTION_BLOCK\n")
  const derived = file("file:///w/FB_D.pou", "FUNCTION_BLOCK FB_D EXTENDS Standard.TON\nEND_FUNCTION_BLOCK\n")
  const unknown = file("file:///w/FB_U.pou", "FUNCTION_BLOCK FB_U EXTENDS NoSuchLib.TON\nEND_FUNCTION_BLOCK\n")
  const project = buildSymbolTable([ton, derived, unknown], [manifest("Standard", "Standard", "Standard")])
  const child = (name: string) => project.children.find((c) => c.name === name)!
  expect(child("FB_D").baseScope?.defUri).toBe(ton.uri)
  expect(child("FB_U").baseScope).toBeUndefined()
})

// A REFUSED FB IS NO BASE — `FUNCTION_BLOCK FINAL PUBLIC FB_A` declares no FB on either vendor (`headerRefused`), so an
// `EXTENDS FB_A` has nothing to link to: the scope the binder keeps for FB_A's own body is no candidate for anyone.
test("an FB whose header is refused is no candidate base", () => {
  const refused = file("file:///w/FB_A.pou", "FUNCTION_BLOCK FINAL PUBLIC FB_A\nVAR\n  n : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n")
  const derived = file("file:///w/FB_D.pou", "FUNCTION_BLOCK FB_D EXTENDS FB_A\nEND_FUNCTION_BLOCK\n")
  const project = buildSymbolTable([refused, derived], [])
  expect(project.children.find((c) => c.name === "FB_D")!.baseScope).toBeUndefined()
})

// ── rule H9: cycles, of every kind that extends, and the self-cycle `linkExtends` never links ─────────────────────
describe("extendsCycle", () => {
  const top = (src: string, name: string) => {
    const project = buildSymbolTable([{ uri: "F.pou", source: src, parseResult: parseSource(src, { networkText: true }) }])
    return project.children.find((c) => c.name === name)!
  }
  test("FBs, interfaces and STRUCTs each close one, from any member of it", () => {
    const fb = top(`FUNCTION_BLOCK A EXTENDS B\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK B EXTENDS A\nEND_FUNCTION_BLOCK`, "B")
    expect(extendsCycle(fb)?.map((s) => s.name)).toEqual(["B", "A", "B"])
    const itf = top(`INTERFACE I_A EXTENDS I_X, I_B\nEND_INTERFACE\nINTERFACE I_B EXTENDS I_A\nEND_INTERFACE`, "I_A")
    expect(extendsCycle(itf)?.map((s) => s.name)).toEqual(["I_A", "I_B", "I_A"])
    const st = top(`TYPE S_A EXTENDS S_B :\nSTRUCT\n a : INT;\nEND_STRUCT\nEND_TYPE\nTYPE S_B EXTENDS S_A :\nSTRUCT\n b : INT;\nEND_STRUCT\nEND_TYPE`, "S_A")
    expect(extendsCycle(st)?.map((s) => s.name)).toEqual(["S_A", "S_B", "S_A"])
  })
  test("an FB naming itself is a cycle; a chain that ends, or only leads into a cycle, is not", () => {
    expect(extendsCycle(top(`FUNCTION_BLOCK A EXTENDS A\nEND_FUNCTION_BLOCK`, "A"))?.map((s) => s.name)).toEqual(["A", "A"])
    const src = `FUNCTION_BLOCK C EXTENDS A\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK A EXTENDS B\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK B EXTENDS A\nEND_FUNCTION_BLOCK`
    expect(extendsCycle(top(src, "C"))).toBeUndefined()
    expect(extendsCycle(top(`FUNCTION_BLOCK A\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK D EXTENDS A\nEND_FUNCTION_BLOCK`, "D"))).toBeUndefined()
  })
  test("ancestry walks an interface's whole list, nearest first, each once", () => {
    const d = top(`INTERFACE I_R\nEND_INTERFACE\nINTERFACE I_A EXTENDS I_R\nEND_INTERFACE\nINTERFACE I_B EXTENDS I_R\nEND_INTERFACE\nINTERFACE I_D EXTENDS I_A, I_B\nEND_INTERFACE`, "I_D")
    expect(ancestry(d).map((s) => s.name)).toEqual(["I_D", "I_A", "I_R", "I_B"])
  })
})

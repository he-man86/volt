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
import { buildSymbolTable } from "./index.js"
import type { LibraryManifest } from "./library-namespace.js"

const LIB = (folder: string) => `file:///w/Library Manager/${folder}`

/** A manifest as `parseLibraryManifest` would produce it. */
const manifest = (folder: string, library: string, namespace: string, dependencies: string[] = []): LibraryManifest => ({
  uri: `${LIB(folder)}/${folder}.library`,
  folder: folder.toLowerCase(),
  namespace,
  library,
  dependencies,
})

const file = (uri: string, source: string) => ({ uri, source, parseResult: parseSource(source) })

// Two libraries, each exporting an ETRIG — and they are not the same type.
const CBM_ETRIG = file(
  `${LIB("CAA Behaviour Model")}/ETRIG.fb`,
  "FUNCTION_BLOCK ETRIG\nVAR\n  fromCbm : BOOL;\nEND_VAR\n",
)
const CBML_ETRIG = file(
  `${LIB("CBML")}/ETRIG.fb`,
  "FUNCTION_BLOCK ETRIG\nVAR\n  fromCbml : BOOL;\nEND_VAR\n",
)
// One extender in a library that depends on CAA Behaviour Model…
const CAA_FILE_USER = file(
  `${LIB("CAA File")}/FileUser.fb`,
  "FUNCTION_BLOCK FileUser EXTENDS ETRIG\nVAR\nEND_VAR\n",
)
// …and one in a library that depends on CBML instead.
const VISU_USER = file(
  `${LIB("VisuUtils")}/VisuUser.fb`,
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
    const own = file(`${LIB("CBML")}/ETRIGA.fb`, "FUNCTION_BLOCK ETRIGA\nVAR\nEND_VAR\n")
    const dep = file(`${LIB("CAA Behaviour Model")}/ETRIGA.fb`, "FUNCTION_BLOCK ETRIGA\nVAR\nEND_VAR\n")
    const user = file(`${LIB("CBML")}/CbmlUser.fb`, "FUNCTION_BLOCK CbmlUser EXTENDS ETRIGA\nVAR\nEND_VAR\n")
    const project = buildSymbolTable(
      [own, dep, user],
      [...MANIFESTS.slice(0, 2), manifest("CBML", "CBML", "CBML", ["CAA Behaviour Model"])],
    )
    expect(baseFolder(project, "CbmlUser")).toBe("CBML")
  })

  test("PROJECT source beats a library of the same name", () => {
    const projectOwn = file("file:///w/POUs/ETRIG.fb", "FUNCTION_BLOCK ETRIG\nVAR\nEND_VAR\n")
    const user = file("file:///w/POUs/App.fb", "FUNCTION_BLOCK App EXTENDS ETRIG\nVAR\nEND_VAR\n")
    const project = buildSymbolTable([CBM_ETRIG, CBML_ETRIG, projectOwn, user], MANIFESTS)
    const scope = project.children.find((c) => c.name === "App")
    expect(scope?.baseScope?.defUri).toBe("file:///w/POUs/ETRIG.fb")
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

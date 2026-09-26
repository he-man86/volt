/**
 * THE SAME TYPE NAME, WRITTEN IN TWO FILES, MEANS TWO DIFFERENT TYPES.
 *
 * `EXTENDS` is not the only lookup that can face several candidates for one name — every `v : ETRIG;` does
 * too. Both `CAA Behaviour Model` (namespace CBM) and `CBML` export an `ETRIG`, real projects reference both,
 * and the declarations differ. Which one a declaration means depends on the library the declaration is IN, by
 * way of that library's own `DEPENDENCIES` line.
 *
 * Before this, `resolveNamedType` took `lookupLocal(project, name)[0]` with no idea who was asking, so every
 * file in the project got the same answer — whichever candidate happened to be bound first.
 */
import { describe, expect, test } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { buildSymbolTable } from "../symbols/index.js"
import type { LibraryManifest } from "../symbols/library-namespace.js"
import { resolveNamedType } from "./resolve.js"

const LIB = (folder: string) => `file:///w/Library Manager/${folder}`

const manifest = (
  folder: string,
  library: string,
  namespace: string,
  dependencies: string[] = [],
): LibraryManifest => ({
  uri: `${LIB(folder)}/${folder}.library`,
  folder: folder.toLowerCase(),
  namespace,
  library,
  dependencies,
  materialization: 2,
})

const file = (uri: string, source: string) => ({ uri, source, parseResult: parseSource(source) })

// The two ETRIGs are not the same function block: only one has `fromCbm`.
const FILES = [
  file(`${LIB("CAA Behaviour Model")}/ETRIG.fb`, "FUNCTION_BLOCK ETRIG\nVAR\n  fromCbm : BOOL;\nEND_VAR\n"),
  file(`${LIB("CBML")}/ETRIG.fb`, "FUNCTION_BLOCK ETRIG\nVAR\n  fromCbml : BOOL;\nEND_VAR\n"),
]

const MANIFESTS = [
  manifest("CAA Behaviour Model", "CAA Behaviour Model", "CBM"),
  manifest("CBML", "CBML", "CBML"),
  manifest("CAA File", "CAA File", "FILE", ["CAA Behaviour Model"]),
  manifest("VisuUtils", "VisuUtils", "VU", ["CBML"]),
]

/** The member set the name resolves to, from the point of view of `askerUri`. */
const membersSeenFrom = (project: ReturnType<typeof buildSymbolTable>, askerUri: string): string[] => {
  const t = resolveNamedType("ETRIG", project, 0, askerUri)
  const scope = t.kind === "function_block" ? t.scope : undefined
  return [...(scope?.symbols.keys() ?? [])].sort()
}

describe("a type name with two candidates", () => {
  test("resolves through the asking file's own library dependencies", () => {
    const project = buildSymbolTable(FILES, MANIFESTS)
    expect(membersSeenFrom(project, `${LIB("CAA File")}/Reader.fb`)).toEqual(["fromcbm"])
    expect(membersSeenFrom(project, `${LIB("VisuUtils")}/Widget.fb`)).toEqual(["fromcbml"])
  })

  test("a file resolves its OWN library's export before a dependency's", () => {
    const project = buildSymbolTable(FILES, [
      ...MANIFESTS.slice(0, 2),
      manifest("CBML", "CBML", "CBML", ["CAA Behaviour Model"]),
    ])
    expect(membersSeenFrom(project, `${LIB("CBML")}/Widget.fb`)).toEqual(["fromcbml"])
  })

  test("project source prefers a project type over any library's", () => {
    const own = file("file:///w/POUs/ETRIG.fb", "FUNCTION_BLOCK ETRIG\nVAR\n  fromProject : BOOL;\nEND_VAR\n")
    const project = buildSymbolTable([...FILES, own], MANIFESTS)
    expect(membersSeenFrom(project, "file:///w/POUs/App.fb")).toEqual(["fromproject"])
  })

  test("the answer does not depend on the order the files were bound", () => {
    const forward = buildSymbolTable(FILES, MANIFESTS)
    const reverse = buildSymbolTable([...FILES].reverse(), MANIFESTS)
    for (const asker of [`${LIB("CAA File")}/Reader.fb`, `${LIB("VisuUtils")}/Widget.fb`])
      expect(membersSeenFrom(reverse, asker)).toEqual(membersSeenFrom(forward, asker))
    expect(membersSeenFrom(reverse, `${LIB("VisuUtils")}/Widget.fb`)).toEqual(["fromcbml"])
  })

  test("with no asker it is still stable — the same answer every time, just uninformed", () => {
    const forward = buildSymbolTable(FILES, MANIFESTS)
    const reverse = buildSymbolTable([...FILES].reverse(), MANIFESTS)
    const anon = (p: ReturnType<typeof buildSymbolTable>) => {
      const t = resolveNamedType("ETRIG", p)
      return [...((t.kind === "function_block" ? t.scope : undefined)?.symbols.keys() ?? [])]
    }
    expect(anon(reverse)).toEqual(anon(forward))
  })
})

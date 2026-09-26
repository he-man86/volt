/**
 * THE LIBRARY REPO'S ONE INVARIANT, for every library and every version it holds: each file is the declaration the
 * bridge materialized for that library at that version, with a body written in.
 *
 * The declaration is the library's INTERFACE and it is the vendor's, so the repo may add a body and nothing that
 * changes a call — only a private VAR block, and only on a function the materialization shows none for (functions
 * need loop counters; a block's private variables are materialized, and kept as they are).
 *
 * The materialization to compare against is found by the manifest's RESOLUTION, in any corpus project that
 * references that version — so a version the repo writes must be one some real project resolves. That is the point:
 * an interface written from memory, for a version no project shows, is exactly what this refuses.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { implementationDir, writtenVersions } from "../../libraries/index.js"
import { libraryResolution } from "../../src/symbols/index.js"
import { walkSources } from "../corpus/support/project.js"

const CORPUS = join(import.meta.dir, "..", "..", "test-corpus")

/** `<library>@<version>` → a folder the bridge materialized that version into, from every manifest in the corpus. */
const materialized = new Map<string, string>()
for (const manifest of walkSources(CORPUS, new Set([".library"]))) {
  const resolved = libraryResolution(readFileSync(manifest, "utf8"))
  if (resolved !== undefined) materialized.set(`${resolved.library}@${resolved.version}`, dirname(manifest))
}

// every version the repo answers for — its own folders, and those aliased onto one (`SAME_BODIES`): an alias is held to
// ITS version's materialization, which is what keeps it honest
const written = writtenVersions()

/** A file as compared: line endings as the checkout left them are not the interface. */
const read = (path: string): string => readFileSync(path, "utf8").replaceAll("\r\n", "\n")

/** Everything but the body: the lines up to the last END_VAR, and the closing END_*. */
const withoutBody = (s: string): string => {
  const lines = s.split("\n")
  return [...lines.slice(0, lines.lastIndexOf("END_VAR") + 1), lines.at(-1)].join("\n")
}

describe("the library repo", () => {
  test("holds at least Standard and Util", () => {
    expect(written.map((w) => w.library)).toEqual(expect.arrayContaining(["Standard", "Util"]))
  })

  for (const { library, version } of written)
    test(`${library} ${version}: every body sits behind the declaration CODESYS materialized`, () => {
      const source = materialized.get(`${library}@${version}`)
      expect(source, `no corpus project resolves ${library}, ${version} — nothing to hold its interface to`).toBeDefined()
      const dir = implementationDir(library, version)!
      for (const f of readdirSync(dir)) {
        const declared = read(join(source!, f))
        let body = withoutBody(read(join(dir, f)))
        if (!/\nVAR\n/.test(declared)) body = body.replace(/\nVAR\n[^]*?\nEND_VAR(?=\n)/, "")
        expect(`${f}\n${body}`).toBe(`${f}\n${declared}`)
      }
    })
})

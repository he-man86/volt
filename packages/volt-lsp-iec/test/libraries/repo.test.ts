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
import { implementationDir } from "../../libraries/index.js"
import { walkSources } from "../corpus/support/project.js"

const REPO = join(import.meta.dir, "..", "..", "libraries")
const CORPUS = join(import.meta.dir, "..", "..", "test-corpus")

/** `<library>@<version>` → a folder the bridge materialized that version into, from every manifest in the corpus. */
const materialized = new Map<string, string>()
for (const manifest of walkSources(CORPUS, new Set([".library"]))) {
  const m = /^RESOLUTION[ \t]+(.+?),[ \t]*(\S+)/m.exec(readFileSync(manifest, "utf8"))
  if (m !== null) materialized.set(`${m[1]!.trim()}@${m[2]}`, dirname(manifest))
}

const written = readdirSync(REPO, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((lib) => readdirSync(join(REPO, lib.name)).map((version) => ({ library: lib.name, version })))

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
        const declared = readFileSync(join(source!, f), "utf8")
        let body = withoutBody(readFileSync(join(dir, f), "utf8"))
        if (!/\nVAR\n/.test(declared)) body = body.replace(/\nVAR\n[^]*?\nEND_VAR(?=\n)/, "")
        expect(`${f}\n${body}`).toBe(`${f}\n${declared}`)
      }
    })
})

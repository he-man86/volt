/**
 * THE CORPUS, ITS PROVENANCE — is every corpus file the current bridge's answer, and where one is not, is that recorded
 * with its reason? (gate review of bridge-one-to-one step 4b, finding 3). A re-pull that is partly reverted — a move the
 * pulling IDE made, an object authored after the build oracle was recorded — leaves files in an older spelling, or leaves
 * an object out, and nothing said which. `support/stale.ts` says it; this holds the corpus to that list both ways: a file
 * in the retired spelling that the list does not name fails, and so does a listed one a refresh has rewritten.
 *
 * Not an LSP question — the LSP reads none of the lines that differ (`support/stale.ts`) — but the corpus is this
 * package's, and the three corpus suites read it as the bridge's answer.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { CORPUS, hasCorpus, projectDirs } from "./support/walk.js"
import { MISSING_OBJECTS, STALE_MANIFESTS } from "./support/stale.js"

/** Every `.library` manifest under `dir`, relative to it, `/`-separated. */
function manifests(dir: string, root = dir): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...manifests(p, root))
    else if (e.endsWith(".library")) out.push(relative(root, p).split("\\").join("/"))
  }
  return out
}

/** The retired spelling: `LibraryManifest.Write` writes `SYSTEM` only where it is true. */
const RETIRED = /^SYSTEM false\r?$/m

describe.skipIf(!hasCorpus)("the corpus is the bridge's answer, or says where it is not", () => {
  test("every manifest in the retired spelling is listed, with its reason — and every listed one still is", () => {
    for (const project of projectDirs()) {
      const found = manifests(join(CORPUS, project))
        .filter((m) => RETIRED.test(readFileSync(join(CORPUS, project, m), "utf8")))
        .sort()
      expect({ project, stale: found }).toEqual({ project, stale: [...(STALE_MANIFESTS[project]?.files ?? [])].sort() })
    }
    for (const project of Object.keys(STALE_MANIFESTS)) expect(projectDirs()).toContain(project)
  })

  test("every object a corpus is recorded as missing is still missing", () => {
    for (const [project, { files }] of Object.entries(MISSING_OBJECTS))
      for (const f of files) expect({ project, f, present: existsSync(join(CORPUS, project, f)) }).toEqual({ project, f, present: false })
  })

  test("every recorded group says why", () => {
    for (const g of [...Object.values(STALE_MANIFESTS), ...Object.values(MISSING_OBJECTS)]) {
      expect(g.why.length).toBeGreaterThan(40)
      expect(g.files.length).toBeGreaterThan(0)
    }
  })
})

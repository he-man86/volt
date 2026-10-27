/**
 * THE EXEC TWINS OF THE CORPORA'S NETWORK BODIES (openspec network-text-st 2.4, design.md oracle 3): every LD/FBD body of
 * the six corpora, as the plain-ST network text a pull writes, has an exec twin — the CODESYS ST that runs as the network
 * (`test/support/network-twin.ts`) — and the twin compiles:
 *
 *   1. offline, by the LSP: the project with every body twinned draws no error or warning the project's own recorded build
 *      does not hold (the corpus gate's rule, `corpus-diagnostics.test.ts`);
 *   2. live, by the IDE: `network-twins.<vendor>.json` (`scripts/record-network-twins.ts`) is the build of the project with
 *      every body replaced by its twin, in place; it is of THESE twins (their hash), and holds no error the project's own
 *      recorded build does not.
 *
 * A body the twin cannot write is refused by name, and none of the corpora's is.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { documentDiagnostics } from "../../src/server/document-diagnostics.js"
import { twinProject } from "../support/network-twin-project.js"
import { corpusVendor } from "./support/project.js"
import { CORPUS, hasCorpus, norm, projectDirs } from "./support/walk.js"

const TIMEOUT = 300_000

/** The project's own recorded build, as the set of its normalized messages. */
const recordedBuild = (dir: string, vendor: string): Set<string> =>
  new Set((JSON.parse(readFileSync(join(dir, `expected-build.${vendor}.json`), "utf8")).diagnostics as { message: string }[]).map((d) => norm(d.message)))

describe.skipIf(!hasCorpus)("the corpora's network bodies run as their exec twins", () => {
  for (const project of projectDirs()) {
    const dir = join(CORPUS, project)
    const vendor = corpusVendor(dir)
    test(`${project}: every network body twins, and the LSP finds nothing in the twins the build did not`, () => {
      const twins = twinProject(dir, vendor)
      expect(twins.refused).toEqual([])
      const build = recordedBuild(dir, vendor)
      const twinned = new Set(twins.files.map((f) => f.uri))
      const extra: string[] = []
      for (const d of twins.twinStore.workspace())
        if (twinned.has(d.uri))
          for (const x of documentDiagnostics(twins.twinStore, d))
            if ((x.severity === 1 || x.severity === 2) && !build.has(norm(x.message))) extra.push(`${d.uri}:${x.range.start.line + 1} ${x.message}`)
      expect(extra).toEqual([])
    }, TIMEOUT)

    const recording = join(dir, `network-twins.${vendor}.json`)
    test.skipIf(!existsSync(recording))(`${project}: the IDE builds the twins with no error its own build lacks`, () => {
      const rec = JSON.parse(readFileSync(recording, "utf8"))
      const twins = twinProject(dir, vendor)
      expect(rec.recorded.twins).toBe(twins.hash) // a recording of these twins, not of older ones
      expect(rec.recorded.buildSuccess).toBe(true)
      const build = recordedBuild(dir, vendor)
      expect((rec.diagnostics as { severity: string; message: string }[]).filter((d) => d.severity === "error" && !build.has(norm(d.message))).map((d) => d.message)).toEqual([])
    }, TIMEOUT)
  }
})

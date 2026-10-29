/**
 * A CORPUS PROJECT WITH EVERY PLAIN-ST NETWORK BODY AS ITS EXEC TWIN (openspec network-text-st 2.4; `network-twin.ts`):
 * the project read as the server reads it (a `WorkspaceStore` seeded from its files), each file holding a network body
 * twinned. What the live recorder pushes into a copy of the project and builds (`scripts/record-network-twins.ts`), and
 * what the offline gate holds the LSP to (`test/corpus/corpus-twins.test.ts`).
 */
import { createHash } from "node:crypto"
import { relative } from "node:path"
import { resolveConfig, type Vendor } from "../../src/analysis/index.js"
import { WorkspaceStore } from "../../src/workspace/workspace-store.js"
import { scanWorkspace } from "../../src/workspace/workspace-refs.js"
import { twinFile } from "./network-twin-file.js"

export interface ProjectTwins {
  /** Each twinned file's wire path (its path in the project, `/`-separated) and its twin source. */
  files: { wire: string; uri: string; source: string }[]
  /** The bodies twinned, and the ones the twin could not write (named). */
  bodies: number
  refused: string[]
  /** One hash of every twin source, in wire order: a recording of the twins' build is of THESE twins. */
  hash: string
  /** A store seeded with the project as twinned — what the LSP says of the twins. */
  twinStore: WorkspaceStore
}

function store(dir: string, vendor: Vendor, sources: readonly { uri: string; source: string }[]): WorkspaceStore {
  const scan = scanWorkspace(dir)
  const s = new WorkspaceStore(resolveConfig({ vendor, diagnoseDeadCode: false }), { networkText: true }, (uri, e) => {
    throw new Error(`${uri}: ${String(e)}`)
  })
  s.configs.configure({ vendor, diagnoseDeadCode: false }, scan.projectSettings)
  s.setRefs(scan.refs, scan.taskRoots)
  s.seedDisk(sources)
  return s
}

export function twinProject(dir: string, vendor: Vendor): ProjectTwins {
  const sources = scanWorkspace(dir).sources.map((s) => ({ uri: s.path, source: s.source }))
  const original = store(dir, vendor, sources)
  const files: ProjectTwins["files"] = []
  const refused: string[] = []
  let bodies = 0
  for (const d of original.workspace()) {
    if (!/^%LANGUAGE (LD|FBD)\s*$/m.test(d.source)) continue
    const t = twinFile(d.source, d.parseResult, original.project(d.uri))
    bodies += t.twinned
    const wire = relative(dir, d.uri).split("\\").join("/")
    for (const r of t.refused) refused.push(`${wire}: ${r}`)
    if (t.twinned > 0) files.push({ wire, uri: d.uri, source: t.source })
  }
  files.sort((a, b) => (a.wire < b.wire ? -1 : a.wire > b.wire ? 1 : 0))
  // Line ends normalized: a checkout's line ends are git's (`core.autocrlf` gives CRLF on Windows, LF on CI), not the
  // twins', so the same twins hash the same on every machine.
  const hash = createHash("sha256")
    .update(files.map((f) => `${f.wire}\n${f.source.replace(/\r\n?/g, "\n")}`).join("\u0000"))
    .digest("hex")
    .slice(0, 16)
  const twins = new Map(files.map((f) => [f.uri, f.source]))
  const twinStore = store(dir, vendor, sources.map((s) => ({ uri: s.uri, source: twins.get(s.uri) ?? s.source })))
  return { files, bodies, refused, hash, twinStore }
}

/**
 * Latency bench for the per-edit hot path (Phase B). Measures what a keystroke actually costs: after a
 * single-character edit, the time to answer `textDocument/diagnostic` and `textDocument/definition` on the
 * largest available corpus project. Prints p50/p95.
 *
 * Opt-in (`LSP_BENCH=1`) — heavy and machine-dependent, so it stays out of the default `bun test`. The
 * budget assertion is deliberately generous; a request over it is a regression to root-cause (PROFILE_CHECKS
 * style), NOT a threshold to raise (see `timeout-is-a-bug-not-a-budget`).
 *
 * This measures the store→compute path the server runs (WorkspaceStore + documentDiagnostics + definition),
 * without the jsonrpc pipe — that's where the O(project)-per-edit cost lives and where the incremental-index
 * fix lands.
 */
import { test, expect } from "bun:test"
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { extname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { WorkspaceStore } from "../../src/server/workspace-store.js"
import { documentDiagnostics } from "../../src/server/diagnostics.js"
import { messagesFor, resolveConfig } from "../../src/analysis/index.js"
import { definition, offsetFromPosition } from "../../src/services/index.js"
import { loadWorkspaceRefs, loadTaskRoots } from "../../src/workspace-refs.js"
import { SOURCE_EXTENSION_SET } from "../../src/source-extensions.js"

const CORPUS_ROOT = join(import.meta.dir, "..", "..", "test-corpus")
const ITERATIONS = 40
// p95 ceiling for one edit→diagnostics. The incremental index + per-file dead-code cache put this at ~5ms
// on 433 files; a regression to the old whole-project-rebuild-per-edit path was ~28ms here and scales with
// project size (60-100ms+ on the full corpus). 60ms catches that with generous headroom for slow CI runners
// — it flags an ALGORITHMIC regression, not micro-noise. Over budget ⇒ root-cause (a timeout is a bug).
const BUDGET_MS = 60

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (SOURCE_EXTENSION_SET.has(extname(p).toLowerCase())) out.push(p)
  }
  return out
}

/** The corpus project (a direct child of test-corpus/) with the most source files present on disk. */
function largestProject(): { dir: string; files: string[] } | undefined {
  if (!existsSync(CORPUS_ROOT)) return undefined
  let best: { dir: string; files: string[] } | undefined
  for (const name of readdirSync(CORPUS_ROOT)) {
    const dir = join(CORPUS_ROOT, name)
    if (!statSync(dir).isDirectory()) continue
    const files = walk(dir)
    if (best === undefined || files.length > best.files.length) best = { dir, files }
  }
  return best
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0
}

test.skipIf(process.env.LSP_BENCH !== "1")(
  "bench: single-char edit → diagnostics + definition stays within budget",
  () => {
    const proj = largestProject()
    if (proj === undefined || proj.files.length < 50) {
      console.log(`[bench] SKIP — no corpus project with ≥50 files (materialized: ${proj?.files.length ?? 0})`)
      return
    }
    const { dir, files } = proj
    console.log(`[bench] project=${dir.split(/[\\/]/).pop()} files=${files.length}`)

    const store = new WorkspaceStore(resolveConfig({ vendor: "codesys" }))
    const messages = messagesFor("codesys")
    store.workspaceRefs = loadWorkspaceRefs(dir)
    store.taskRoots = loadTaskRoots(dir)
    store.seedDisk(files.map((p) => ({ uri: pathToFileURL(p).href, source: readFileSync(p, "utf8") })))

    // Edit target: the largest ST file (most body → most diagnostics work).
    const target = files
      .map((p) => ({ p, src: readFileSync(p, "utf8") }))
      .sort((a, b) => b.src.length - a.src.length)[0]!
    const uri = pathToFileURL(target.p).href
    store.openDocument(uri, "iecst", 1, target.src)

    const diagMs: number[] = []
    const defMs: number[] = []
    for (let i = 0; i < ITERATIONS; i++) {
      // A single-char edit at the very end — appends a space, invalidating the project index.
      const end = store.doc(uri)!.source.length
      store.changeDocument(uri, i + 2, [{ range: rangeAt(store.doc(uri)!.source, end), text: " " }])

      let t = performance.now()
      documentDiagnostics(store, messages, store.doc(uri)!)
      diagMs.push(performance.now() - t)

      t = performance.now()
      const d = store.doc(uri)!
      definition(d, store.project(), Math.floor(d.source.length / 2))
      defMs.push(performance.now() - t)
    }

    const sortedDiag = [...diagMs].sort((a, b) => a - b)
    const sortedDef = [...defMs].sort((a, b) => a - b)
    console.log(`[bench] diagnostics  p50=${pct(sortedDiag, 50).toFixed(1)}ms  p95=${pct(sortedDiag, 95).toFixed(1)}ms`)
    console.log(`[bench] definition   p50=${pct(sortedDef, 50).toFixed(1)}ms  p95=${pct(sortedDef, 95).toFixed(1)}ms`)

    expect(pct(sortedDiag, 95)).toBeLessThan(BUDGET_MS)
  },
  120_000,
)

/** An empty range (insertion point) at absolute offset `off` in `source`. */
function rangeAt(source: string, off: number) {
  let line = 0
  let last = -1
  for (let i = 0; i < off; i++)
    if (source[i] === "\n") {
      line++
      last = i
    }
  const character = off - last - 1
  return { start: { line, character }, end: { line, character } }
}

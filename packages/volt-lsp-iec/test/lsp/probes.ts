/**
 * WHAT THE SERVER DID, SEEN FROM OUTSIDE IT — the two probes the scheduling suites (openspec lsp-server-scheduling,
 * step 1) observe work with, and no product hook:
 *
 * - **the parse probe**: a delegating `mock.module` of the syntax barrel. Every `parseDocument` is counted per URI
 *   ("a save re-parses one file"), and a source carrying {@link THROWS_IN_PARSE} throws — the design's throwing parse
 *   (1.3). Every other call is the real parse.
 * - **the compute probe**: a delegating `mock.module` of the analysis barrel (`analysis/index.js` — the one analysis
 *   file anything outside `src/analysis/` may import, layering rule A2; mocking `analysis/pipeline/diagnostics.ts`
 *   directly was a deep import and failed `test/package/layering.test.ts`). It counts `computeDiagnostics`, the
 *   semantic pass every document's findings go through, as the server calls it through the barrel (today
 *   `server/document-diagnostics.ts`). When 2.4 moves the composition into `analysis/`, the server reaches the pass
 *   through whatever barrel export composes a document, and THIS probe moves to that export: the plain pin "a document
 *   pull computes only that document" counts 1 and fails loud (0) if the probe is left behind. Every call is counted
 *   per URI ("an idle pull computes nothing", "a document pull computes one document"). A parse cannot see this: a recompute binds
 *   from cached parses and parses nothing. A dead POU gives no findings and is never computed, so the suites that count
 *   computes use live units.
 * - **the read probe**: a delegating `mock.module` of `node:fs`. A `readFileSync` of the one path armed with
 *   {@link busyRead} throws `EBUSY`, as a file the CLI or the IDE is still writing does on Windows. Every other read is
 *   the real one.
 *
 * The mocks are process-wide (bun's `mock.module` patches the loaded module in place, the server's own imports
 * included) and installed once, when this module is first imported; in one `bun test` run they stay for every LATER
 * file too (conformance, corpus, frontend). They pass everything through but the sentinels, so no answer changes: the
 * full suite with them loaded has the same pass count as without (lsp-server-scheduling gate 1, in tasks.md 1.3). The
 * cost is one counter update and one `includes` per parse or compute. Rejected: a counter or a throw seam in `WorkspaceStore` (product code
 * that exists for tests).
 */
import { mock } from "bun:test"
import * as fs from "node:fs"
import * as syntax from "../../src/frontend/syntax/index.js"
import * as analysis from "../../src/analysis/index.js"

/** A source containing this comment throws inside `parseDocument`. Nothing real contains it. */
export const THROWS_IN_PARSE = "(* volt-test: this parse throws *)"

const parses = new Map<string, number>()
const realParse = syntax.parseDocument
const realSyntax = { ...syntax }
mock.module("../../src/frontend/syntax/index.js", () => ({
  ...realSyntax,
  parseDocument: (...args: Parameters<typeof realParse>): ReturnType<typeof realParse> => {
    const [uri, source] = args
    parses.set(uri, (parses.get(uri) ?? 0) + 1)
    if (source.includes(THROWS_IN_PARSE)) throw new Error(`test: the parse of ${uri} throws`)
    return realParse(...args)
  },
}))

/** Forget every parse counted so far. */
export function resetParses(): void {
  parses.clear()
}

/** `counts` restricted to the URIs under `rootUri` (a folder boundary: `…/ws/` never matches `…/ws2/…`), or all of
 *  them when no root is given. */
function under(counts: Map<string, number>, rootUri: string | undefined): Map<string, number> {
  if (rootUri === undefined) return new Map(counts)
  const folder = rootUri.toLowerCase().replace(/\/*$/, "/")
  return new Map([...counts].filter(([uri]) => uri.toLowerCase().startsWith(folder)))
}

/** The URIs parsed since the last {@link resetParses}, each with its count; only those under `rootUri` when given
 *  (the harness's barrier and other suites' documents are not the question). */
export function parsed(rootUri?: string): Map<string, number> {
  return under(parses, rootUri)
}

const computes = new Map<string, number>()
const realCompute = analysis.computeDiagnostics
const realAnalysis = { ...analysis }
mock.module("../../src/analysis/index.js", () => ({
  ...realAnalysis,
  computeDiagnostics: (...args: Parameters<typeof realCompute>): ReturnType<typeof realCompute> => {
    const [{ uri }] = args
    computes.set(uri, (computes.get(uri) ?? 0) + 1)
    return realCompute(...args)
  },
}))

/** Forget every compute counted so far. */
export function resetComputes(): void {
  computes.clear()
}

/** The URIs whose findings were computed since the last {@link resetComputes}, each with its count; only those under
 *  `rootUri` when given. */
export function computed(rootUri?: string): Map<string, number> {
  return under(computes, rootUri)
}

let busy: string | undefined
const realRead = fs.readFileSync
const realFs = { ...fs }
const read = ((...args: Parameters<typeof realRead>) => {
  const [file] = args
  if (busy !== undefined && typeof file === "string" && file.toLowerCase() === busy) {
    const e = new Error(`EBUSY: resource busy or locked, open '${file}'`) as NodeJS.ErrnoException
    e.code = "EBUSY"
    e.errno = -4082
    e.syscall = "open"
    e.path = file
    throw e
  }
  return realRead(...args)
}) as typeof realRead
mock.module("node:fs", () => ({ ...realFs, readFileSync: read, default: { ...realFs, readFileSync: read } }))

/** Every `readFileSync` of `path` throws EBUSY until {@link busyRead} is called with undefined. */
export function busyRead(path: string | undefined): void {
  busy = path?.toLowerCase()
}

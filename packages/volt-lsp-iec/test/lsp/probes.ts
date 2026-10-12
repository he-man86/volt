/**
 * WHAT THE SERVER DID, SEEN FROM OUTSIDE IT — the probes the scheduling suites (openspec lsp-server-scheduling,
 * step 1) observe work with, and no product hook:
 *
 * - **the parse probe**: a delegating `mock.module` of the syntax barrel. Every `parseDocument` is counted per URI
 *   ("a save re-parses one file"), and a source carrying {@link THROWS_IN_PARSE} throws — the design's throwing parse
 *   (1.3). Every other call is the real parse.
 * - **the compute probe**: a delegating `mock.module` of the analysis barrel (`analysis/index.js` — the one analysis
 *   file anything outside `src/analysis/` may import, layering rule A2; mocking `analysis/pipeline/diagnostics.ts`
 *   directly was a deep import and failed `test/package/layering.test.ts`). It counts `documentFindings`, the barrel
 *   export that composes one document's findings, as the server calls it (`server/document-diagnostics.ts`; it was
 *   `computeDiagnostics` until lsp-server-scheduling 2.4 moved the composition into `analysis/` — the pin "a document
 *   pull computes only that document" counts 1 and fails loud, 0, if the probe is left behind a move). Every call is
 *   counted per URI ("an idle pull computes nothing", "a document pull computes one document"). A parse cannot see
 *   this: a recompute binds from cached parses and parses nothing.
 * - **the bind probe**: a delegating `mock.module` of the symbols barrel. Every `build.relink` is counted ("a watched
 *   batch relinks the project once, however many files it moves"), and a file whose source carries
 *   {@link THROWS_IN_BIND} throws in `build.bindFile` — and in `build.buildSymbolTable`, which binds every file it is
 *   given with its own (unmocked) `bindFile`, so the mock throws there for the same files, as the real bind would.
 * - **the read probe**: a delegating `mock.module` of `node:fs`. A `readFileSync` of the one path armed with
 *   {@link busyRead} throws `EBUSY`, as a file the CLI or the IDE is still writing does on Windows; a `readdirSync` of
 *   the one folder armed with {@link deniedList} throws `EPERM`, as a folder the user may not list does. Every other
 *   read is the real one.
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
import * as symbols from "../../src/frontend/symbols/index.js"

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
const realCompute = analysis.documentFindings
const realAnalysis = { ...analysis }
mock.module("../../src/analysis/index.js", () => ({
  ...realAnalysis,
  documentFindings: (...args: Parameters<typeof realCompute>): ReturnType<typeof realCompute> => {
    const uri = args[0].doc.uri
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

/** A source containing this comment parses, and throws when it is BOUND into a project. Nothing real contains it. */
export const THROWS_IN_BIND = "(* volt-test: this bind throws *)"

let relinks = 0
const realBuild = symbols.build
const realSymbols = { ...symbols }
const bindThrows = (file: { uri: string; source?: string }): void => {
  if (file.source?.includes(THROWS_IN_BIND) === true) throw new Error(`test: the bind of ${file.uri} throws`)
}
mock.module("../../src/frontend/symbols/index.js", () => ({
  ...realSymbols,
  build: {
    ...realBuild,
    buildSymbolTable: (...args: Parameters<typeof realBuild.buildSymbolTable>): ReturnType<typeof realBuild.buildSymbolTable> => {
      for (const file of args[0]) bindThrows(file)
      return realBuild.buildSymbolTable(...args)
    },
    bindFile: (...args: Parameters<typeof realBuild.bindFile>): void => {
      bindThrows(args[1])
      realBuild.bindFile(...args)
    },
    relink: (...args: Parameters<typeof realBuild.relink>): void => {
      relinks++
      realBuild.relink(...args)
    },
  },
}))

/** The `build.relink` calls since the last {@link resetRelinks}. */
export function relinked(): number {
  return relinks
}

/** Forget every relink counted so far. */
export function resetRelinks(): void {
  relinks = 0
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
let denied: string | undefined
const realReaddir = fs.readdirSync
const readdir = ((...args: Parameters<typeof realReaddir>) => {
  const [dir] = args
  if (denied !== undefined && typeof dir === "string" && dir.toLowerCase() === denied) {
    const e = new Error(`EPERM: operation not permitted, scandir '${dir}'`) as NodeJS.ErrnoException
    e.code = "EPERM"
    e.errno = -4048
    e.syscall = "scandir"
    e.path = dir
    throw e
  }
  return realReaddir(...args)
}) as typeof realReaddir
const patched = { readFileSync: read, readdirSync: readdir }
mock.module("node:fs", () => ({ ...realFs, ...patched, default: { ...realFs, ...patched } }))

/** Every `readFileSync` of `path` throws EBUSY until {@link busyRead} is called with undefined. */
export function busyRead(path: string | undefined): void {
  busy = path?.toLowerCase()
}

/** Every `readdirSync` of the folder `path` throws EPERM (a folder the user may not list) until {@link deniedList} is
 *  called with undefined. */
export function deniedList(path: string | undefined): void {
  denied = path?.toLowerCase()
}

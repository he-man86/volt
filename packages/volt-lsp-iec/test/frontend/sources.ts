/**
 * EVERYTHING THE FRONT-END READS, AS THREE GROUPS — the one input set of the phase-0 measurements (openspec
 * `frontend-conformance` tasks 0.1–0.4) and of snapshot F (task 1.3).
 *
 *   corpus    every source file of the six real projects under `test-corpus/`, each project with the build its IDE
 *             recorded (`expected-build.<vendor>.json`) and the dialect of that vendor;
 *   fixtures  every conformance fixture's own source and the PLC_PRG it is built under, with the fixture's CODESYS
 *             and TwinCAT build recordings;
 *   library   every ST body of the library repo (`libraries/<library>/<version>/`), which no IDE built: Volt wrote them.
 *
 * Ids are RELATIVE and slash-separated (`corpus/pro2193/…`, `fixture/<name>/<file>`, `library/Standard/3.5.18.0/TON.fb`),
 * so a dump taken in a temporary worktree (snapshot F, design.md P9) compares equal to one taken here.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import type { Dialect } from "../../src/syntax/index.js"
import { readSourceText } from "../../src/workspace-refs.js"
import { walkSources } from "../corpus/support/project.js"
import { ALL_TESTS } from "../conformance/fixtures/index.js"
import { plcPrgSource } from "../conformance/support/plc-prg.js"
import type { LanguageTest } from "../conformance/types.js"

export const PACKAGE = join(import.meta.dir, "..", "..")
export const CORPUS = join(PACKAGE, "test-corpus")
const RECORDINGS = join(PACKAGE, "test", "conformance", "recordings")
const LIBRARY_REPO = join(PACKAGE, "libraries")

/** A path relative to the package, slash-separated — the portable spelling every dump and finding uses. */
export const rel = (path: string): string => relative(PACKAGE, path).split("\\").join("/")

export interface RecordedDiagnostic {
  severity: string
  message: string
}

/** What one IDE build said: whether it succeeded, and its diagnostics. */
export interface RecordedBuild {
  buildSuccess: boolean
  diagnostics: readonly RecordedDiagnostic[]
}

export interface SourceFile {
  /** Relative, portable id (see the header). */
  id: string
  /** The uri the LSP reads it under — a disk path for the corpus and the library repo, `file:///conformance/…` for a fixture. */
  uri: string
  source: string
}

export interface CorpusProject {
  name: string
  dir: string
  vendor: Dialect
  build: RecordedBuild | undefined
  files: SourceFile[]
}

export interface FixtureSources {
  test: LanguageTest
  /** The fixture's own item, under the uri the replay reads it as (`evidence.ts` `lspErrors`). */
  own: SourceFile
  plc: SourceFile
  codesys: RecordedBuild | undefined
  twincat: RecordedBuild | undefined
}

// ─── corpus ──────────────────────────────────────────────────────────────────────────────────────────────────

/** The six projects, in name order, each with its files in `walkSources` order. */
export function corpusProjects(): CorpusProject[] {
  if (!existsSync(CORPUS)) return []
  return readdirSync(CORPUS)
    .filter((name) => statSync(join(CORPUS, name)).isDirectory())
    .sort()
    .map((name) => {
      const dir = join(CORPUS, name)
      const vendor: Dialect = existsSync(join(dir, "expected-build.twincat.json")) ? "twincat" : "codesys"
      const recording = join(dir, `expected-build.${vendor}.json`)
      const build = existsSync(recording) ? corpusBuild(recording) : undefined
      const files = walkSources(dir).map((path) => ({
        id: `corpus/${rel(path).slice("test-corpus/".length)}`,
        uri: path,
        source: readSourceText(path),
      }))
      return { name, dir, vendor, build, files }
    })
}

function corpusBuild(path: string): RecordedBuild {
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    recorded?: { buildSuccess?: boolean }
    diagnostics: RecordedDiagnostic[]
  }
  const success = raw.recorded?.buildSuccess
  if (success === undefined) throw new Error(`${rel(path)} records no buildSuccess`)
  return { buildSuccess: success, diagnostics: raw.diagnostics }
}

/** Is `id` a library DECLARATION the bridge materialized (`Library Manager/`) rather than the project's own code? */
export const isLibraryManagerFile = (id: string): boolean => id.includes("/Library Manager/")

// ─── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────

type BuildRecordings = Record<string, { buildSuccess?: boolean; diagnostics?: RecordedDiagnostic[] }>
const buildRecordings = (vendor: Dialect): BuildRecordings =>
  (JSON.parse(readFileSync(join(RECORDINGS, `${vendor}.build.json`), "utf8")) as { tests: BuildRecordings }).tests

/** The file extension a fixture's kind materializes as — as `support/evidence.ts` names it. */
export function fixtureExtension(kind: LanguageTest["kind"]): string {
  return kind === "function_block"
    ? "fb"
    : kind === "function"
      ? "fun"
      : kind === "program"
        ? "prg"
        : kind === "gvl"
          ? "gvl"
          : kind === "interface"
            ? "itf"
            : kind
}

export const fixtureUri = (t: LanguageTest): string => `file:///conformance/${t.pouName}.${fixtureExtension(t.kind)}`
export const plcUri = (t: LanguageTest): string => `file:///conformance/${t.name}/PLC_PRG.prg`

let fixtureCache: FixtureSources[] | undefined
/** Every fixture, in `ALL_TESTS` order, with its two build recordings. */
export function fixtureSources(): FixtureSources[] {
  if (fixtureCache !== undefined) return fixtureCache
  const codesys = buildRecordings("codesys")
  const twincat = buildRecordings("twincat")
  const recorded = (rec: BuildRecordings, name: string): RecordedBuild | undefined => {
    const r = rec[name]
    if (r === undefined) return undefined
    if (r.buildSuccess === undefined) throw new Error(`recording of ${name} states no buildSuccess`)
    return { buildSuccess: r.buildSuccess, diagnostics: r.diagnostics ?? [] }
  }
  fixtureCache = ALL_TESTS.map((t) => ({
    test: t,
    own: { id: `fixture/${t.name}/${t.pouName}.${fixtureExtension(t.kind)}`, uri: fixtureUri(t), source: t.source },
    plc: { id: `fixture/${t.name}/PLC_PRG.prg`, uri: plcUri(t), source: plcPrgSource(t) },
    codesys: recorded(codesys, t.name),
    twincat: recorded(twincat, t.name),
  }))
  return fixtureCache
}

// ─── the library repo ────────────────────────────────────────────────────────────────────────────────────────

/** Every ST body the library repo holds, in path order. */
export function libraryRepoFiles(): SourceFile[] {
  return walkSources(LIBRARY_REPO, new Set([".fb", ".fun"])).map((path) => ({
    id: `library/${rel(path).slice("libraries/".length)}`,
    uri: path,
    source: readFileSync(path, "utf8"),
  }))
}

// ─── messages ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One message, comparably spelled — the corpus gate's normalizer (`corpus.test.ts` `norm`): whitespace collapsed and
 * insignificant beside `;`, CRLF read as LF. A diagnostic that quotes source carries its layout; the IDE strips it.
 */
export const normMessage = (m: string): string =>
  m
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*/g, ";")
    .trim()

/**
 * Recorded messages as a MULTISET, compared by `normMessage`: `take(m)` uses up one recorded copy of `m` and says whether
 * one was left. An LSP message repeated more often than the vendor recorded it is a finding, not a match.
 */
export function messagePool(recorded: readonly string[]): { take(message: string): boolean } {
  const left = new Map<string, number>()
  for (const m of recorded) left.set(normMessage(m), (left.get(normMessage(m)) ?? 0) + 1)
  return {
    take(message) {
      const key = normMessage(message)
      const n = left.get(key) ?? 0
      if (n === 0) return false
      left.set(key, n - 1)
      return true
    },
  }
}

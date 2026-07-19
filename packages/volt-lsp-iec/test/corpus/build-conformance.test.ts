/**
 * Corpus build-conformance — the REAL oracle: every error-severity diagnostic the LSP emits on a corpus
 * project must be one the IDE's own build also emitted. This replaces the `corpus.test.ts` "zero errors"
 * assumption (which wrongly treated the projects as clean — they are NOT; see the C0371 demotion) with a
 * ground-truth comparison, exactly like `replay.test.ts` does per-fixture, but over whole projects.
 *
 * Ground truth lives in `test-corpus/<project>/expected-build.<vendor>.json`, captured by
 * `scripts/record-corpus-build.ts` from a LIVE build (needs the real project loaded in the IDE). Until a
 * project is recorded, its gate SKIPS — the comparison can't run without the compiler's answer. The message
 * set is the criterion (matching replay.test.ts), so an LSP detection with wording the IDE doesn't use reads
 * as a false positive until reconciled — which is the point: it forces parity and catches invented errors.
 */
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { extname, join } from "node:path"
import { parseSource } from "../../src/syntax/index.js"
import { buildSymbolTable } from "../../src/symbols/index.js"
import {
  computeSemanticDiagnostics,
  deadMemberSpans,
  deadPous,
  inDeadMember,
  ownerPou,
  resolveConfig,
  type Vendor,
} from "../../src/analysis/index.js"
import { loadTaskRoots, loadWorkspaceRefs } from "../../src/workspace-refs.js"
import { SOURCE_EXTENSION_SET } from "../../src/source-extensions.js"

/** The LSP error messages the build did NOT emit — the false positives. Message-set ⊆, like replay.test.ts. */
export function buildFalsePositives(lspErrorMessages: readonly string[], buildMessages: Iterable<string>): string[] {
  const build = new Set(buildMessages)
  return lspErrorMessages.filter((m) => !build.has(m))
}

// ── the comparison logic is pure + verified regardless of whether any recording exists yet ──────────────
test("buildFalsePositives: an LSP error absent from the build is a false positive; a present one is not", () => {
  const build = ["'x' is no input of 'FB'", "Cannot convert type 'INT' to type 'BOOL'"]
  expect(buildFalsePositives(["'x' is no input of 'FB'"], build)).toEqual([])
  expect(buildFalsePositives(["No such label 'A'…"], build)).toEqual(["No such label 'A'…"]) // C0371-class: caught
  expect(buildFalsePositives([], build)).toEqual([])
})

// ── per-project gate: activates the moment a recording is captured, skips until then ────────────────────
const CORPUS_ROOT = join(import.meta.dir, "..", "..", "test-corpus")
const VENDOR: Vendor = "codesys"

interface BuildRecording {
  recorded: { at: string; vendor: string; buildSuccess: boolean; count: number }
  diagnostics: { severity: string; message: string; line: number }[]
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (SOURCE_EXTENSION_SET.has(extname(p).toLowerCase())) out.push(p)
  }
  return out
}

/** Every error-severity LSP message across a project, with the same dead-code suppression the server applies. */
function lspErrorMessages(dir: string): string[] {
  const config = resolveConfig({ vendor: VENDOR })
  const inputs = walk(dir).map((uri) => {
    const source = readFileSync(uri, "utf8")
    return { uri, source, parseResult: parseSource(source) }
  })
  const project = buildSymbolTable(inputs)
  const references = loadWorkspaceRefs(dir)
  const dead = deadPous(inputs, loadTaskRoots(dir))
  const deadMembers = deadMemberSpans(inputs, dead)
  const messages: string[] = []
  for (const f of inputs) {
    const owner = ownerPou(f.parseResult)
    if (owner !== undefined && dead.has(owner)) continue
    const dm = deadMembers.get(f.uri)
    for (const d of computeSemanticDiagnostics({ parseResult: f.parseResult, source: f.source, project, config, references }))
      if (d.severity === "error" && !inDeadMember(d.span, dm)) messages.push(d.message)
  }
  return messages
}

const projects = existsSync(CORPUS_ROOT)
  ? readdirSync(CORPUS_ROOT).filter((p) => statSync(join(CORPUS_ROOT, p)).isDirectory())
  : []

describe("corpus build-conformance (LSP errors ⊆ real IDE build)", () => {
  for (const project of projects) {
    const recPath = join(CORPUS_ROOT, project, `expected-build.${VENDOR}.json`)
    const has = existsSync(recPath)
    test.skipIf(!has)(`${project}: every LSP error is a real ${VENDOR} build diagnostic`, () => {
      const rec = JSON.parse(readFileSync(recPath, "utf8")) as BuildRecording
      const buildMsgs = rec.diagnostics.map((d) => d.message)
      const fps = buildFalsePositives(lspErrorMessages(join(CORPUS_ROOT, project)), buildMsgs)
      expect(fps).toEqual([])
    }, 120_000)
  }
})

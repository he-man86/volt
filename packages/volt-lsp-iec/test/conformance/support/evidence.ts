/**
 * HOW WELL A FIXTURE IS EVIDENCED — the one implementation, used by the generator and by the gate.
 *
 * `scripts/rate-fixtures.ts` writes the answer into each fixture's `evidence`; `confidence.test.ts` recomputes it and
 * fails if a stored one disagrees. Both call THIS, so a generated file and the gate that checks it can never be
 * measuring different things — which is the only way storing derived data in source is safe.
 *
 * **It does not compare values, and that is deliberate.** `transpile.test.ts` owns value equality, in both backends,
 * using the vendor's own display formats (`ideValue` reads `DUT_X.Running`, `TIME#1s1ns`, `'a$Tb'`). A first version
 * re-implemented that comparison here and reported 97 false divergences on a green suite. So `confirmed` means "the
 * vendor answered, we execute it, and the gate that owns equality is asserting it" — a statement about WHERE THE
 * EVIDENCE IS, not a second opinion about the values.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { computeSemanticDiagnostics, messagesFor, resolveConfig } from "../../../src/analysis/index.js"
import { computeNetworkTextDiagnostics } from "../../../src/network/index.js"
import { parseSource } from "../../../src/syntax/index.js"
import { buildSymbolTable } from "../../../src/symbols/index.js"
import { lowerSource } from "../../../src/transpile/lower/index.js"
import { run } from "../../../src/transpile/interp/index.js"
import { assembleFixture } from "./fixture-units.js"
import { plcPrgSource } from "./plc-prg.js"
import { STANDARD_LIBRARY } from "./standard-library.js"
import type { LanguageTest } from "../types.js"

export type Evidence = NonNullable<LanguageTest["evidence"]>

/** The order a report lists them in: strongest evidence first, then the gaps, then what was never asked. */
export const EVIDENCE_ORDER: readonly Evidence[] = [
  "confirmed",
  "refused",
  "not-lowered",
  "unasked",
  "lsp-gap",
  "diverges",
  "unaskable",
]

const RECORDINGS = join(import.meta.dir, "..", "recordings")
const runRec = JSON.parse(readFileSync(join(RECORDINGS, "codesys.run.json"), "utf8")).tests as Record<
  string,
  { error?: string; values?: Record<string, string> }
>
const buildRec = JSON.parse(readFileSync(join(RECORDINGS, "codesys.build.json"), "utf8")).tests as Record<
  string,
  { buildSuccess?: boolean }
>

/** The fixture as one program, plus the libraries it lowers against — `assembleFixture` is the shared assembly. */
function sourceOf(t: LanguageTest, all: readonly LanguageTest[]): { source: string; libraries: { uri: string; source: string }[] } {
  const { source, gvls } = assembleFixture(t, all)
  return { source, libraries: [...STANDARD_LIBRARY, ...gvls] }
}

/**
 * Does the LSP report an ERROR for this source?
 *
 * Three things a naive version got wrong, each of which turned a covered fixture into a phantom gap:
 *
 *   PARSE ERRORS COUNT. A reserved word in name position is reported by `cursor.ts` with CODESYS's own wording, not
 *   by a semantic check. Reading only semantic diagnostics sees half of what the LSP says.
 *
 *   NETWORK TEXT HAS ITS OWN PASS. `computeSemanticDiagnostics` SKIPS a graphical body; `computeNetworkTextDiagnostics`
 *   is what reads it (`replay.test.ts` runs both for exactly this reason). Without it, eleven network fixtures read as
 *   gaps when the LSP flags every one.
 *
 *   THE URI IS PART OF THE INPUT. A signature-name check compares the declared name against the FILE's, so a fixture
 *   analysed under a made-up filename cannot trigger it. The uri is built the way `replay.test.ts` builds it.
 *
 * It asks only WHETHER the LSP objects, never whether the message matches — `refused.test.ts` owns the wording,
 * against the vendor's own text. Conflating the two would make this either too strict (a wording drift becomes a gap)
 * or unable to run at all, since most fixtures carry no `refused` fragment to compare.
 */
function lspReportsAnError(t: LanguageTest, all: readonly LanguageTest[]): boolean {
  const { source, gvls } = assembleFixture(t, all)
  const own = { uri: `file:///conformance/${t.pouName}.${extFor(t.kind)}`, source, parseResult: parseSource(source) }
  const plcText = plcPrgSource(t)
  const plc = { uri: `file:///conformance/${t.name}/PLC_PRG.prg`, source: plcText, parseResult: parseSource(plcText) }
  const files = [own, plc, ...gvls.map((g) => ({ uri: g.uri, source: g.source, parseResult: parseSource(g.source) }))]
  if (files.some((f) => f.parseResult.errors.length > 0)) return true

  const project = buildSymbolTable([...files, ...libraryFiles()])
  const config = resolveConfig({ vendor: "codesys" })
  const semantic = files.flatMap((f) =>
    computeSemanticDiagnostics({ parseResult: f.parseResult, source: f.source, project, config }),
  )
  const network = computeNetworkTextDiagnostics(own, project, messagesFor("codesys"))
  return [...semantic, ...network].some((d) => d.severity === "error")
}

/** The file extension a fixture's kind materializes as — one object per file, as the wire keys them. */
function extFor(kind: LanguageTest["kind"]): string {
  return kind === "function_block" ? "fb" : kind === "function" ? "fun" : kind === "program" ? "prg" : kind === "gvl" ? "gvl" : kind === "interface" ? "itf" : "dut"
}

let libraries: { uri: string; source: string; parseResult: ReturnType<typeof parseSource> }[] | undefined
const libraryFiles = (): NonNullable<typeof libraries> => (libraries ??= STANDARD_LIBRARY.map((l) => ({ ...l, parseResult: parseSource(l.source) })))

export function rateFixture(t: LanguageTest, all: readonly LanguageTest[]): Evidence {
  if (t.execSkip !== undefined || t.recorderSkip === true) return "unaskable"
  if (t.deferred?.lsp !== undefined) return "lsp-gap"

  const rec = runRec[t.name]
  const build = buildRec[t.name]
  // A vendor REFUSAL is an answer, and either recording can carry it — but `refused` claims WE refuse it too, so it
  // has to be asked rather than assumed. It was assumed, and that was an overclaim: `cc_reserved_name_s_string`,
  // `cc_il_name_ld` and their neighbours are rejected by CODESYS, carry no `refused` marker for `refused.test.ts` to
  // check, and parse CLEANLY here — rated as evidence when they were silent gaps.
  if (rec?.error?.startsWith("does not compile") === true || build?.buildSuccess === false || t.refused !== undefined)
    return lspReportsAnError(t, all) ? "refused" : "lsp-gap"
  if (rec?.values === undefined) return "unasked"

  // The vendor ran it. Do WE? That is the only thing left to decide here.
  const { source, libraries } = sourceOf(t, all)
  let pou
  try {
    pou = lowerSource(source, "PLC_PRG", libraries).pou
  } catch {
    return "diverges" // a THROW is not a refusal — lowering must end in a diagnostic, so this is a defect
  }
  // `deferred.transpile` is read only AFTER this: a fixture deferred because lowering REFUSES it is a coverage gap,
  // and reading the flag first reported four refusals as wrong answers.
  if (pou === undefined) return "not-lowered"
  if (t.deferred?.transpile !== undefined) return "diverges"
  try {
    const p = run(pou)
    for (let i = 0; i < (t.cycles ?? 1); i++) p.scan()
  } catch {
    return "diverges" // the vendor completed the scan and we faulted
  }
  return "confirmed"
}

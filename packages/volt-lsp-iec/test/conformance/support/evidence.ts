/**
 * HOW WELL A FIXTURE IS EVIDENCED — the one implementation, used by the generator and by the gate.
 *
 * `scripts/rate-fixtures.ts` writes the answer into each fixture's `evidence`; `fixtures.test.ts` recomputes it and
 * fails if a stored one disagrees. Both call THIS, so a generated file and the gate that checks it can never be
 * measuring different things — which is the only way storing derived data in source is safe.
 *
 * **It does not compare values, and that is deliberate.** `fixtures.test.ts` owns value equality, in both backends,
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
import { assembleFixture, withDependencies } from "./fixture-units.js"
import { plcPrgSource } from "./plc-prg.js"
import { STANDARD_LIBRARY, STANDARD_LOWERING, STANDARD_MANIFESTS } from "./standard-library.js"
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
  return { source, libraries: [...STANDARD_LOWERING, ...gvls] }
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
 *   is what reads it (`fixtures.test.ts` runs both for exactly this reason). Without it, eleven network fixtures read as
 *   gaps when the LSP flags every one.
 *
 *   THE URI IS PART OF THE INPUT. A signature-name check compares the declared name against the FILE's, so a fixture
 *   analysed under a made-up filename cannot trigger it. The uri is built the way `fixtures.test.ts` builds it.
 *
 * `lspReportsAnError` asks only WHETHER the LSP objects; `lspErrors` returns the same messages for the fixtures that
 * carry the vendor's own text to compare against. They are the same walk on purpose — the wording check used to build
 * its own two-file project, which is the very assembly the third note above says defeats `signature-name`.
 */
export function lspErrors(t: LanguageTest, all: readonly LanguageTest[]): string[] {
  // ONE ITEM, ONE FILE — the layout the protocol guarantees and `fixtures.test.ts` replays. `assembleFixture` is the
  // TRANSPILER's assembly: it concatenates every dependency AND the synthesized PLC_PRG into a single source. Read
  // as a file, that source holds two top-level POUs, which is exactly the shape `signature-name` treats as a fixture
  // packing its dependencies inline — so it stayed silent and four measured refusals read as `lsp-gap`.
  const own = { uri: `file:///conformance/${t.pouName}.${extFor(t.kind)}`, source: t.source, parseResult: parseSource(t.source) }
  const deps = withDependencies(t, all)
    .filter((f) => f.name !== t.name && f.source !== "")
    .map((f) => ({ uri: `file:///conformance/${f.pouName}.${extFor(f.kind)}`, source: f.source, parseResult: parseSource(f.source) }))
  const plcText = plcPrgSource(t)
  const plc = { uri: `file:///conformance/${t.name}/PLC_PRG.prg`, source: plcText, parseResult: parseSource(plcText) }
  const files = [own, plc, ...deps]
  const project = buildSymbolTable([...files, ...libraryFiles()], STANDARD_MANIFESTS)
  const config = resolveConfig({ vendor: "codesys" })
  const semantic = files.flatMap((f) =>
    computeSemanticDiagnostics({ parseResult: f.parseResult, source: f.source, project, config }),
  )
  const network = computeNetworkTextDiagnostics(own, project, messagesFor("codesys"))
  return [
    ...files.flatMap((f) => f.parseResult.errors.map((e) => e.message)),
    ...[...semantic, ...network]
      .filter((d) => d.severity === "error" || CONFIGURABLE_SEVERITY.has(d.code))
      .map((d) => d.message),
  ]
}

/** Whether the LSP objects at all — a parse error counts, and so does a check the PROJECT could configure louder. */
function lspReportsAnError(t: LanguageTest, all: readonly LanguageTest[]): boolean {
  return lspErrors(t, all).length > 0
}

/**
 * THE RECORDING PROJECT'S OWN SETTINGS, which are not a language answer. `__NEW` needs the APPLICATION to define a
 * dynamic-memory pool and the exec-oracle project defines none, so every `__NEW` fixture comes back refused for a
 * reason no LSP can see — the same shape as `tc_nc_axis`, where the project references no motion library. When
 * that is the WHOLE refusal the fixture is unaskable HERE; when the vendor also said something about the language
 * (`newdel_without_pragma`), the refusal stands and is checked.
 *
 * Closable by configuring the project, not by changing a fixture or a check.
 */
const PROJECT_CONFIGURATION: readonly RegExp[] = [/^No memory for dynamic object creation defined for application /]

function onlyProjectConfiguration(error: string): boolean {
  const lines = error.replace(/^does not compile: /, "").split(" | ")
  return lines.length > 0 && lines.every((line) => PROJECT_CONFIGURATION.some((p) => p.test(line)))
}

/**
 * Checks whose SEVERITY the project decides, not the language. C0033 (`dw := ptr`) is configurable in CODESYS: the
 * recording project has it as an error, this LSP ships the vendor's default — a warning — and the MESSAGE is
 * identical either way (`cc5_pointer_not_convertible`). Reading severity alone filed that as a silent gap when the
 * LSP objects in the vendor's own words; the two differ by configuration, not by behaviour.
 */
const CONFIGURABLE_SEVERITY: ReadonlySet<string> = new Set(["pointer-not-convertible"])

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
  if (rec?.error !== undefined && onlyProjectConfiguration(rec.error)) return "unaskable"
  // A vendor REFUSAL is an answer, and either recording can carry it — but `refused` claims WE refuse it too, so it
  // has to be asked rather than assumed. It was assumed, and that was an overclaim: `cc_reserved_name_s_string`,
  // `cc_il_name_ld` and their neighbours are rejected by CODESYS, carry no `refused` marker for `fixtures.test.ts` to
  // check, and parse CLEANLY here — rated as evidence when they were silent gaps.
  if (rec?.error?.startsWith("does not compile") === true || build?.buildSuccess === false || t.refused !== undefined)
    return lspReportsAnError(t, all) ? "refused" : "lsp-gap"
  // THE VENDOR STOPPING IS AN ANSWER. A recording whose error is not a compile failure is one the IDE built, logged
  // into and ran — and whose scan never completed: `LN(0)`, `1.0 / 0`, an integer divide by zero, a deref of an
  // unbound pointer. Reading that as "never asked" threw away the very measurements the infinity rule in
  // `ir/values.ts` is built on. The agreement here is inverted: we CONFIRM by faulting too, and DIVERGE by
  // finishing a scan the vendor could not.
  const vendorStops = rec?.error !== undefined
  if (rec?.values === undefined && !vendorStops) return "unasked"

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
    // A fault is the RIGHT answer when the vendor could not finish the scan either, and the wrong one otherwise.
    return vendorStops ? "confirmed" : "diverges"
  }
  return vendorStops ? "diverges" : "confirmed"
}

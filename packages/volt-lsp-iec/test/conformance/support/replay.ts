/**
 * THE REPLAY'S PROJECT — what the LSP sees when it is asked about one conformance fixture, as the recording project held
 * it: the fixture's own item, its global lists and the PLC_PRG that instantiates it, on top of every OTHER fixture's
 * declarations and the standard library, for one vendor.
 *
 * It lived inside `fixtures.test.ts` (`runLsp`) and moved here unchanged so the diagnostic census
 * (`test/analysis/census.ts`, openspec analysis-conformance 0.1) measures the SAME composition the replay gates — a census
 * over a project of its own would count findings the replay never sees. What each caller then ASKS of the bound fixture
 * (the replay its messages, the census each check's slice) is the caller's — and "what the LSP says about it" is ONE
 * answer, `replayDiagnostics` (analysis-conformance 2.6).
 */
import { CODESYS_ONLY_KEYWORDS, TWINCAT_LITERAL_PREFIXES, parseDocument, parseSource } from "../../../src/frontend/syntax/index.js"
import { build, type Scope } from "../../../src/frontend/symbols/index.js"
import { computeDiagnostics, messagesFor, resolveConfig, type DiagnosticItem, type Vendor } from "../../../src/analysis/index.js"
import { computeNetworkTextDiagnostics } from "../../../src/network/index.js"
import { ALL_TESTS } from "../fixtures/index.js"
import { splitLists, withDependencies } from "./fixture-units.js"
import { plcPrgSource } from "./plc-prg.js"
import { RECORDING_ENVIRONMENT } from "./recording-environment.js"
import { PROJECT_LIBRARY, PROJECT_MANIFESTS, projectDevices } from "./project-libraries.js"

function extFor(kind: string): string {
  const map: Record<string, string> = { function_block: "pou", function: "pou", program: "pou", gvl: "gvl", interface: "itf", dut: "dut" }
  const ext = map[kind]
  if (!ext) throw new Error(`fixture kind "${kind}" has no file extension`)
  return ext
}

// Cross-fixture declaration context: every fixture's interfaces/DUTs/GVLs and FBs (with their standalone
// method/property/action member units) are visible to the others, so `EXTENDS X` / `IMPLEMENTS X` / type refs
// AND inherited members resolve across fixtures. Each fixture is its own file, so a standalone method binds to
// the FB in its OWN fixture (no cross-fixture leak); fixture pouNames are unique (`FB_LANG_<name>`) so FBs
// don't collide. Only PROGRAM units are excluded (PLC_PRG is synthesized per fixture separately).
// Each read as the object its file holds (`parseDocument`), as the workspace store reads a workspace file — a DUT's or a
// GVL's text the way the IDE reads it (`syntax/format/source-object.ts`).
const PARSED = ALL_TESTS.map((t) => {
  const uri = `file:///conformance/${t.pouName}.${extFor(t.kind)}`
  return { uri, source: t.source, parseResult: parseDocument(uri, t.source, { networkText: true }) }
})
// A list a fixture holds beside its POU is an item of its own, under the name the push gives it (`splitLists`): bound
// once with the declarations, and analysed with its fixture.
const SPLIT = PARSED.map((p, i) => splitLists(ALL_TESTS[i]!, p))
const LISTS = SPLIT.flatMap((s) => s.lists)
const CROSS_DECLS = SPLIT.map(({ item: p }) => ({
  uri: p.uri,
  source: p.source,
  parseResult: {
    units: p.parseResult.units.filter((u) => u.kind !== "program"),
    errors: [],
    // The declaration-only copy parses the SAME source, so it fails on the same names; keeping them means a fixture
    // whose declaration cannot parse stays as quiet here as it is anywhere else.
    failedDeclarations: p.parseResult.failedDeclarations,
    tokens: p.parseResult.tokens,
    dialect: p.parseResult.dialect,
  },
}))
// The recorder builds each fixture with a PLC_PRG that instantiates + uses it; usage-only diagnostics
// (assignment in the caller, external write) live there, so synthesize + analyze it too.
const PLC_PRGS = ALL_TESTS.map((t) => {
  if (t.plcPrgVar === undefined && t.plcPrgBody === undefined) return undefined
  const source = plcPrgSource(t)
  // A DIRECTORY per fixture, so the file's BASE NAME is the object's name — `PLC_PRG.pou`, as a workspace has it.
  // It used to be `<fixture>__plcprg.pou`, which made every synthesized PLC_PRG look like a POU whose signature
  // disagrees with its object name (`signature-name`), and that is a real CODESYS error, not a harness detail.
  return { uri: `file:///conformance/${t.name}/PLC_PRG.pou`, source, parseResult: parseSource(source, { networkText: true }) }
})

/**
 * BOTH recording projects reference a standard library, so a fixture calling `LEN` compiled against its
 * declaration and the replay has to as well (gap 9, `cc_standard_len_wstring`).
 *
 * <p>This was CODESYS-only, on the note "TwinCAT's standard library is Tc2_Standard, a different materialization
 * — not added for it". True about the materialization and wrong about the consequence: without one, TwinCAT's
 * replay could not resolve `LEN` at all, so it said NOTHING where the recording has a real error, and SEVENTEEN
 * fixtures lost agreement to a missing library rather than to a missing check.</p>
 *
 * <p>Sharing CODESYS's materialization is a claim about Tc2_Standard, and it is the no-FP gate that makes it
 * testable rather than a guess: a signature that differs would put an LSP-only message on the board immediately.
 * Measured 2026-09-21 — agreement 2479 -> 2496 and the false-positive list unchanged at three. A specific
 * divergence, when one is found, is a reason to materialize Tc2_Standard separately, not to go back to none.</p>
 */
const standardLibrary = (vendor: Vendor) => PROJECT_LIBRARY.map((l) => ({ ...l, parseResult: parseSource(l.source, { networkText: true }, vendor) }))

/**
 * THE SAME SOURCE, LEXED AS THE OTHER VENDOR — for the handful of fixtures where that can differ at all.
 *
 * `__POSITION`, `__POUNAME`, `__COMPARE_AND_SWAP`, `__VECTOR` are CODESYS's alone, and so is every `<word>#` literal
 * prefix TwinCAT does not read (`TWINCAT_LITERAL_PREFIXES`: `UCHAR#`, `LDATE#`, `CHAR#`, an enum's `E#`…;
 * `syntax/lex/vocabulary.ts`, measured on both recordings) — and a WSTRING hex escape
 * of fewer than four digits ends the token where TwinCAT stops, not where CODESYS does (`lex/lexer.ts`
 * `lexQuotedString`, `esc_wstring_hex_*`). For every other source the two dialects produce identical tokens, so this
 * re-parses only what contains one of them — by name, and for the escape any `$` with one to three hex digits (a
 * STRING's too: re-parsing more than needed is exact, only slower). Parsing all 2540 fixtures twice would be correct
 * and would also double the harness's setup for about thirty files.
 */
// …and a partial access `x.%W0`: one token on CODESYS, `.` `%` `W0` on TwinCAT (`lex/lexer`, `accepts_partial_access`)
const DIALECT_WORDS = new RegExp(`(?<![A-Za-z0-9_])(${[...CODESYS_ONLY_KEYWORDS].join("|")})|\\$[0-9A-Fa-f]{1,3}(?![0-9A-Fa-f])|\\.%`, "i")
const LITERAL_PREFIX = /(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)#/g
const DIALECT_SENSITIVE = {
  test: (source: string): boolean =>
    DIALECT_WORDS.test(source) || [...source.matchAll(LITERAL_PREFIX)].some((m) => !TWINCAT_LITERAL_PREFIXES.has(m[1].toUpperCase())),
}
export type ReplayDoc = { uri: string; source: string; parseResult: ReturnType<typeof parseSource> }
// By the document, not its uri: fixtures share a POU name, so two fixtures' files can share a uri.
const TC_PARSE = new WeakMap<object, ReplayDoc>()
function asVendor<T extends ReplayDoc>(doc: T, vendor: Vendor): T | ReplayDoc {
  if (vendor !== "twincat") return doc
  let hit = TC_PARSE.get(doc)
  if (hit === undefined) {
    // A source with none of the CODESYS-only words lexes to the same tokens in both dialects, so its CODESYS parse IS
    // its TwinCAT parse, and says so (`ParseResult.dialect` — the analysis refuses a parse made for the other vendor).
    const parseResult = DIALECT_SENSITIVE.test(doc.source)
      ? parseDocument(doc.uri, doc.source, { networkText: true }, "twincat")
      : { ...doc.parseResult, dialect: "twincat" as const }
    hit = { uri: doc.uri, source: doc.source, parseResult }
    TC_PARSE.set(doc, hit)
  }
  return hit
}
/**
 * ONE PROJECT PER VENDOR, EDITED IN PLACE — not one rebuilt per fixture.
 *
 * This used to call `buildSymbolTable` with `CROSS_DECLS.filter((_, i) => i !== testIdx)`: every fixture's
 * declarations except its own, bound from scratch, once per fixture. That is O(n^2) in the fixture count — at 1453
 * fixtures it is 2.1 million file-binds per vendor — and it timed out the moment a census sweep pushed n up by half.
 * The census will push it much further, so the shape had to change rather than the budget.
 *
 * The exclusion was only ever there because `CROSS_DECLS[i]` and `own` are the same file: binding both would declare
 * every fixture's own types twice. `unbindFile` takes that one file out by URI and `bindFile` puts it back, so the
 * project each fixture sees is EXACTLY what it saw before — every other fixture's declarations, plus its own units
 * with their programs, plus the standard library.
 */
const SHARED = new Map<Vendor, Scope>()
function sharedProject(vendor: Vendor): Scope {
  let project = SHARED.get(vendor)
  if (project === undefined) {
    project = build.buildSymbolTable([...CROSS_DECLS, ...LISTS, ...standardLibrary(vendor)], PROJECT_MANIFESTS, vendor, RECORDING_ENVIRONMENT, projectDevices(vendor))
    SHARED.set(vendor, project)
  }
  return project
}

/** The swap left in place by the previous call, undone lazily at the start of the next. */
let pending: { project: Scope; idx: number; plcUri: string | undefined } | undefined
function restore(): void {
  if (pending === undefined) return
  build.unbindFile(pending.project, PARSED[pending.idx]!.uri)
  if (pending.plcUri !== undefined) build.unbindFile(pending.project, pending.plcUri)
  build.bindFile(pending.project, CROSS_DECLS[pending.idx]!)
  pending = undefined
}

/** One fixture's files as the replay analyses them: its own item, its PLC_PRG (when it has one), its global lists, and
 *  the items and lists of every fixture it depends on. */
export interface ReplayFiles {
  own: ReplayDoc
  plc: ReplayDoc | undefined
  lists: readonly ReplayDoc[]
  /**
   * THE BUILD COMPILES WHAT THE FIXTURE USES. `record:language` pushes every fixture this one depends on
   * (`withDependencies`: a base FB, an interface, a DUT, a global) and records everything the build says — a
   * dependency's own error lands under this fixture's name (`sn_dut_mismatch_used`, `interface_with_property_impl`,
   * `itf_var_section_inherited`). So the replay analyses those files too. Measured 2026-10-06 (analysis-conformance
   * 3.4), both vendors: 3 fixtures gain the dependency's recorded message, none gains one the build did not record.
   */
  dependencies: readonly ReplayDoc[]
}

/** Per fixture index, the indices of the fixtures it depends on (not itself), once. */
const DEPENDENCIES = new Map<number, readonly number[]>()
const INDEX_OF = new Map(ALL_TESTS.map((t, i) => [t.name, i]))
function dependencyIndices(testIdx: number): readonly number[] {
  let hit = DEPENDENCIES.get(testIdx)
  if (hit === undefined) {
    const t = ALL_TESTS[testIdx]!
    hit = withDependencies(t, ALL_TESTS)
      .filter((f) => f.name !== t.name && f.source !== "")
      .map((f) => INDEX_OF.get(f.name)!)
    DEPENDENCIES.set(testIdx, hit)
  }
  return hit
}

/**
 * Bind fixture `testIdx` (an index into `ALL_TESTS`) into `vendor`'s shared project and hand `ask` its files and that
 * project. Each call swaps its own fixture in after undoing the previous one, so its answer does not depend on the order
 * fixtures are asked in.
 */
export function withReplayFixture<T>(testIdx: number, vendor: Vendor, ask: (files: ReplayFiles, project: Scope) => T): T {
  const { item: own, lists } = splitLists(ALL_TESTS[testIdx]!, asVendor(PARSED[testIdx] as (typeof PARSED)[number], vendor))
  const plc0 = PLC_PRGS[testIdx]
  const plc = plc0 === undefined ? undefined : asVendor(plc0, vendor)
  const project = sharedProject(vendor)
  // swap this fixture's declaration-only copy for its real one, run, then put it back
  // ONE `relink` PER FIXTURE, not two. It walks every child in the project, so at two per fixture it is the
  // O(n^2) term all over again — which is what pushed this back over the 5s hang guard once the census sweeps added
  // another eight hundred fixtures. The restore does not link: the project is left bound-but-unlinked, and the NEXT
  // fixture's link fixes it before anything reads it. Nothing runs in between.
  restore()
  build.unbindFile(project, own.uri)
  build.bindFile(project, { uri: own.uri, parseResult: own.parseResult, source: own.source })
  if (plc) build.bindFile(project, { uri: plc.uri, parseResult: plc.parseResult, source: plc.source })
  // with the MANIFESTS: re-linking without them cleared the library-visibility table the first build published, so
  // every fixture after the first resolved an ambiguous library name as if no library could see another
  build.relink(project, PROJECT_MANIFESTS)
  pending = { project, idx: testIdx, plcUri: plc?.uri }
  // each dependency's own files, as bound (its declaration-only copy holds the same units, so its checks resolve as in
  // its own replay)
  const dependencies = dependencyIndices(testIdx).flatMap((j) => {
    const split = splitLists(ALL_TESTS[j]!, asVendor(PARSED[j] as (typeof PARSED)[number], vendor))
    return [split.item, ...split.lists]
  })
  return ask({ own, plc, lists, dependencies }, project)
}

/**
 * WHAT THE LSP SAYS ABOUT ONE BOUND FIXTURE — the conformance composition, in ONE place (analysis-conformance P1, task 2.6):
 * the pipeline (`computeDiagnostics`) over each document the replay analyses — its own item, its PLC_PRG, its global
 * lists, each under its own uri — then the network-text pass over its own item, which stays a call of its own while
 * design.md §3 is parked. No parse error is added beside the pipeline's: `checkParseErrors` reports each one. The replay
 * gate (`fixtures.test.ts` `runLsp`) and the agreement residue (`scripts/agreement-residue.ts`) both ask this; they each
 * composed it themselves, and the residue's own project gave two fixtures a different answer (task 0.4).
 */
export function replayDiagnostics({ own, plc, lists, dependencies }: ReplayFiles, project: Scope, vendor: Vendor): DiagnosticItem[] {
  const config = resolveConfig({ vendor })
  const docs = replayDocuments({ own, plc, lists, dependencies })
  return [
    ...docs.flatMap((d) => computeDiagnostics({ uri: d.uri, parseResult: d.parseResult, source: d.source, project, config })),
    ...networkDocuments({ own, plc, lists, dependencies }).flatMap((d) =>
      computeNetworkTextDiagnostics({ uri: d.uri, source: d.source, parseResult: d.parseResult }, project, messagesFor(vendor)),
    ),
  ]
}

/** The documents the pipeline runs over: the fixture's item, its PLC_PRG, its lists, and its dependencies' files. */
export function replayDocuments({ own, plc, lists, dependencies }: ReplayFiles): ReplayDoc[] {
  return [own, ...(plc === undefined ? [] : [plc]), ...lists, ...dependencies]
}

/** The documents the network-text pass runs over: the fixture's own item and its dependencies' files. */
export function networkDocuments({ own, dependencies }: ReplayFiles): ReplayDoc[] {
  return [own, ...dependencies]
}

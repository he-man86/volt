/**
 * Write what is known about every fixture into `fixtures/map.generated.ts` — ONE row each, ONE file.
 *
 *   bun run rate:fixtures          # regenerate
 *   bun run rate:fixtures --check  # report what would change, write nothing
 *
 * A row answers the whole question a reader has about a fixture:
 *
 *   `evidence`  how well it is EVIDENCED — the vendor was asked and we agree (`confirmed`), the vendor refuses and
 *               so do we (`refused`), it is a coverage gap (`not-lowered`), a wrong answer (`diverges`), a check the
 *               LSP does not make yet (`lsp-gap`), nobody has asked (`unasked`), nothing to ask (`unaskable`).
 *   `tier`      the band of the language its own body reaches — `decl` up to `indirect`, from the lowered IR.
 *   `rust`      which oracle reached the EMITTED RUST: `vendor` when the recording's values came back out of it,
 *               `compiles` when it built and no recorded value reaches it.
 *   `lints`     what the Rust linter still says about that Rust, after a policy that states a reason per allowed
 *               lint. Absent means clean; a list is the work left on that construct.
 *   `pedantic`  how many clippy::pedantic + clippy::perf findings it carries — the distance to idiomatic.
 *   `edge`      the interpreter against the compiled Rust on edge inputs nobody recorded: `agree`, `disagree`, or
 *               `not-run`, and the header says why for each of those.
 *   `size`      emitted Rust lines per ST line.
 *   `shape`     the emission's shape id — its normalized constructs in order.
 *   `notes`     the ids of the constructs it emits that the review judged. Their full text — improvement,
 *               alternatives, chosen, why — is written at the END of the same file, a generated `NOTES` section
 *               copied from the authored table in `support/transpile-confidence.ts` (`renderNotes`), so a row leads
 *               to its reasons without leaving the map. The authored table stays the source; the copy is gated.
 *
 * WHY A GENERATED MODULE AND NOT A FIELD IN EACH FIXTURE. About half the catalog is not literal objects: 458 of the
 * fixtures come from factory helpers (`fb("cc_…", …)`) or carry template-literal names
 * (`` name: `cc_enum_into_${target}` ``). A per-entry field reaches only the literal half, which would leave the
 * annotation inconsistent — present on one fixture and absent on its neighbour for a reason that is about how the
 * file is written rather than about what is known. One module keyed by name reaches all of them, and
 * `fixtures/index.ts` merges it so `t.evidence` and `t.transpile` are populated on EVERY fixture at runtime.
 *
 * It is derived data, so it is generated and then CHECKED: `fixtures.test.ts` recomputes every row and fails if a
 * stored one disagrees. That is what makes it safe to commit — it can be read, diffed and reviewed, and it cannot
 * go stale without a red test.
 *
 * THE RECORDINGS ARE NOT TOUCHED. `recordings/*.json` is the vendor's own answer and only a recorder writes it;
 * this reads them. Re-run after `record:exec` or `record:language`, and after any change to the EMITTER — which is
 * the other input, and the reason this now compiles every fixture instead of finishing instantly.
 *
 * ONE COMPILE PER FIXTURE, AND IT IS AN EXECUTABLE. The edge run needs something to run, and a second compile per
 * fixture for it would double the cost; so the harness is appended to the emitted code and the linter reads the
 * same build. That makes `rust` an executable build for every fixture, as it already was for every fixture the value
 * pass reaches — and it is why the two `array_index_const_*` fixtures read `rejected`: rustc's deny-by-default
 * `unconditional_panic` refuses an executable of `a[11]` over an `ARRAY[1..10]`, which a metadata build never ran.
 */
// FIRST, before anything that reaches the LSP: the environment the gate rates under. `bun test` preloads this
// (bunfig.toml), so every rating the gate recomputes sees LD and FBD network text ON; a generator that did not load it
// rated the thirteen network fixtures with the switch OFF — `lsp-gap` where the gate says `refused` — and wrote a map
// its own gate rejected, unless whoever ran it remembered to set VOLT_GRAPHICAL=1 by hand.
import "../test/network-text-on.js"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ALL_TESTS } from "../test/conformance/fixtures/index.js"
import { assembleFixture } from "../test/conformance/support/fixture-units.js"
import { PROJECT_BASE } from "../test/conformance/support/project-libraries.js"
import { EVIDENCE_ORDER, rateFixture, type Evidence } from "../test/conformance/support/evidence.js"
import {
  ALLOWED,
  NOTES,
  TIERS,
  assertNotes,
  assertPolicy,
  buildArgv,
  correctnessOf,
  deadNotes,
  divergesOf,
  edgeHarness,
  edgePlan,
  edgeVerdict,
  emissionShape,
  notesOf,
  printRow,
  rejectionIsADefect,
  renderNotes,
  rendered,
  sizeRatio,
  splitFindings,
  tierOf,
  type EdgeVerdict,
  type FixtureMapRow,
} from "../test/conformance/support/transpile-confidence.js"
import { CLIPPY } from "../test/conformance/support/rustc.js"
import { emitRust, lowerSource } from "../src/transpile/index.js"

const OUT = join(import.meta.dir, "..", "test", "conformance", "fixtures", "map.generated.ts")
const check = process.argv.includes("--check")

assertPolicy()
assertNotes()

// NO FALLBACK TO `rustc`. Without the linter every row would be written with no `lints` key, which reads exactly
// like clean — so a regeneration on a machine without clippy would silently erase the work list this file exists
// to hold. Refuse instead.
if (CLIPPY === null)
  throw new Error(
    "no `clippy-driver` on PATH. Every row's `lints` would be written empty, which is indistinguishable from " +
      "clean — so this refuses rather than erase the map. `rustup component add clippy`.",
  )
const clippy = CLIPPY

const dir = mkdtempSync(join(tmpdir(), "volt-fixture-map-"))
const rows = new Map<string, FixtureMapRow>()
/** How many fixtures each ALLOWED lint actually excused — an entry that excuses nothing is refused below. */
const excused = new Map<string, number>()
/** A fixture INSIDE the input contract whose emitted Rust the compiler refused — an emitter defect, refused below. */
const rejected = new Map<string, string>()
/** Every construct any fixture emits, with its normalized line — a note keyed by anything else is refused below. */
const constructs = new Map<string, string>()
/** Why each `not-run` edge row did not run, by reason. */
const notRun = new Map<string, number>()
/** The first difference of each `disagree` edge row, for the header. */
const disagreements = new Map<string, string>()
/** Every pedantic finding, by lint, across all fixtures. */
const pedanticTally = new Map<string, number>()
const started = performance.now()

// ONE COMPILER PER CORE. Each fixture is its own `clippy-driver`, and spawning 2,600 at once is thrashing rather
// than parallelism — the same shape `fixtures.test.ts` settled on for its own Rust pass.
const lanes = Math.max(1, navigator.hardwareConcurrency - 1)
let next = 0
await Promise.all(
  Array.from({ length: Math.min(lanes, ALL_TESTS.length) }, async () => {
    for (let i = next++; i < ALL_TESTS.length; i = next++) {
      const t = ALL_TESTS[i]!
      const evidence: Evidence = rateFixture(t, ALL_TESTS)
      const { source, gvls } = assembleFixture(t, ALL_TESTS)
      let pou
      try {
        pou = lowerSource(source, "PLC_PRG", gvls, undefined, PROJECT_BASE).pou
      } catch {
        pou = undefined // a THROW is a defect `rateFixture` already reports as `diverges`; there is no Rust to rate
      }
      if (pou === undefined) {
        rows.set(t.name, { evidence, ...(divergesOf(t.name) === undefined ? {} : { diverges: divergesOf(t.name) }) })
        continue
      }
      const emitted = emitRust(pou)
      const code = emitted.code
      const plan = edgePlan(t, ALL_TESTS, pou, code)
      const file = join(dir, `${t.name}.rs`)
      const exe = join(dir, `${t.name}${process.platform === "win32" ? ".exe" : ""}`)
      await Bun.write(file, `${code}\n${edgeHarness(pou, emitted, plan, "")}`)
      const build = Bun.spawn(buildArgv(clippy, file, { exe }), { stderr: "pipe", stdout: "pipe" })
      // THE EXIT CODE IS READ. It was discarded, so every fixture that lowered was written `compiles` — six of
      // them wrongly, because their emitted Rust does not build (`i : INT := 1.5` emits `1.5i16`). All six are
      // outside the input contract, which makes the EMISSION fine and the CLAIM false.
      const built = (await build.exited) === 0
      const stderr = await new Response(build.stderr).text()
      if (!built && rejectionIsADefect(evidence)) rejected.set(t.name, rendered(stderr).slice(0, 600))
      // ONE pass over the compiler's JSON, all three halves out of it
      const { found, excused: covered, pedantic } = splitFindings(stderr, code.split("\n").length)
      for (const lint of covered) excused.set(lint, (excused.get(lint) ?? 0) + 1)
      for (const lint of pedantic) pedanticTally.set(lint, (pedanticTally.get(lint) ?? 0) + 1)

      let edge: EdgeVerdict = "not-run"
      if (!built) notRun.set("the emitted Rust does not build", (notRun.get("the emitted Rust does not build") ?? 0) + 1)
      else if ("notRun" in plan) notRun.set(plan.notRun, (notRun.get(plan.notRun) ?? 0) + 1)
      else {
        const result = await edgeVerdict(exe, pou, plan)
        edge = result.verdict
        if (result.first !== undefined) disagreements.set(t.name, result.first)
      }
      rmSync(exe, { force: true })
      rmSync(exe.replace(/\.exe$/, ".pdb"), { force: true })

      const shape = emissionShape(code)
      shape.constructs.forEach((id, k) => constructs.set(id, shape.lines[k]!))
      const diverges = divergesOf(t.name)
      rows.set(t.name, {
        evidence,
        tier: tierOf(pou, t.pouName),
        rust: correctnessOf(t.name, evidence, built, [source, ...gvls.map((g) => g.source)].join("\n")),
        ...(found.length > 0 ? { lints: [...new Set(found.map((f) => f.code))].sort() } : {}),
        pedantic: pedantic.length,
        edge,
        size: sizeRatio(code, source, gvls),
        shape: shape.shape,
        ...notesOf(shape.constructs),
        ...(diverges === undefined ? {} : { diverges }),
      })
    }
  }),
)
rmSync(dir, { recursive: true, force: true })

// AN EMITTED PROGRAM THAT DOES NOT COMPILE, for ST the vendor ACCEPTS, is an emitter defect — and outside the value
// pass (which reaches only the fixtures that have recorded values) nothing was watching for one.
if (rejected.size > 0)
  throw new Error(
    `the emitted Rust does not compile for ${rejected.size} fixture(s) whose ST CODESYS accepts:\n` +
      [...rejected].map(([name, why]) => `  ${name}\n${why}`).join("\n"),
  )

// AN ALLOW-LIST ENTRY THAT EXCUSES NOTHING IS DECORATION, and until the allow moved out of the `-A` flags into the
// parser nothing could tell: a lint the compiler was told to allow never reaches the output either way. Two of them
// were exactly that. Refusing here is the only place with the measurement to refuse on.
const dead = Object.keys(ALLOWED).filter((lint) => (excused.get(lint) ?? 0) === 0)
if (dead.length > 0)
  throw new Error(
    `these allowed lints excused nothing across all ${rows.size} fixtures: ${dead.join(", ")}. An entry that ` +
      "excuses nothing outlives the emission it was written for and nobody can tell — delete it, or name the " +
      "fixture that still produces it.",
  )

// THE SAME REFUSAL FOR A NOTE: a judgement about a construct no fixture emits any more is a note about nothing, and
// it would sit in `NOTES` looking like open work. Delete it, or re-key it to the construct that replaced it.
const orphaned = deadNotes(new Set(constructs.keys()))
if (orphaned.length > 0)
  throw new Error(`these NOTES name a construct no fixture emits any more: ${orphaned.join(", ")}`)

const evidenceTally = new Map<Evidence, number>()
const tierTally = new Map<string, { total: number; clean: number }>()
const lintTally = new Map<string, number>()
const edgeTally = new Map<EdgeVerdict, number>()
const shapes = new Set<string>()
const sizes: [string, number][] = []
let improvable = 0
let withAlternatives = 0
for (const [name, row] of rows) {
  evidenceTally.set(row.evidence, (evidenceTally.get(row.evidence) ?? 0) + 1)
  if (row.tier !== undefined) {
    const t = tierTally.get(row.tier) ?? { total: 0, clean: 0 }
    tierTally.set(row.tier, { total: t.total + 1, clean: t.clean + (row.lints === undefined ? 1 : 0) })
  }
  for (const lint of row.lints ?? []) lintTally.set(lint, (lintTally.get(lint) ?? 0) + 1)
  if (row.edge !== undefined) edgeTally.set(row.edge, (edgeTally.get(row.edge) ?? 0) + 1)
  if (row.shape !== undefined) shapes.add(row.shape)
  if (row.size !== undefined) sizes.push([name, row.size])
  if (row.notes !== undefined) improvable++
  if (row.notes?.some((id) => (NOTES[id]!.alternatives ?? []).length > 0)) withAlternatives++
}
// by value, then by name on a tie: the Maps take their order from racing compile lanes, and `--check` compares bytes
const ranked = <K extends string>(m: ReadonlyMap<K, number>): [K, number][] =>
  [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
sizes.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
const median = [...sizes].map(([, s]) => s).sort((a, b) => a - b)[Math.floor(sizes.length / 2)] ?? 0
const pedanticTotal = [...pedanticTally.values()].reduce((a, b) => a + b, 0)

const lines = [...rows].sort((a, b) => a[0].localeCompare(b[0])).map(([name, row]) => printRow(name, row))
const text = `/**
 * GENERATED by \`bun run rate:fixtures\` — do not edit.
 *
 * One row per fixture: how well it is EVIDENCED, what its ST lowers to, which oracle reached the emitted Rust, and
 * what the Rust linter still says about that Rust. \`fixtures/index.ts\` merges this onto every fixture, so
 * \`t.evidence\` and \`t.transpile\` are populated whether the fixture is a literal object or built by a factory;
 * \`fixtures.test.ts\` recomputes all of it and fails if anything here is stale.
 *
 * \`support/evidence.ts\` defines the evidence ratings; \`support/transpile-confidence.ts\` defines the tier, the
 * oracle, the lint policy — including the reason each allowed lint is Volt's own answer rather than a defect —, the
 * shape, the edge differential, and the review's \`NOTES\` — authored there, and copied in full to the END of this
 * file, so the construct ids in a row's \`notes\` resolve to their text here.
 *
 * At the last regeneration:
 *
 *   evidence
${EVIDENCE_ORDER.filter((r) => (evidenceTally.get(r) ?? 0) > 0)
  .map((r) => ` *     ${r.padEnd(12)} ${String(evidenceTally.get(r)).padStart(5)}`)
  .join("\n")}
 *
 *   tier                     lowered    clean
${TIERS.filter((t) => tierTally.has(t))
  .map((t) => {
    const { total, clean } = tierTally.get(t)!
    return ` *     ${t.padEnd(20)} ${String(total).padStart(6)} ${String(clean).padStart(8)}`
  })
  .join("\n")}
 *
 *   surviving lints (a lint listed here is work, not policy — ${Object.keys(ALLOWED).length} allowed ones are named with their reasons)
${
  lintTally.size === 0
    ? " *     none"
    : ranked(lintTally)
        .map(([lint, n]) => ` *     ${lint.padEnd(38)} ${String(n).padStart(5)}`)
        .join("\n")
}
 *
 *   allowed, and how many fixtures each one still excuses — \`support/transpile-confidence.ts\` holds the reason
 *   each is Volt's own answer rather than a defect. A count could never reach zero: the generator refuses to write.
${ranked(excused)
  .map(([lint, n]) => ` *     ${lint.padEnd(38)} ${String(n).padStart(5)}`)
  .join("\n")}
 *
 *   edge — the interpreter against the compiled Rust on inputs nobody recorded (type extremes, 0, ±1, NaN, ±inf,
 *   empty and full strings), one variable at a time. Agreement is not correctness: both run one IR.
${(["agree", "disagree", "not-run"] as const)
  .map((v) => ` *     ${v.padEnd(12)} ${String(edgeTally.get(v) ?? 0).padStart(5)}`)
  .join("\n")}
${ranked(notRun)
  .map(([why, n]) => ` *       not-run: ${why.padEnd(44)} ${String(n).padStart(5)}`)
  .join("\n")}
${[...disagreements]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([name, first]) => ` *       disagree: ${name} — ${first}`.slice(0, 116))
  .join("\n")}
 *
 *   pedantic — ${pedanticTotal} clippy::pedantic + clippy::perf findings; the ten most frequent
${ranked(pedanticTally)
  .slice(0, 10)
  .map(([lint, n]) => ` *     ${lint.padEnd(38)} ${String(n).padStart(6)}`)
  .join("\n")}
 *
 *   size — emitted Rust lines per ST line, the string prelude not counted: median ${median}; the ten largest
${sizes
  .slice(0, 10)
  .map(([name, s]) => ` *     ${name.padEnd(44)} ${String(s).padStart(5)}`)
  .join("\n")}
 *
 *   shape — ${shapes.size} distinct emission shapes over ${sizes.length} lowered fixtures, ${constructs.size} distinct constructs.
 *   ${Object.keys(NOTES).length} constructs carry a review note (\`NOTES\`): ${improvable} fixtures are improvable, ${withAlternatives} touch a construct with alternatives.
 *   Each row's \`notes\` names its noted constructs; their texts are the \`NOTES\` section at the end of this file.
 */
import type { FixtureMapRow, ShapeNote } from "../support/transpile-confidence.js"

export const FIXTURE_MAP: Readonly<Record<string, FixtureMapRow>> = {
${lines.join("\n")}
}
${renderNotes(NOTES, constructs)}`

const before = (() => {
  try {
    return readFileSync(OUT, "utf8")
  } catch {
    return ""
  }
})()

const seconds = Math.round((performance.now() - started) / 1000)

if (check) {
  if (before === text) {
    console.log(`the fixture map is current for ${rows.size} fixtures (${seconds}s)`)
    process.exit(0)
  }
  console.log("map.generated.ts is STALE — run `bun run rate:fixtures`")
  process.exit(1)
}

writeFileSync(OUT, text)
console.log(`mapped ${rows.size} fixtures in ${seconds}s -> ${OUT}`)
for (const r of EVIDENCE_ORDER) if ((evidenceTally.get(r) ?? 0) > 0) console.log(`  ${r.padEnd(12)} ${evidenceTally.get(r)}`)
for (const t of TIERS) {
  const tier = tierTally.get(t)
  if (tier !== undefined) console.log(`  ${t.padEnd(12)} ${tier.total} lowered, ${tier.clean} clean`)
}
for (const v of ["agree", "disagree", "not-run"] as const) console.log(`  edge ${v.padEnd(9)} ${edgeTally.get(v) ?? 0}`)

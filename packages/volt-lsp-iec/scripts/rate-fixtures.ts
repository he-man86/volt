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
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ALL_TESTS } from "../test/conformance/fixtures/index.js"
import { assembleFixture } from "../test/conformance/support/fixture-units.js"
import { STANDARD_LIBRARY } from "../test/conformance/support/standard-library.js"
import { EVIDENCE_ORDER, rateFixture, type Evidence } from "../test/conformance/support/evidence.js"
import {
  ALLOWED,
  LINT_FLAGS,
  TIERS,
  assertPolicy,
  divergesOf,
  excusedFindings,
  printRow,
  transpileHalf,
  type FixtureMapRow,
} from "../test/conformance/support/transpile-confidence.js"
import { CLIPPY } from "../test/conformance/support/rustc.js"
import { emitRust, lowerSource } from "../src/transpile/index.js"

const OUT = join(import.meta.dir, "..", "test", "conformance", "fixtures", "map.generated.ts")
const check = process.argv.includes("--check")

assertPolicy()

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
      let pou
      try {
        const { source, gvls } = assembleFixture(t, ALL_TESTS)
        pou = lowerSource(source, "PLC_PRG", [...STANDARD_LIBRARY, ...gvls]).pou
      } catch {
        pou = undefined // a THROW is a defect `rateFixture` already reports as `diverges`; there is no Rust to rate
      }
      if (pou === undefined) {
        rows.set(t.name, { evidence, ...(divergesOf(t.name) === undefined ? {} : { diverges: divergesOf(t.name) }) })
        continue
      }
      const code = emitRust(pou).code
      const file = join(dir, `${t.name}.rs`)
      await Bun.write(file, `${code}\nfn main() {}\n`)
      const build = Bun.spawn([clippy, "--edition", "2021", "--emit", "metadata", "-o", `${file}.meta`, file, ...LINT_FLAGS], {
        stderr: "pipe",
        stdout: "pipe",
      })
      await build.exited
      const stderr = await new Response(build.stderr).text()
      for (const lint of excusedFindings(stderr, code.split("\n").length)) excused.set(lint, (excused.get(lint) ?? 0) + 1)
      const diverges = divergesOf(t.name)
      rows.set(t.name, {
        evidence,
        ...transpileHalf(t, evidence, pou, stderr, code.split("\n").length),
        ...(diverges === undefined ? {} : { diverges }),
      })
    }
  }),
)
rmSync(dir, { recursive: true, force: true })

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

const evidenceTally = new Map<Evidence, number>()
const tierTally = new Map<string, { total: number; clean: number }>()
const lintTally = new Map<string, number>()
for (const row of rows.values()) {
  evidenceTally.set(row.evidence, (evidenceTally.get(row.evidence) ?? 0) + 1)
  if (row.tier !== undefined) {
    const t = tierTally.get(row.tier) ?? { total: 0, clean: 0 }
    tierTally.set(row.tier, { total: t.total + 1, clean: t.clean + (row.lints === undefined ? 1 : 0) })
  }
  for (const lint of row.lints ?? []) lintTally.set(lint, (lintTally.get(lint) ?? 0) + 1)
}

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
 * oracle and the lint policy — including the reason each allowed lint is Volt's own answer rather than a defect.
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
    : [...lintTally]
        .sort((a, b) => b[1] - a[1])
        .map(([lint, n]) => ` *     ${lint.padEnd(38)} ${String(n).padStart(5)}`)
        .join("\n")
}
 *
 *   allowed, and how many fixtures each one still excuses — \`support/transpile-confidence.ts\` holds the reason
 *   each is Volt's own answer rather than a defect. A count could never reach zero: the generator refuses to write.
${[...excused]
  .sort((a, b) => b[1] - a[1])
  .map(([lint, n]) => ` *     ${lint.padEnd(38)} ${String(n).padStart(5)}`)
  .join("\n")}
 */
import type { FixtureMapRow } from "../support/transpile-confidence.js"

export const FIXTURE_MAP: Readonly<Record<string, FixtureMapRow>> = {
${lines.join("\n")}
}
`

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

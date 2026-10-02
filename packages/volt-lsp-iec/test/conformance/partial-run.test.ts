/**
 * A `VOLT_FIXTURES` run (`support/selection.ts`) answers what the full run answers for the fixtures it names — or it is
 * a green that means nothing. The part that can drift is not the per-fixture rows (they walk `SELECTION.selected`, so a
 * named fixture gets exactly the full run's row): it is a PROJECT-WIDE row. Written as a plain `test()` over `rated()` or
 * `SELECTION.selected` rather than as `whole()`, a total quietly shrinks to the selection — `rated("diverges").length`
 * is 0 against its ceiling — and a partial run passes what the full run fails, with nothing red.
 *
 * So this runs `fixtures.test.ts` partially, one fixture per rating, and holds what it executed:
 *   - every test passes (an expected failure passes; a skip is not a pass and is held below);
 *   - each named fixture gets its rating's row, under that rating's describe;
 *   - every other EXECUTED test is one of `SCOPED` — the rows whose assertion is a list of offenders among the selected
 *     fixtures (so the same verdict the full run gives them), or pure helpers that read no fixture at all. A new row
 *     that is neither fails here by title: make it `whole()`, or scope it to `SELECTION` and add it to `SCOPED`.
 * The full-run comparison itself (titles + verdicts equal for the named fixtures) was measured once, 2026-10-02, by
 * JUnit diff; a full run costs ~8 min, so this holds the classification that keeps it true instead.
 */
import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** One fixture per rating — `fixtures/map.generated.ts` is where each one's rating is read. `unaskable` has no
 *  per-fixture row (its one row checks each selected fixture says why), so it is `null` here. */
const NAMED: Record<string, string | null> = {
  bit_or_bool: "confirmed",
  accepts_output_into_other_type: "refused",
  addr_bit_inside_byte: "not-lowered",
  decl_bracket_init_no_assign_fb: "lsp-gap",
  decl_subrange_unsigned: "diverges",
  cc_vg_jump_in_disabled_network: null, // unaskable
}

/** `describe > title` of every executed row that names no fixture. Each is scoped to the selection or reads none. */
const SCOPED = [
  "confirmed — the same values out of the emitted Rust > every case's lints are exactly what its stored row carries",
  "confirmed — the same values out of the emitted Rust > every case's pedantic count and edge verdict are what its stored row carries",
  "the rest of the lowered fixtures — the emitted Rust builds, or says why not > a fixture whose ST CODESYS accepts emits Rust that compiles",
  "the rest of the lowered fixtures — the emitted Rust builds, or says why not > the stored oracle matches what the compiler actually did",
  "the rest of the lowered fixtures — the emitted Rust builds, or says why not > every case's lints are exactly what its stored row carries",
  "the rest of the lowered fixtures — the emitted Rust builds, or says why not > every case's pedantic count and edge verdict are what its stored row carries",
  "not-lowered — the vendor runs it and lowering refuses > every refusal is a registered code",
  "diverges — measured, and run as an expected failure > an unproven row is one the Rust pass did not reach this run",
  "diverges — measured, and run as an expected failure > each names what was measured",
  "lsp-gap — a refusal the LSP does not make yet > each is either written down on the fixture or a known measured silence",
  "unaskable — the oracle cannot ask it > each says why, in execSkip or recorderSkip",
  " > no fixture the BUILD recording compiled was refused by the simulator",
  "the map's measured columns — the pure halves > a line normalizes to its construct: identifiers, literals and temporaries are erased, types are kept",
  "the map's measured columns — the pure halves > a construct's id is the review's id for the same line",
  "the map's measured columns — the pure halves > a fixture's shape is its constructs in order — renaming is invisible, reordering is not",
  "the map's measured columns — the pure halves > the prelude is not the fixture's construct",
  "the map's measured columns — the pure halves > a fixture's constructs come with their normalized lines, one per id",
  "the map's measured columns — the pure halves > a row's notes are the ids of its noted constructs, deduplicated and sorted",
  "the map's measured columns — the pure halves > the map's NOTES section renders every note's full text under its construct line, by id",
  "the map's measured columns — the pure halves > size counts emitted lines per ST line, the prelude and blank lines excluded",
  "the map's measured columns — the pure halves > the edge inputs of an integer are its extremes, zero, one and minus one",
  "the map's measured columns — the pure halves > the edge inputs of a REAL reach NaN, both infinities, both zeros and the largest finite value",
  "the map's measured columns — the pure halves > a program that reaches the platform's libm is not an edge question the repo can answer",
  "the map's measured columns — the pure halves > the edge inputs of a string are empty and full; of a BOOL both values",
  "the table is total > every fixture carries a rating this file has a row for",
  "the table is total > the stored rating on every fixture matches the computed one",
  "the table is total > the stored tier and oracle on every fixture match the computed ones",
  "the table is total > the stored shape, size and notes on every fixture, and the map's NOTES section, match the computed ones",
  "the table is total > every allowed lint states the reason it is Volt's answer rather than a defect",
  "the table is total > the ratings with no row say why",
  "the LSP against twincat's recorded build > emits NO false positives (every LSP message is a real IDE message)",
  "the LSP against twincat's recorded build > every known divergence still diverges (a marked fixture that agrees must lose its mark)",
  "the LSP against codesys's recorded build > emits NO false positives (every LSP message is a real IDE message)",
  "the LSP against codesys's recorded build > every known divergence still diverges (a marked fixture that agrees must lose its mark)",
  " > the LSP emits NO error on a fixture the simulator built and executed",
].sort()

interface Case {
  name: string
  describe: string
  verdict: "pass" | "skip" | "fail"
}

const unescape = (s: string) =>
  s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")

function parseJunit(xml: string): Case[] {
  const cases: Case[] = []
  const re = /<testcase name="([^"]*)" classname="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g
  for (const m of xml.matchAll(re)) {
    const body = m[4] ?? ""
    const verdict = /<failure|<error/.test(body) ? "fail" : /<skipped/.test(body) ? "skip" : "pass"
    cases.push({ name: unescape(m[1]), describe: unescape(m[2]), verdict })
  }
  return cases
}

describe("a VOLT_FIXTURES run answers what the full run answers for the fixtures it names", () => {
  test("one fixture per rating: each gets its row, everything executed passes, and every other row is scoped", async () => {
    const dir = await mkdtemp(join(tmpdir(), "volt-partial-run-"))
    try {
      const out = join(dir, "junit.xml")
      const env: Record<string, string | undefined> = { ...process.env, VOLT_FIXTURES: Object.keys(NAMED).join(",") }
      // The child is a partial run on purpose; the refusal it would meet in CI guards a GATE, not this probe.
      delete env.CI
      delete env.VOLT_REQUIRE_FULL
      const child = Bun.spawn(
        ["bun", "test", "test/conformance/fixtures.test.ts", "--reporter=junit", `--reporter-outfile=${out}`],
        { cwd: join(import.meta.dir, "..", ".."), env, stdout: "pipe", stderr: "pipe" },
      )
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
      const cases = parseJunit(await readFile(out, "utf8"))
      expect(cases.length, stderr.slice(-4000)).toBeGreaterThan(0)

      expect(cases.filter((c) => c.verdict === "fail").map((c) => `${c.describe} > ${c.name}`)).toEqual([])
      expect(code, stderr.slice(-4000)).toBe(0)

      const fixtureOf = (c: Case) => Object.keys(NAMED).find((n) => c.name === n || c.name.startsWith(`${n} — `))
      for (const [name, rating] of Object.entries(NAMED))
        if (rating !== null)
          expect(
            cases.some((c) => fixtureOf(c) === name && c.describe.startsWith(`${rating} — `)),
            `${name} has no row under "${rating} — …"`,
          ).toBe(true)

      const executed = cases
        .filter((c) => c.verdict === "pass" && fixtureOf(c) === undefined)
        .map((c) => `${c.describe} > ${c.name}`)
        .sort()
      expect(executed).toEqual(SCOPED)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)
})

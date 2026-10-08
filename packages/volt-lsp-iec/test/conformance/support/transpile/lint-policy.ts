/**
 * The LINT POLICY: what the Rust linter says about a fixture's emitted Rust, after an allow-list that names its own
 * reasons (ALLOWED), and the pedantic count (split out of the confidence module, transpile-restructure 1.8.3).
 */
import { CLIPPY } from "../rustc.js"

// ── the lint policy ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * A LINT VOLT ACCEPTS AS ITS OWN ANSWER, and why. Everything not named here is a finding recorded against the
 * fixture that produces it.
 *
 * The reason is the point. An allow-list of bare lint names is how this decays into decoration — the entry outlives
 * the emission it excused and nobody can tell. `assertPolicy` refuses an entry with an empty reason, so the only
 * way to add one is to say what it is for.
 */
export const ALLOWED: Readonly<Record<string, string>> = {
  dead_code:
    "a fixture reads one variable and the rest of the POU it declares is unreferenced by construction — the same exception the crate check makes",
  unreachable_code:
    "a statement after RETURN or EXIT is a real ST program CODESYS compiles (`stmt_return_midway`, `stmt_exit_inner` exist to ask what it does), and Rust is right that the line cannot run",
  unused_comparisons:
    "a FOR bound AT its type's maximum is a comparison rustc can prove (`for_at_type_max`: `i <= 127i8`) — the comparison is necessary and the loop needs it",
  "clippy::absurd_extreme_comparisons":
    "the same `for_at_type_max` bound, under clippy's name for it: the loop test prints as the FLIPPED comparison (`i > 127i8`) since that pass, and clippy reads the flipped form where rustc read the original",
  // NO `non_camel_case_types` / `non_snake_case` HERE. Both were written from reasoning — a POU struct keeps the
  // ST spelling, a field may not be snake by Rust's rule — and neither fires: the emitter already carries
  // `#[allow(non_camel_case_types)]` on every struct, and `snake()` makes every field name valid. Measured over
  // all 2,295 lowered fixtures, both excused nothing. An entry that excuses nothing is the decoration this block
  // warns about, and the generator now refuses to write a map while one exists.
  "clippy::self_assignment":
    "the ST says `n := n`. `cc3_empty_and_noop` asks what a no-op assignment does, and every `cfold_*` fixture uses one to give the recorder a statement to read — the emission is faithful and the lint is about the fixture, not the printer",

  // ── the fixture asks exactly this. Each names the fixture whose ST produced it; without one, it is a defect. ──
  "clippy::eq_op":
    "the ST computes a value FROM a variable and itself, on purpose: `realovf_divide_by_computed_zero` needs a zero the constant folder cannot see (`zero := num - num`), and `mathdom_ln_zero` needs one for `LN(0)`",
  "clippy::approx_constant":
    "the fixture's own literal. `narrowing_lreal_to_real` declares `3.14159265358979` to ask what survives LREAL → REAL, and `fmt_lreal_many_decimals` multiplies by `3.14159265` to ask how many digits LREAL_TO_STRING prints",
  "clippy::unnecessary_min_or_max":
    "`max_min_basic` and `max_extensible` put LITERALS through MIN/MAX to ask what the operators do with them, so the chain folds; the emission is faithful. `limit_inverted_bounds` asks what LIMIT answers when MN > MX, so `(-5i64).max(100).min(0)` IS the question — CODESYS answers MX, and `limit` prints MIN(MAX(…)) for exactly that reason",
  "clippy::manual_clamp":
    "NOT `clamp`, deliberately and with a measurement behind it: Rust's `clamp` PANICS when MN > MX and CODESYS answers MX (`limit_inverted_bounds`). `MIN(MAX(IN, MN), MX)` is the measured behaviour — see the comment at the `limit` case in `emit.ts`",
  "clippy::never_loop":
    "`stmt_exit_inner` is a FOR whose body is a bare EXIT — the fixture exists to ask what EXIT does to an inner loop, so a loop that runs once is the question rather than a defect",
  "clippy::manual_range_patterns":
    "a CASE arm's labels print as the ST wrote them. `xo2_case_ranges_over_enum` has both `1..3` and `4, 5, 6`, and they emit as `1..=3` and `4 | 5 | 6`; collapsing the second would make the Rust say something the source did not",
}

/** Fails on an allow-list entry with no reason — the only thing that keeps the policy from decaying into a list. */
export function assertPolicy(): void {
  const bare = Object.entries(ALLOWED).filter(([, reason]) => reason.trim() === "")
  if (bare.length > 0) throw new Error(`allowed lints with no reason: ${bare.map(([lint]) => lint).join(", ")}`)
}

/**
 * The flags that make a build REPORT every lint instead of failing on it. Lint levels are last-wins, so the
 * allow-list comes after the two groups it carves out of.
 *
 * THIS USED TO BE `-D warnings`, and denying is what a compile pass with no map wants: a new warning fails the
 * build the moment it appears. It cannot work here, for a reason worth writing down — `-D` makes the diagnostic
 * `level: "error"`, so a findings parser looking for warnings sees NOTHING and every row is written clean while
 * the build fails for a reason the row does not record. Measured: 2,295 fixtures, all reported clean, 0 lints.
 *
 * The strength is not lost, it MOVES: the ratchet in `transpile-replay.test.ts` fails when a fixture reports a lint its
 * stored row does not carry, which is the same guarantee per fixture and covers clippy's lints too, where
 * `-D warnings` only ever covered rustc's. A real compile ERROR still fails the build — it is not a lint.
 */
export const LINT_FLAGS: readonly string[] = [
  "-W", "warnings", "-W", "clippy::all",
  // COUNTED, not listed: `splitFindings` takes these out of `lints` into the row's `pedantic` number (`pedanticGroups`)
  "-W", "clippy::pedantic", "-W", "clippy::perf",
  "--error-format=json",
]

/**
 * THE ARGV BOTH PRODUCERS BUILD, so the `built` flag the generator writes into a row means what the gate asserts.
 *
 * They diverged: the generator omitted `-F unsafe_code` entirely, so it decided `compiles` vs `rejected` under a
 * weaker configuration than the gate enforces — a fixture emitting `unsafe` would have been written `compiles` and
 * then failed "the stored oracle matches what the compiler actually did" forever, with the two never agreeing.
 *
 * `out` decides the one thing they may still differ on: the value pass links a real executable because it RUNS it,
 * and everything else stops at `--emit metadata`. That is a deliberate difference and it is the only one.
 */
export function buildArgv(compiler: string, file: string, out: { exe: string } | { metadata: string }): string[] {
  const emit = "exe" in out ? ["-o", out.exe] : ["--emit", "metadata", "-o", out.metadata]
  // ST has no dynamic memory, so the Rust needs no `unsafe` — forbidden, so a case needing it fails rather than builds
  return [compiler, "--edition", "2021", ...LINT_FLAGS, "-F", "unsafe_code", ...emit, file]
}

/**
 * THE ALLOW-LIST IS APPLIED IN THE PARSER, NOT AS `-A` FLAGS. It was flags, which is the obvious way and made the
 * policy unfalsifiable: a lint the compiler was told to allow never reaches the output, so an entry that excuses
 * NOTHING looks exactly like one doing its job. Two of them were (`non_camel_case_types`, `non_snake_case`),
 * written from reasoning and never produced by any of the 2,295 lowered fixtures.
 *
 * Reading every warning and splitting it here costs nothing — the build already emits JSON — and it gives
 * `splitFindings` its `excused` half, so the generator can refuse to write a map while an entry excuses nothing.
 */

/** One finding on a fixture's emitted Rust. */
export interface Finding {
  code: string
  line: number
}

/** One diagnostic, as `--error-format=json` writes it. */
interface Diagnostic {
  level?: string
  code?: { code?: string }
  spans?: { line_start?: number; is_primary?: boolean }[]
}

/**
 * WHERE A DIAGNOSTIC IS — the span flagged `is_primary`, NOT `spans[0]`.
 *
 * rustc does not guarantee the primary span comes first, and the line decides whether a finding belongs to the
 * EMITTED code or to the `main` the caller appended. Read off `spans[0]`, a lint whose first span is a secondary
 * one inside that `main` is computed past `emittedLines` and silently dropped from the fixture's row, and the
 * inverse is recorded against the emitter. The same index feeds the dead-allow-list-entry refusal.
 */
function lineOf(d: Diagnostic): number {
  return (d.spans?.find((s) => s.is_primary === true) ?? d.spans?.[0])?.line_start ?? 0
}

/**
 * The findings in a `--error-format=json` stderr, minus the policy. A parser over the compiler's own output rather
 * than over its rendered text, because the rendered form wraps and a lint name can land mid-line.
/**
 * Every lint on a fixture's emitted code, split by the policy — ONE pass over the compiler's JSON.
 *
 * `found` is what is recorded against the fixture; `excused` is what `ALLOWED` covered, counted so a dead entry is
 * visible (two of them were: `non_camel_case_types` and `non_snake_case`, written from reasoning and produced by
 * none of the 2,295 lowered fixtures). They were two functions running the same loop with inverted conditions,
 * so every fixture's stderr was split and JSON-parsed twice across 2,600 of them.
 *
 * FILTERED BY LINE, because both callers compile `emitRust(pou).code` plus a `main` of their own — the gate's
 * prints the recorded variables, the generator's is empty — and the gate's `println!` calls raise lints that are
 * the harness's, not the emitter's. That filter is what keeps the two producers measuring the same thing, which
 * is the whole reason a generated file can be checked at all.
 */
export function splitFindings(
  stderr: string,
  emittedLines: number,
): { found: Finding[]; excused: string[]; pedantic: string[] } {
  const found: Finding[] = []
  const excused: string[] = []
  /** Every finding in clippy's `pedantic` or `perf` group, once per occurrence — the row's `pedantic` count. */
  const pedantic: string[] = []
  const groups = pedanticGroups()
  for (const raw of stderr.split("\n")) {
    if (!raw.startsWith("{")) continue
    let parsed: Diagnostic
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue // a line that is not one JSON diagnostic carries no finding; a real error arrives on its own
    }
    const code = parsed.code?.code
    if (parsed.level !== "warning" || code === undefined) continue
    const line = lineOf(parsed)
    if (line <= 0 || line > emittedLines) continue
    const group = groups.get(code)
    if (group !== undefined) pedantic.push(code)
    // a `pedantic` lint is not in `clippy::all`, so it is not `lints`' business; a `perf` one is, and stays
    if (group === "pedantic") continue
    if (code in ALLOWED) excused.push(code)
    else found.push({ code, line })
  }
  return { found, excused, pedantic }
}

/** A `--error-format=json` stderr as a human would read it — the `rendered` field each diagnostic already carries. */
export function rendered(stderr: string): string {
  const parts: string[] = []
  for (const raw of stderr.split("\n")) {
    if (!raw.startsWith("{")) {
      if (raw.trim() !== "") parts.push(raw)
      continue
    }
    try {
      const parsed = JSON.parse(raw) as { rendered?: string; level?: string }
      if (parsed.level !== "warning" && typeof parsed.rendered === "string") parts.push(parsed.rendered)
    } catch {
      parts.push(raw)
    }
  }
  return parts.join("\n")
}

// ── the pedantic count ───────────────────────────────────────────────────────────────────────────────────────

/**
 * WHICH LINTS COUNT AS PEDANTIC — clippy's own `pedantic` and `perf` groups, read off the linter that runs.
 *
 * A compiler diagnostic names its lint (`clippy::cast_lossless`) and not its group, so the membership has to come
 * from somewhere, and a list typed out here would be one clippy release away from wrong. `clippy-driver -W help`
 * prints every group with its members; that is the same binary whose findings are being classified, so the two
 * cannot disagree. `perf` is part of `clippy::all` already — its findings stay in `lints` too, and are counted
 * here as well, because the question this column answers is "what would a Rust engineer still change".
 *
 * Empty only when there is no `clippy-driver`, and then nothing reads it: every lint check is skipped by
 * `skipLintCheck`, which is loud about it, and the generator refuses to run at all.
 */
let lintGroups: ReadonlyMap<string, "pedantic" | "perf"> | undefined
export function pedanticGroups(): ReadonlyMap<string, "pedantic" | "perf"> {
  if (lintGroups !== undefined) return lintGroups
  const groups = new Map<string, "pedantic" | "perf">()
  if (CLIPPY !== null) {
    const help = Bun.spawnSync([CLIPPY, "-W", "help"], { stdout: "pipe", stderr: "pipe" }).stdout.toString()
    for (const line of help.split(/\r?\n/)) {
      const m = /^\s*clippy::(pedantic|perf)\s+(clippy::.+)$/.exec(line)
      if (m === null) continue
      for (const name of m[2]!.split(",")) groups.set(name.trim().replaceAll("-", "_"), m[1] as "pedantic" | "perf")
    }
    // NO SILENT ZERO. A help text this parser no longer reads would write `pedantic: 0` on every row — clean, and false.
    if (![...groups.values()].includes("pedantic") || ![...groups.values()].includes("perf"))
      throw new Error("`clippy-driver -W help` listed no clippy::pedantic or clippy::perf group — its format changed")
  }
  return (lintGroups = groups)
}

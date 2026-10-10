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
  // EVERY REASON BELOW was re-measured after the four models (transpile-restructure 7.11.3, 2026-10-10): its count is
  // the findings it excused over every lowered fixture, built as `rate:fixtures` builds them, and the fixtures it names
  // are the ones that produce it today. `unnecessary_min_or_max` and `manual_clamp` excused nothing any more and went
  // before this pass (the generator refuses an entry at 0).
  dead_code:
    "rustc's `dead_code` names a FIELD ASSIGNED TO ITSELF — 'useless assignment of field of type … to itself' — and that is the whole of it (42 findings in 42 fixtures): the same `x := x` statements `clippy::self_assignment` names below, in the `cfold_*`, `initseq_*`, `ir_initializer_warning_*` and `init_struct_field_*` fixtures and `cc3_empty_and_noop`. It used to be the fixture variables nobody reads; the harness reads them now, and the module prints only the runtime helpers the code calls (lean 1, 7.1.2). ONLY that message is excused (`ALLOWED_MESSAGE`): an unused generated fn, field or variant is found",
  unreachable_code:
    "a FOR whose body always leaves (`stmt_exit_inner`: an inner FOR whose body is EXIT) runs at most one pass, so its step cannot run — and printed without the step, nothing in the loop changes its counter, which is clippy's `while_immutable_condition`; the step is kept, in a plain block. Nothing after a RETURN, EXIT or CONTINUE is printed any more (lean 7.5.11), so this is the one line left (1 finding, 1 fixture)",
  unused_assignments:
    "the ST stores into a routine local a value nothing reads after it (7 findings in 5 fixtures) — `shadowing_method_local_shadows_fb_var` / `shadowing_method_param_shadows_member` increment the METHOD's own local or input and return, `var_temp_dynamic_init_method` zeroes its VAR_TEMPs on the way out, `pointer_null_copied_into_multi_target` and `pointer_deref_before_first_store` set a pointer they then overwrite: a dead store the source makes, printed as it is. The printer makes none of its own: since lean 7.7.2 no initial value nothing reads is printed (`emit/rust/locals.ts` `lateInit`)",
  unused_comparisons:
    "a FOR bound AT its type's maximum is a comparison rustc can prove (`for_at_type_max`, `for_counter_at_type_max`, `flw_for_byte_to_255`, `flw_for_usint_by_two_to_255`: `i <= 255u8`) — the loop needs it, it is what ends the loop; and a negative literal beside an unsigned operand IS that type's maximum, folded (`lt_literal_negative_in_comparison_unsigned`, `tr_6_negative_paren_beside_unsigned`: the fixture asks what that comparison answers) — 6 findings in 6 fixtures",
  "clippy::absurd_extreme_comparisons":
    "the same six comparisons under clippy's name for them: the loop test prints as the `while` condition itself (`i <= 255u8`) since lean 7.5.4, which clippy reads as always true, and the same folded negative literal beside an unsigned operand (6 findings in 6 fixtures)",
  // NO `non_camel_case_types` / `non_snake_case` HERE. Both were written from reasoning — a POU struct keeps the
  // ST spelling, a field may not be snake by Rust's rule — and neither fires: the emitter already carries
  // `#[allow(non_camel_case_types)]` on every struct, and `snake()` makes every field name valid. Measured over
  // all 2,295 lowered fixtures, both excused nothing. An entry that excuses nothing is the decoration this block
  // warns about, and the generator now refuses to write a map while one exists.
  "clippy::self_assignment":
    "the ST says `n := n` (42 findings in 42 fixtures). `cc3_empty_and_noop` asks what a no-op assignment does, and every `cfold_*`, `initseq_*`, `ir_initializer_warning_*` and `init_struct_field_*` fixture uses one to give the recorder a statement to read — the emission is faithful and the lint is about the fixture, not the printer. The review (note ea53989ac8, transpile-restructure 7.8.9) put it so: ST `x := x;` prints `self.copied = self.copied;`, clippy::self_assignment (a correctness-group lint) in initseq_member_of_struct and cc3_empty_and_noop; it could be dropped when target and source are the same side-effect-free place with no conversion — and is kept, because the statement is the fixture's question",

  // ── the fixture asks exactly this. Each names the fixture whose ST produced it; without one, it is a defect. ──
  "clippy::eq_op":
    "the ST computes a value FROM a variable and itself, on purpose (15 findings in 15 fixtures): `cmp_nan_self_*` compare a NaN with itself to ask what each comparison answers, and a zero the constant folder cannot see is `seed - seed` — `realovf_divide_by_computed_zero`, `cmp_negzero_eq_zero`, `mathdom_ln_zero` / `log` / `sqrt`, the `tr_46_exptdom_*` powers of zero and NaN",
  "clippy::approx_constant":
    "the fixture's own literal (6 findings in 6 fixtures): `narrowing_lreal_to_real` declares `3.14159265358979` to ask what survives LREAL → REAL, `fmt_lreal_many_decimals` multiplies by `3.14159265` to ask how many digits LREAL_TO_STRING prints, `op_math_ln` takes LN of `2.71828`, `op_math_trig` and `mathdom_tan_at_pole` evaluate at `1.5708` / π/2, and `op_arithmetic_int_plus_real` adds `3.14`",
  "clippy::never_loop":
    "`stmt_exit_inner` is a FOR whose body is a bare EXIT — the fixture exists to ask what EXIT does to an inner loop, so a loop that runs once is the question rather than a defect (1 finding, 1 fixture)",
  "clippy::too_many_arguments":
    "StringUtils' STRREPLACEA (`lib_stu_replace`, `lib_stu_replace_past_len`; 2 findings) declares SEVEN inputs, clippy's limit, two of them `POINTER TO STRING` cursors — and a cursor is two Rust parameters, its byte offset and the string it walks (a hidden in-out, model 2), so the fn takes nine. Collapsing the pair is a cursor type carrying its capacity, which the cursor model does not have; the extra parameters are the representation, not a defect (lean 7.7.12, measured after 7.7.8; 7.4.6 changed none of its parameters: they are integers and cursors, no STRING input)",
  "clippy::missing_panics_doc":
    "a generated fn that can stop the task — a call through a null interface, a METHOD reaching an in-out no call bound, a read through a pointer whose tag names no target — does it with `panic!(\"<the fault>\")` on the line that can fault, which IS the documentation: a `/// # Panics` block would say the same sentence again above the fn, two lines per fn over the emission (386 findings in 266 fixtures, measured 2026-10-10 at lean 7.7.13), for a doc no generated crate renders. The runtime's own helpers do carry `/// # Panics`, written once",
  "clippy::manual_range_patterns":
    "a CASE arm's labels print as the ST wrote them. `xo2_case_ranges_over_enum` has both `1..3` and `4, 5, 6`, and they emit as `1..=3` and `4 | 5 | 6`; collapsing the second would make the Rust say something the source did not (1 finding, 1 fixture)",
}

/**
 * The ONE message an ALLOWED lint excuses, where the lint names more than its reason does: rustc's `dead_code` is also
 * an unused fn, field or variant, which the reason above does not describe — that is FOUND (review of 7.11.3).
 */
export const ALLOWED_MESSAGE: Readonly<Record<string, RegExp>> = {
  dead_code: /^useless assignment of field of type `[^`]+` to itself$/,
}

/** Whether the policy excuses this diagnostic: its lint is ALLOWED, and its message the one `ALLOWED_MESSAGE` names. */
function allowed(code: string, message: string | undefined): boolean {
  const only = ALLOWED_MESSAGE[code]
  return code in ALLOWED && (only === undefined || only.test(message ?? ""))
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
  message?: string
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
    // a PEDANTIC lint ALLOWED with its reason is Volt's answer too: excused, and not counted (lean 7.7.13)
    if (group === "pedantic" && allowed(code, parsed.message)) {
      excused.push(code)
      continue
    }
    if (group !== undefined) pedantic.push(code)
    // a `pedantic` lint is not in `clippy::all`, so it is not `lints`' business; a `perf` one is, and stays
    if (group === "pedantic") continue
    if (allowed(code, parsed.message)) excused.push(code)
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

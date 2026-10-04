/**
 * WHAT A FIXTURE TRANSPILES TO, AND HOW MUCH THAT IS WORTH — the one implementation, used by the generator and by
 * the gate, exactly as `evidence.ts` is.
 *
 * `evidence` answers *how well is this fixture EVIDENCED* — whether the vendor was asked and whether we match. It
 * says nothing about the code that comes out, and for a long time nothing needed it to: the emitted Rust was an
 * oracle, and `fixtures.test.ts` compiled it with `-A unused_parens` under the reason "generated code is not read
 * for style". That stopped being true when `emit/rust/index.ts` declared an emitted SURFACE a user's harness reaches
 * into by name. Somebody reads it now.
 *
 * So this adds the second half, and keeps both halves MEASURED rather than judged:
 *
 *   `tier`         which band of the language the fixture's own body reaches — the simplest-first ladder.
 *   `correctness`  which oracle reached its emitted Rust.
 *   `lints`        what the Rust linter says about that Rust, after a policy that names its own reasons.
 *
 * There is no score. A number invites tuning; these three say where the evidence is and what is wrong with the
 * output, and all three are recomputed from the recordings and the compiler on every run.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CLOCK, isBit, LoopGuardError, run, rustAccess, type IrPou, type Runner } from "../../../src/transpile/index.js"
import { lex } from "../../../src/frontend/syntax/index.js"
import { STRING_PRELUDE } from "../../../src/transpile/emit/rust/prelude.js"
import type { Type } from "../../../src/frontend/types/index.js"
import { CODESYS_TRIAGE, KNOWN_DIVERGENCES, TWINCAT_TRIAGE } from "./divergences.js"
import { runPaths } from "./run-paths.js"
import { CLIPPY } from "./rustc.js"
import type { LanguageTest } from "../types.js"
import {
  type Correctness,
  type EdgeVerdict,
  type FixtureMapRow,
  type ShapeNote,
  type Tier,
} from "../fixtures/map-row.js"

/**
 * The highest band the fixture's OWN body reaches.
 *
 * NOT the whole program. Every FB fixture is assembled under a synthesized `PLC_PRG` that declares an instance and
 * calls it, so reading `pou.body` files 1,719 of the 1,935 fixtures under `call` — on a statement no fixture wrote,
 * which makes the ladder useless for deciding what is simple. Measured both ways: own-body gives 329 `decl`,
 * 1,324 `arith`, 54 `control`, 24 `aggregate`, 88 `call`, 116 `indirect`.
 */
export function tierOf(pou: IrPou, ownPouName: string): Tier {
  const seen = new Set<string>()
  const expr = (e: unknown): void => {
    if (e === null || typeof e !== "object") return
    const n = e as Record<string, unknown>
    if (typeof n.kind === "string") seen.add(n.kind)
    for (const k of ["left", "right", "value", "index", "operand", "tag", "of", "base", "cond", "call"]) expr(n[k])
    for (const k of ["args", "elements", "arms", "inputs", "inouts", "lent"])
      if (Array.isArray(n[k])) (n[k] as unknown[]).forEach(expr)
    place(n.place)
    place(n.instance) // an `invoke`'s receiver — a call through a pointer or an in-out is reached only here
  }
  const place = (p: unknown): void => {
    if (p === null || typeof p !== "object") return
    const n = p as Record<string, unknown>
    if (n.root !== undefined) seen.add("place-root")
    for (const step of (n.path ?? []) as Record<string, unknown>[]) {
      seen.add(`place-${String(step.kind)}`)
      expr(step.index)
    }
    place(n.guard) // a dereference guard is a place of its own, and it is what makes the access indirect
  }
  const stmt = (s: unknown): void => {
    if (s === null || typeof s !== "object") return
    const n = s as Record<string, unknown>
    if (typeof n.kind === "string") seen.add(`stmt-${n.kind}`)
    for (const k of ["value", "cond", "selector"]) expr(n[k])
    // A LOOP'S TEST IS `{ cond, atEnd }`, not an expression — it has no `kind`, and `cond` is not a key `expr`
    // recurses through, so `WHILE iface.Ready()` and `WHILE NOT w.3` contributed NOTHING and their fixtures were
    // filed `control` instead of `indirect`. The sweep walks these bands in order, so a mis-banded fixture is
    // worked in the wrong pass — in the one table whose stated purpose is to be measured rather than judged.
    expr((n.test as Record<string, unknown> | undefined)?.cond)
    place(n.target)
    for (const k of ["then", "else", "body", "init", "step", "arms", "args", "inputs", "inouts", "lent"])
      for (const x of (n[k] ?? []) as Record<string, unknown>[]) {
        if (typeof x?.kind === "string") stmt(x)
        else if (Array.isArray(x?.body)) (x.body as unknown[]).forEach(stmt)
      }
  }
  const up = ownPouName.toUpperCase()
  const mine = pou.layouts.filter((l) => l.name.toUpperCase() === up)
  if (mine.length > 0) {
    for (const l of mine) (l.body ?? []).forEach(stmt)
    for (const r of pou.routines) if ((r.fb ?? "").toUpperCase() === up) r.body.forEach(stmt)
  } else {
    pou.body.forEach(stmt)
    for (const r of pou.routines) if (r.fb === undefined) r.body.forEach(stmt)
  }
  const has = (...k: string[]): boolean => k.some((x) => seen.has(x))
  if (has("dispatch", "freeze", "copy", "place-bit", "place-root")) return "indirect"
  if (has("invoke", "stmt-call")) return "call"
  if (has("place-field", "place-index")) return "aggregate"
  if (has("stmt-if", "stmt-switch", "stmt-loop", "stmt-break", "stmt-continue", "stmt-return")) return "control"
  if (has("binary", "unary", "convert", "builtin")) return "arith"
  return "decl"
}

const RUNS = JSON.parse(readFileSync(join(import.meta.dirname, "..", "recordings", "codesys.run.json"), "utf8")).tests as Record<
  string,
  { error?: string; values?: Record<string, string> }
>

/**
 * `vendor` is the strong one and the only one that compares a VALUE: the "confirmed — the same values out of the
 * emitted Rust" block in `fixtures.test.ts` compiles this fixture, runs it and asserts the recording's own numbers.
 *
 * THERE IS NO `backends` VALUE, deliberately. `backends.test.ts` compares the interpreter against the Rust on a
 * deterministic SAMPLE of 120, which is a property of the suite rather than a fact about a fixture — writing it in
 * a per-fixture row would claim evidence that moves when `SAMPLE` moves.
 */
export function correctnessOf(name: string, evidence: string, built: boolean, source: string): Correctness {
  // BOTH ARGUMENTS ARE REQUIRED, and `built` has no default ON PURPOSE. `compiles` was once ASSUMED: the generator
  // ran the compiler and threw the exit code away, so every fixture that lowered was written `compiles` — six of
  // them wrongly, because their emitted Rust does not build (`i : INT := 1.5` emits `1.5i16`). A default of `true`
  // re-arms exactly that, silently, for the next caller who omits it.
  //
  // THE EVIDENCE IS PASSED IN TOO, rather than read off the fixture: the generator writes the map that
  // `fixtures/index.ts` merges, so inside it `t.transpile` is the PREVIOUS generation's and `t.evidence` is a
  // rating this run may be about to change. Reading either there is a read path into its own prior output.
  if (!built) return "rejected"
  const values = RUNS[name]?.values
  if (evidence !== "confirmed" || values === undefined) return "compiles"
  // A RECORDING OF NOTHING BUT DEFAULTS, FROM NOTHING BUT DEFAULTS, IS NOT A VALUE COMPARED. Every variable starts at its
  // type's default, so a body that computes the wrong thing over zeros — or nothing at all — reads the same: `b := -a`
  // with `a` at 0 answers 0 under any sign rule. 158 of the 1950 `vendor` rows were that (transpile-review 48, 36 `cc_`
  // rows). A default ANSWER from a non-default constant does discriminate — `LIMIT(100, 50, 0)` = 0 is the measured
  // "MX wins", a WHILE false on entry leaves 0 — and a `prim_default_*` fixture asks for exactly the default.
  if (!name.startsWith("prim_default_") && Object.values(values).every((v) => DEFAULT_VALUE.test(v)) && constantsAreDefaults(source))
    return "compiles"
  return "vendor"
}

/** A recorded value that is its type's default: a zero of any type, FALSE, an empty string, the epoch, midnight. */
const DEFAULT_VALUE =
  /^(?:[A-Z_]+#0(?:ms|ns|us)?|FALSE|''|""|L?DATE#1970-1-1|L?(?:DATE_AND_TIME|DT)#1970-1-1-0:0:0|L?(?:TIME_OF_DAY|TOD)#0:0:0)$/

/** True when no constant in the program is anything but a default — no non-zero number, no TRUE, no non-empty string,
 *  no non-zero duration or date. Comments and pragmas are not inputs. */
function constantsAreDefaults(source: string): boolean {
  for (const t of lex(source, "codesys")) { // the transpiler's input is CODESYS ST
    if (t.kind === "keyword" && t.keyword === "TRUE") return false
    if (t.kind === "string_lit" || t.kind === "wstring_lit") {
      if (t.text.length > 2) return false
      continue
    }
    if (!LITERALS.has(t.kind)) continue
    const value = t.text.slice(t.text.lastIndexOf("#") + 1).replace(/_/g, "")
    if (!/^[0.]+(?:e[+-]?\d+)?(?:ms|s|ns|us|m|h|d)?$/i.test(value)) return false
  }
  return true
}
const LITERALS: ReadonlySet<string> = new Set(["int_lit", "real_lit", "typed_lit", "time_lit", "date_lit", "tod_lit", "datetime_lit"])

/**
 * A fixture whose emitted Rust the compiler REJECTS, and whose ST the vendor accepts. That is an emitter defect:
 * the transpiler's input contract is "code CODESYS compiles" (`src/transpile/index.ts`), so inside the contract the
 * Rust has to build. Outside it — `refused`, `lsp-gap` — lowering is only total, not meaningful, and a rejected
 * emission is the honest outcome rather than a bug.
 *
 * `diverges` is the defect ALREADY WRITTEN DOWN: the fixture carries `deferred.transpile` naming what was measured
 * (a transpile-review task whose red fixture landed before its fix), and its row reads `rust: "rejected"`. Refusing
 * to write the map over it would make the red fixture impossible to land ahead of the fix.
 */
export function rejectionIsADefect(evidence: string): boolean {
  return evidence !== "refused" && evidence !== "lsp-gap" && evidence !== "diverges"
}

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
 * The strength is not lost, it MOVES: the ratchet in `fixtures.test.ts` fails when a fixture reports a lint its
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

// ── the emission shape ───────────────────────────────────────────────────────────────────────────────────────

/**
 * WHAT A FIXTURE'S EMITTED RUST LOOKS LIKE, with everything that is the FIXTURE'S rather than the EMITTER'S taken out
 * — the normalization the overnight review (transpile-review-2026-09-29) clustered 2,333 emissions with, moved here
 * verbatim so its ids are reproducible and the review's notes stay keyed to something that exists.
 *
 * One emitted line is one CONSTRUCT: identifiers become `x` (a variable), `f` (a field), `m(` (a call) or `T` (a
 * type); literals become `L` KEEPING their type suffix (an `i16` store and a `u8` store are different emissions);
 * string literals `S`/`B`; generated temporaries and loop labels `_N`; a run of identical list items `…`. Rust's own
 * words, the prelude's API and the emitter's fixed names are kept — they are the shape.
 */
const KEEP = new Set(
  (
    "as break const continue else enum false fn for if impl in let loop match mod move mut pub ref return self Self static struct " +
    "super trait true type unsafe use where while dyn " +
    "i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 bool usize isize char str String Vec Option Some None Ok Err Box " +
    "IecStr IecString IecWString Globals Programs Default default new scan call init fb_init __init after_global_init " +
    "std mem ops cmp array fmt from_fn replace swap take min max clamp abs from_bits to_bits " +
    "len is_ascii_digit push_str wrapping_add wrapping_sub wrapping_mul wrapping_div wrapping_rem wrapping_neg wrapping_abs " +
    "wrapping_shl wrapping_shr units unwrap is_empty div_euclid rem_euclid to unwrap_or parse collect is_nan is_infinite " +
    "contains map trim_end_matches to_string split_once push partial_cmp iter into filter copy_from_slice chars round " +
    "char_at with_char as_bytes trunc rotate_left rotate_right narrow widen powf ln sin cos tan asin acos atan sqrt exp log10 " +
    "clone lit iec_max iec_min iec_lreal_text iec_time_text iec_ltime_text iec_date_text iec_dt_text iec_tod_text " +
    "iec_parse_real iec_parse_int iec_civil panic INFINITY NEG_INFINITY NAN MIN MAX signum copied fold sum count " +
    "checked_add checked_sub checked_mul checked_div saturating_add saturating_sub pow trailing_zeros leading_zeros " +
    "allow derive Debug Clone PartialEq Copy non_camel_case_types dead_code g prg p v"
  ).split(/\s+/),
)

/** One emitted line as its construct. */
export function normalizeRustLine(line: string): string {
  let s = line.trim()
  s = s.replace(/\/\/.*$/, "")
  s = s.replace(/b"(?:[^"\\]|\\.)*"/g, "B").replace(/"(?:[^"\\]|\\.)*"/g, "S").replace(/b'(?:[^'\\]|\\.)'/g, "C")
  // numeric literals, keeping the type suffix
  s = s.replace(
    /\b(0x[0-9a-fA-F_]+|0b[01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)(_?(?:i8|i16|i32|i64|i128|u8|u16|u32|u64|u128|usize|isize|f32|f64))?\b/g,
    (_m, _n, suffix: string | undefined) => `L${suffix ? suffix.replace("_", "") : ""}`,
  )
  // labels and generated temporaries
  s = s.replace(/'(loop|body)_\d+/g, "'$1_N").replace(/\b(__[a-z_]+?)_?\d+\b/g, "$1_N").replace(/\b(_[a-z_]+?)_\d+\b/g, "$1_N")
  // identifiers
  s = s.replace(/(\.)?\b([A-Za-z_][A-Za-z0-9_]*)\b(\s*\()?/g, (m, dot: string | undefined, id: string, call: string | undefined) => {
    if (id === "L" || id === "S" || id === "B" || id === "C" || /^L(i|u|f)\d+$/.test(id)) return m
    if (/^__?[a-z_]+_N$/.test(id) || /^(loop|body)_N$/.test(id) || id === "_") return m
    if (KEEP.has(id)) return m
    if (/_(get|set)$/.test(id) && call) return `${dot ?? ""}m_${id.endsWith("_get") ? "get" : "set"}${call}`
    const repl = call ? "m" : /^[A-Z]/.test(id) && !dot ? "T" : dot ? "f" : "x"
    return `${dot ?? ""}${repl}${call ?? ""}`
  })
  // collapse runs of an identical list item: `L, L, L` → `L, …`
  s = s.replace(/([^,[\]{}()]+)(?:,\s*\1)+/g, "$1, …")
  return s.replace(/\s+/g, " ").trim()
}

/** A normalized line that is punctuation of the construct around it — a brace, an attribute, a derive — not one. */
const BOILERPLATE = /^(\}|\{|\);?|\},?|\]|Self \{|#\[.*\]|impl .* \{|fn default\(\) -> Self \{|Self::new\(\)|pub fn new\(\) -> Self \{|\/\/.*|)$/

/** A construct's id: ten hex digits of its SHA-1, as the review printed them. */
export function shapeId(normalized: string): string {
  return createHash("sha1").update(normalized).digest("hex").slice(0, 10)
}

/** The lines of `code` that are the prelude every string-using POU carries whole — the emitter's, not the fixture's. */
function preludeLines(code: string): number {
  return code.startsWith(STRING_PRELUDE) ? STRING_PRELUDE.split("\n").length - 1 : 0
}

/**
 * A fixture's emission as its constructs, IN ORDER, and one id for the whole sequence.
 *
 * `shape` is what the map's row carries: two fixtures share it exactly when they emit the same constructs in the
 * same order, whatever their names and literals. `constructs` is what `NOTES` is keyed by — the unit the review
 * judged — and what a row's `notes` are joined through; `lines` is each construct as `normalizeRustLine` printed
 * it, parallel to `constructs`, which the map prints above each note. None of it depends on anything but the code:
 * no run order, no counter, no position in the corpus.
 */
export function emissionShape(code: string): { shape: string; constructs: readonly string[]; lines: readonly string[] } {
  const skip = preludeLines(code)
  const lines: string[] = []
  code.split("\n").forEach((raw, i) => {
    if (i < skip || raw.trim() === "") return
    const n = normalizeRustLine(raw)
    if (!BOILERPLATE.test(n)) lines.push(n)
  })
  const constructs = lines.map(shapeId)
  return { shape: shapeId(constructs.join("\n")), constructs, lines }
}

/**
 * Emitted Rust lines per ST line, to one decimal — non-blank lines on both sides, the prelude not counted (it is the
 * same 140 lines on every string POU and would make the column say "uses a STRING"), ST comment lines not counted.
 * The ST is the ASSEMBLED fixture — its POUs, the PLC_PRG that calls them and its GVLs — and NOT a library body it
 * pulls in, so a library call inflates the ratio; the review measured that too, and said so.
 */
export function sizeRatio(code: string, source: string, gvls: readonly { source: string }[]): number {
  const skip = preludeLines(code)
  const rust = code.split("\n").filter((l, i) => i >= skip && l.trim() !== "").length
  const stLines = (s: string): number => s.split(/\r?\n/).filter((l) => l.trim() !== "" && !/^\s*\/\//.test(l)).length
  const st = stLines(source) + gvls.reduce((n, g) => n + stLines(g.source), 0)
  return Math.round((rust / st) * 10) / 10
}

// ── the notes: what the review judged, which nothing can recompute ───────────────────────────────────────────

/**
 * WHAT THE REVIEW SAID, once per item — the lean items the overnight review's agents returned
 * (transpile-review-2026-09-29, grouped in `openspec/changes/transpile-lean-candidates`), keyed by the agent that
 * reported it: `shapesN_k` is batch N of the construct review, `linesN_k` a line-by-line unit that named a
 * construct. `alternatives`, `chosen` and `why` are the reviewer's own words; an item with no construct id the
 * corpus still emits is not here (it has nothing to be keyed by), and neither is one about the transpiler's source.
 *
 * AUTHORED, NOT GENERATED. The seed came out of the review's transcripts once; from here an entry changes when a
 * person decides — the lean item landed (delete it), the reasoning changed (edit it), a new review (add one).
 */
const LEAN = {
  shapes10_1: {
    improvement: "When the divisor is a nonzero constant other than -1 (every date conversion: 86400, 86400000, 86400000000000), the zero guard and the let-block are dead code. Emit `l % K` directly.",
    alternatives: [
      "today: the guarded let-block for every integer MOD",
      "a const nonzero divisor (other than -1) emits plain `%`. Chosen: this is exact and it is what a Rust engineer writes",
    ],
    chosen: "a const nonzero divisor (other than -1) emits plain `%`",
    why: "this is exact and it is what a Rust engineer writes",
  },
  shapes10_2: {
    improvement: "Keep the whole days as `count / day * day` instead of `count - count MOD day`. This also fixes the double-evaluation finding: one read, no MOD, no wrapping_sub (which can never underflow here anyway).",
    alternatives: [
      "today: count.wrapping_sub(count MOD day), which evaluates count twice",
      "count / day * day. Chosen: single evaluation, shortest, the same value for unsigned ticks",
      "a let-bound temporary. Correct, but longer",
    ],
    chosen: "count / day * day",
    why: "single evaluation, shortest, the same value for unsigned ticks",
  },
  shapes10_3: {
    improvement: "MOD on SINT/INT/USINT/UINT/BYTE/WORD widens both operands to i32 and narrows the result. Remainder never overflows except MIN % -1, and wrapping_rem at native width already gives 0 there, so computing at native width gives identical results.",
    alternatives: [
      "today: widen to i32, wrapping_rem, then cast back",
      "native width `if r == 0 { 0 } else { l.wrapping_rem(r) }` with no casts. Chosen: identical values for every input",
    ],
    chosen: "native width `if r == 0 { 0 } else { l.wrapping_rem(r) }` with no casts",
    why: "identical values for every input",
  },
  shapes10_4: {
    improvement: "SEL's integer literal arms are typed i64, or its INT arms widened to i32, then the whole `if` is cast back to the target. Literals can be typed at the destination (`20i16`) and INT arms left unwidened. (SEL prints a plain `if` now — only the selected arm is evaluated, as CODESYS does, transpile-review-2026-09-29 task 41.)",
  },
  shapes10_5: {
    improvement: "`.to()` re-copies the string even when the value is already `IecString::<N>` of the target's own capacity (for example `IecString::<80>::lit(...).to()` into an IecString<80>). Emit it only when the capacities differ or the target's capacity is generic (VAR_IN_OUT).",
    alternatives: [
      "today: `.to()` on every string store",
      "`.to()` only when the capacities differ or are generic. Chosen: the other stores need no copy because IecStr is Copy",
    ],
    chosen: "`.to()` only when the capacities differ or are generic",
    why: "the other stores need no copy because IecStr is Copy",
  },
  shapes10_6: {
    improvement: "For a head-tested loop with no step (WHILE), a `continue 'loop_N;` is exact, because Rust's continue returns to the head test. The labeled body block is only needed for FOR (step after the body) and REPEAT (UNTIL at the tail).",
    alternatives: [
      "today: a labeled body block plus `break 'body_N` for every loop kind",
      "WHILE uses `continue 'loop_N`, FOR and REPEAT keep the block. Chosen: shorter, and the construct a Rust engineer expects; the block stays where it is semantically needed",
    ],
    chosen: "WHILE uses `continue 'loop_N`, FOR and REPEAT keep the block",
    why: "shorter, and the construct a Rust engineer expects; the block stays where it is semantically needed",
  },
  shapes10_7: {
    improvement: "TRUNC of a constant argument still emits the run-time range check (`(-3.7f64).trunc()` with a contains check). Fold it at emit time to the i32 literal.",
    alternatives: [
      "today: the run-time check",
      "fold when args[0] is const. Chosen for constants only. The f64 widening of a REAL argument is NOT removable: 2147483647.0f32 rounds to 2^31, so the range check must stay in f64",
    ],
    chosen: "fold when args[0] is const",
    why: "The f64 widening of a REAL argument is NOT removable: 2147483647.0f32 rounds to 2^31, so the range check must stay in f64",
  },
  shapes5_1: {
    improvement: "f64::round already rounds half away from zero and is odd-symmetric: round(-2.5) = -3, round(-0.0) = -0.0, round(NaN) = NaN. So the sign branch is the identity. Emit `let c = v.round();`. The 32-bit helper can also fold to `if c.is_nan() || c >= 9223372036854775808.0 { 0 } else if c < -2147483648.0 { i32::MIN } else { c as i64 as i32 }`.",
  },
  shapes5_3: {
    improvement: "An all-constant integer expression is already folded at full width in lowering (expressions.ts:241-247), but the node is kept and printed. Emit the folded literal. Constant-folding in lowering is fine; CODESYS folding it too does not matter for a value.",
    alternatives: [
      "emit the folded literal (preferred)",
      "keep `0i64.wrapping_sub(1i64)` (today): rustc folds it anyway, so this is readability only",
    ],
    chosen: "emit the folded literal",
  },
  shapes5_4: {
    improvement: "When the divisor is a nonzero literal the zero check cannot fire. Print plain `a / 3.0f64` and emit the iec_div helper only when a divisor can be zero.",
  },
  shapes5_5: {
    improvement: "If the divisor is a literal other than 0 (and other than -1 for signed), emit `l % r` directly. The block, the zero test and wrapping_rem are dead code for a literal divisor.",
  },
  shapes5_6: {
    improvement: "Widening both sides of a compare cannot change the answer, so when both operands share signedness and the literal fits the narrow type, compare in the operand's own type: `self.n == 2`. This removes the cast_lossless lints (4 per fixture here).",
    alternatives: [
      "compare in the narrow type when the literal fits (preferred: what a Rust engineer writes)",
      "keep the promoted compare (today): always correct, including for an out-of-range literal, which is why it is promoted",
    ],
    chosen: "compare in the narrow type when the literal fits",
    why: "what a Rust engineer writes",
  },
  shapes5_7: {
    improvement: "Outside routine mode, the chain temporary becomes a public field of the POU struct. It persists across scans, appears in Debug/PartialEq, and triggers clippy::pub_underscore_fields. Make it a local `let`, or skip the temp entirely when the value is a plain load of a place no target in the chain writes.",
    alternatives: [
      "a scan-local `let __chain_value = ...;` (preferred)",
      "no temp when the value is a side-effect-free load: `self.y = self.z; self.x = self.y;`",
      "struct field (today)",
    ],
    chosen: "a scan-local `let __chain_value = ...;`",
  },
  shapes5_8: {
    improvement: "The assignment always adds `.to()`, even when the value is already a fresh IecString of the target's capacity, so each assignment copies 2-3 times. Skip the outer `.to()` when the value's type capacity equals the target's. Build a literal or format! result directly at the target capacity: `IecString::<12>::lit(...)`.",
  },
  shapes5_9: {
    improvement: "A lossless widening followed by a conversion back to the source's own Rust type is the identity. Peephole: if e.value is a convert from type X with rustType(X) === target and the middle step is a widening, emit X's text.",
  },
  shapes5_10: {
    improvement: "Several spellings are correct.",
    alternatives: [
      "`f32::from(u8::from(self.v))`: lossless and lint-free (my choice)",
      "`if self.v { 1.0 } else { 0.0 }`",
      "`(self.v as u8) as f32` (today): correct, but flags cast_lossless",
    ],
    chosen: "`f32::from(u8::from(self.v))`: lossless and lint-free",
  },
  shapes5_11: {
    improvement: "For SQRT only, f32::sqrt is correctly rounded, and f64 sqrt followed by narrowing is provably the same (53 >= 2*24+2). So a REAL SQRT can be `x.sqrt()` in f32. Keep the f64 detour for the other transcendentals, where it is load-bearing.",
  },
  shapes5_12: {
    improvement: "Unary `!` binds tighter than every binary operator, so the parentheses are always redundant: emit `!x` and let the binary printer add parentheses only where needed. The `&`/`|` for eager AND/OR are deliberate and stay.",
  },
  shapes5_14: {
    improvement: "Lowering already knows these are compile-time constants: 7/2 is folded at LINT width by the measured rule. Emit the folded, converted literal (`3.0f32`; `0.3f64 as f32` becomes its f32 literal). The value must be folded exactly as the vendor does, since `x : REAL := 7 / 2` is 3.",
  },
  shapes4_1: {
    improvement: "A struct-literal initializer repeats the type suffix even though the field's declared type already fixes it (`l25: 2.5f64`, `next_day: 0u32`, `di: 0i32`). The suffix is needed only where the literal is a method receiver or an untyped operand (`100i64.wrapping_add(...)`).",
    alternatives: [
      "(A) EMITTED TODAY: always suffix (`2.5f64`, `0u32`). One spelling everywhere, and it is safe in receiver position, which the negative-literal parenthesization comment depends on.",
      "(B) Drop the suffix in pure initializer / assignment-RHS positions where the target type is annotated (`l25: 2.5`, `next_day: 0`). This is what a hand-written struct init looks like.",
      "Choice: keep (A). The saving is cosmetic, and one uniform spelling from literal() is exactly what keeps receiver positions correct. A context flag would add a second path.",
    ],
    chosen: "keep (A). The saving is cosmetic, and one uniform spelling from literal() is exactly what keeps receiver positions correct. A context flag would add a second path.",
  },
  shapes4_2: {
    improvement: "Large integer initializers such as DATE/DT seconds and TIME ms (`d28: 1709078400u32`, `one_day: 86400000u32`) trip clippy::unreadable_literal (1-2 per fixture across date_plus_time, date_width_wrap, dt_minus_time, constant_arithmetic_width, signed_overflow). Grouping the digits (`1_709_078_400u32`) removes that lint class.",
    alternatives: [
      "(A) EMITTED TODAY: plain digits `1709078400u32`.",
      "(B) `1_709_078_400u32` for literals of 6 or more digits: a one-line regex in literal().",
      "(C) For DATE/TIME, a named constructor or comment (`/* D#2024-02-28 */`). More readable, but more machinery.",
      "Choice: (B). It is trivial and lint-clean, and the value is unchanged.",
    ],
    chosen: "(B). It is trivial and lint-clean, and the value is unchanged.",
  },
  shapes4_3: {
    improvement: "The f32 overflow test (`!isFinite(Math.fround(v))`) already rounds to f32, but the printed text still uses the unrounded v. Printing the rounded value's shortest round-tripping decimal is both the correctness fix for the midpoint finding and leaner: one rounding decision instead of two (JS for the infinity check, rustc for the digits).",
    alternatives: [
      "(A) EMITTED TODAY: `${v}f32`, so rustc rounds the float64's decimal. Wrong on midpoints.",
      "(B) `(${v}f64 as f32)`. Exact, but adds a cast on every REAL literal and a clippy cast lint.",
      "(C) The shortest decimal d with Math.fround(+d) === Math.fround(v), suffixed f32. Exact and short.",
      "Choice: (C).",
    ],
    chosen: "(C).",
  },
  shapes6_1: {
    improvement: "A field initializer in `Self { .. }` has a declared type, so the literal suffix is redundant there. `li: 0i64,` could be `li: 0,` and `v: 305419896u32,` could be `v: 305419896,`. The suffix is needed only where the literal is a method receiver (`100i64.wrapping_add(..)`). Also, pointer/reference slots already print bare `ref_: 0,` because their type is not elementary, so today the same construct comes out two ways within one struct.",
    alternatives: [
      "`x: 0i64,` (emitted today): literal() always appends rustType(t)",
      "`x: 0,` / `x: 0.0,`: rely on the field type. This is what I would choose: pass a 'typed position' flag from initOf to literal() and drop the suffix there, keeping it everywhere a literal can be a receiver",
      "`..Default::default()` for all-zero fields: shorter, but hides the declared values and needs Default for arrays over 32 elements, which the file comment rejects",
    ],
    chosen: "`x: 0,` / `x: 0.0,`: rely on the field type. This is what I would choose: pass a 'typed position' flag from initOf to literal() and drop the suffix there, keeping it everywhere a literal can be a receiver",
  },
  shapes6_2: {
    improvement: "A reference bound at its declaration to a variable of the same instance always gets the constant tag 1 (`ref_: 0` in new(), then `self.ref_ = 1;` in init()). The tag does not depend on init order: refdecl_target_after reads an address, not a value. Folding it into new() as `ref_: 1,` removes the init()/__init() method and its call chain (`self.inst.__init()` in the parent) for every refdecl_* fixture.",
  },
  shapes6_3: {
    improvement: "When a reference is bound unconditionally at its declaration and has a single target (lw.boundPointers already records unconditional binds), the `iec_deref(self.ref_)` null check can never fire. `{ iec_deref(self.ref_); self.v }` could be `self.v`. That also drops the `fn iec_deref` prelude when nothing else uses it.",
  },
  shapes6_4: {
    improvement: "Every struct gets `pub fn new()` plus a hand-written `impl Default { fn default() -> Self { Self::new() } }` (5 lines each). Clippy's `new_without_default` is the only reason for the impl. Where every initializer is its type's zero and no array exceeds 32 elements, `#[derive(Default)]` alone would do. Otherwise, keeping `new` and dropping Default (with an allow) is shorter.",
    alternatives: [
      "new() + manual impl Default calling new (emitted today, uniform, satisfies clippy::new_without_default)",
      "#[derive(Default)] when all initializers are zero-valued and no array exceeds 32 elements: shortest, but gives two code paths",
      "only new() plus #[allow(clippy::new_without_default)]: one line instead of five. I would choose this; the uniform shape is kept",
    ],
    chosen: "only new() plus #[allow(clippy::new_without_default)]: one line instead of five. I would choose this; the uniform shape is kept",
  },
  shapes4_4: {
    improvement: "`let c = if v < 0.0 { -((-v).round()) } else { v.round() };` does the same as `let c = v.round();`. f64::round already rounds half away from zero on both signs, and -0.0 stays -0.0. Emitted in every one of 182+57 fixtures that use the helpers.",
  },
  shapes4_5: {
    improvement: "`if c.is_nan() { return 0; }` and `if c >= 9223372036854775808.0 { return 0; }` return the same value and can be one test: `if c.is_nan() || c >= 9223372036854775808.0 { return 0; }`. Better still, write the whole helper as one match on ranges, like iec_r2i64 already folds NaN into its range test.",
    alternatives: [
      "today: separate NaN / below-min / above-2^63 early returns, then (c as i64) as i32",
      "merge NaN and >= 2^63 into one `return 0` (preferred: same table, one line fewer, reads like the r2i64 twin)",
    ],
    chosen: "merge NaN and >= 2^63 into one `return 0`",
    why: "same table, one line fewer, reads like the r2i64 twin",
  },
  shapes4_6: {
    improvement: "In a PROGRAM or FB body, the temp for a chain `x := y := z` is a persistent **pub struct field**: it appears in new(), in PartialEq and Debug, and in the public API. It is scratch storage that lives only for one statement. Emit it as a `let` local in scan()/call(), which routine mode already does. When the value is a plain load or a constant, drop the temp: `self.y = self.z; self.x = self.y;`, where the conversion already goes through y's type.",
    alternatives: [
      "today: temp as struct field (__chain_value_N) in body mode, local in routine mode",
      "a `let __chain_value_N = …;` local in every mode (preferred: one rule, no state leaked into the instance)",
      "no temp at all when the value is side-effect-free (a load/const), reading the previous link instead",
    ],
    chosen: "a `let __chain_value_N = …;` local in every mode",
    why: "one rule, no state leaked into the instance",
  },
  shapes4_7: {
    improvement: "Comparisons are always promoted, which gives `(self.ea as i32) == 1i32` for an INT enum and `1i64 == 1i64` for two enum constants (clippy eq_op; the fixture's `same := A1 = B1` folds to `true`). The comment says promotion is there for a narrow operand compared with an out-of-range literal. Promote only when a literal does not fit the operand's own type; otherwise compare in the common type with no casts. Fold constant == constant.",
    alternatives: [
      "today: every comparison is lifted to the promoted type (i32/i64), so both sides get cast",
      "widen only when an operand is a literal outside the other operand's range (preferred: gives the same answer in all cases, since widening never changes a comparison, and emits `self.ea == 1i16`)",
      "fold a comparison of two constants to its BOOL",
    ],
    chosen: "widen only when an operand is a literal outside the other operand's range",
    why: "gives the same answer in all cases, since widening never changes a comparison, and emits `self.ea == 1i16`",
  },
  shapes4_8: {
    improvement: "`iec_div(self.seed, 3.0f64)` checks a divisor that is a nonzero literal, so the check can never fire. When the right operand is a constant other than ±0.0, emit plain `(l / r)`. Keep iec_div only for a divisor that could be zero at run time.",
    alternatives: [
      "today: every REAL `/` goes through iec_div",
      "plain `/` when the divisor is a nonzero const (preferred: same stops; the check is dead code for a literal divisor)",
    ],
    chosen: "plain `/` when the divisor is a nonzero const",
    why: "same stops; the check is dead code for a literal divisor",
  },
  shapes4_9: {
    improvement: "A negated literal is printed as `(-0.5f64)`. `self.seed * -0.5f64` is valid Rust with the same precedence, and a negative literal constant could be emitted as one token.",
  },
  shapes13_1: {
    improvement: "The field declaration itself is already lean and correct. LWORD, ULINT and LTIME map to u64 (LTIME counts nanoseconds and is unsigned, as recorded in ltime_basic: 1s+1ns = LINT 1000000001). WORD and UINT map to u16, LINT to i64. I probed these with rustc under scratchpad/review/b13/p.rs. Every u16 and u8 input to unsigned_underflow matches a same-width wrap. SHL(LWORD 1, n) for n in {-1, 64, 65, 127, i16::MIN} follows the 6-bit mask that shift_64bit and the DWORD case (33 gives 2) establish. DINT against UDINT 3e9 meets in DINT, which signed_unsigned_comparison confirms: udMax > -1 is FALSE, so this is bits and not a widened compare. LTIME max+1 wraps to 0. diff.json has 0 interpreter/Rust disagreements across all 569 members of these three shapes. The only choice worth noting is the other mapping that produces `pub x: u64`: an INTERFACE is emitted as u64 (emit.ts:49), while a POINTER/REFERENCE is usize (emit.ts:47).",
    alternatives: [
      "Today: interface → u64 tag, pointer/reference → usize index. Correct, but two handle kinds use two integer types, and an interface field reads exactly like an LWORD field in the emitted struct.",
      "Interface → usize, the same as a pointer: one handle type, and no `as usize` where a tag indexes a table. This is my choice if tags are ever used as indices.",
      "A newtype `struct Itf(u64)` / `Option<NonZeroUsize>`: self-documenting and null-safe, but costs a derive and more code at every compare against 0. Not worth it for generated code.",
    ],
    chosen: "Interface → usize, the same as a pointer: one handle type, and no `as usize` where a tag indexes a table",
  },
  shapes13_2: {
    improvement: "castTo does not fold a constant operand. A literal shift/rotate count is typed as its narrowest type (SINT), then cast with `as u32` at run time. For a non-negative literal count, print the bare literal (`wrapping_shr(1)`, `rotate_left(4)`). Rust infers u32 there, and a negative literal already becomes its masked u32 value when it is folded.",
    alternatives: [
      "Today: `x.rotate_left(1i8 as u32)`, a literal typed SINT and then cast.",
      "Fold in castTo: when the operand is an IR const, print `${value}` (or `${value as u32}u32` when it is negative). My choice: it is shortest, and clippy::unnecessary_cast-style noise goes away.",
      "Type the literal from its context (u32) in lowering. This is cleaner in principle, but the count's context is not an IEC type.",
    ],
    chosen: "Fold in castTo: when the operand is an IR const, print `${value}` (or `${value as u32}u32` when it is negative)",
    why: "it is shortest, and clippy::unnecessary_cast-style noise goes away.",
  },
  shapes13_3: {
    improvement: "Promoting first is the measured CODESYS rule (arithmetic_width: SINT 127 + 1 into INT is 128), so it has to stay when the result is stored WIDER. When an add/sub/mul result is narrowed straight back to the operands' own width, the low bits are identical. I checked all 65536 u16 and all 256 u8 inputs: `(x as i32).wrapping_sub(1) as u16 == x.wrapping_sub(1)`. The emitter can peephole `(a as W).wrapping_{add,sub,mul}(b) as T`, where a and b are both T (or a literal that fits T), into `a.wrapping_op(b)`. This does NOT hold for div/mod (sign/overflow), for comparisons, or for a wider target.",
    alternatives: [
      "Today: always promote, then truncate: `(x as i32).wrapping_sub(1i32) as u16`. This is one rule and trivially correct.",
      "Peephole at the store when target width == operand width and op ∈ {add, sub, mul, and, or, xor}: `x.wrapping_sub(1)`. My choice: it is what a Rust engineer writes, and it is provably equal (mod 2^n arithmetic).",
      "Decide it in lowering (skip promotion when the consumer narrows back). This is harder: the IR would have to see the store's type while lowering the expression.",
    ],
    chosen: "Peephole at the store when target width == operand width and op ∈ {add, sub, mul, and, or, xor}: `x.wrapping_sub(1)`",
    why: "it is what a Rust engineer writes, and it is provably equal (mod 2^n arithmetic).",
  },
  shapes13_4: {
    improvement: "All-constant integer arithmetic is typed LINT, as measured (CODESYS folds at full width: 30000+30000 into DINT is 60000). It is still emitted as a run-time i64 wrapping op plus a narrowing cast. Folding it in lowering, computing the LINT value with wrapping at i64 and then converting to the target, would emit `200i16` / `4000000000i64`. This is the same value by construction, and it is what CODESYS's own compiler does.",
    alternatives: [
      "Today: emit the fold's arithmetic at run time in i64 and cast. Correct, and there is one code path.",
      "Fold in lowering into an IrConst typed LINT, then retype. My choice: the interpreter also stops redoing it every scan, and the emitted line matches the ST author's intent.",
      "Fold only in the Rust printer (const-eval of literal operands). Smaller change, but the interpreter and Rust would then differ in structure, which the equivalence harness would not see.",
    ],
    chosen: "Fold in lowering into an IrConst typed LINT, then retype",
    why: "the interpreter also stops redoing it every scan, and the emitted line matches the ST author's intent.",
  },
  shapes1_1: {
    improvement: "A negative constant in a non-receiver position is still wrapped: `s_minus1: (-1i8),`, `neg_big: (-40000.5f32),`. The parens only matter when the literal is a method receiver. Apply `unparen` (or skip the parens) in field-initializer and argument positions.",
  },
  shapes1_3: {
    improvement: "The body is always wrapped in an extra `{ ... }` block even when it has no CONTINUE, and a loop whose only EXIT sits directly in its own body gets `'loop_N:` + `break 'loop_N;` although a plain `break;` works when the body block is unlabeled. Emit the body inline when `!frame.continues`, and use an unlabeled `break` when no labeled body block sits between the EXIT and the loop.",
  },
  shapes1_5: {
    improvement: "In a PROGRAM/FB body, a lowering temporary (`__chain_value_N`, and likewise the output/property/inout_guard temps from calls.ts:787/1229/1261) becomes a persistent `pub` struct field. It appears in Debug/PartialEq/new() and is carried across scans, though it is only ever a statement-local value. Emit it as a `let` in scan()/call(), as routineMode already does. SIZEOF correctly ignores it (probed r1/sz.st: 16 = 16).",
  },
  shapes1_6: {
    improvement: "A constant index is printed as `self.arr[((5i8 as i64) - 1i64) as usize]`, `self.u.b[(1i8 as i64) as usize]`, `self.arr[0i64 as usize]`. Fold a constant index minus the lower bound to a usize literal: `self.arr[4]`. The pointer path is `(self.p as i64).wrapping_add(-1i64)`, and ADR(arr[1]) stores `1i64.wrapping_sub(-1i64) as usize`, which should be `2`.",
  },
  shapes1_7: {
    improvement: "Keeping the members of a WORD/BYTE[2] union in sync emits `{ let __mod_l = ...; let __mod_r = 256u64; if __mod_r == 0 { 0 } else { __mod_l.wrapping_rem(__mod_r) } }` twice per write, zero-guarding a constant 256. A Rust engineer writes `self.u.b = self.u.w.to_le_bytes();` and `self.u.w = u16::from_le_bytes(self.u.b);`. Values are correct (probed r1/un.st: 4813, 205, 171).",
    alternatives: [
      "today: per-byte MOD/DIV arithmetic with constant-divisor zero guards",
      "to_le_bytes/from_le_bytes on the whole member (preferred: 1 line, obviously right on a little-endian target, which CODESYS x86/ARM are)",
      "at minimum: drop the `__mod_r == 0` guard when the divisor is a nonzero constant",
    ],
    chosen: "to_le_bytes/from_le_bytes on the whole member",
    why: "1 line, obviously right on a little-endian target, which CODESYS x86/ARM are",
  },
  shapes1_8: {
    improvement: "`p : POINTER TO INT := ADR(x)` becomes `p: 0` in new() plus `self.p = 1;` in a separate init()/__init(). The handle is a compile-time constant, and init-reads-later already refuses any initializer that could see it at 0, so the tag can be the starting value (`p: 1`). That drops init()/__init for most POUs, along with the requirement that callers remember to call it.",
  },
  shapes1_9: {
    improvement: "The function return is always `let mut f: T = default; ...; f = expr; f`, and a VAR_OUTPUT is reset at entry even when the body assigns it unconditionally (`*i_carry_out = 0i16;` twice). All parameters are declared `mut` even when never reassigned (`mut i_a: i16`). When the result or output is assigned exactly once on every path, return the expression directly, drop the entry reset, and declare `mut` only on reassigned parameters.",
  },
  shapes1_10: {
    improvement: "Large integer literals are emitted unseparated (`1709078400u32`, `86400000u32`, `1000000000u64`), which is 200+ clippy::unreadable_literal hits across the decl/assign literal shapes. Group digits with `_` (e.g. `1_709_078_400u32`) for literals of 6+ digits.",
  },
  shapes1_11: {
    improvement: "Statements after an unconditional RETURN/EXIT are still printed (`return; self.n = 99i16; ...`, the body after `break 'loop_2;`). rustc reports unreachable_code, and the policy allows it. The printer could stop emitting a block after a diverging statement; the ST line is dead either way.",
  },
  shapes1_12: {
    improvement: "Pointers and references are `usize` tags, null-checked by a free function and dispatched by `match` when there are several targets.",
    alternatives: [
      "today: `usize` tag, `0` = NULL, `iec_deref(p)` check, then a static target or a `match` over tags",
      "a per-pointer `enum` (Null, X, Y) with the match on variants: typed and exhaustive, no `_ => panic` arm, but more code per pointer type",
      "keep usize (my choice): it maps directly to CODESYS's integer-valued pointer, stays compact, and the refusals (pointer-step, pointer-value) already keep arithmetic out",
    ],
    chosen: "keep usize: it maps directly to CODESYS's integer-valued pointer, stays compact, and the refusals (pointer-step, pointer-value) already keep arithmetic out",
  },
  shapes2_1: {
    improvement: "The same ST construct `x := x + 1` is emitted two ways. A body statement is widened to i32 and narrowed back; the FOR step is added in the counter's own type. For add, sub, mul and neg, truncating the wide wrapping result equals wrapping in the narrow type, so an assign whose value is convert(promoted add/sub/mul of operands converted up from T) back to T can be printed narrow. Comparisons (`(self.runs as i32) > 10i32`) can also be printed narrow, because a sign-preserving widening keeps the order.",
    alternatives: [
      "A: widen, then wrapping op, then narrow: `(x as i32).wrapping_add(1i32) as i16`. Emitted today for every body expression. Always right, including for DIV: INT_MIN / -1 must stay in i32 (32768 then `as i16` gives -32768), because a narrow i16 `/` would panic.",
      "B: narrow wrapping op: `x.wrapping_add(1i16)`. Emitted today only for the FOR step. Identical results for add/sub/mul/neg when the result is stored back into T.",
      "Choose B for add/sub/mul/neg and comparisons whose result goes straight back to T or into a bool, and keep A for DIV and for a result stored into a wider target (ABS(INT_MIN) into a DINT, `si + 1000` into an INT). It removes 2 casts per statement on the most common line in the corpus.",
    ],
    chosen: "B for add/sub/mul/neg and comparisons whose result goes straight back to T or into a bool, and keep A for DIV and for a result stored into a wider target (ABS(INT_MIN) into a DINT, `si + 1000` into an INT). It removes 2 casts per statement on the most common line in the corpus.",
  },
  shapes2_3: {
    improvement: "A constant index prints as `(4i8 as i64) as usize` and should print `4`, since the lowering already knows it is in range and rustc checks constant indices. For lower == 0 and a signed variable index, `(self.k as i64) as usize` can be `self.k as usize`: a signed-to-usize `as` sign-extends, so a negative index still becomes huge and still panics. The i64 hop is needed only when a non-zero lower bound is subtracted.",
  },
  shapes2_4: {
    improvement: "`ADR(arr[1])` over ARRAY[0..4] is emitted as `1i64.wrapping_sub(-1i64) as usize` instead of the folded constant `2`. Fold it when the index is constant. On deref the pointer has already passed `iec_deref` (it is non-zero), so `(self.p as i64).wrapping_add(-1i64) as usize` can be `self.p - 1`, plus `+ k` for p[k].",
  },
  shapes2_5: {
    improvement: "Re-lending a VAR_IN_OUT that is already `&mut T` prints an explicit reborrow `&mut (*x)`. Passing `x` reborrows implicitly. When the bound place is a bare inout or lent root with an empty path, print the name.",
  },
  shapes2_6: {
    improvement: "A string literal is built at its own (default 80) capacity and then copied with `.to()` into the target. `lit` already truncates, so `IecString::<N>::lit(b\"abc\")` at the target's capacity is the same value with one copy fewer. The `lit(format!(..)).to::<12>().to()` double copies collapse in the same way when the intermediate capacity is at least the final one. This affects about 472 emitted lines.",
  },
  shapes2_7: {
    improvement: "`array.element.kind === \"elementary\"` decides between a repeat expression and from_fn, so a 2-D array of i16 goes through a closure. [i16; N] is Copy, so `[[0i16; 3]; 2]` is legal. Use the emitter's existing isCopy(type) in that condition.",
  },
  shapes2_8: {
    improvement: "The aggregate initializer builds a mutable temporary and assigns fields one by one.",
    alternatives: [
      "A (today): `{ let mut v = T::new(); v.x = 1; v.y = 2.5; v }`. Works for FB types and nested initializers.",
      "B: struct update syntax `T { x: 1i16, y: 2.5f32, ..T::new() }`. One expression, no mut, and the idiomatic Rust form. The fields are pub and in the same module, so it compiles.",
      "Choose B. The only reason to keep A would be an initializer that reads a sibling, and those go through __init anyway.",
    ],
    chosen: "B. The only reason to keep A would be an initializer that reads a sibling, and those go through __init anyway.",
  },
  shapes2_9: {
    improvement: "DUT structs derive only Clone, so a struct store needs `.clone()` and a struct array needs from_fn. A struct whose fields are all Copy (elementary, IecStr, usize pointers, arrays of those) could `#[derive(Clone, Copy)]`. The store then becomes a plain assignment and the array becomes `[T::new(); N]` (with a const fn new) or keeps from_fn.",
  },
  shapes2_10: {
    improvement: "ABS of an unsigned argument is the identity, as the lowering comment itself says. Returning `arg` there removes a widen, an abs and a narrow; the emitter's own unsigned shortcut at emit.ts:756 never fires because the type has already been promoted to DINT.",
  },
  shapes2_11: {
    improvement: "Every input is declared `mut` and every method carries `#[allow(unused_mut, unused_variables, unused_assignments)]`. Print `mut` only for an input the body stores to (the IR knows the assigned places). When the result local is never assigned, return `false`/default directly instead of `let mut fb_init = false; ... fb_init`. The allows could then go.",
  },
  shapes2_12: {
    improvement: "init() always gets `#[allow(unused_variables)]`, even without a g or prg parameter. Guard it the way line 1240 does (`usesGlobals || usesPrograms`).",
  },
  shapes2_13: {
    improvement: "The parentheses guard a negative constant as a method receiver. In a field initializer or other non-receiver position they are noise (clippy unused_parens territory). Only `-f32::INFINITY` needs them, and only as a receiver.",
  },
  shapes2_14: {
    improvement: "The helper is `assert!(at != 0, \"dereference of a null pointer\")`, which states the check in one line.",
    alternatives: [
      "A (today): `fn iec_deref(at: usize) { if at == 0 { panic!(..) } }` wrapped around every read in a block `{ iec_deref(p); x }`.",
      "B: `assert_ne!(at, 0, ..)` / `assert!` in the same helper. Same behaviour, shorter.",
      "C: model a single-target pointer as `Option<()>` or NonZeroUsize. Heavier; not worth it. Choose B.",
    ],
  },
  shapes5_15: {
    improvement: "An f32 literal whose value is already frounded (REAL#0.1, REAL#3.14159) prints the full float64 repr of that f32: `a: 0.10000000149011612f32`, `b: 3.141590118408203f32`. Print the shortest decimal that round-trips as f32 instead (the smallest p in 1..9 with Math.fround(+v.toPrecision(p)) === Math.fround(v)), giving `0.1f32` and `3.14159f32`. Doing it this way also fixes the double-rounding finding when applied to fround(v).",
    alternatives: [
      "today: `${v}f32`, the f64 shortest repr of the value (long for a frounded value, and double-rounding-unsafe for an unfrounded one)",
      "print `${Math.fround(v)}f32`: correct, but still 17 digits",
      "print the shortest f32 repr of Math.fround(v): correct and lean (chosen)",
    ],
    chosen: "print the shortest f32 repr of Math.fround(v): correct and lean",
  },
  shapes5_16: {
    improvement: "At a struct-field initializer the field's type is already declared, so the type suffix is redundant: `lt1s: 1000000000u64,` could be `lt1s: 1_000_000_000,`. The suffix is only needed where the literal is a method receiver. clippy::unreadable_literal fires 11 times on this shape and 3 times on 74845f98c6: separate digits in groups of three for integers of 5 or more digits.",
    alternatives: [
      "today: a suffixed literal everywhere (`0u64`, `65535u16`, `0.0f32`), which is uniform and safe at receivers",
      "an untyped literal in typed positions (field init, `let x: T =`) and a suffix only at receivers: leaner, but needs a position flag in literal()",
      "keep the suffix but add `_` digit grouping: the smallest change and removes the lint (my choice: add grouping now, keep the suffix for uniformity)",
    ],
    chosen: "keep the suffix but add `_` digit grouping: the smallest change and removes the lint",
    why: "add grouping now, keep the suffix for uniformity",
  },
  shapes5_17: {
    improvement: "A negative literal is wrapped in parens even at a field-init position, where it can never be a method receiver: `im5: (-5i16),` and `i_min: (-32768i16),`, 87 lines across the fixtures. rustc's unused_parens does not fire there, so the lint scan does not see it. The initOf field pushes could unparen() the value, which is already used for assignment right-hand sides.",
    alternatives: [
      "today: parens always, which is safe at every receiver",
      "unparen() at the initOf call sites (:1170/:1190/:1227/:1072), the same treatment assignments already get (chosen)",
    ],
    chosen: "unparen() at the initOf call sites (:1170/:1190/:1227/:1072), the same treatment assignments already get",
  },
  shapes11_1: {
    improvement: "When a pointer's target is an array element, lowering adds (lower-1) to the handle and then hands the emitter an index step with `lower` set, which the emitter subtracts again, so the lower bound cancels at runtime. For ARRAY[3..7], probe ptr_neg_step emits `self.arr[((self.p as i64).wrapping_add(2i64) - 3i64) as usize]`, which is just `self.p - 1`. It also mixes `wrapping_add` with a plain `-` in one expression. If pointeePlace built a zero-based index (`p - 1 (+ extra)`) with `lower: 0n`, the emitter would print `[(self.p as i64 - 1) as usize]`. With lower 0 it already prints `.wrapping_add(-1i64)`, and that could be a plain `- 1`.",
  },
  shapes11_2: {
    improvement: "`ADR(arr[1])` with a constant index emits `self.p = 1i64.wrapping_sub(-1i64) as usize;`, and `ADR(arr[7])` over ARRAY[3..7] emits `self.p = 7i64.wrapping_sub(2i64) as usize;`. When last.index is a const, the handle is a compile-time constant (2 and 5). It should be emitted as `self.p = 2;`, the same way a scalar ADR already emits `self.p = 1;`.",
    alternatives: [
      "today: the generic `LINT(index) - (lower-1)` expression, cast to usize, even for a constant index",
      "fold in addressOf when last.index.kind === 'const' and emit the literal handle (my choice: it is identical to the scalar-ADR form `self.p = 1;` and costs about 3 lines)",
      "a generic const-folding pass over IR binaries (bigger, and it would help elsewhere too)",
    ],
    chosen: "fold in addressOf when last.index.kind === 'const' and emit the literal handle",
    why: "it is identical to the scalar-ADR form `self.p = 1;` and costs about 3 lines",
  },
  shapes11_3: {
    improvement: "The null check is emitted even when every value ever stored into the pointer is a non-zero constant, with no `p := 0` and no stepping. In mem_adr_of_inout_member it reads `self.p = 1; iec_deref(self.p); io.y = 99i16;`, and that check can never fire. Lowering already knows every store into a form-1 pointer (lw.shared.pointers). If none of them can produce 0, it could drop `guard`. But a single-target pointer's field starts at 0 and can be read before any store in a later scan, so this is only safe when a store dominates the deref in the same body. That is the case the scoped VAR_IN_OUT path already proves (`boundPointers`).",
    alternatives: [
      "today: always guard (simple, always correct)",
      "drop the guard only when a store of a non-zero constant dominates the deref in the same run (the boundPointers case). I would do only this narrow case, or leave it as is, because the saving is small and a wrong elision turns a CODESYS fault into a silent wrong index (p[i] with p=0 can land on a valid element)",
    ],
  },
  shapes11_4: {
    improvement: "The helper is `fn iec_deref(at: usize) { if at == 0 { panic!(\"dereference of a null pointer\"); } }`. clippy::manual_assert flags it in every pointer fixture (mem_pointer_index_struct_array: 2, mem_adr_of_inout_member: 1). `assert!(at != 0, \"dereference of a null pointer\");` says the same thing in the idiomatic way, and the panic message does not change.",
    alternatives: [
      "today: an if with panic! inside the helper",
      "`assert!(at != 0, \"dereference of a null pointer\")` inside the helper (my choice: one-line change, same message, clippy-clean)",
      "an inline `assert_ne!(self.p, 0, ...)` at each site with no helper (more text per site, not better)",
    ],
    chosen: "`assert!(at != 0, \"dereference of a null pointer\")` inside the helper",
    why: "one-line change, same message, clippy-clean",
  },
  shapes11_5: {
    improvement: "The field line itself is already minimal and correct (INT to i16, LREAL to f64). Probes of its edge inputs match the interpreter: INT := 40000 gives -25536, SINT := 200 gives -56, UINT := -1 gives 65535, LREAL 1e300 to REAL gives inf, 16777217.0 to REAL rounds to 16777216. The surrounding boilerplate is what a Rust engineer would trim. Every struct gets a hand-written new() plus `impl Default { fn default() { Self::new() } }`, even when every initialiser is the type's zero. Zero initialisers also use typed-suffix literals (`0i16`, `0.0f32`), while a pointer field uses a bare `0`.",
    alternatives: [
      "today: hand-written new() with every field listed, plus impl Default delegating to new(). This is always valid, including for arrays longer than 32 (which have no std Default) and for non-zero initialisers",
      "`#[derive(Default)]` when every field's initialiser is its type's zero and no array is longer than 32, keeping new() as `Self::default()`. Shorter, but it gives two emission paths for one construct, which breaks the 'same construct, same shortest way' rule",
      "keep today's form (my choice: one uniform path is worth the lines; the suffix-vs-bare literal inconsistency is cosmetic)",
    ],
    chosen: "keep today's form",
    why: "one uniform path is worth the lines; the suffix-vs-bare literal inconsistency is cosmetic",
  },
  shapes11_6: {
    improvement: "A widening that cannot lose data (BYTE to INT, u8 to i16) is emitted as a bare `as`, which clippy::cast_lossless flags (1 hit in literal_out_of_range_init, 3 in mem_pointer_index_struct_array). `i16::from(self.b300)` says 'lossless' in the type system. Whether this is worth doing is a style choice.",
    alternatives: [
      "today: `x as T` for every integer conversion (one uniform spelling, wrapping where narrowing)",
      "`T::from(x)` for lossless widenings and `as` only where wrap or truncation is intended. That makes the narrowing casts stand out, which suits a reviewer (my choice if the lint list is being worked down)",
    ],
    chosen: "`T::from(x)` for lossless widenings and `as` only where wrap or truncation is intended. That makes the narrowing casts stand out, which suits a reviewer (my choice if the lint list is being worked down)",
  },
  shapes13_6: {
    improvement: "A FOR ... BY -1 step is printed as `i.wrapping_add(-1i32)`. When the step is a negative constant, print `i.wrapping_sub(1i32)` instead.",
    alternatives: [
      "emitted today: `i.wrapping_add(-1i32)`",
      "`i.wrapping_sub(1i32)` (chosen: identical for every value, including MIN, and idiomatic)",
    ],
    chosen: "`i.wrapping_sub(1i32)`",
    why: "identical for every value, including MIN, and idiomatic",
  },
  shapes13_7: {
    improvement: "With lower bound 0, `(n as i64) as usize` is the same as `n as usize` for every signed or unsigned integer of 64 bits or fewer, because a negative value sign-extends to a huge usize either way and still panics. Drop the i64 hop when lower===0n. For ARRAY[*], `.wrapping_sub` on two widened i32 cannot overflow, so a plain `-` is enough and matches the static-bound form `[(i - L) as usize]`.",
    alternatives: [
      "emitted today: `[(n as i64) as usize]` / `[(i as i64).wrapping_sub(lo as i64) as usize]`",
      "`[n as usize]` for lower 0 and `[(i as i64 - lo as i64) as usize]` for open bounds (chosen: same panics, fewer tokens)",
    ],
    chosen: "`[n as usize]` for lower 0 and `[(i as i64 - lo as i64) as usize]` for open bounds",
    why: "same panics, fewer tokens",
  },
  shapes13_8: {
    improvement: "Every string assignment adds `.to()` even when the value already has the target's capacity, because the call lowering converted it already or the literal was built with that capacity. Each `.to()` is a full IecStr copy through lit(). Add it only when the value's capacity differs from the target's, or when the target capacity is generic.",
    alternatives: [
      "emitted today: always append `.to()`",
      "append only when rustType(value.type) !== rustType(target) or the target is an inout generic (chosen)",
    ],
    chosen: "append only when rustType(value.type) !== rustType(target) or the target is an inout generic",
  },
  shapes13_9: {
    improvement: "Passing an in-out on to another call prints `&mut (*numbers)`. When the place is the bare inout root, print the binding itself (`numbers`); Rust reborrows it implicitly.",
  },
  shapes13_10: {
    improvement: "Temporaries for a property setter argument and for an unbound function output become persistent `pub` fields of the PROGRAM/FB struct (clippy::pub_underscore_fields, 19 in this batch). They are also compared by PartialEq and printed by Debug. The setter can take the value directly (`self.fb.threshold_set(100i16)`), and an unbound output can be a call-scoped `&mut 0i16` or a `let mut` in the enclosing block.",
  },
  shapes13_11: {
    improvement: "A DUT struct always derives only Clone, so assigning it prints `.clone()` even when every field is Copy (i16, bool, IecString<4>). Derive Copy for structs whose fields are all Copy and let isCopy say so; the `.clone()` then goes away.",
  },
  shapes13_12: {
    improvement: "Every VAR_INPUT parameter is declared `mut`, and a blanket #[allow(unused_mut)] hides it. The IR shows whether the body writes the input (an assign whose target is that local slot, or a `&mut` lend of it). Print `mut` only then and drop unused_mut from the allow list.",
  },
  shapes13_13: {
    improvement: "AND/OR always print non-short-circuit `&`/`|`, so a side effect on the right runs as it does in the interpreter (clippy::needless_bitwise_bool, 48 here). When both operands are free of side effects (loads, consts, comparisons, no call), `||`/`&&` gives the same result.",
    alternatives: [
      "emitted today: `|` / `&` always (correct, avoids any evaluation-order divergence)",
      "`||`/`&&` when neither side contains a call (equivalent; chosen for readability)",
      "keep `|` everywhere and accept the lint (simplest emitter)",
    ],
    chosen: "`||`/`&&` when neither side contains a call (equivalent; chosen for readability)",
  },
  shapes13_14: {
    improvement: "Comparisons widen both sides to the promoted type. When both operands already have the same narrow type and the literal fits that type, the narrow comparison gives the same answer, e.g. `raw > 0i16`.",
    alternatives: [
      "emitted today: widen to i32 (always correct, including out-of-range literals)",
      "compare natively when the operand types are equal and the const fits (chosen at emit: exact and shorter)",
      "`i32::from(x)` instead of `as` (silences cast_lossless, not shorter)",
    ],
    chosen: "compare natively when the operand types are equal and the const fits (chosen at emit: exact and shorter)",
  },
  shapes13_15: {
    improvement: "LEN_INTERNAL only reads its argument but declares it VAR_IN_OUT, so it takes `&mut IecString<N>` and forces every caller's STRING input to be `mut`. Declare it VAR_IN_OUT CONSTANT (emitted as `&IecString<N>`). Its counter `(len_internal as i32).wrapping_add(1i32) as u16` can also count in DINT and convert once.",
  },
  shapes13_16: {
    improvement: "A library routine is lowered once per caller string type and per call context, yet every copy is already generic over `const N___STR_*`. The copies come out byte-identical apart from the name. Key the variant on the cursor shape (and not on capacity) or dedupe routines with identical bodies at emit.",
  },
  shapes13_17: {
    improvement: "An open array is passed as a slice plus hidden lower and upper DINTs, and in an FB these are stored as two pub fields per dimension. The upper bound is always lower + slice.len() - 1, so passing it again is redundant. Pass only the lower bound and compute UPPER_BOUND from `.len()`.",
  },
  shapes6_6: {
    improvement: "Fold all-constant integer and real expressions to a single literal. The comment already says 'folds at FULL width', but the IR still carries the operation: `2000000000i64.wrapping_add(2000000000i64)`, `100i64.wrapping_add(100i64) as i16`, `9i64.min(2i64) as i16`, `((-1e15f64) * 1e15f64) * self.grow`. Folding via evaluate.ts gives `4000000000i64`, `200i16`, `2i16`, `-1e30f64 * self.grow`.",
  },
  shapes6_7: {
    improvement: "A comparison of a narrow variable with a literal that fits its type is widened to DINT: `(self.a as i32) <= 3i32` where `self.a <= 3i16` is equal for every input, because widening is value-preserving for comparison. MIN(INT, INT) likewise prints `(self.a3 as i32).min(self.b7 as i32) as i16`, where `self.a3.min(self.b7)` is equal.",
    alternatives: [
      "today: promote both sides to DINT (the IEC register-width rule, needed for + - *)",
      "compare in the operands' own common type when the op is a comparison or MIN/MAX and every constant fits it. My choice: exact for every input and no casts",
      "`i32::from(self.a) <= 3`: clippy-pedantic's preferred lossless cast spelling, but longer",
    ],
    chosen: "compare in the operands' own common type when the op is a comparison or MIN/MAX and every constant fits it",
    why: "exact for every input and no casts",
  },
  shapes6_8: {
    improvement: "An assignment chain in a PROGRAM or FB body stores its temporary as a struct FIELD (`pub __chain_value_7: f64`, initialised in new()), which is persistent state that only ever holds one statement's value. Each link re-converts from the temp instead of reading the previous target: `self.out_l = (self.__chain_value_7 as f32) as f64` could be `self.out_l = self.mid_r as f64` (the same value, since mid_r was just assigned that conversion), or the temp could be a `let`.",
    alternatives: [
      "today: temp as struct field, re-convert the whole chain per link",
      "`let __chain_value = self.src_l;` a local, each link converting from the previous TARGET. My choice: no hidden field, one cast per link",
      "no temp at all when the value is a plain load with no side effect: `self.mid_r = self.src_l as f32; self.out_l = self.mid_r as f64;`",
    ],
    chosen: "`let __chain_value = self.src_l;` a local, each link converting from the previous TARGET",
    why: "no hidden field, one cast per link",
  },
  shapes6_9: {
    improvement: "A literal index prints `self.arr_uai[(0i8 as i64) as usize]`. A constant index already range-checked by lowering can print as `[0]`. The dynamic-lower-bound form uses `.wrapping_sub(...)` (callshape_array_star_fb_inout), while a static lower bound uses plain `-`. Choose one.",
  },
  shapes6_10: {
    improvement: "REAL math goes through f64 and back: `(self.arg as f64).exp() as f32`.",
    alternatives: [
      "today: widen to f64, compute, narrow. Matches the interpreter bit for bit, and is closer to the x87 extended-precision CODESYS computes with (mathret_* recorded equal)",
      "`self.arg.exp()` on f32: shorter, but a different float32 routine that can differ in the last ULP from both the interpreter and CODESYS",
      "Keep today's form: the cast is the price of parity, not waste",
    ],
  },
  shapes6_11: {
    improvement: "`iec_r2i32(self.big_real as f64) as u16` is correct against all 192 measured cells (re-probed: -2147483648.6, 9.3E18, 4294967295.5 and -0.4 agree between backends).",
    alternatives: [
      "today: one f64 helper per register width, then an `as` wrap into the destination",
      "a generic `fn iec_r2i32<T: From<f32>>`: saves the `as f64` on a REAL source but adds a trait bound; not worth it",
      "Keep today's form",
    ],
  },
  shapes6_12: {
    improvement: "`(self.a ^ self.c) ^ self.b` keeps parentheses around a left-associative same-operator chain. `self.a ^ self.c ^ self.b` is identical. `a | (b & c)` is fine as written.",
  },
  shapes6_13: {
    improvement: "Every loop in production Rust carries a u64 counter and a branch per iteration. Behind a cfg(test) or harness flag the emitted loop would be the plain `loop { if !cond { break } … }` a Rust engineer writes.",
  },
  shapes7_1: {
    improvement: "Fold all-constant integer subtrees. `v := 0 - 42` is emitted as `0i64.wrapping_sub(42i64) as i32`, `x := MAX(1,5,3)` as `1i64.max(5i64).max(3i64) as i16` (clippy::unnecessary_min_or_max), a shift count literal as `1i8 as u32`, and `d + T#1H` as `3600000u32 / 1000u32`. The declaration path already folds (lower/constants.ts foldConstant/constEval), and CODESYS folds these at compile time too.",
    alternatives: [
      "(a) TODAY: runtime i64 wrapping arithmetic then `as T`. rustc const-folds it, so it only costs readability.",
      "(b) fold in lowering to an IrExpr const of the destination type, reusing constEval. One place, and the interpreter benefits too. My choice.",
      "(c) fold only in the emitter when both operands are `const`. Smaller change, but a second folding rule.",
    ],
    chosen: "(b) fold in lowering to an IrExpr const of the destination type, reusing constEval. One place, and the interpreter benefits too",
  },
  shapes7_2: {
    improvement: "A comparison of two operands of the SAME narrow type (SINT/SINT, INT/INT, the same enum) is printed as `(a as i32) < (b as i32)`. Comparing in the operands' own type gives the same result, because a comparison cannot overflow. Only mixed-sign or mixed-width pairs need the lift.",
    alternatives: [
      "(a) TODAY: always promote to DINT, then compare.",
      "(b) skip the promotion when rustType(left) === rustType(right) for eq/ne/lt/le/gt/ge. My choice.",
      "(c) promote to the smallest common type (i16 for INT vs USINT). More rules, and little gain beyond (b).",
    ],
    chosen: "(b) skip the promotion when rustType(left) === rustType(right) for eq/ne/lt/le/gt/ge",
  },
  shapes7_3: {
    improvement: "Unary minus and ABS widen to i32 and narrow back: `(self.a as i32).wrapping_neg() as u8`, `(self.u200 as i32).wrapping_abs() as u8`. When the destination has the operand's width, `self.a.wrapping_neg()` / `self.a.wrapping_abs()` give the same bits. ABS of a promoted UNSIGNED operand is the identity (`self.u200`). When the result stays wide, `-(self.i_min as i32)` cannot overflow, so the wrapping call is dead.",
    alternatives: [
      "(a) TODAY: promote to DINT, wrapping_neg/wrapping_abs, then cast to the destination.",
      "(b) narrow-in/narrow-out → the operand's own wrapping_neg/wrapping_abs; unsigned ABS → the operand; widened result → plain `-`. My choice, because the bits are provably identical.",
      "(c) keep the IR as is and add a peephole in the emitter's `convert` for `(x as i32).op() as <x's type>`.",
    ],
    chosen: "(b) narrow-in/narrow-out → the operand's own wrapping_neg/wrapping_abs; unsigned ABS → the operand; widened result → plain `-`",
  },
  shapes7_4: {
    improvement: "Every widening cast is printed with `as` (`self.n as u32`, `self.x as f64`, `self.a as i32`). That is ~200 clippy::cast_lossless findings in this batch alone. A lossless widening reads better as `u32::from(x)` / `f64::from(x)`, and `as` would then mark only the conversions that truncate, wrap or reinterpret sign.",
    alternatives: [
      "(a) TODAY: `as` everywhere.",
      "(b) `T::from(x)` when the source→target is lossless (sign-preserving widening, integer ≤ 16 bits → f32, ≤ 32 bits → f64), `as` otherwise. My choice.",
      "(c) leave `as` and allow cast_lossless in the lint list. Zero effort, but the reader loses the lossy/lossless signal.",
    ],
    chosen: "(b) `T::from(x)` when the source→target is lossless (sign-preserving widening, integer ≤ 16 bits → f32, ≤ 32 bits → f64), `as` otherwise",
  },
  shapes7_5: {
    improvement: "TIME/DATE/DT/TOD → LTIME/LDT is `(self.v as u64).wrapping_mul(1000000u64)`, and a u32 count times at most 1e9 cannot overflow u64. TOD→DT is `((self.v as u64) / 1000u64) as u32`, which needs no u64 at all: it is `self.v / 1000`. The 64-bit work type is only needed where a mod-by-day follows an up-scaling (DT→TOD).",
    alternatives: [
      "(a) TODAY: always ULINT, wrapping_mul.",
      "(b) ULINT only when an up-scale feeds a day mask. Plain `*` where the product provably fits; stay in u32 for a pure down-scale. My choice.",
      "(c) keep ULINT and only swap wrapping_mul for `*`.",
    ],
    chosen: "(b) ULINT only when an up-scale feeds a day mask. Plain `*` where the product provably fits; stay in u32 for a pure down-scale",
  },
  shapes7_6: {
    improvement: "The chained-assignment temporary becomes a `pub __chain_value_N` FIELD of the POU struct: declared, initialised in new(), part of Debug/PartialEq and clippy::pub_underscore_fields. It holds a value only for one statement, so it should be a `let` local. The last link `(self.__chain_value_7 as f32) as f64` could also just read the target it has just written.",
    alternatives: [
      "(a) TODAY: a frame slot, i.e. a struct field.",
      "(b) a statement-scoped `let` (the MOD/SEL expansions already use `let __mod_l`). My choice.",
      "(c) evaluate once into the LAST target and read that target for each earlier link. Wrong when a target's index holds a call, so it is not general.",
    ],
    chosen: "(b) a statement-scoped `let` (the MOD/SEL expansions already use `let __mod_l`)",
  },
  shapes7_7: {
    improvement: "`self.into_wide = self.narrow.widen::<80>().to();` copies twice: widen already produces IecWString<80>, and `.to()` copies it again into the same capacity. `self.abc == IecString::<3>::lit(b\"abc\")` builds a whole string only to compare it. `self.abc.units() == b\"abc\"` (or `< &b\"z\"[..]` for ordering) compares the same used units.",
    alternatives: [
      "(a) TODAY: `.to()` on every string store; a literal is always an IecString::lit.",
      "(b) skip `.to()` when the value's printed type already has the target's capacity; compare against a literal via `units()` slices. My choice.",
      "(c) implement PartialEq<[T]> on IecStr and compare against `b\"abc\"[..]` directly.",
    ],
    chosen: "(b) skip `.to()` when the value's printed type already has the target's capacity; compare against a literal via `units()` slices",
  },
  shapes7_8: {
    improvement: "Every METHOD of a PROGRAM gets `prg: &mut Programs`, and a blanket `#[allow(unused_mut, unused_variables, unused_assignments)]` covers the unused ones (init_slot_program_own `boot`, fbcall_program_own_members `deeper`/`tidy`/`twice`). Pass `prg` only to routines that reach Programs, directly or through a callee, the way `usesPrograms` is already computed for scan.",
    alternatives: [
      "(a) TODAY: uniform signature for every routine of a program plus allow(unused).",
      "(b) per-routine reachability of Programs (a transitive call-graph flag). My choice: signatures then say what a routine touches.",
      "(c) keep the uniform signature and name it `_prg`. Silences the lint, keeps the noise.",
    ],
    chosen: "(b) per-routine reachability of Programs (a transitive call-graph flag)",
    why: "signatures then say what a routine touches.",
  },
  shapes7_9: {
    improvement: "`let c = if v < 0.0 { -((-v).round()) } else { v.round() };` is exactly `v.round()`: f64::round already rounds half away from zero, symmetrically.",
  },
  shapes7_10: {
    improvement: "`iec_div(self.int7 as f64, 2.0f64)` pays for a zero check and a generic call when the divisor is a non-zero constant. When the right operand is a `const` other than 0, print plain `/`.",
  },
  shapes7_11: {
    improvement: "`{ let mut v = T::new(); v.offset = 7i16; v }` is a block with a mutable temporary. Rust's struct-update syntax says the same thing in one expression.",
    alternatives: [
      "(a) TODAY: `{ let mut v = T::new(); v.f = x; v }`. Works for nested paths too.",
      "(b) `T { f: x, ..T::new() }`. Idiomatic; needs the field list to be the struct's own direct fields, which is exactly what `sets` holds. My choice.",
      "(c) generate a `T::with_f(x)` constructor. More code, no gain.",
    ],
    chosen: "(b) `T { f: x, ..T::new() }`. Idiomatic; needs the field list to be the struct's own direct fields, which is exactly what `sets` holds",
  },
  shapes11_7: {
    improvement: "A constant array index is printed as `[(1i8 as i64) as usize]`, or `[((1i8 as i64) - 1i64) as usize]` for a non-zero lower bound. It should fold to `[1]` / `[0]`. The same constant also comes out two ways in one fixture: xo_union_across_objects has both `halves[0i64 as usize]` and `halves[(0i8 as i64) as usize]`.",
  },
  shapes11_8: {
    improvement: "A runtime FOR step is printed in full three times per pass: twice in the test and once in the step. For callshape_for_runtime_step that is a SEL `if` each time. It is side-effect free because calls are refused, so it can be bound once per pass (`let __step = ...;`) and referenced.",
  },
  shapes11_9: {
    improvement: "When the body has no CONTINUE, only the label `'body_N:` is stripped and a bare `{ ... }` block is left around the body. Drop the braces too, as is already done for `'loop_N:`.",
  },
  shapes11_10: {
    improvement: "`WHILE TRUE` / `REPEAT ... UNTIL FALSE` print `if false { break; }`. When the negated test is the constant false, omit the line.",
  },
  shapes11_11: {
    improvement: "Lowering temps in a PROGRAM/FB body become persistent pub struct fields (`pub __chain_value_3: bool`, `pub __property_1: i16`). They are written before they are read in the same statement, so they should be Rust locals (`let chain = self.c;`), or passed directly (`self.fb_upw.threshold_set(100i16)`). Today they grow the FB's state and its PartialEq, and trip pub_underscore_fields.",
  },
  shapes11_12: {
    improvement: "VAR_TEMP arrays and structs are fields reset at the top of every call (`self.a = [0i16; 3];`, `self.scratch = T::new();`). As a Rust local (`let mut a = [0i16; 3];`) they would carry no reset and no persistent state.",
  },
  shapes11_13: {
    improvement: "initOf checks only the first array level for elementary elements, so a 2D array of f32/i16 prints `std::array::from_fn(|_| [0.0f32; 4])` where `[[0.0f32; 4]; 4]` is a const expression. Apply peelArray recursively: if the leaf is elementary, use nested repeat expressions.",
  },
  shapes11_14: {
    improvement: "With a constant non-zero divisor, the MOD block `{ let __mod_l = ...; let __mod_r = 2i32; if __mod_r == 0 { 0 } else { __mod_l.wrapping_rem(__mod_r) } }` reduces to `(self.i as i32) % 2`. `%` by a non-zero, non -1 constant cannot panic.",
  },
  shapes11_15: {
    improvement: "Integer + - * on INT operands whose result is stored straight back into an INT is emitted widened, when the narrow form gives the same stored result.",
    alternatives: [
      "Emitted today: `(self.sum as i32).wrapping_add(self.i as i32) as i16`. This is faithful to CODESYS's 32-bit intermediate, and it is required when the result feeds a compare, a division or a wider store.",
      "Narrow: `self.sum.wrapping_add(self.i)`. Truncating a wrapping add/sub/mul is a ring homomorphism, so the stored value is identical for every input. This is my choice when the consumer is a same-typed store, because it removes 3 casts and the cast_possible_truncation/cast_lossless findings.",
    ],
    chosen: "Narrow: `self.sum.wrapping_add(self.i)`. Truncating a wrapping add/sub/mul is a ring homomorphism, so the stored value is identical for every input",
  },
  shapes11_16: {
    improvement: "Comparing a variable with an in-range literal of the variable's own type widens both sides.",
    alternatives: [
      "Emitted today: `(self.n as i32) > 5i32`, uniform, and safe for out-of-range literals.",
      "Narrow: `self.n > 5i16`, used when the literal fits the variable's type (the answer cannot differ). The FOR test already emits `self.i > 10i16` for the same comparison, so one construct currently has two spellings. I would narrow when the constant fits.",
    ],
  },
  shapes11_17: {
    improvement: "BOOL AND is always `&`.",
    alternatives: [
      "Emitted today: `&` everywhere, so both sides are evaluated, which matches CODESYS AND and the interpreter.",
      "`&&` when the right side holds no call and no deref guard. It is identical in value and is idiomatic Rust. I would keep `&` because it is one uniform, provably faithful rule and clippy does not flag it.",
    ],
  },
  shapes11_18: {
    improvement: "`cursor := ADR(slots[0])` prints `0i64.wrapping_sub(-1i64) as usize`. The handle is a constant, so it can fold to `1`.",
  },
  shapes11_19: {
    improvement: "Negative literals in array initialisers are parenthesised: `[(-1i32), 0i32]` and `[1.0f32, (-3.0f32)]`. They should print as `-1i32`.",
  },
  shapes11_20: {
    improvement: "ST `x := x;` prints `self.copied = self.copied;`, which is clippy::self_assignment (a correctness-group lint) in initseq_member_of_struct and cc3_empty_and_noop. It could be dropped when target and source are the same side-effect-free place with no conversion.",
  },
  shapes17_1: {
    improvement: "A read-modify-write through a pointer or string cursor checks the same pointer twice: iec_deref(p); on the line before, then again in `{ iec_deref(p); *__str_p }` inside the value. In the StringUtils bodies the pointer has already been tested at entry (IF p = 0 THEN RETURN), so every check inside the loops is dead. Emit the guard once per statement, and none at all after a dominating null test. Also stop copying the whole IecStr (`*__str_p`, 88+ bytes, Copy) just to read one character: `__str_p.char_at(i)` borrows it.",
  },
  shapes17_2: {
    improvement: "A character store is emitted as `*s = { ..; *s }.with_char(i, c).to();`, which copies the string by value, rebuilds it through lit() in .to() at the SAME capacity, and moves it back. An in-place `s.set_char(i, c)` (&mut self) does the same thing with no copies. More generally, skip the .to() whenever source and target capacity are the same (REPLACE: `insert(..) }.to()` 255->255, then `.to::<80>().to()` at the call site converts twice).",
    alternatives: [
      "TODAY: value-style `*s = {copy}.with_char(i,c).to()`, which keeps the IR's load/setchar/assign triple literal",
      "in-place `s.set_char(i, c)`: the shortest form with no copies, and I would choose it, since the setchar is always stored straight back into the place it loaded",
      "keep value style but drop .to() when capacities match: the smallest emitter change",
    ],
    chosen: "in-place `s.set_char(i, c)`: the shortest form with no copies, and I would choose it, since the setchar is always stored straight back into the place it loaded",
  },
  shapes17_3: {
    improvement: "The same construct, index minus lower bound, is printed two ways. A fixed array gets a plain `(i - 1i64) as usize` (emit.ts:517). An ARRAY[*] dimension or a string cursor gets `(i as i64).wrapping_sub(lower as i64) as usize` or `(p as i64).wrapping_sub(1i64).wrapping_add(n as i64)`, because the offset goes through the generic IR sub/add, which prints as wrapping. Two i32 values widened to i64 cannot overflow, so the wrapping is noise. Give the open-array and cursor offset the index-step form the emitter already has (a `lower` expression on the step), so all three print `[(i - lower) as usize]`.",
  },
  shapes17_4: {
    improvement: "When one argument holds a call, EVERY argument is hoisted into its own `let __arg_N`, pure ones included (REPLACE: `let __arg_1 = str2; let __arg_2 = (p-1).max(0) as i16;`). Order only matters between arguments that have effects or read what an earlier one writes. Hoist only the call-holding arguments, plus anything evaluated before them that they could change, and leave pure locals and constants inline.",
    alternatives: [
      "TODAY: hoist all inputs when any holds a call. Simple and obviously order-preserving",
      "hoist only a prefix up to the last call-holding input. Still order-preserving, since trailing pure args cannot observe anything",
      "hoist only effectful inputs. The shortest, but it needs a purity analysis, which holdsCall almost is. I would choose the prefix rule: trivially correct and it removes the trailing lets",
    ],
    chosen: "hoist only effectful inputs. The shortest, but it needs a purity analysis, which holdsCall almost is. I would choose the prefix rule: trivially correct and it removes the trailing lets",
  },
  shapes17_5: {
    improvement: "Every call on a PROGRAM-owned instance moves the whole program out with std::mem::take, which builds a fresh PROGRAM::new() (every initialiser, every string lit) as a stand-in. It then moves it back, even when the callee never touches `prg` (FB_CS_relay20.map has `#[allow(unused_variables)]` on `prg`). Pass `prg` only to routines that transitively reach a program. Then `prg.prg_cs_station20.relay.map()` is a plain field call with no take. Re-entrancy is already refused by lowering (call-program-reentrant, verified with a probe), so the take only exists to satisfy the borrow checker.",
  },
  shapes17_6: {
    improvement: "TRUNC is printed inline as a 110-character block, `{ let t = (x as f64).trunc(); if (-2147483648.0..=2147483647.0).contains(&t) { t as i32 } else { i32::MIN } }`, at every use. REAL_TO_DINT already goes through a prelude helper (iec_r2i32). Emit an `iec_trunc_i32(v: f64) -> i32` helper next to it and call that. It is correct as it stands (NaN and out of range give i32::MIN, as measured).",
  },
  shapes17_7: {
    improvement: "INT arithmetic is widened to i32, done with wrapping ops and narrowed with `as i16`. For a chain of + - * stored straight back into an INT, i16 wrapping_* gives bit-identical results, because the ring homomorphism mod 2^16 holds. Only division, MOD, comparisons and shifts need the widening.",
    alternatives: [
      "TODAY: widen every operand to i32, wrapping_* in i32, then truncate with `as i16`. Uniform, and matches CODESYS's register width for / and comparisons",
      "native i16 wrapping_* for pure add/sub/mul chains that end in an INT store: fewer casts, same result. I would choose this for ring-only chains and keep the widening wherever /, MOD, a comparison or a shift is in the chain",
    ],
    chosen: "native i16 wrapping_* for pure add/sub/mul chains that end in an INT store: fewer casts, same result. I would choose this for ring-only chains and keep the widening wherever /, MOD, a comparison or a shift is in the chain",
  },
  shapes17_8: {
    improvement: "An ARRAY OF an interface is a `[u64; N]` of instance tags, but because the element kind is not 'elementary' it is initialised with `std::array::from_fn(|_| 0)`. Any Copy element whose init is a literal can be `[0; N]`.",
  },
  shapes17_9: {
    improvement: "An output nobody binds (f_state_split(9, ..)) is written into a persistent `pub __output_N` field of PLC_PRG (4 such fields in state_routine_outputs). A local `let mut __out = 0;` or a `&mut 0i16` temporary would keep the struct to the variables the ST declared.",
  },
  shapes17_10: {
    improvement: "A UNION whose members are all pointers is a struct of usize fields, and `u.p1_Byte := x` is followed by `u.p1_sint = u.p1_byte; u.p2_int = ..; ..` for every member. All the members share the same address, so one field would do. Relatedly, in an ANY_INT monomorph the CASE on the compile-time diSize (passed as a constant `1i32`) still emits all four arms, three of them dead reinterpretations of the caller's type.",
  },
  shapes17_11: {
    improvement: "Every parameter is `mut`, and a blanket allow hides it. The string-pointer parameters come in pairs (usize address + &mut IecString), which pushes StringUtils functions past clippy::too_many_arguments. Emit `mut` only on parameters the body assigns. For a cursor the address is always 1 unless it was stepped, so it could be omitted when never stepped. An ARRAY[*] also passes its upper bounds as arguments, when they are derivable from the slice length (lower + len - 1).",
  },
  shapes17_12: {
    improvement: "`(((uisearchstart as i32).max(1i32) as u16) as i32)` goes u16 -> i32 -> u16 -> i32. `(uisearchstart.max(1) as i32)` is the same value.",
  },
  shapes3_1: {
    improvement: "A single store into a UNION member expands to one statement per overlapping byte of every other member. Each statement is a mod/div/mul/add chain in u64, and each MOD carries a `let __mod_l..; if __mod_r == 0 {0} else {wrapping_rem}` block even though the divisor is the literal 256. c3/un.st (DWORD/ARRAY[1..2] OF WORD/ARRAY[0..3] OF BYTE/LWORD) emits about 30 lines of this for 4 ST stores.",
    alternatives: [
      "(a) TODAY: byte-wise arithmetic built in the IR, so the interpreter runs the same nodes.",
      "(b) Per member, from little-endian bytes: `let b = self.u.l.to_le_bytes(); self.u.d = u32::from_le_bytes(b[..4].try_into().unwrap()); self.u.b.copy_from_slice(&b[..4]);`. A byte-array member is written directly and a scalar goes through from_le_bytes. This needs an IR node such as `overlay(src, dst)` with a twin in the interpreter.",
      "(c) Lay the union out as one `[u8; N]` with get/set accessors per member, so no copies are needed. This is the biggest change.",
      "I would choose (b): an IR 'reinterpret bytes' node is small, keeps the interpreter in parity, and emits what a Rust engineer would write.",
    ],
    chosen: "I would choose (b): an IR 'reinterpret bytes' node is small, keeps the interpreter in parity, and emits what a Rust engineer would write.",
  },
  shapes3_2: {
    improvement: "Integer MOD by a non-zero CONSTANT still prints the zero-divisor guard block. When the right operand is a const ≠ 0 (and not -1 for signed), emit `(l % r)`. For unsigned operands, `wrapping_rem` is not needed.",
    alternatives: [
      "TODAY: the guarded block for every MOD",
      "`l % c` when c is a const outside {0, -1}",
      "I would choose the const fast path. It is correct for every input, since Rust `%` only panics on 0 and on MIN % -1.",
    ],
    chosen: "I would choose the const fast path. It is correct for every input, since Rust `%` only panics on 0 and on MIN % -1.",
  },
  shapes3_3: {
    improvement: "A constant index is printed through casts and an unfolded lower-bound subtraction: `self.pairs[(0i8 as i64) as usize]`, `self.dut_u.a_bytes[0i64 as usize]`, `self.u.w[(1i64 - 1i64) as usize]`. When step.index is a const, print `[value - lower]` as a bare usize literal.",
  },
  shapes3_4: {
    improvement: "The pointer tag arithmetic is never folded. ADR prints `1i64.wrapping_sub(-1i64) as usize` for the constant 2, and p[i] prints `(self.p as i64).wrapping_add(-1i64).wrapping_add(2i64) as usize`. Fold the constant ADR to a literal and merge the two const offsets into one. Because `iec_deref` has already rejected 0, the element index can be `self.p - 1 + k` in usize, with no i64 round trip.",
  },
  shapes3_5: {
    improvement: "The same construct, a read through a pointer or REFERENCE, is emitted two ways. A single target gives `{ iec_deref(self.ref_); self.first }` and several targets give `match self.ref_ { 1 => self.first, 2 => self.second, _ => panic!(..) }`. refdecl_rebound_by_statement shows both on adjacent lines.",
    alternatives: [
      "TODAY: guard block for 1 target, match for 2 or more",
      "A match for every arity: `match p { 1 => x, _ => panic!() }` (clippy may call a single arm match_single_binding-adjacent; still clear)",
      "The guard form for every arity, via `iec_deref(p);` plus an indexable target table. That does not fit fields of different types.",
      "I would keep today's split, since the guard form is shorter for the common case, but share one panic helper so the message and the code path are single-sourced.",
    ],
  },
  shapes3_6: {
    improvement: "Every call of a PROGRAM becomes `{ let mut program = std::mem::take(&mut prg.p); program.call(prg); prg.p = program; }`, even when the program's body never touches `prg`. That costs a full `P::new()` (all arrays and strings initialised) per call, plus a `#[allow(unused_variables)]` for the unused `prg`. Seen in c3/prgin.st, init_slot_program_own and sn_program_mismatch. Pass `prg` only to programs that reach Programs, and call them as `prg.p.call()` with no take. The two sites also disagree on the temporary's name (`__program` vs `program`). The method form at 599 leaves a trailing `};` in statement position (init_slot_program_own.rs:67), which is clippy unnecessary_semicolon.",
    alternatives: [
      "TODAY: mem::take on every program call (requires Default)",
      "A direct `prg.p.call()` when the callee's closure does not reach Programs, with take kept for the rest",
      "Split borrows: pass only the other programs' fields. This is a larger change.",
      "I would choose the second option. It is a static fact lowering already computes (it refuses self-reentry).",
    ],
    chosen: "I would choose the second option. It is a static fact lowering already computes (it refuses self-reentry).",
  },
  shapes3_7: {
    improvement: "A structured initial value is emitted as a block that mutates a fresh value: `{ let mut v = T::new(); v.x = 1i16; v.y = 2.5f32; v }`, nested for a struct inside a struct. Struct update syntax, `T { x: 1i16, y: 2.5f32, ..T::new() }`, is the idiomatic single expression and needs no shadowed `v`.",
  },
  shapes3_8: {
    improvement: "`let c = if v < 0.0 { -((-v).round()) } else { v.round() };` equals `v.round()` for every f64, because f64::round already rounds half away from zero symmetrically (including -0.0 and NaN). The measured table (r2ilad_*, r2i_*_nan/inf, trunc_beyond_dint) otherwise matches both helpers; I found no wrong input.",
  },
  shapes3_9: {
    improvement: "Every METHOD, ACTION and FUNCTION carries `#[allow(unused_mut, unused_variables, unused_assignments)]` (438 of 2333 files), including bodies with no locals or parameters at all, such as `widen`, `clamp` and `narrow`. Emit each allow only when the routine has a local, parameter or initialiser that can trigger it.",
  },
  shapes3_10: {
    improvement: "LIMIT over INT operands is printed widened and narrowed back: `(self.i_raw as i32).max(0i32).min(100i32) as i16`. The result of min/max over same-typed operands cannot leave that type, so `self.i_raw.max(0i16).min(100i16)` is equal for all inputs. Skip the promotion for min, max and limit when all operands share a type.",
  },
  shapes3_11: {
    improvement: "Conversions and divisions of CONSTANTS are not folded: `true as u8`, `5u8 as u32`, `-1i8 as i16`, `300i32 as i8` (=44), `5u8 != 0`, `iec_div(1.0f64, 3.0f64)`, and a whole TRUNC range-check block on `(-2.7f64)`. When the operand is a const, print the converted literal. When a real divisor is a non-zero const, print `/` instead of `iec_div`.",
  },
  shapes3_12: {
    improvement: "The in-out binding dispatch prints as `(match self.derived.__inout_binding { 1 => self.derived.bump(&mut self.v), _ => panic!(..) });` as a statement. The parentheses plus `;` are what clippy::unnecessary_semicolon names. Forwarding an in-out prints `self.add_ten(&mut (*shared))` where `shared` is already `&mut i16`, so a plain `self.add_ten(shared)` is enough. The tag field is `pub __inout_binding: i32` (clippy pub_underscore_fields).",
  },
  shapes3_13: {
    improvement: "In set_reset_chained, the S=/R= chain temporary is a pub struct FIELD (`self.__chain_value_3 = self.c;`) rather than a local `let`, which adds a pub_underscore_fields lint and bloats state. A local `let c = self.c;` is enough because the value never lives across scans.",
  },
  shapes18_1: {
    improvement: "Per-call scratch in an FB or PROGRAM body (a discarded VAR_OUTPUT `__output_N`, a property-setter value `__property_N`, an in-out guard or index `__inout_guard_N`/`__inout_index_N`) becomes a persistent `pub` struct field. It gets initialised in new(), carried by Clone/PartialEq/Debug, and trips clippy::pub_underscore_fields. The same temp inside a METHOD is a `let mut` local (tempPlace's routineMode branch), so one construct is emitted two ways. A body could collect these as locals too: a `let mut __output_10 = 0i16;` at the top of call()/scan(), or declared at the statement. The value never outlives the statement that writes it.",
  },
  shapes18_2: {
    improvement: "A property write `inst.P := v` always goes through a temp: `let mut __property_0: i16 = 0i16; __property_0 = v; self.level_set(__property_0);`, or `self.__property_1 = 100i16; self.fb_upw.threshold_set(self.__property_1);`. You only need the temp when evaluating the value needs a `&mut` borrow that overlaps the receiver, e.g. `self.level_set(self.level_get() + 5)` where the getter takes `&mut self`. For a literal or a plain field read, `self.fb_upw.threshold_set(100i16)` compiles and does the same thing. The alternative is to pass the value straight in as the invoke input and bind a temp only when the value contains an invoke on the same instance.",
    alternatives: [
      "temp always, as today: simple, and every borrow shape compiles",
      "direct argument when the value has no invoke, `let` temp otherwise (my choice: most property writes are literal or field reads)",
    ],
    chosen: "direct argument when the value has no invoke, `let` temp otherwise",
    why: "most property writes are literal or field reads",
  },
  shapes18_3: {
    improvement: "Passing a lent instance or an in-out on to another call prints `&mut (*__lent_0)`, and a method call on an in-out string prints `len((*text).to::<255>())`. `__lent_0` is already a `&mut T`, so passing `__lent_0` reborrows implicitly (or `&mut *__lent_0` without the parentheses). Method calls auto-deref, so `text.to::<255>()` works. Fix: in the `&mut` argument path at :435, if the place is a bare borrowed root (inout/lent, empty path), emit the name alone. Also treat a following method call like a field step in deref().",
  },
  shapes18_4: {
    improvement: "castTo wraps a constant in a cast even though its value is known. Today: `2882343476u32 as u64`, `self.slots[(0i8 as i64) as usize]`, `self.mask.wrapping_shl(20i8 as u32)`, `rotate_right(4i8 as u32)`. When the operand is an IR const that fits the target type, print the literal in the target type instead: `2882343476u64`, `self.slots[0]`, `wrapping_shl(20)`. The value is identical: an in-range constant keeps its value through `as`, and a negative shift count can still go through the cast. Removes clippy cast_lossless/cast_possible_truncation/cast_sign_loss on these lines.",
  },
  shapes18_6: {
    improvement: "Comparing an INT to a literal widens both sides: `(i_value as i32) < 0i32`, `(path.used as i32) < 3i32`, `(self.n as i32) <= 12i32`. That is always correct, and the lowering comment explains why: a narrow compare against an out-of-range literal (`i < 40000`) would be wrong. When the constant fits the variable's own type, though, `i_value < 0` gives the same answer and reads the way you would write it.",
    alternatives: [
      "widen both sides always (today): one rule and never wrong, but costs a cast and clippy::cast_lossless on every narrow compare",
      "compare in the narrow type when the other side is a constant that fits it, widen otherwise (my choice: same answers, the common case of `x < 3` becomes idiomatic, and out-of-range literals keep the widened form)",
    ],
    chosen: "compare in the narrow type when the other side is a constant that fits it, widen otherwise",
    why: "same answers, the common case of `x < 3` becomes idiomatic, and out-of-range literals keep the widened form",
  },
  shapes18_7: {
    improvement: "INT division by a nonzero constant other than -1 prints as `((value as i32) / 10i32) as i16`. With a constant divisor d where d != 0 and d != -1, the quotient always fits the dividend's own width, so `value / 10i16` in i16 gives the same answer and cannot panic. The widening only matters for a variable divisor (MIN / -1 must wrap in SINT/INT and not trap, which is measured).",
    alternatives: [
      "widen, divide, narrow (today): uniform, and correct for the variable-divisor MIN/-1 case",
      "narrow division when the divisor is a constant other than 0 and -1 (my choice for constants, keep the widening for variables)",
    ],
    chosen: "narrow division when the divisor is a constant other than 0 and -1 (my choice for constants, keep the widening for variables)",
  },
  shapes18_8: {
    improvement: "An array of interface slots (and of pointers or references) is Copy, but `initOf` checks `array.element.kind === \"elementary\"`, so it prints `std::array::from_fn(|_| 0)`. Use `isCopy(array.element)` (already defined at :305) to pick `[0; N]`, and keep from_fn for structs and FB instances, which are not Copy.",
  },
  shapes18_9: {
    improvement: "Every VAR_INPUT is `mut` whether or not the body writes it (`configure(&mut self, mut i_width: i16, mut i_height: i16)` never assigns either one). The `#[allow(unused_mut)]` on every routine hides that. The IR already knows which slots a routine body assigns, so it can print `mut` only for those. That would let `unused_mut` come off the allow list.",
  },
  shapes18_10: {
    improvement: "The function-result variable is always declared with a default, assigned, and returned: `let mut inner: IecString<40> = IecString::<40>::lit(b\"\"); inner = IecString::<40>::lit(b\"FB_CP_named.Inner\").to(); inner`. This is faithful to ST, where the result can be read before it is set. When a body's first statement unconditionally assigns the result and nothing reads it earlier, the declaration could take that value directly, or the body could end in the expression. For strings it also saves building a throwaway empty IecString.",
    alternatives: [
      "default-then-assign (today): uniform, always matches ST's read-before-write semantics",
      "initialise at the first unconditional write when nothing reads the result before it (smaller, but needs a definite-assignment pass)",
    ],
  },
  shapes14_2: {
    improvement: "A constant that is cast or used as an index should be printed already typed or folded. `char_at(0i8 as i64)` becomes `char_at(0)`, and `values[((1i8 as i64) - 1i64) as usize]` becomes `values[0]`. Literals come out typed as the smallest type (SINT), then castTo adds `as i64`, and the lower-bound subtraction is done at run time.",
  },
  shapes14_3: {
    improvement: "Leave out the store's `.to()` when the value is already the target's IecStr<N>: a same-capacity with_char result, a literal already built at the target capacity, or a value that ends in `.to::<N>()`/`.narrow::<N>()`. Leave out `.to::<N>()` when source and target capacity are equal. Today `left = left.with_char(n as i64, 0u8).to();` and `self.left_two = left(...).to::<80>().to();` each copy the string twice.",
    alternatives: [
      "emitted today: always `.to()` on a string store. Always correct, because Rust infers the target N, and it covers a generic-capacity VAR_IN_OUT target",
      "skip `.to()` when rustType(value.type) === rustType(target.type). A string can only be typed-identical when its capacity matches. I would choose this: the type is already known at both ends",
    ],
    chosen: "skip `.to()` when rustType(value.type) === rustType(target.type). A string can only be typed-identical when its capacity matches",
    why: "the type is already known at both ends",
  },
  shapes14_4: {
    improvement: "When an add, sub or mul on a narrow integer is widened to i32 and then narrowed straight back to the operand's own type, the widening does nothing, because wrapping is modular. Print `len_internal = len_internal.wrapping_add(1);`, not `(len_internal as i32).wrapping_add(1i32) as u16`.",
    alternatives: [
      "emitted today: widen to i32, wrapping op, narrow. Faithful to CODESYS's register-width promotion, and needed for DIV and for comparisons",
      "x.wrapping_add(L) in the narrow type. Bit-identical for +,-,* whenever the result is stored back into a type no wider than the operands. I would choose this for add/sub/mul whose consumer is a same-width store, and keep the widening everywhere else",
    ],
    chosen: "x.wrapping_add(L) in the narrow type. Bit-identical for +,-,* whenever the result is stored back into a type no wider than the operands. I would choose this for add/sub/mul whose consumer is a same-width store, and keep the widening everywhere else",
  },
  shapes14_5: {
    improvement: "An INT or SINT division is widened to i32 so that MIN / -1 does not trap. That is measured: arithedge_int_div_min_by_minus_one gives -32768. `x.wrapping_div(y)` in the narrow type gives the same value and still panics on a zero divisor.",
    alternatives: [
      "emitted today: widen to i32, plain `/`, narrow. Correct: MIN/-1 fits in i32, and 0 panics like CODESYS",
      "i16::wrapping_div. Same values, and divide-by-zero still panics. I would use it only for widths below 32, because DINT/LINT must keep plain `/` to trap MIN/-1 as CODESYS does",
    ],
  },
  shapes14_6: {
    improvement: "Leave out the widening casts on a comparison whose two sides already have the same Rust type, or the same signedness with one side a literal that fits. `self.q = self.cv == 0;`, `helpissameignorecase = chartoupper(by1) == chartoupper(by2);`, `if self.x.drive.travelled > 10 {`.",
    alternatives: [
      "emitted today: both sides promoted to i32. Needed for mixed-sign pairs such as BYTE vs SINT or UDINT vs DINT (measured same_width_mixed_sign_order)",
      "compare in the common type when both sides are the same type. I would choose this: promotion cannot change the result of an ordering between two values of one type",
    ],
    chosen: "compare in the common type when both sides are the same type",
    why: "promotion cannot change the result of an ordering between two values of one type",
  },
  shapes14_7: {
    improvement: "WHILE and FOR print as `loop { if !(cond) { break; } body; step }`. `while cond { … }` / `for`-style is what a Rust engineer writes. The loop-form is kept because of CONTINUE-before-step. Also `negated` does not apply De Morgan's law: `!((i < n) & (i < last))` could be `(i >= n) | (i >= last)`.",
    alternatives: [
      "emitted today: loop + negated break. Correct for a CONTINUE that must still run the FOR step, and for the limit being re-evaluated every pass (measured callshape_for_limit_call: 4 limit reads for 3 passes)",
      "`while cond { body }` for WHILE with no CONTINUE, and a labelled block for the FOR step. I would choose while for WHILE only; FOR keeps loop+break because its limit is re-read each pass",
    ],
    chosen: "`while cond { body }` for WHILE with no CONTINUE, and a labelled block for the FOR step. I would choose while for WHILE only; FOR keeps loop+break because its limit is re-read each pass",
  },
  shapes14_8: {
    improvement: "A library routine that takes a string pointer is lowered once per argument capacity (`strcmpa_pby1_string80_pby2_string30` and `strcmpa_pby1_string80_pby2_string80` sit side by side). Each copy is ALSO generic over the capacity, so the bodies are identical. Key the cursor variant by width (STRING/WSTRING), offset and sharing only.",
  },
  shapes14_9: {
    improvement: "Passing on a caller's own `&mut` in-out prints `&mut (*__str_pstring)`, an explicit reborrow that clippy::borrow_deref_ref names. Pass `__str_pstring` itself.",
  },
  shapes14_10: {
    improvement: "Reading a character through a string cursor copies the WHOLE IecStr out of the block before calling char_at: `{ iec_deref(p); *__str_p }.char_at(i)`. A store also checks the pointer twice (guardLine and then the guarded load on the right-hand side). Print `{ iec_deref(p); __str_p.char_at(i) }`, and check once per store.",
  },
  shapes14_11: {
    improvement: "An unbound METHOD VAR_OUTPUT becomes a PERSISTENT struct field (`pub __output_2: i16` on the caller's FB), which is initialised, cloned and compared along with the rest of the state. The method resets its outputs on entry (`*extra = 0i16;`), so a call-local `let mut __out = 0i16; self.v.m(&mut __out)` is enough.",
  },
  shapes14_12: {
    improvement: "Hoisting inputs into `let __arg_k` exists to fix evaluation order between inputs. A FUNCTION call with a single input and no in-outs has no order to fix. Print `f_x3_double(f_x3_double(value))`.",
  },
  shapes14_13: {
    improvement: "`let c = if v < 0.0 { -((-v).round()) } else { v.round() };` is exactly `v.round()`, because Rust's round is already half-away-from-zero and symmetric.",
  },
  shapes14_14: {
    improvement: "Mark a parameter `mut` only when the body assigns it, and return the value directly when the result is assigned once at the end. That removes the blanket allow attribute.",
  },
  shapes14_15: {
    improvement: "An ARRAY[*] passes both bounds per dimension as extra i32 arguments, and an FB stores them as fields set before each call (`self.filler.__numbers_lower_1 = 1i32; self.filler.__numbers_upper_1 = 2i32;`). The upper bound is always lower + slice.len() - 1, so only the lower bound needs passing.",
    alternatives: [
      "emitted today: lower and upper both passed. Simple, and UPPER_BOUND is a plain read",
      "upper derived as `lower + grid.len() as i32 - 1` (and N for inner dims). I would choose this: one source of truth, so the bound and the slice cannot disagree",
    ],
    chosen: "upper derived as `lower + grid.len() as i32 - 1` (and N for inner dims)",
    why: "one source of truth, so the bound and the slice cannot disagree",
  },
  shapes14_16: {
    improvement: "`IecWString::<80>::lit(&[97u16, 98u16, 99u16])` needs no per-element suffix, since the slice type is inferred from lit's T: `&[97, 98, 99]`. An empty literal `IecString::<8>::lit(b\"\")` is `IecString::<8>::new()`.",
  },
  shapes14_17: {
    improvement: "Comparing a string with a literal builds a whole IecStr to compare against. `text.units() == b\"abc\"` (or at least drop the parens around `*text`) does the same with no construction.",
  },
  shapes14_18: {
    improvement: "Every LEN call copies its argument into a 256-byte STRING(255) by value. The library body only reads it, so taking the argument by reference and generic over N (like the cursor in-outs) avoids the copy.",
    alternatives: [
      "emitted today: a by-value STRING(255) input. Matches the declared input and truncates a longer string at 255, as the vendor's 255 limit does",
      "&IecStr<u8, N> generic, with the cut at 255 inside the body. Saves the copy, but changes the input-copy semantics a callee could observe if it wrote its input. Worth it only for bodies proven read-only",
    ],
  },
  shapes15_1: {
    improvement: "A string store is copied twice: the IR convert prints `.to::<80>()` and the assignment appends another `.to()` to the same capacity. The assignment should add `.to()` only when the value's capacity differs from the target's, or only for a generic (VAR_IN_OUT) target, which is the one case its comment justifies.",
    alternatives: [
      "today: `.to::<80>().to()`, a convert plus an unconditional assign copy",
      "drop the assign's `.to()` when the typed capacity already equals the target's (the one I would choose: same truncation, one copy)",
      "drop the IR convert and let the assign's inferred `.to()` truncate, which loses the explicit capacity in the text",
    ],
    chosen: "drop the assign's `.to()` when the typed capacity already equals the target's (the one I would choose: same truncation, one copy)",
  },
  shapes15_2: {
    improvement: "`s[i] := c` prints `x = x.with_char(i, c).to();`. That is a by-value copy of the whole string, a rebuild, and then a same-capacity `.to()` copy back. A `fn set_char(&mut self, i: i64, c: T)` in the prelude, printed as `x.set_char(i, c);`, is the idiomatic in-place form.",
    alternatives: [
      "today: `x = x.with_char(i, c).to()` (value in, value out, re-truncated)",
      "`x.set_char(i, c)` taking &mut self (the one I would choose: no copy, same panic contract)",
    ],
    chosen: "`x.set_char(i, c)` taking &mut self (the one I would choose: no copy, same panic contract)",
  },
  shapes15_3: {
    improvement: "A literal typed in its IEC type and then cast: `self.buf.char_at(4i8 as i64)`, `entries[(0i8 as i64) as usize]`, `values[((1i8 as i64) - 1i64) as usize]`. castTo should print a constant directly in the target type (`4i64`, or bare `4`), and a constant index minus a constant lower bound should fold to `[0]`.",
  },
  shapes15_4: {
    improvement: "`x := x * 3` on INT prints `x = (x as i32).wrapping_mul(3i32) as i16;`. When the result goes straight back into the narrow type, `+ - *` modulo 2^16 is the same computed in i16: `x = x.wrapping_mul(3);`. The widening matters only for comparisons, division and a wider destination.",
    alternatives: [
      "today: widen to i32, wrapping op, `as i16` (always correct and uniform, mirrors the interpreter's promotion)",
      "narrow-type `wrapping_*` when a whole add/sub/mul tree lands in the same width, which is correct because the ring is mod 2^n (the one I would choose, as an emit-time peephole that never applies to div/MOD/compare, since i16::MIN / -1 differs)",
    ],
    chosen: "narrow-type `wrapping_*` when a whole add/sub/mul tree lands in the same width, which is correct because the ring is mod 2^n (the one I would choose, as an emit-time peephole that never applies to div/MOD/compare, since i16::MIN / -1 differs)",
  },
  shapes15_5: {
    improvement: "`IF POS >= 1 AND LEN > 0` prints `((pos as i32) >= 1i32) & ((len as i32) > 0i32)`, and CTU prints `(self.cu & (!self.mu)) & ((self.cv as i32) < 65535i32)`. A comparison of a narrow variable with a literal that fits needs no widening (`pos >= 1`), and on side-effect-free operands `&&` is the idiomatic spelling.",
    alternatives: [
      "today: widen both sides and use non-short-circuit `&`/`|` everywhere (right when the right side calls something, as the 2026-09-15 review found)",
      "`&&`/`||` only when neither side holds an invoke, and compare in the narrow type when the literal fits (the one I would choose)",
    ],
    chosen: "`&&`/`||` only when neither side holds an invoke, and compare in the narrow type when the literal fits (the one I would choose)",
  },
  shapes15_6: {
    improvement: "`g: &mut Globals` is threaded into EVERY body once any global is used, with a blanket `#[allow(unused_variables)]`. In initseq_reads_global the FB's `call(&mut self, g)` never reads g. The emitter could compute transitive global use per POU and pass g only where it is reached.",
    alternatives: [
      "today: uniform calling convention, simple and never wrong",
      "per-POU transitive usage, which is leaner Rust but needs a call-graph pass (I would keep today's convention and drop only the allow where g IS used)",
    ],
  },
  shapes15_7: {
    improvement: "Every routine takes every input as `mut`, starts with `let mut f: i16 = 0i16; f = X; f`, and silences the result with a blanket allow. A param is `mut` only when the body assigns it or lends it `&mut`. A return slot assigned once on every path could be `let f = X; f`, or just the tail expression.",
  },
  shapes15_8: {
    improvement: "A lent `POINTER TO` input keeps its now-dead value parameter: `f_lang_ptrtwo(0, &mut self.first)` with `mut p: usize` never read, because lowering refuses any other use of p. The value parameter can be dropped when the pointer is lent.",
  },
  shapes15_9: {
    improvement: "`(*x)` and `&mut (*x)` are printed where auto-deref and implicit reborrow do the job: `(*str).char_at(..)` could be `str.char_at(..)`, `self.inner.call(&mut (*numbers))` could be `self.inner.call(numbers)`, and `((*x) as i32)` could be `(*x as i32)`.",
  },
  shapes15_10: {
    improvement: "`ref_.Size := 7` becomes `self.__property_4 = 7i16; { iec_deref(self.ref_); self.c.size_set(self.__property_4) };`. The staging temp is a PUBLIC STRUCT FIELD that persists on the FB. It exists for borrow reasons only when the value calls a getter on the same instance. For other values the setter can take the value directly, and otherwise a block-local `let` does the job without adding state to the struct.",
  },
  shapes15_11: {
    improvement: "An empty-string initializer prints `IecString::<255>::lit(b\"\")`. `IecString::<255>::new()` (or Default) says the same thing without the slice copy.",
  },
  shapes15_12: {
    improvement: "A WSTRING literal prints as `IecWString::<10>::lit(&[104u16, 101u16, ...]).to()`, one typed u16 per char, and is built at its own capacity and then copied. A prelude `IecWString::from_str(\"he\")` (encode_utf16), or building at the target capacity, reads as the source and drops the copy.",
  },
  shapes15_13: {
    improvement: "The same construct, an index minus its lower bound, is printed two ways: `[(i - 1i64) as usize]` for a fixed array and `[(u as i64).wrapping_sub(l as i64) as usize]` for ARRAY[*]. The ARRAY[*] bounds also travel as persistent FB fields that each hop re-copies (`self.inner.__numbers_lower_1 = self.__numbers_lower_1;`), where `numbers.len()` plus one lower-bound parameter would carry them. At minimum, pick one subtraction spelling.",
  },
  shapes15_14: {
    improvement: "Every LEN/LEFT/MID/... call copies its argument into a fresh IecString<255> (`len(self.hello.to::<255>())`), and LEN then lends that copy `&mut` to LEN_INTERNAL. A read-only STRING input could print as a generic `&IecStr<u8, N>`, as the VAR_IN_OUT CONSTANT form already does (shape 81253ce291), which removes the 256-byte copy per call.",
  },
  shapes15_15: {
    improvement: "A cursor store through a pointer prints `iec_deref(p);` on the line before it and then `{ iec_deref(p); *__str_p }` again inside the same expression, so the same null check runs two or three times per statement (StringUtils STRMIDA/STRREPLACEA). Guarding each pointer once per statement is enough.",
  },
  shapes8_1: {
    improvement: "f64::round already rounds half away from zero symmetrically, so `-((-v).round())` equals `v.round()` for every v < 0, including the -0.0 results. The branch is dead weight: `let c = v.round();`.",
  },
  shapes8_2: {
    improvement: "`RangeBounds::contains` is already false for NaN, so `c.is_nan() ||` is redundant: `if !(-9.2e18..1.8e19).contains(&c) { return i64::MIN; }`.",
  },
  shapes8_3: {
    improvement: "When both operands already have the destination's width and signedness, and the promoted result is stored straight back at that width, the i32 detour changes nothing for add/sub/mul (congruent mod 2^n), and/or/xor, and min/max. Division, shifts, comparisons and mixed signedness still need the widening.",
    alternatives: [
      "(a) today: `(self.b as i32).wrapping_add(100i32) as u8`. Always correct and mirrors the IR's promotion, but costs 2-3 casts per op and fires clippy cast_possible_truncation, cast_sign_loss and cast_lossless.",
      "(b) narrow peephole: `self.b.wrapping_add(100)` / `self.a & self.b` / `self.a.min(self.b)`, used when the convert(promoted) node is immediately narrowed to the operands' own type and the op is width-agnostic.",
      "(c) keep the i32 for signed-unsigned mixes (max_signed_unsigned needs it) and for div/shr/compare.",
      "I would choose (b) with (c)'s exclusions. It is what a Rust engineer writes and it removes most of the arith-tier cast lints, but it needs a lowering rule listing which ops are width-agnostic.",
    ],
    chosen: "I would choose (b) with (c)'s exclusions. It is what a Rust engineer writes and it removes most of the arith-tier cast lints, but it needs a lowering rule listing which ops are width-agnostic.",
  },
  shapes8_4: {
    improvement: "`.%W0` / `.%B0` shift by `0i16 as u32`, which is a dead shift plus a pointless cast: emit `self.d as u16`. For other offsets the count is a known in-range constant, so emit `(self.d >> 16) as u16` and `(self.d >> 3) & 1 != 0`. The `load` bit path at emit.ts ~662 already skips `>> 0`; partial access should follow it.",
  },
  shapes8_5: {
    improvement: "A literal count prints as `7i8 as u32`. Print the bare literal (`7`). When the count is a constant below the operand width, `>>`/`<<` state it directly.",
    alternatives: [
      "(a) today: `x.wrapping_shl(7i8 as u32)` for every count. Uniform, and correct for variable counts (x86 masks the count).",
      "(b) `x << 7` when the count is a constant in [0, width). Cannot panic, and is idiomatic.",
      "Choose (b) for constants, and keep wrapping_* with `as u32` only for variable counts.",
    ],
    chosen: "(b) for constants, and keep wrapping_* with `as u32` only for variable counts.",
  },
  shapes8_6: {
    improvement: "An all-literal MAX/MIN/LIMIT is not folded, even though lowering can fold through ir/evaluate.ts. It is also computed in i64 and cast. The MUX arms could be typed at the result type: `match k { 0 => 10, 1 => 20, _ => 30 }`.",
    alternatives: [
      "(a) today: `1i64.max(5i64).max(3i64) as i16`",
      "(b) fold the constant: `self.three = 5;`",
      "(c) no folding, but type the literals in the destination type: `1i16.max(5).max(3)`",
      "Choose (b). The folding already exists for declaration initializers and is proven equal to runtime (constant-folding.ts).",
    ],
    chosen: "(b). The folding already exists for declaration initializers and is proven equal to runtime (constant-folding.ts).",
  },
  shapes8_7: {
    improvement: "When the divisor is a non-zero constant, the zero check is dead. Print `self.real7 / 2.0`, or fold a literal/literal quotient to `3.5f32`. The same applies to MOD by a non-zero constant: `x.wrapping_rem(3)` without the `let __mod_*` block.",
  },
  shapes8_8: {
    improvement: "For SQRT alone, f32::sqrt is correctly rounded, and so is f64 sqrt narrowed to f32, because 53 >= 2*24+2 makes double rounding harmless. The two are bit-identical, so `x.sqrt()` is exact and shorter. Trig, log and exp must stay on the f64 path.",
    alternatives: [
      "(a) today: `(x as f64).sqrt() as f32`. One rule for every math builtin.",
      "(b) `x.sqrt()` for a REAL argument and REAL result. Same bits.",
      "Choose (b) only if the emitter already special-cases per function. Otherwise the uniformity of (a) is defensible.",
    ],
    chosen: "(b) only if the emitter already special-cases per function. Otherwise the uniformity of (a) is defensible.",
  },
  shapes19_1: {
    improvement: "A write through a pointer prints `iec_deref(p);` on the line before, and then the RHS read through the same pointer is guarded again inside `{ iec_deref(p); *x }`. The statement guard dominates the read, so the inner guard is dead. The lowering also sets the pointer to the constant 1 on the line just before (`p1 = 1; iec_deref(p1);`), so both checks can be dropped when the tag is a known non-zero constant.",
  },
  shapes19_2: {
    improvement: "Each ANY variant is already monomorphised per argument type, so diSize is a compile-time constant. It is still passed as a runtime `mut x: i32` parameter and `match`ed, which leaves 3 dead arms per variant. Folding diSize to a const prunes them. An ANY whose pValue is never read (state_any_input_sizes, type_any_function_input) still takes `&mut arg`. It needs no reference at all, and the string variant needs no `<const N>` generic, because its name already fixes STRING(10).",
  },
  shapes19_3: {
    improvement: "A CONSTANT index is not folded: `self.values[((1i8 as i64) - 1i64) as usize]` should be `self.values[0]`, and xo_interface_array_dispatch prints `self.ops[((Li8 as i64) - Li64) as usize]`. For a runtime index, several correct forms exist (see alternatives).",
    alternatives: [
      "today: `[((i as i64) - L) as usize]`. It is correct for every integer index type, and the widening avoids overflow at i16::MIN - 1.",
      "`[(i as usize).wrapping_sub(L)]`: one cast fewer, same panic-on-out-of-range behaviour (a negative index wraps to a huge usize). I would choose this for L > 0 on 64-bit, and the plain `[i as usize]` it already uses for L = 0.",
      "constant index: fold to a literal usize at emit time. Always choose this, since rustc also rejects an out-of-range constant at compile time the same way.",
    ],
    chosen: "`[(i as usize).wrapping_sub(L)]`: one cast fewer, same panic-on-out-of-range behaviour (a negative index wraps to a huge usize)",
  },
  shapes19_4: {
    improvement: "MIN/MAX of two operands of the same type is widened to DINT and narrowed back: `(self.raw as i32).min(g.g_low as i32) as i16`. MIN/MAX of equal types cannot overflow, so `self.raw.min(g.g_low)` gives the identical result.",
    alternatives: [
      "today: widen to the promoted type, then `.min`, then cast back.",
      "same-type `.min`/`.max` when both operands (before promotion) share a type. I would choose this: zero casts, identical results. Keep the widening only for a mixed meet (USINT vs SINT).",
    ],
    chosen: "same-type `.min`/`.max` when both operands (before promotion) share a type",
    why: "zero casts, identical results. Keep the widening only for a mixed meet (USINT vs SINT).",
  },
  shapes19_5: {
    improvement: "MUX over untyped literals meets at LINT, so the result is `(match k { 0 => 0i64, …, _ => 4i64 }) as i16`. The literals could be typed at the destination (INT) and the outer cast dropped.",
  },
  shapes19_6: {
    improvement: "The dispatch is always wrapped in parentheses, even as a statement (`(match … { … });`). A lent instance used as a method receiver is printed `(*__lent_0).area()`, where method auto-deref makes `__lent_0.area()` correct: the `through` test covers a field or index step but not a method call.",
  },
  shapes19_7: {
    improvement: "A scalar VAR_IN_OUT CONSTANT is copied into a let and lent by reference: `{ let __copy_0 = self.plain_var; self.twice(&__copy_0) }` into `twice(&mut self, value: &i16)`. For a Copy scalar the parameter can take `value: i16` by value: `self.twice(self.plain_var)`. Aliasing is already refused (call-inout-alias), so by-value is equivalent.",
    alternatives: [
      "today: a copy in a block plus `&T`. It works for every type, including IecString.",
      "by value for Copy scalars and `&IecString` only for strings. I would choose this: no block and no let.",
    ],
    chosen: "by value for Copy scalars and `&IecString` only for strings",
    why: "no block and no let.",
  },
  shapes19_8: {
    improvement: "Once any PROGRAM is called, every routine takes `prg: &mut Programs`. So a call into a program's member does `std::mem::take(&mut prg.p); p.m.level_get(prg); prg.p = p`, a move-out and move-back of the whole program struct, even when the callee (level_get) never touches prg. Passing prg only to routines that reach a program would reduce these calls to `prg.p.gauge.level_get()`.",
  },
  shapes19_9: {
    improvement: "ptrparam_method emits the generic `read(&mut self, mut p: usize, __ptr_p: &mut i16)` beside its per-target specialisations `read_ptr_p_0` and `read_ptr_p_1`, and nothing calls the generic one. The specialisations still take the unused `mut p: usize` and are called with a literal `0`. Drop the dead generic and the unused parameter.",
  },
  shapes19_10: {
    improvement: "INT/SINT +, - and * widen to i32 and narrow back. Several emissions are correct here (see alternatives).",
    alternatives: [
      "today: `(a as i32).wrapping_add(b as i32) as i16`. It is correct, and it matches the vendor's DINT promotion when the value is consumed wider (a comparison, or a DINT destination).",
      "same-width `a.wrapping_add(b)` when the destination is the operand width. It is bit-identical for +, - and * modulo 2^16 and saves 3 casts. I would choose it only where the result is immediately stored at that width. Keep the widening for / and MOD (MIN / -1) and for comparisons.",
    ],
    chosen: "same-width `a.wrapping_add(b)` when the destination is the operand width. It is bit-identical for +, - and * modulo 2^16 and saves 3 casts. I would choose it only where the result is immediately stored at that width. Keep the widening for / and MOD (MIN / -1) and for comparisons.",
  },
  shapes19_11: {
    improvement: "MOD by a non-zero CONSTANT still emits the zero-divisor block `{ let __mod_l = …; let __mod_r = 1000u32; if __mod_r == 0 { 0 } else { __mod_l.wrapping_rem(__mod_r) } }`. With a literal divisor it is just `x % 1000` (or `wrapping_rem` for a -1 divisor).",
  },
  shapes20_1: {
    improvement: "An add/sub/mul/neg chain over INT/SINT/UINT/WORD operands that is narrowed straight back to the operand width is computed in i32 and cast back. Wrapping add, sub and mul give the same answer mod 2^n, so the widening cannot change the stored result. I probed INT -32768*3+1, TO_INT(BYTE 255)+TO_INT(WORD 65535) and SINT/INT edges: the interpreter and rustc agree, and the narrow form matches bit for bit. Peephole in the emitter: `(a as i32).wrapping_OP(b as i32) as i16`, where a and b are already i16 or are literals, becomes `a.wrapping_OP(b)`. Only for add/sub/mul/neg and AND/OR/XOR, never for div/mod/compare/shift, and only when the chain ends in a narrowing cast.",
    alternatives: [
      "(a) today: widen to DINT, wrap, then `as i16`. This mirrors IEC promotion literally and is always right.",
      "(b) narrow wrapping ops `a.wrapping_mul(3).wrapping_add(1)`. Same result for add/sub/mul chains that end in a narrowing store, with no casts.",
      "Choose (b), applied as an emitter peephole when the IR chain is closed under wrap-homomorphic ops and ends in a convert back to the operand width. Keep (a) wherever the intermediate escapes (compare, div, mod, shift, wider store).",
    ],
    chosen: "(b), applied as an emitter peephole when the IR chain is closed under wrap-homomorphic ops and ends in a convert back to the operand width. Keep (a) wherever the intermediate escapes (compare, div, mod, shift, wider store).",
  },
  shapes20_2: {
    improvement: "A comparison of an INT with an in-range literal is widened on both sides, which is 6 casts on one line. The comment's reason (an out-of-range literal) does not apply when the literal fits the operand type. Also, AND/OR over two side-effect-free comparisons prints the bitwise `&`/`|`, which is clippy::needless_bitwise_bool (1-3 per timer fixture). The eager form is only needed when a side of the expression holds a call.",
    alternatives: [
      "(a) today: widen both sides and use bitwise `&`. Correct for every input.",
      "(b) keep the compare narrow when the literal fits the variable's type, and print `&&`/`||` when neither side holds a call (no observable short-circuit).",
      "Choose (b). The eager `&` is the right default only for impure operands.",
    ],
    chosen: "(b). The eager `&` is the right default only for impure operands.",
  },
  shapes20_3: {
    improvement: "LIMIT/MAX/MIN on INT operands widen every argument to i32 and cast the result back. Integer max/min is width-independent, so `g.g_low.max(self.raw).min(g.g_high)` is the same. I probed LIMIT with the inverted bounds (hi,lo) and -32768: both backends give -5. SEL's arms are widened the same way inside its `if`.",
  },
  shapes20_4: {
    improvement: "When the divisor is a literal, the zero test is decided at emit time. For a nonzero unsigned literal, plain `%` cannot panic. For a signed literal other than 0 and -1, plain `%` cannot panic either. So `self.difftime % 1000u32` replaces the 3-binding block. 1522 also widens INT to i32 for a MOD whose result goes back to i16. Remainder never needs widening: wrapping_rem already covers MIN % -1. A literal -1 is printed as `1i32.wrapping_neg()`, so it is not recognised as a constant (see the next item).",
    alternatives: [
      "(a) today: a generic guarded block for every MOD.",
      "(b) `l % r` for a nonzero literal r other than -1; `l.wrapping_rem(r)` for a variable r that is proven nonzero; the guarded block otherwise.",
      "Choose (b).",
    ],
    chosen: "(b).",
  },
  shapes20_6: {
    improvement: "When the value is already a convert to the target's own capacity, the assign adds a second truncating copy. `insert(...).to::<80>().to()` into an IecString<80> is two 81-byte copies where one does. This occurs 101 times across 64 fixtures. Skip the trailing `.to()` when the value's type equals the target type, or drop the convert when its only consumer is the assign.",
  },
  shapes20_7: {
    improvement: "A VAR_IN_OUT CONSTANT bound to a LITERAL gets a `let` copy before the call. The copy exists to avoid E0503 when a `&mut` of the same place sits beside it. A literal is no place, and a temporary lives to the end of the statement, so `f_ioc_matches3(&IecString::<80>::lit(b\"abc\"))` is enough. Keep the copy only when the bound value is a place, as in `self.twice(&__copy_0)` of `self.plain_var`, where it is needed.",
  },
  shapes20_8: {
    improvement: "Hoisting exists to make order visible between SEVERAL inputs, or to read a program before it is moved out. It fires for a single input (`len(concat(..))`), which has no order to show. On a PROGRAM method it also hoists constants (`let __arg_0 = 10i16;`, `true`, `false`), which cannot read the program. Hoist only inputs that hold a call when there are two or more of them, and on a program method only inputs that read `prg`.",
  },
  shapes20_9: {
    improvement: "The same construct, moving a value out of its owner for a call and putting it back, is emitted three ways: `let mut program = std::mem::take(..)`, `let mut __program = std::mem::take(..)`, and `.clone()` then write-back for an own field lent to an own METHOD. Lowering already refuses real aliasing (`call-inout-alias`, which I probed: a method that reads the field it is lent is refused), so the clone is a copy the program never needs. Use `std::mem::take` / `std::mem::replace` everywhere. For fixed arrays longer than 32, where `[T;N]: Default` does not hold, use `std::mem::replace(&mut self.points, <init>)`. Use one binding name.",
    alternatives: [
      "(a) today, for own fields: clone, call, write back.",
      "(b) `let mut t = std::mem::take(&mut self.points); self.shift(.., &mut t); self.points = t;`, which moves and does not copy.",
      "(c) split the borrow by making the method a free fn over the fields it touches. This is a bigger change.",
      "Choose (b). It matches the program-instance form already emitted.",
    ],
    chosen: "(b). It matches the program-instance form already emitted.",
  },
  shapes20_10: {
    improvement: "Lowering temps in an FB or program body (a property-set value, an in-out index captured before the call, a pointer guard) become persistent `pub` struct fields. They show in the struct, in PartialEq/Debug and in `new()`, and they cause clippy::pub_underscore_fields. They live for one statement, so a Rust `let` in the emitted body is enough: `self.tank.level_set(5i16)`, or `let idx = self.cursor; ...`.",
  },
  shapes20_11: {
    improvement: "Passing a whole VAR_IN_OUT on to another routine prints `&mut (*values)`. Passing `values` reborrows implicitly. At minimum `&mut *values` drops the parentheses. This appears in 19 fixtures.",
  },
  shapes20_12: {
    improvement: "An index offset is printed two ways: `.wrapping_sub` for an open array and plain `-` for a declared bound. Both are i64 over an i32 or i16 index and cannot overflow, so use one form. An ARRAY[*] also carries both `__lower` and `__upper` i32 params, but the slice already has its length (upper = lower + len - 1). Passing only the lower bound shortens every signature and call. 1546 also computes the same element index twice in a read-modify-write. `let e = &mut line[i]; e.x = e.x.wrapping_add(offset);` names it once.",
  },
  shapes20_13: {
    improvement: "A bit store always emits the general block. Correctness holds: I probed INT.15, SINT.7 and LINT.63 set to TRUE, which gave -32768, -128 and i64::MIN in both backends. For a constant value the store is `self.w |= 1u16 << 3;` or `self.w &= !(1u16 << 3);`. The `&mut` alias is needed only when the place's index holds a call. For a variable value, a branch-free `self.w = (self.w & !m) | (u16::from(v) << 3)` also works.",
    alternatives: [
      "(a) today: bind the value and the place, then choose with an if.",
      "(b) a literal TRUE/FALSE gives `|=` / `&= !`; a pure place writes directly; the block stays only when the index holds a call.",
      "(c) branch-free `(x & !m) | (T::from(v) << i)`.",
      "Choose (b), with (c) for a variable value.",
    ],
    chosen: "(b), with (c) for a variable value.",
  },
  shapes20_14: {
    improvement: "A dispatch used as a statement prints `(match ..);`, which is clippy::unnecessary_semicolon (2 in itf_call_dispatches_on_instance). As a statement it can be a bare `match .. { .. }`. A method call on a lent instance prints `(*__lent_N).take(..)`. Auto-deref makes `__lent_N.take(..)` the same call, as place() already relies on for field and index steps.",
  },
  shapes20_15: {
    improvement: "A store through a pointer that also reads through the same pointer checks for null twice in a row: once on the guard line and once in the value block. The guard line already covers the read. Each ANY_INT monomorph still receives its diSize as a `mut input: i32` param and emits `match input`, though since transpile-review 17 only the arm for its own size is lowered (the others dereferenced pValue as a type it is not), so the match has one arm and the param could be dropped.",
  },
  shapes12_1: {
    improvement: "A nested array whose element is Copy is built with std::array::from_fn closures. `[[[0i16; 3]; 2]; 2]` is the direct form. initOf already has isCopy (emit.ts:305), and its test should be isCopy(array.element) instead of array.element.kind === 'elementary'.",
  },
  shapes12_2: {
    improvement: "A constant index is printed as a typed literal, then cast, then offset at run time: `self.partial[((5i8 as i64) - 1i64) as usize]`. When step.index is a const, print the folded usize (`[4]`). rustc would also reject an out-of-range constant at compile time, as it already does for array_index_const_out_of_bounds.",
    alternatives: [
      "TODAY: `[((5i8 as i64) - 1i64) as usize]`: uniform, but noisy",
      "fold in the emitter when step.index.kind === 'const': `[4]` (my choice: one line in place(), and a constant OOB becomes a compile error)",
      "fold in lowering (index node already LINT const minus lower): same output, but the interpreter would share it",
    ],
    chosen: "fold in the emitter when step.index.kind === 'const': `[4]`, and a constant OOB becomes a compile error)",
    why: "one line in place(",
  },
  shapes12_3: {
    improvement: "A pointer's element index is built as cursor + (lower - 1), which gives `(self.cursor as i64).wrapping_add(-1i64) as usize`. ADR(slots[0]) is built as `0i64.wrapping_sub(-1i64) as usize` instead of the constant 1. Fold the constant when last.index is a const. Emit the dereference index in the same form array subscripts use (`(x - 1i64)`), or as `self.cursor - 1`: iec_deref has already proved the cursor non-zero, so it cannot underflow. Today pointer indices and array indices are two spellings of one operation.",
    alternatives: [
      "TODAY: `(c as i64).wrapping_add(-1i64) as usize` for the pointer, `(i as i64 - 1i64) as usize` for arrays",
      "`self.slots[self.cursor - 1]`: the cursor is usize and non-null after iec_deref (my choice)",
      "express the dereference as an index step with lower = 1 so the same place() code prints it",
    ],
    chosen: "`self.slots[self.cursor - 1]`: the cursor is usize and non-null after iec_deref",
  },
  shapes12_4: {
    improvement: "MOD always gets the zero-divisor block, even for a nonzero constant divisor: `{ let __mod_l = ..; let __mod_r = 256u64; if __mod_r == 0 { 0 } else { __mod_l.wrapping_rem(__mod_r) } }`. When e.right is a nonzero const, print `(l % r)` (or `.wrapping_rem` for a signed MIN % -1). The union overlay also builds each byte with div/mod/mul on u64, where `(w >> 8) as u8` or `(w & 0xFF00) | b as u16` says the same thing. A u8 value % 256 is the identity.",
    alternatives: [
      "TODAY: guarded block for every integer MOD",
      "const nonzero divisor → `(l % r)`; keep the guard only for a runtime divisor (my choice: MOD by a literal is the common case)",
      "unions: to_le_bytes/from_le_bytes round-trip per member, which is shorter but a different IR the interpreter would need to mirror",
    ],
    chosen: "const nonzero divisor → `(l % r)`; keep the guard only for a runtime divisor",
    why: "MOD by a literal is the common case",
  },
  shapes12_5: {
    improvement: "An inout FB or struct passed on, or called, is printed as `(*target).call()`, `(*target).dim()` and `m(4i32, &mut (*book))`. Method calls auto-deref, and a `&mut T` binding reborrows implicitly when passed. Print `target.call()` and `f_x3_mark(4, book)`, the same exemption the emitter already makes for `.x` and `[i]`.",
  },
  shapes12_6: {
    improvement: "A character read through a string cursor copies the whole IecStr out of the borrow: `{ iec_deref(p); *__str_p }.char_at(i)` is 256+ bytes per character, so O(n²) per LEN/TRIM/COPY loop. A write guards twice and copies twice: `iec_deref(p); *__str_p = { iec_deref(p); *__str_p }.with_char(..).to();`. Put the guard around the whole method call (`{ iec_deref(p); __str_p.char_at(i) }`) and add an in-place `set_char(&mut self, i, c)` to the prelude for stores.",
    alternatives: [
      "TODAY: value-semantics with_char(self) -> Self, plus a copy out of the borrow",
      "`&mut self` set_char plus a guard around the call (my choice: same semantics, and the interpreter's setChar needs no change)",
      "keep with_char but guard the call rather than the load: removes the read copy only",
    ],
    chosen: "`&mut self` set_char plus a guard around the call",
    why: "same semantics, and the interpreter's setChar needs no change",
  },
  shapes12_7: {
    improvement: "Every string store appends `.to()`, a truncating copy through lit, even when the value already has the target's capacity. Examples: `left = left.with_char(..).to()`, `concat = str1.to()`, and `self.left_two = left(..).to::<80>().to()`, which converts twice. Skip `.to()` when rustType(s.value.type) === rustType(into) and the target is not a generic-capacity inout.",
  },
  shapes12_8: {
    improvement: "Every input parameter is `mut`, whether or not the body assigns it, and the resulting warnings are silenced with #[allow(unused_mut, unused_variables, unused_assignments)]. Print `mut` only for parameters the body writes (the IR knows which slots are assignment targets), and drop the allow.",
  },
  shapes12_9: {
    improvement: "A pointer whose only target is a whole variable is the constant 1 (`pointer_to_value = 1;`), and each dereference still emits `{ iec_deref(pointer_to_value); *value }`. A borrowed pointer parameter is passed as a dead `0` (`f_lang_ptrread(0, &mut self.value)`) that the body never reads. The same goes for the string-cursor calls `strtrima_pstring_string20(1, &mut self.both)`. When the pointer slot is only ever stored constants ≠ 0, skip the guard. When the callee never reads the integer, drop the parameter.",
  },
  shapes12_10: {
    improvement: "Each routine declares `let mut f: T = 0; f = expr; f`, where `expr` as the tail is the idiomatic form. Each FOR prints `i = 0i32;` right after `let mut i: i32 = 0i32;`. Both are dead stores. When the result is assigned exactly once as the last statement, return the expression. Otherwise the pattern is correct and only verbose.",
  },
  shapes12_11: {
    improvement: "LEN copies the argument into a STRING(255) by value, then counts it one char_at at a time. IecStr already stores `len`. Emitted by hand, LEN is `s.units().len() as i16` (the truncation to 255 is `.min(255)`). Library bodies are ST by design (only s[i] and TIME() are primitives), so this is a trade-off rather than a defect.",
    alternatives: [
      "TODAY: ST library body, one source for both backends, O(n) plus a copy",
      "a prelude intrinsic for LEN_INTERNAL only (`units().len()`), which every other string function calls, so one primitive speeds them all (my choice)",
      "intrinsics for every Standard string function: fastest, but it re-creates the TS/Rust twin the library repo was built to delete",
    ],
    chosen: "a prelude intrinsic for LEN_INTERNAL only (`units().len()`), which every other string function calls, so one primitive speeds them all",
  },
  shapes12_12: {
    improvement: "Arithmetic whose operands are all literals is not folded in a body. `self.di := 30000 + 30000` is emitted as `30000i64.wrapping_add(30000i64) as i32` instead of `60000i32`. Lowering already has the exact evaluator (`builtinValue`/`arith`, the one the declaration folding uses), so running it over an all-const binary node gives the recorded value by construction.",
    alternatives: [
      "A: emit the unfolded i64 wrapping_add then cast (emitted today)",
      "B: fold in lowering with the shared evaluate.ts table and emit a typed literal (preferred: CODESYS itself folds at compile time, and the value comes from the one table both backends use)",
      "C: leave it to rustc/LLVM const-folding (the same machine code, but the source stays noisy)",
    ],
    chosen: "B: fold in lowering with the shared evaluate.ts table and emit a typed literal",
    why: "CODESYS itself folds at compile time, and the value comes from the one table both backends use",
  },
  shapes12_13: {
    improvement: "SINT/INT add, sub and mul are widened to DINT and narrowed back: `(self.si as i32).wrapping_add(1i32) as i8`. When the node's only consumer is a store or conversion back to the operand's own width, `self.si.wrapping_add(1i8)` gives the same answer, because wrapping add/sub/mul commute with truncation mod 2^n. Division, MOD, comparisons and wider stores still need the promotion (SINT -128 / -1 is measured to be 128 in DINT).",
    alternatives: [
      "A: always promote to i32 and cast back (emitted today; uniform, and the promotion is what CODESYS measures)",
      "B: narrow-width wrapping op when the result converts straight back to the operand width and op is in {add,sub,mul} (preferred for readability; exact by modular arithmetic)",
      "C: keep the promotion in the IR and peephole `(x as i32).wrapping_add(c) as i8` in the emitter (smaller change, but a second place that knows the rule)",
    ],
    chosen: "B: narrow-width wrapping op when the result converts straight back to the operand width and op is in {add,sub,mul} (preferred for readability; exact by modular arithmetic)",
  },
  shapes12_14: {
    improvement: "MAX/MIN of a REAL variable and an untyped real literal goes through f64 and back: `(self.n as f64).max(2.5f64) as f32`. max/min only select one of their inputs, so when the literal is exactly representable in f32 the answer equals `self.n.max(2.5f32)`. Arithmetic (+ - * /) must keep the widening, because it changes rounding.",
    alternatives: [
      "A: widen to f64 and cast back (emitted today; uniform with arithmetic)",
      "B: keep f32 for selection builtins when every constant round-trips through f32 exactly (preferred: the same value with no casts)",
    ],
    chosen: "B: keep f32 for selection builtins when every constant round-trips through f32 exactly",
    why: "the same value with no casts",
  },
  shapes16_1: {
    improvement: "Every store into a string gets another `.to()`, even when the value already has the target's capacity. That covers `left(...).to::<80>().to()`, `x = x.with_char(..).to()` and `IecString::<80>::lit(b\"..\").to()`. The extra `.to()` is an identity copy through lit(). Append it only when the target capacity is a generic (the VAR_IN_OUT case the comment is about) or differs from the value's type.",
  },
  shapes16_2: {
    improvement: "A character read through a string cursor prints `{ iec_deref(p); *__str_p }.char_at(i)`. The block's tail moves the WHOLE IecString out (it is Copy) just to read one byte. Loops such as StrLenA, StrFindA and the null-cursor length therefore copy the whole string once per character, which makes an O(n) walk O(n*N). Return a borrow instead (`{ iec_deref(p); &*__str_p }.char_at(i)`) or put the check inside the index. A write prints `iec_deref(p);` on its own line and then the same guard again inside the value, so each character store checks the pointer twice.",
  },
  shapes16_3: {
    improvement: "`s[i] := c` is lowered as a value, `s = s.with_char(i, c).to()`. That makes three whole-string moves or copies per character: self by value, the return, and `.to()`. A statement-level setchar could print `s.set_char(i, c);` with `set_char(&mut self, ..)`.",
    alternatives: [
      "Today: an expression `x = x.with_char(i,c).to()`, which the value-semantics IR uses for every character store, including through cursors (`*p = { iec_deref(q); *p }.with_char(..).to()`).",
      "In-place `x.set_char(i, c)` when a setchar's source and target are the same place: this is what I would choose. It is one bounds check and a one-byte write. The IR already knows target == source.",
    ],
    chosen: "In-place `x.set_char(i, c)` when a setchar's source and target are the same place: this is what I would choose. It is one bounds check and a one-byte write. The IR already knows target == source.",
  },
  shapes16_4: {
    improvement: "The MOD-by-zero guard is printed even when the divisor is a non-zero constant, e.g. `{ let __mod_l = self.n as i32; let __mod_r = 2i32; if __mod_r == 0 { 0 } else { __mod_l.wrapping_rem(__mod_r) } }`.",
    alternatives: [
      "Today: the let-bound guard block for every integer MOD.",
      "Constant divisor ≠ 0 and ≠ -1: `(l % 2i32)`. This is what I would choose. `%` truncates toward zero exactly like IEC MOD and cannot panic for such a divisor.",
      "Constant divisor -1: `l.wrapping_rem(-1)`, or `0`, pending the MIN MOD -1 recording above.",
      "Variable divisor: keep the guard (shape 3357f26b8d needs it).",
    ],
    chosen: "Constant divisor ≠ 0 and ≠ -1: `(l % 2i32)`. This is what I would choose. `%` truncates toward zero exactly like IEC MOD and cannot panic for such a divisor.",
  },
  shapes16_5: {
    improvement: "Comparisons between same-typed narrow operands, or against a literal that fits, are printed in DINT: `((self.n as i32) == 1i32) | ((self.n as i32) == 3i32)` and `(c as i32) != 0i32` for a u8 char. Comparing in the operands' own type gives the same answer whenever both sides share a type (or the literal fits it). Promotion only matters for mixed signedness or mixed widths.",
    alternatives: [
      "Today: always promote to DINT/LINT and cast each operand.",
      "Compare in the common type when the operands' types are equal (or a const fits): `self.n == 1`, `c != 0`. This is what I would choose, because it gives identical results and drops two casts per comparison.",
      "A further step for OR chains of equality against constants: `matches!(self.n, 1 | 3)`, or `matches!(c, 9..=13 | 32 | 160)` for lib_stu_trim's IsSpace. It is shorter but a bigger emitter change.",
    ],
    chosen: "Compare in the common type when the operands' types are equal (or a const fits): `self.n == 1`, `c != 0`. This is what I would choose, because it gives identical results and drops two casts per comparison.",
  },
  shapes16_6: {
    improvement: "Narrow arithmetic stored straight back into its own width is computed in DINT and truncated: `x = (x as i32).wrapping_mul(3i32).wrapping_add(y as i32) as i16`. For + - * the low 16 bits do not depend on the width, so this equals `x.wrapping_mul(3).wrapping_add(y)`. The widening only matters when the result is divided, compared, shifted right or stored wider.",
    alternatives: [
      "Today: promote, then wrapping_* in i32, then `as i16`. This is correct for every consumer.",
      "When the whole tree is + - * (with no DIV/MOD/compare/shift inside) and the store target has the operands' width: compute in that width with wrapping_*. This is what I would choose. It is bit-identical and drops 2-3 casts per line.",
      "Keep the promotion everywhere and just accept the casts. This is the simplest rule and is what the interpreter mirrors.",
    ],
    chosen: "When the whole tree is + - * (with no DIV/MOD/compare/shift inside) and the store target has the operands' width: compute in that width with wrapping_*. This is what I would choose. It is bit-identical and drops 2-3 casts per line.",
  },
  shapes16_7: {
    improvement: "An index prints `[(i as i64) as usize]`. On a 64-bit target, `i as usize` is bit-identical for every integer i (sign-extension is the same), so the i64 hop only earns its place when a lower bound is subtracted. A literal index prints `[(1i8 as i64) as usize]` where `[1]` is enough. The lower-bound form uses plain `-` (`((self.i as i64) - 1i64) as usize`), while the same subtraction written in ST prints `.wrapping_sub`, so the same construct has two spellings.",
    alternatives: [
      "Today: always castTo i64, then `as usize` or `(.. - lower) as usize`.",
      "lower == 0: `[i as usize]`, and a const index folded to `[k]`. This is what I would choose.",
      "lower != 0 with a const index: fold `k - lower` at emit time.",
    ],
    chosen: "lower == 0: `[i as usize]`, and a const index folded to `[k]`. This is what I would choose.",
  },
  shapes16_9: {
    improvement: "StrFindA's `MAX(uiSearchStart, 1) - 1` prints `(((uisearchstart as i32).max(1i32) as u16) as i32).wrapping_sub(1i32)`. That promotes, narrows back to UINT (a no-op, because the max of two UINTs is a UINT), and then promotes again. `(uisearchstart.max(1) as i32) - 1`, or the u16 max followed by one widening, is the same value.",
  },
  shapes16_10: {
    improvement: "A cursor index is built as `sub(p,1)` then `add(extra)` without folding. For `p^[1]` that prints `(p as i64).wrapping_sub(1i64).wrapping_add(1i64)`. When extra is a constant, fold it to `(p as i64) + (extra-1)`, or to `p as i64` for extra == 1.",
  },
  shapes16_11: {
    improvement: "LEN/LEFT/RIGHT/MID/CONCAT/INSERT/DELETE/REPLACE/FIND take `mut str: IecString<255>` BY VALUE. Every call site therefore converts `self.hello.to::<255>()` (a 256-byte copy through lit), and every result comes back as `.to::<80>()`. LEN then walks 255 bytes with char_at in a loop capped at 1e6 iterations, although the length is `s.len`. The xo3 WSTRING chain `.narrow::<80>().to::<10>().to()` is three copies for one conversion (the operand keeps its own capacity since transpile-review 11, so the leading `.to::<80>()` is gone). The 255 cut on the way in is measured (string_input_truncation), so a generic `&IecStr<N>` parameter would need an explicit `min(len, 255)` view to stay right.",
    alternatives: [
      "Today: monomorphic STRING(255) by value, the ST body run as written, conversions at both ends.",
      "A generic `<const N>` borrow with the 255 cut applied as a view (units()[..min(len,255)]): this removes both copies and keeps the body.",
      "Narrow straight to the target (`narrow::<10>()`), since narrow already truncates at M. This is the cheap fix for shape 08b9196831.",
    ],
  },
  shapes16_12: {
    improvement: "A VAR_IN_OUT CONSTANT given a LITERAL is still bound to a `let __copy_1 = IecString::<80>::lit(b\"abc\");` before the call. The reason for the copy (E0503, a copy of x beside &mut x) cannot arise for a literal, so `&IecString::<80>::lit(b\"abc\")` inline is enough, because the temporary lives for the whole call. The scalar CONSTANT in-out is also passed as `&i16`, where a value would be leaner.",
  },
  shapes16_13: {
    improvement: "An aggregate initializer prints `{ let mut v = T::new(); v.first = ..; v.last = ..; v }`. Struct-update syntax, `T { first: .., last: .., ..T::new() }`, is the idiomatic single expression and needs no mut binding. For an FB, keep the block form if its fields are private or new() has side effects.",
  },
  shapes16_14: {
    improvement: "A borrowed in-out passed on is printed `&mut (*__str_pstfrom)` (a needless reborrow spelling; `__str_pstfrom` or `&mut *__str_pstfrom` will do). len_internal reads `(*str).char_at(..)`, where auto-deref makes the `(*..)` redundant (clippy explicit_auto_deref territory).",
  },
  shapes16_15: {
    improvement: "An ARRAY[*] parameter is passed as `(mut __x_lower_N: i32, mut __x_upper_N: i32, x: &mut [T])`. The slice already carries its length, so the upper bound is always `lower + len - 1`. Passing only the lower bound, or deriving upper from `x.len()`, removes one parameter per dimension and one argument per call. `mut` is printed on bound parameters that are never assigned; it is silenced by allow(unused_mut) rather than left out.",
    alternatives: [
      "Today: pass both bounds as i32, with `mut` on each.",
      "Pass lower only; compute UPPER_BOUND as `lower + x.len() as i32 - 1`. This is what I would choose.",
      "Keep both, but drop `mut` when the IR never assigns the slot.",
    ],
    chosen: "Pass lower only; compute UPPER_BOUND as `lower + x.len() as i32 - 1`. This is what I would choose.",
  },
  shapes16_16: {
    improvement: "A nested call argument is hoisted into a `let __arg_0` even when it is the only argument, so evaluation order cannot differ. `len(concat(..))` is the same program.",
  },
  shapes8_9: {
    improvement: "This line is correct for every input, because a BOOL's declared or default initial value is a literal. Nothing needs to change. Several spellings would be correct here, so the options are listed below. Shape 496b8acb56 is the same emission: the normalizer in scratchpad/review/shapes.ts:31 keeps `g` as a reserved word (it stands for the globals parameter), so a field that happens to be named `g` (sel_sel_false, sel_sel_true, ct_bit_packing_sizes) was counted as a separate shape. That is a quirk of the review tool, not of the transpiler.",
    alternatives: [
      "Explicit literal `x: false,` inside `new()`, with `impl Default` calling `Self::new()`. This is emitted today and is the one I would keep: it is the shortest, it states the IEC initial value at the declaration, and it is the same path used for every other elementary init.",
      "`x: Default::default(),` or `..Default::default()`: this hides the declared value, only works for fields whose init is the type's zero, and needs a derived Default, which Rust refuses for arrays longer than 32 (emit.ts:318-323 gives this reason).",
      "`#[derive(Default)]` plus `new() { Self::default() }` when every field has its zero init: this would remove the per-field lines in some structs, but the struct shape would then depend on the init values, which breaks 'the same construct always emitted the same way'.",
    ],
  },
  shapes8_10: {
    improvement: "The call itself is correct and lean. I probed INT wrap at 32767 -> -32768 and -1 -> 0 through outer->inner, and both match CODESYS's wrap. The in-frame specialization in lower/specialize.ts is also correct for the aliasing cases (a:=n, b:=n gives 6 in CODESYS). The waste is in the lines around the call: every generated routine gets `#[allow(unused_mut, unused_variables, unused_assignments)]`, including `outer`, `inner` and `two_a_0_b_0`, which have no parameters and no locals, so none of the three lints can fire. Emit the attribute only when the routine declares at least one local or in-out/lent parameter, and only name the lints that can apply (for example `unused_mut`/`unused_assignments` only when there are locals). The comment says the lints are 'verified load-bearing', but that holds only for routines that have bindings.",
  },
  shapes8_11: {
    improvement: "SEL binds both arms eagerly so that side effects match the interpreter, and that is right in general. When every argument is a side-effect-free place or literal, though, the eager block is the same as a plain `if`. Separately, widening INT to i32 and narrowing back is a no-op for a selection; the promotion comes from lowering treating SEL like arithmetic.",
    alternatives: [
      "Eager block with i32 widening. This is emitted today; it is always correct but costs 3 temporaries and 3 casts.",
      "`if self.g { self.b } else { self.a }` when all arms are pure (no invoke, dispatch or call in the IR, which is the same test as callsNothing in lower/specialize.ts) and the arms are not promoted. I would choose this: it is what a Rust engineer writes and gives an identical result, because selecting between two i16 values cannot overflow.",
      "Keep the eager block but drop the widening: `let __sel_f = self.a;` and no trailing `as i16`. This is a smaller change with the same correctness.",
    ],
    chosen: "`if self.g { self.b } else { self.a }` when all arms are pure (no invoke, dispatch or call in the IR, which is the same test as callsNothing in lower/specialize.ts) and the arms are not promoted",
    why: "it is what a Rust engineer writes and gives an identical result, because selecting between two i16 values cannot overflow.",
  },
  shapes9_1: {
    improvement: "A conversion already builds an IecString<80>, and the assignment then always adds `.to()`, which copies it into an IecString<80> again. That is a second 80-byte copy with no effect. Skip `.to()` when the value's static capacity equals the target's, or build the literal straight at the target capacity when it is ≥ the conversion's 80.",
  },
  shapes9_2: {
    improvement: "`lit(..).to::<12>().to()`: the explicit truncating copy into STRING(12) is followed by a second same-capacity `.to()`. Drop the outer copy when the capacities match; with the lean above, this becomes a single `IecString::<12>::lit(..)`.",
  },
  shapes9_3: {
    improvement: "`(a as i32).wrapping_add(b as i32) as i16` when a, b and the destination are all INT. Addition, subtraction and multiplication modulo 2^32 truncated to 16 bits equal the same operations modulo 2^16, so the native-width call gives the same result.",
    alternatives: [
      "A (emitted today): promote both operands to the DINT register, wrap there, truncate with `as i16`. This mirrors the IR, which always promotes, and is what clippy flags as cast_lossless and cast_possible_truncation (36 + 21 + 16 + 6 hits across these shapes).",
      "B: a peephole in emit.ts: when a convert-to-T wraps a binary add/sub/mul whose operands are both converts from T, print `a.wrapping_add(b)` in T. The results are identical, and it removes 3 casts per line.",
      "C: `i32::from(a)` instead of `a as i32` for the widening only. That silences cast_lossless but keeps the round trip.",
      "Choose B for add/sub/mul (it is exact) and keep A for div, where INT_MIN / -1 must not panic (measured arithedge_int_div_min_by_minus_one = -32768) and for comparisons that mix signedness.",
    ],
    chosen: "B for add/sub/mul (it is exact) and keep A for div, where INT_MIN / -1 must not panic (measured arithedge_int_div_min_by_minus_one = -32768) and for comparisons that mix signedness.",
  },
  shapes9_4: {
    improvement: "`{ let __mod_l = v; let __mod_r = 86400000000000u64; if __mod_r == 0 { 0 } else { __mod_l.wrapping_rem(__mod_r) } }`: the divisor is a nonzero literal (every calendar conversion lowers to this), so the zero check and both bindings are dead. Print `(v % 86_400_000_000_000u64)` when the right operand is a nonzero constant; wrapping_rem is only needed for a signed divisor of -1.",
  },
  shapes9_5: {
    improvement: "`(if false { 10i64 } else { 20i64 }) as i16`: the literals are typed i64 and then cast, and a constant selector could be folded.",
    alternatives: [
      "A (emitted today): a plain `if` — only the selected arm is evaluated (transpile-review-2026-09-29 task 41).",
      "C: fold SEL with a constant selector to the chosen arm, and type literal arms as the result type (10i16) instead of LINT.",
    ],
    chosen: "C: fold SEL with a constant selector to the chosen arm, and type literal arms as the result type (10i16) instead of LINT.",
  },
  shapes9_6: {
    improvement: "`(match k { 0 => self.a as i32, 1 => self.b as i32, _ => self.c as i32 }) as i16` for INT inputs into an INT destination: the widening per arm and the narrowing afterwards cancel out (20 cast lints). Emit the match in the inputs' own type when it equals the destination's.",
  },
  shapes9_8: {
    improvement: "`{ let mut __program = std::mem::take(&mut prg.x); __program.boot(prg); prg.x = __program; };` builds a whole default program (arrays, strings included) and moves it twice on every call, even when the callee never reads `prg` (its fn carries #[allow(unused_variables)] for exactly that). When the callee's body does not reach Programs, call `prg.x.call()` directly and drop the prg parameter. The statement form also carries a stray `;` after the block.",
  },
  shapes9_9: {
    improvement: "`pub fn fb_init(&mut self, prg: &mut Programs, mut b_init_retains: bool, mut b_in_copy_code: bool) -> bool { let mut fb_init: bool = false; …; fb_init }` marks inputs mut even though they are never written, then suppresses the result with #[allow(unused_mut, unused_variables, unused_assignments)]. Emit `mut` only for inputs the body assigns (the IR knows the stores), and drop the allow.",
  },
  shapes9_10: {
    improvement: "`iec_deref(self.ref_); self.n = ({ iec_deref(self.ref_); self.n } as i32)…`: the same pointer is null-checked twice in one statement, once for the store target and once for the read. Skip a read guard whose guard place equals the target's guard, which has already run on the previous line.",
  },
  shapes9_11: {
    improvement: "`((x as f64).sqrt() as f32)` for SQRT of a REAL.",
    alternatives: [
      "A (emitted today): widen to f64, sqrt, narrow. This matches the interpreter's float64 Math path by construction.",
      "B: `x.sqrt()` on f32. IEEE sqrt is correctly rounded, and f64 has more than 2*24+2 bits, so the double rounding is innocuous and the result is bit-identical for every input. That does NOT hold for ln/sin/exp, which must stay on A.",
      "Choose B for sqrt only; it removes 2 casts per call.",
    ],
    chosen: "B for sqrt only; it removes 2 casts per call.",
  },
  shapes9_12: {
    improvement: "`a & (b | (c & !d))` on plain BOOL loads: clippy::needless_bitwise_bool.",
    alternatives: [
      "A (emitted today): `&`/`|` always, so a call on the right side runs in both backends (the reason given at emit.ts:795-796).",
      "B: `&&`/`||` when the right operand is side-effect free (loads, constants, comparisons of loads). The results are identical, and it is what a Rust engineer writes.",
      "Choose B only for pure right operands; the current rule is still needed when the right side can have effects.",
    ],
    chosen: "B only for pure right operands; the current rule is still needed when the right side can have effects.",
  },
  shapes9_13: {
    improvement: "A widening that cannot lose information (i16→i32, u32→i64, f32→f64) is printed `x as T`. `T::from(x)` states that it is lossless and is what clippy asks for. Choose it only for widenings; wrapping narrowings must keep `as`.",
  },
} satisfies Record<string, ShapeNote>

/** Two items the review reported against one construct, as one note: both improvements, every option, the first choice. */
function merged(...notes: readonly ShapeNote[]): ShapeNote {
  const alternatives = notes.flatMap((n) => n.alternatives ?? [])
  const choice = notes.find((n) => n.chosen !== undefined)
  return {
    improvement: notes.flatMap((n) => (n.improvement === undefined ? [] : [n.improvement])).join(" Also: "),
    ...(alternatives.length > 0 ? { alternatives } : {}),
    ...(choice?.chosen === undefined ? {} : { chosen: choice.chosen }),
    ...(choice?.why === undefined ? {} : { why: choice.why }),
  }
}

/**
 * ONE NOTE PER CONSTRUCT, keyed by its id; the comment above each is the construct as `normalizeRustLine` prints it.
 * A construct that several items named carries all of them (`merged`).
 */
export const NOTES: Readonly<Record<string, ShapeNote>> = {
  // x: std::array::from_fn(|_| L),
  "00c356c11c": LEAN.shapes18_8,
  // pub fn x<const T: usize>(mut __grid_lower_N: i32, mut __grid_upper_N: i32, mut __grid_lower_N: i32, mut __grid_upp
  "00fc50d055": LEAN.shapes17_11,
  // pub p: usize,
  "013de1dc6a": LEAN.shapes1_12,
  // self.f = Lu8;
  // self.sum = (self.sum as i32).wrapping_add(self.f as i32) as i16;
  "0153115496": LEAN.shapes11_15,
  // self.v = m(self.f * Lf64, …);
  "015dcb3b7f": LEAN.shapes5_4,
  // self.v = (-Li64).wrapping_neg();
  // pub fn fb_init(&mut self, prg: &mut Programs, mut x: bool, …) -> bool {
  "0180f72495": LEAN.shapes9_9,
  // m(Li32, &mut (*x));
  "01e84968c3": LEAN.shapes12_5,
  // x = *x;
  "01ef1b756d": LEAN.shapes12_9,
  // replace = { let __arg_N = m(x, …, p); let __arg_N = x; let __arg_N = (p as i32).wrapping_sub(Li32).max(Li32) as i1
  "0205cf3af0": merged(LEAN.shapes17_2, LEAN.shapes17_4),
  // if x.is_nan() { return L; }
  "02a72c2e83": LEAN.shapes5_1,
  // pub fn m(mut x: u8, …) -> bool {
  "03846c1eae": LEAN.shapes14_14,
  // self.f.f[(Li8 as i64) as usize] = Lu8;
  "03b3e8b80c": LEAN.shapes11_7,
  // pub fn m(mut x: i32, x: &mut i16) -> i32 {
  "040107266f": LEAN.shapes19_2,
  // x = x.with_char(x.wrapping_sub(x) as i64, str.char_at(x as i64)).to();
  "0464b7d671": merged(LEAN.shapes16_1, LEAN.shapes16_3),
  // x: [Lu8; L],
  "054b93382f": LEAN.shapes1_7,
  // x: [{ let mut v = T::new(); v.f = Li16; v }, { let mut v = T::new(); v.f = Li16; v.f = false; v }, T::new()],
  "055df7e5f8": LEAN.shapes3_7,
  // self.f = iec_max(self.f.to::<L>(), self.f).to::<L>().to();
  "05a142a4f4": LEAN.shapes15_1,
  // x: [Lf32, …, (-Lf32)],
  "060ccf97cc": LEAN.shapes11_19,
  // self.f = (self.f as i32) <= (self.f as i32);
  "06135af232": LEAN.shapes7_2,
  // x: Li32,
  "06bb3a6005": merged(LEAN.shapes4_1, LEAN.shapes4_2),
  // self.f[((self.f as i64) - Li64) as usize].f = (self.f as i32).wrapping_mul(Li32) as i16;
  "07d4272a6e": LEAN.shapes16_7,
  // self.f = (self.f as i32).wrapping_sub(self.f as i32) as u16;
  "07ee06657f": LEAN.shapes9_3,
  // self.f = (self.f as i32).max(self.f as i32) as u8;
  "0817bbbc15": LEAN.shapes8_3,
  // pub fn m(mut x: i32, x: &mut T) -> i32 {
  "0855e1134c": LEAN.shapes18_9,
  // pub __inout_index_N: i16,
  "0878222ac3": LEAN.shapes18_1,
  // self.f = (self.f as f64).exp() as f32;
  "08964781e8": LEAN.shapes6_10,
  // self.f = { let x = self.v; let x = Lu64; if x == L { L } else { x.wrapping_rem(x) } };
  "08ce268604": LEAN.shapes9_4,
  // self.v = Lu32;
  "093ad5cc7a": LEAN.shapes1_10,
  // return x;
  "0969e59592": LEAN.shapes12_10,
  // self.f = self.__numbers_lower_N;
  "09b1152bef": LEAN.shapes14_15,
  // self.f = self.f.rotate_right(Li8 as u32);
  "09eeda28bb": LEAN.shapes7_1,
  // self.f.widen();
  "09f527f35b": LEAN.shapes3_9,
  // { let x = true; let x = &mut self.f.f; *x = if x { *x | (Lu16 << L) } else { *x & !(Lu16 << L) }; }
  "0a1967fcea": LEAN.shapes20_13,
  // self.f = self.f.to::<L>().to();
  "0a52a768d3": LEAN.shapes5_8,
  // fn m(v: f64) -> i32 {
  "0ab1e9c511": LEAN.shapes4_4,
  // pub fn fb_init(&mut self, mut x: bool, …, mut x: i16) -> bool {
  "0ab2575555": LEAN.shapes12_8,
  // pub __numbers_lower_N: i32,
  "0ac4ab4a64": LEAN.shapes13_17,
  // *x = { m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x as i64), { m(x); *x }.char_at((x as i64).
  "0b353e99d9": LEAN.shapes17_2,
  // __inout_index_N: Li16,
  "0b358286cb": LEAN.shapes18_1,
  // self.m(&mut (*x));
  "0b51d542e8": LEAN.shapes2_5,
  // self.f = { m(self.f); self.f[(self.f as i64).wrapping_add(-Li64) as usize].f };
  "0c7c4434c4": LEAN.shapes3_4,
  // pub fn m(mut p: usize, x: &mut i16) -> i16 {
  "0ca9dad97d": merged(LEAN.shapes15_7, LEAN.shapes15_8),
  // (match self.f.f { L => self.f.m(&mut self.f), _ => panic!(S) });
  "0cbdff077d": LEAN.shapes19_6,
  // self.v = ({ m(self.f); self.v } as i32).wrapping_add(Li32) as i16;
  "0cf79a4fb2": merged(LEAN.shapes9_3, LEAN.shapes9_10),
  // pub fn x<const T: usize>(str: &mut IecString<T>) -> u16 {
  "0d14fd327c": LEAN.shapes15_9,
  // self.f = Li16;
  "0e0d715a81": LEAN.shapes1_11,
  // self.f = (self.f as i32).wrapping_sub(Li32) as u8;
  "0e5c6a2896": LEAN.shapes8_3,
  // self.f = Li64.wrapping_add(Li64);
  "0e60621ff1": LEAN.shapes6_6,
  // self.v = Li32.wrapping_neg() as i16;
  // self.f.f = ({ let x = self.f.f as u64; let x = Lu64; if x == L { L } else { x.wrapping_rem(x) } }).wrapping_add(({
  "10814b65ce": LEAN.shapes12_4,
  // self.f = IecString::<L>::lit(x!(S, self.f).as_bytes()).to();
  "10af274f28": LEAN.shapes9_1,
  // self.f = Li32.wrapping_neg() as i8;
  // x
  "11f6ad8ec5": LEAN.shapes1_9,
  // self.f = ((self.f as i32) > Li32) & (((self.f as i32) < Li32) | self.f);
  "128ab89e82": LEAN.shapes9_12,
  // x: (-Li64),
  "12e93440b3": LEAN.shapes1_1,
  // pub x: i16,
  "1307e33bbf": merged(LEAN.shapes11_5, LEAN.shapes11_6),
  // self.f = (if self.g { Li64 } else { Li64 }) as i16;
  "2db51dfb96": merged(LEAN.shapes10_4, LEAN.shapes10_5),
  // pub __inout_guard_N: usize,
  "149af70520": LEAN.shapes18_1,
  // self.f[(Li8 as i64) as usize] = L;
  "14a38342eb": LEAN.shapes18_4,
  // pub fn m(mut x: u16) -> bool {
  "14b2f39d44": LEAN.shapes14_14,
  // pub fn init(&mut self, g: &mut Globals) {
  "1524fb865f": LEAN.shapes15_6,
  // if ((self.f as i32) > Li32) & self.f {
  "1541330f1e": LEAN.shapes11_16,
  // x: (-Lf32),
  "159ca60812": LEAN.shapes1_1,
  // __inout_guard_N: L,
  "16410bb3a0": LEAN.shapes18_1,
  // m(Li16, &mut self.__output_N, …);
  "1647895e3b": LEAN.shapes18_1,
  // self.f = (self.f as f64).sqrt() as f32;
  "1671e97e30": LEAN.shapes7_4,
  // self.f = { self.__inout_index_N = self.f[(self.f as i64) as usize]; let __arg_N = self.m(); m(__arg_N, &mut self.f
  "16b713f0f3": LEAN.shapes20_10,
  // x: Lf64,
  "1707972c33": merged(LEAN.shapes4_1, LEAN.shapes4_3),
  // pub fn m(&mut self, mut p: usize) -> i16 {
  "178b1e9748": LEAN.shapes19_9,
  // self.f = (self.f as i32).wrapping_shl(Li8 as u32) as u16;
  "17bfcf56b6": LEAN.shapes8_5,
  // self.f = (self.f as f64).tan() as f32;
  "18157407c3": LEAN.shapes7_4,
  // self.f = self.f.rotate_left(self.f as u32);
  "181d22eae0": LEAN.shapes7_4,
  // len = m(&mut str) as i16;
  "185a887a57": LEAN.shapes13_15,
  // self.f = (self.f as i32).wrapping_add(Li32) as i8;
  "18e6b05962": LEAN.shapes8_3,
  // self.f.f[((Li8 as i64) - Li64) as usize].f.f = true;
  "191ba38aad": LEAN.shapes11_7,
  // { let x = self.f; let x = &mut self.f; *x = if x { *x | (Lu32 << L) } else { *x & !(Lu32 << L) }; }
  "1985d03764": LEAN.shapes20_13,
  // if !((x < Li32) & ((x.char_at(x as i64) as i32) != Li32)) { break; }
  "19dfd3f883": LEAN.shapes16_5,
  // break 'loop_N;
  "1ad1ab3163": LEAN.shapes11_9,
  // x = m(__numbers_lower_N, __numbers_upper_N, &mut (*x)).wrapping_add(Li32);
  "1b12aad5a0": LEAN.shapes16_15,
  // x[(self.__numbers_upper_N as i64).wrapping_sub(self.__numbers_lower_N as i64) as usize] = Li16;
  "1be212b44b": LEAN.shapes16_7,
  // pub fn m(mut x: i16) -> i16 {
  "1ca8b1b1fc": LEAN.shapes13_12,
  // pub fn m(mut x: i16) -> u32 {
  "1d10ec0f39": LEAN.shapes13_12,
  // if x > x.wrapping_sub(Li32) { break; }
  "1d1551a034": LEAN.shapes14_7,
  // pub x: u16,
  "1d7709a031": merged(LEAN.shapes13_1, LEAN.shapes13_2, LEAN.shapes13_3),
  // self.f.f[(Li8 as i64) as usize] = IecString::<L>::lit(B).to();
  "1d835ef992": merged(LEAN.shapes16_1, LEAN.shapes16_7),
  // x: [IecString::<L>::lit(B); L],
  "1d9f55ded0": LEAN.shapes14_16,
  // pub fn x<const T: usize>(mut x: usize, x: &mut IecString<T>) -> u8 {
  "1dec9ffb7e": LEAN.shapes16_14,
  // x[(self.f as i64).wrapping_sub(self.__numbers_lower_N as i64) as usize] = self.f.wrapping_add(self.f.wrapping_mul(
  "1e5d67a16e": merged(LEAN.shapes17_3, LEAN.shapes17_7),
  // x = (self.f as i32).wrapping_add(self.f as i32) as i16;
  "1ebe9a3a67": LEAN.shapes19_10,
  // x: std::array::from_fn(|_| std::array::from_fn(|_| std::array::from_fn(|_| [Li16; L]))),
  "1f2f8205f9": LEAN.shapes12_1,
  // self.f = match self.f { L => self.f, …, _ => panic!(S) };
  "1fa78ccf62": LEAN.shapes3_5,
  // self.f = (if self.g { self.f as i32 } else { self.f as i32 }) as i16;
  "8b3a192776": LEAN.shapes10_4,
  // x = Li32.wrapping_neg();
  // break 'body_N;
  "204a887600": LEAN.shapes11_9,
  // x = x.to();
  "211808ca56": merged(LEAN.shapes12_6, LEAN.shapes12_7),
  // if (self.f as i32) > Li32 {
  "21575de23f": LEAN.shapes11_16,
  // self.f = len(self.f.to::<L>());
  "21ef64a1e0": LEAN.shapes14_18,
  // x = (self.f as i32).wrapping_mul(Li32) as i16;
  "228035615e": LEAN.shapes19_10,
  // self.f = ({ let x = self.f as i32; let x = self.f as i32; if x == L { L } else { x.wrapping_rem(x) } }) as u16;
  "2287fe3f1d": LEAN.shapes10_3,
  // self.f.__numbers_upper_N = Li32;
  "22f3bd9b6d": LEAN.shapes14_15,
  // x = x.with_char(x.wrapping_sub(x) as i64, Lu8).to();
  "234c4da721": LEAN.shapes15_2,
  // if false { break; }
  "235daf8f29": LEAN.shapes11_10,
  // self.f = self.f.f == IecWString::<L>::lit(&[Lu16, …]);
  "23d12708e2": LEAN.shapes15_12,
  // self.f = (self.f as f64).sin() as f32;
  "23d755d76c": LEAN.shapes6_10,
  // pub fn m(mut x: u32) -> bool {
  "241f597128": LEAN.shapes14_14,
  // self.f = Li64.wrapping_add(Li64) as i32;
  "24588decbd": LEAN.shapes7_1,
  // self.f = self.f.char_at(Li8 as i64);
  "2506fd8442": LEAN.shapes14_2,
  // self.f = (self.f as i32).wrapping_shr(Li8 as u32) as u8;
  "253e416b11": LEAN.shapes8_5,
  // self.f = m(L, …, &mut self.f, …);
  "256218c83c": LEAN.shapes14_8,
  // self.f = (x as i32).wrapping_mul(x as i32) as i16;
  "260b606dc8": LEAN.shapes19_10,
  // pub fn m(mut __numbers_lower_N: i32, mut __numbers_upper_N: i32, x: &mut [i16]) -> i16 {
  "26a81a085d": LEAN.shapes16_15,
  // self.f = ((self.f as f64).sqrt() as f32) == ((self.f as f64).sqrt() as f32);
  "26afed6c0b": LEAN.shapes9_11,
  // self.f = match self.f { L => (*__lent_N).m(), _ => panic!(S) };
  "26bfea40dc": LEAN.shapes19_6,
  // self.f = { self.__inout_guard_N = self.p; self.__inout_index_N = (self.p as i64).wrapping_add(-Li64); let __arg_N 
  "26c1488275": LEAN.shapes20_10,
  // if (self.f as i32) == Li32 {
  "271163608b": LEAN.shapes5_6,
  // self.f = iec_max(self.f, ….to::<L>()).to::<L>().to();
  "286d90b120": LEAN.shapes15_1,
  // self.f = ((self.f as i32) & (self.f as i32)) as i16;
  "28a9242939": LEAN.shapes8_3,
  // x = len((*x).to::<L>());
  "28af8caf65": LEAN.shapes18_3,
  // self.f = m(self.f as f64).ln() as f32;
  "28c9b9742d": LEAN.shapes6_10,
  // self.f[(self.f as i64) as usize].f = (self.f as i32).wrapping_mul(Li32) as i16;
  "28e0f14a5a": LEAN.shapes3_4,
  // self.f = (((self.f as i32) == Li32) | ((self.f as i32) == Li32)) | ((self.f as i32) == Li32);
  "28ee7b5d58": LEAN.shapes16_5,
  // self.f = m(((self.f as f64).sqrt() as f32) as f64);
  "2929468557": LEAN.shapes8_8,
  // self.f = (self.f as i32).wrapping_mul(Li32).wrapping_add(Li32) as i16;
  "293906cee0": LEAN.shapes20_1,
  // x = m(__values_lower_N, __values_upper_N, &mut (*x)).wrapping_add(__values_upper_N);
  "29dc1a9c14": LEAN.shapes20_11,
  // x = (x as i32).wrapping_sub(Li32) as u16;
  "2a09a0d33c": LEAN.shapes15_4,
  // pub fn x<const T: usize>(x: &IecString<T>) -> i16 {
  "2b67f9045b": LEAN.shapes19_7,
  // self.__property_N = self.f;
  "2b6ceac96d": merged(LEAN.shapes18_1, LEAN.shapes18_2),
  // self.f = (self.f as i32).wrapping_shr(Li8 as u32) as u16;
  "2c27c13c32": LEAN.shapes8_5,
  // self.f = (self.f as i32) <= Li32;
  "2cfa532f63": LEAN.shapes6_7,
  // x = (*x) == IecString::<L>::lit(B);
  "2e20d3f400": LEAN.shapes14_17,
  // x = (x as i32).wrapping_mul(Li32).wrapping_add(x as i32) as i16;
  "2ea589a8a1": LEAN.shapes16_6,
  // g.f = (self.f as i32).wrapping_mul(Li32) as i16;
  "2ed6ef380f": LEAN.shapes19_10,
  // self.lit = Li64.min(Li64) as i16;
  "2f368e2e5b": LEAN.shapes6_6,
  // x.f = (x as i32).wrapping_mul(Li32) as i16;
  "2fd81c587c": LEAN.shapes15_4,
  // pub fn call(&mut self, g: &mut Globals, prg: &mut Programs) {
  "30d5674ec4": LEAN.shapes19_8,
  // self.is_empty = m(L, &mut self.f);
  "311bf0f5b7": LEAN.shapes14_8,
  // self.f = (self.f as i32).wrapping_shl(Li8 as u32) as i8;
  "317cab8d16": LEAN.shapes8_5,
  // self.f = self.f.with_char(Li8 as i64, Lu8).to();
  "318cfd770d": merged(LEAN.shapes15_2, LEAN.shapes15_3),
  // self.f = Li32.wrapping_neg().max(self.f as i32).min(self.f as i32) as i16;
  // { let x = true; let x = &mut self.f; *x = if x { *x | (Lu16 << L) } else { *x & !(Lu16 << L) }; }
  "3279d75111": LEAN.shapes20_13,
  // self.f = (self.f as u64).wrapping_sub({ let x = self.f as u64; let x = Lu64; if x == L { L } else { x.wrapping_rem
  "32a9e6d2e3": merged(LEAN.shapes10_1, LEAN.shapes10_2),
  // self.f = Li64.wrapping_sub(-Li64) as usize;
  "32f4b8cabb": LEAN.shapes11_18,
  // *x = ({ let x = x as i32; let x = x as i32; if x == L { L } else { x.wrapping_rem(x) } }) as i16;
  "3357f26b8d": LEAN.shapes16_4,
  // x = Li32.wrapping_add(self.f as i32) as i16;
  "335f79d286": LEAN.shapes19_10,
  // self.f = self.__numbers_lower_N.wrapping_mul(Li32).wrapping_add(self.__numbers_upper_N);
  "33fc10bac3": LEAN.shapes16_15,
  // m(L, …u16, Li16, …, L, …u16, &mut self.f, …);
  "34556679d4": LEAN.shapes15_15,
  // self.f = self.f.wrapping_shr(Li16 as u32) as u8;
  "346e81a0f2": LEAN.shapes8_4,
  // if ((x == L) | (x == L)) | ((x as i32) < Li32) {
  "347b79cfd5": LEAN.shapes15_5,
  // x: { let mut v = T::new(); v.f = Li16; v.f = Lf32; v.f = IecString::<L>::lit(B); v },
  "3489b7781f": LEAN.shapes3_7,
  // self.f = (self.f as i32).wrapping_mul(Li32) as u8;
  "34c55ebfd9": LEAN.shapes8_3,
  // pub fn after_global_init(&mut self, g: &mut Globals) {
  "365326bb03": LEAN.shapes15_6,
  // x: [(-Li32), Li32, …],
  "36d4b59ee2": LEAN.shapes11_19,
  // x.f = (x.f as i32).wrapping_add(Li32) as i16;
  "373f640901": LEAN.shapes15_4,
  // self.f = Li64.max(-Li64).min(Li64) as i16;
  "21672c09ea": LEAN.shapes8_6,
  // map
  "37745ed7a0": LEAN.shapes17_5,
  // pub __property_N: i16,
  "377c1dfc31": LEAN.shapes13_10,
  // self.f.f = IecString::<L>::lit(B).to();
  "37c65c7fbb": LEAN.shapes2_6,
  // self.f = (self.f as i32).wrapping_shr(Li8 as u32) as i16;
  "37e2b15787": LEAN.shapes8_5,
  // self.sum = (self.f.f as i32).wrapping_add(self.f.f as i32) as i16;
  "37f5ec3b06": LEAN.shapes16_6,
  // x = (self.f as i32).wrapping_add(Li32) as i16;
  "37faa78985": LEAN.shapes19_10,
  // g.f = (g.f as i32).wrapping_add(Li32) as u16;
  "383107953f": LEAN.shapes19_10,
  // self.f = self.__numbers_upper_N.wrapping_sub(self.__numbers_lower_N).wrapping_add(Li32);
  "38cce5cb54": LEAN.shapes16_15,
  // self.f = Lu8 as u32;
  "395880371f": LEAN.shapes3_11,
  // self.f = (self.f as i32).wrapping_neg() as i16;
  "3968425889": LEAN.shapes7_3,
  // self.f = self.f.clone();
  "39e68c53af": LEAN.shapes2_9,
  // *x = ((x as i32) / Li32) as i16;
  "3a7612a7b4": LEAN.shapes18_7,
  // self.f = self.f.rotate_right(self.f as u32);
  "3aa4ff5b30": LEAN.shapes7_4,
  // self.f = (match g.f { L => Li64, …, _ => Li64 }) as i16;
  "3b823fe0e7": LEAN.shapes19_5,
  // self.f = ((*x) as i32).wrapping_mul(Li32) as i16;
  "3c5653e905": merged(LEAN.shapes15_4, LEAN.shapes15_9),
  // (match self.f { L => self.f.m_set(self.__property_N), _ => panic!(S) });
  "3c8fcdf5d6": merged(LEAN.shapes20_10, LEAN.shapes20_14),
  // replace
  "3cacc7bfac": LEAN.shapes12_11,
  // x = (m(x) as i32) == (m(x) as i32);
  "3cded85aba": LEAN.shapes14_6,
  // pub fn m(mut x: IecString<L>, …) -> IecString<L> {
  "3cf4e6fa21": merged(LEAN.shapes15_7, LEAN.shapes15_14),
  // if (self.f as i32) > Li32 { break; }
  "3d3b42b24d": LEAN.shapes11_16,
  // self.f = self.f.narrow::<L>().to::<L>().to();
  "d54a668b9a": LEAN.shapes15_1,
  // self.f.m();
  "3d737b5821": LEAN.shapes1_6,
  // x = __grid_lower_N.wrapping_mul(Li32).wrapping_add(__grid_upper_N) as i16;
  "3d792fe7d9": LEAN.shapes16_15,
  // if m(x, …, false, &mut (*x), &mut (*x)) {
  "3d7b4a7836": LEAN.shapes15_9,
  // self.f = { let x = (-Lf64).trunc(); if (-L..=L).contains(&x) { x as i32 } else { i32::MIN } };
  "3e1e32f963": LEAN.shapes10_7,
  // x = (x as i32).wrapping_mul(x as i32) as i16;
  "3eced711ed": LEAN.shapes19_10,
  // self.f.f = (self.f as i32) >= Li32;
  "3ecf4f248b": LEAN.shapes14_6,
  // self.f = m(L, …i32, L, &mut self.f, …);
  "3eed014822": LEAN.shapes14_8,
  // x = { m(x); *x };
  "3fed555c25": LEAN.shapes12_9,
  // x: std::array::from_fn(|_| [Lf32; L]),
  "4026548939": LEAN.shapes11_13,
  // self.f = self.__chain_value_N;
  "40fd7317bb": LEAN.shapes5_7,
  // self.f = { m(self.p); self.f[(self.p as i64).wrapping_add(-Li64).wrapping_add(Li64) as usize].f };
  "417ce6fb0b": LEAN.shapes3_4,
  // self.p = Li64.wrapping_sub(-Li64) as usize;
  "41d2232599": LEAN.shapes2_4,
  // x = (x as i32).wrapping_add(x as i32) as i16;
  "41d2269c05": LEAN.shapes15_4,
  // self.f = m(self.f.to::<L>(), IecString::<L>::lit(B), Li16).to::<L>().to();
  "41d85d47cf": LEAN.shapes16_1,
  // self.f = (self.f as i32).wrapping_mul(Li32) as i8;
  "41f40f95f9": LEAN.shapes8_3,
  // self.v = ((Lf32 - self.f) as f64).sqrt() as f32;
  "428230e030": LEAN.shapes8_8,
  // pub __chain_value_N: bool,
  "42897347c4": LEAN.shapes11_11,
  // pub fn m(mut x: i32, mut x: i16, x: &mut i64) -> bool {
  "431373ac5d": LEAN.shapes19_2,
  // x = Li32.wrapping_neg() as i16;
  // self.f.__numbers_lower_N = self.__numbers_lower_N;
  "43449862b7": LEAN.shapes15_13,
  // x = (x as i32).wrapping_sub(Li32) as u8;
  "43aa1830f1": LEAN.shapes14_4,
  // pub fn x<const T: usize>(mut p: usize, x: &mut IecString<T>) -> u8 {
  "43aad8296c": LEAN.shapes16_14,
  // self.f = IecString::<L>::lit((if self.f { S } else { S }).as_bytes()).to();
  "448986061e": LEAN.shapes9_1,
  // self.f.f[((Li8 as i64) - Li64) as usize].f.f = (self.f.f[((Li8 as i64) - Li64) as usize].f.f as i32).wrapping_mul(
  "44a9549a6b": LEAN.shapes12_2,
  // if ({ m(p); *x }.char_at((p as i64).wrapping_sub(Li64)) as i32) == Li32 { break; }
  "44d286d05b": merged(LEAN.shapes16_2, LEAN.shapes16_5),
  // self.f = m(self.f.to::<L>(), Li32.wrapping_neg() as i16, Li16).to::<L>().to();
  "8ee065ce1a": LEAN.shapes16_1,
  // self.p = L;
  "45292dbd9c": merged(LEAN.shapes1_6, LEAN.shapes1_8),
  // self.f = IecString::<L>::lit((if self.v { S } else { S }).as_bytes()).to();
  "45e329cf8f": LEAN.shapes9_1,
  // self.f = IecString::<L>::lit(iec_tod_text(self.v as i64).as_bytes()).to();
  "463c3aa6a9": LEAN.shapes9_1,
  // self.f = self.f.wrapping_add(Li16);
  "46c17ef7d3": LEAN.shapes2_1,
  // self.f = { let __arg_N = m(self.f.to::<L>(), IecString::<L>::lit(B)); len(__arg_N) };
  "47a7c12d8a": LEAN.shapes20_8,
  // self.f.m_set(self.__property_N);
  "48737e1389": LEAN.shapes18_2,
  // self.f = self.p.wrapping_add(L);
  "48944bacca": LEAN.shapes2_4,
  // pub fn fb_init(&mut self, mut x: bool, …) -> bool {
  "49346d6299": LEAN.shapes2_11,
  // self.f = self.v.wrapping_sub({ let x = self.v; let x = Lu64; if x == L { L } else { x.wrapping_rem(x) } });
  "49387a9ebf": merged(LEAN.shapes10_1, LEAN.shapes10_2),
  // g: false,
  "496b8acb56": merged(LEAN.shapes8_9, LEAN.shapes8_11),
  // self.f = (self.f as i32).wrapping_add(Li32) as i16;
  "4979768984": LEAN.shapes2_1,
  // self.f = (-Li64).wrapping_neg();
  // if (len(self.f.f[(self.f as i64) as usize].to::<L>()) as i32) > (self.f as i32) {
  "4a599db8d8": merged(LEAN.shapes16_7, LEAN.shapes16_11),
  // pub x: i64,
  "4a6baf16b3": merged(LEAN.shapes13_1, LEAN.shapes13_4),
  // x = ((*x) as i32).wrapping_mul(Li32) as i16;
  "4b22d23722": merged(LEAN.shapes15_4, LEAN.shapes15_9),
  // self.f = match self.f { L => (*__lent_N).take(Li16), _ => panic!(S) };
  "4b5007906a": LEAN.shapes20_14,
  // self.f = Lu64;
  "4bf3f61062": LEAN.shapes1_10,
  // pub fn x<const T: usize>(mut x: usize, x: &mut IecString<T>) -> i32 {
  "4c796f6678": LEAN.shapes16_14,
  // x = (x as i32).wrapping_add(Li32) as u16;
  "4c9f4e33f4": LEAN.shapes14_4,
  // if !((x < x) & ((x.char_at(x.wrapping_add(x) as i64) as i32) == (x.char_at(x as i64) as i32))) { break; }
  "4d5ea12dda": LEAN.shapes16_5,
  // self.f = (self.v as u64).wrapping_sub({ let x = self.v as u64; let x = Lu64; if x == L { L } else { x.wrapping_rem
  "4d6263fb86": merged(LEAN.shapes10_1, LEAN.shapes10_2),
  // { let __copy_N = IecString::<L>::lit(B); self.f.call(&self.f, &__copy_N); }
  "4d6e5e12b9": LEAN.shapes16_12,
  // self.__property_N = Li16;
  "4d8c0c87ee": LEAN.shapes13_10,
  // { let mut x = std::mem::take(&mut prg.f); x.m(prg); prg.f = x; };
  "4da7af6f6b": LEAN.shapes9_8,
  // self.f = self.f[((Li8 as i64) - Li64) as usize];
  "4e213fd264": LEAN.shapes15_3,
  // *v = ((*v) as i32).wrapping_add(Li32) as i16;
  "4ebfb530bd": LEAN.shapes19_10,
  // self.f = false;
  "4edbb4135a": LEAN.shapes3_13,
  // self.f = m(self.f.to::<L>(), Li16, …).to::<L>().to();
  "4eeb332195": LEAN.shapes15_1,
  // self.f = (self.f as i32).wrapping_add(Li32) as u16;
  "4fb4aff790": LEAN.shapes8_3,
  // *x = { m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x as i64), Lu8).to();
  "4fb82cd93a": merged(LEAN.shapes16_2, LEAN.shapes16_3, LEAN.shapes16_10),
  // if !((x < Li32) & (x < x)) { break; }
  "50226e2c19": LEAN.shapes14_7,
  // *x = self.f;
  "50ba9519ad": LEAN.shapes17_9,
  // if !((x < x) && ((x[(x as i64) as usize] as i32) != Li32)) { break; }
  "50f8dcd811": LEAN.shapes16_5,
  // let mut take: i16 = Li16;
  "51ea066d8e": LEAN.shapes18_10,
  // loop {
  "521ba042ac": LEAN.shapes1_3,
  // self.f = self.f.wrapping_shr(Li16 as u32) as u16;
  "5228723708": LEAN.shapes8_4,
  // self.f = (*x).m();
  "52d85b7cdc": LEAN.shapes12_5,
  // x = x.wrapping_add(-Li32);
  "5351b3711d": LEAN.shapes13_6,
  // x = Li16;
  "5370b79269": LEAN.shapes12_10,
  // if x >= L { return (x as u64) as i64; }
  "5383e1c9ac": LEAN.shapes7_9,
  // take
  "53bd7d992e": LEAN.shapes17_9,
  // self.f = (self.f as i32) >= (self.f as i32);
  "54889e0f45": LEAN.shapes7_2,
  // x = (((x as i32).max(Li32) as u16) as i32).wrapping_sub(Li32);
  "5513d0e592": LEAN.shapes16_9,
  // self.f[(self.p as i64).wrapping_add(-Li64).wrapping_add(Li64) as usize].f = Li16;
  "55d895e28f": LEAN.shapes3_4,
  // self.f = m(self.f, … as f32);
  "55fe85cf23": LEAN.shapes5_4,
  // self.f = self.f.wrapping_sub(self.f).wrapping_add(self.f);
  "561f3f5e13": LEAN.shapes19_11,
  // x[(x as i64) as usize] = { m(x); *x }.char_at((x as i64).wrapping_sub(Li64).wrapping_add(x as i64));
  "569d2b7a40": merged(LEAN.shapes16_2, LEAN.shapes16_10),
  // pub fn m(mut __values_lower_N: i32, mut __values_upper_N: i32, x: &mut [u8]) -> i64 {
  "56c1a77525": LEAN.shapes16_15,
  // self.f = (self.f as i32).wrapping_abs() as u8;
  "56c33c9bab": LEAN.shapes7_3,
  // pub ops: [u64; L],
  "572db4e711": LEAN.shapes17_8,
  // self.f = Li64.wrapping_sub(Li64);
  "57a8f5a4c8": LEAN.shapes5_3,
  // *x = { m(x.f); *x }.wrapping_add(x as i32);
  "57ce9e2ee4": LEAN.shapes19_1,
  // self.v = m(self.f, Lf64);
  "5886a0dc2b": LEAN.shapes4_8,
  // self.f = Li64.wrapping_sub(Li64) as i32;
  "58988cbee9": LEAN.shapes7_1,
  // self.f.call(prg);
  "58a7e6289b": LEAN.shapes17_5,
  // self.f = Li64.max(Li64).max(Li64) as i16;
  "58d4f235fd": LEAN.shapes7_1,
  // x = __numbers_lower_N;
  "58edc15c64": LEAN.shapes13_17,
  // if (x as i32) < Li32 {
  "58f3434567": LEAN.shapes18_6,
  // self.f = Li32.wrapping_neg() as i16;
  // self.f = iec_min(self.f, …).to();
  "59b48cdb5b": LEAN.shapes5_8,
  // self.f = iec_max(self.f, …).to();
  "59b92aa532": LEAN.shapes5_8,
  // self.f = match self.f { L => self.f.m(), _ => panic!(S) };
  "59c341cb0f": LEAN.shapes19_6,
  // self.f = (match self.f { L => self.f as i32, …, _ => self.f as i32 }) as i16;
  "5a9bc1030e": LEAN.shapes9_6,
  // __chain_value_N: Li16,
  "5b7909c564": LEAN.shapes4_6,
  // self.v = self.f * (-Lf64);
  "5c40a4e5a8": LEAN.shapes4_9,
  // m(x);
  "5c499dbdc8": LEAN.shapes12_6,
  // self.f = replace(self.f.to::<L>(), IecString::<L>::lit(B), Li16, …).to::<L>().to();
  "5c7f0546bc": LEAN.shapes16_1,
  // pub x: f32,
  "5c9bb13706": LEAN.shapes12_14,
  // self.f = IecString::<L>::lit(iec_date_text(self.v as i64).as_bytes()).to();
  "5cd04259c1": LEAN.shapes9_1,
  // x[(x as i64).wrapping_sub(__numbers_lower_N as i64) as usize] = x.wrapping_mul(Li32) as i16;
  "5d3437b284": LEAN.shapes16_7,
  // x: IecString::<L>::lit(B),
  "5d9850550d": LEAN.shapes2_6,
  // self.f = match self.ops[((self.f as i64) - Li64) as usize] { L => self.f.m(self.f), L => self.f.m(self.f), _ => pa
  "5dcbae07c6": LEAN.shapes20_12,
  // if ((x as i32) >= Li32) & ((len as i32) > Li32) {
  "5e5aa25221": LEAN.shapes15_5,
  // let mut fb_init: i16 = Li16;
  "5e9caa6605": LEAN.shapes18_10,
  // (match self.f.f { L => self.f.m(&mut self.f), L => self.f.m(&mut self.f), _ => panic!(S) });
  "5ed54bb657": LEAN.shapes20_14,
  // self.f = (self.f as i32).wrapping_neg();
  "605307fc4c": LEAN.shapes7_3,
  // { let __arg_N = true; let __arg_N = false; let __arg_N = prg.f.f; { let mut x = std::mem::take(&mut prg.f); let x 
  "60d6b79cca": merged(LEAN.shapes20_8, LEAN.shapes20_9),
  // self.f = m(self.f as f64, Lf64) as f32;
  "61a75e7b4b": LEAN.shapes7_10,
  // self.f = (self.f as i32).wrapping_add(self.f.f as i32) as i16;
  "623e0abb20": LEAN.shapes19_10,
  // self.f = ((self.f as i32) / (self.f as i32)) as f32;
  "6256abaa7b": LEAN.shapes8_7,
  // self.f[((Li8 as i64) - Li64) as usize] = (self.f[((Li8 as i64) - Li64) as usize] as i32).wrapping_add(Li32) as i16
  "628bc6e2ed": LEAN.shapes12_2,
  // if ({ m(x); *__str_pst_N }.char_at((x as i64).wrapping_sub(Li64).wrapping_add(x as i64)) as i32) == Li32 { break; 
  "62c7abffa7": LEAN.shapes17_1,
  // x = __numbers_upper_N;
  "62caf55aa5": LEAN.shapes13_17,
  // self.m_set(__property_N);
  "637fe937dc": LEAN.shapes18_2,
  // self.f = self.f.wrapping_shl(self.f as u32);
  "638ea949bb": LEAN.shapes7_4,
  // self.v = Li64.wrapping_sub(Li64) as i32;
  "63c4ea9498": LEAN.shapes7_1,
  // pub x: i32,
  "63d29bd1a0": merged(LEAN.shapes12_12, LEAN.shapes12_13),
  // self.f = Li64.wrapping_sub(Li64) as i16;
  "63dc3d3963": LEAN.shapes7_1,
  // pub fn m(mut x: f32) -> f32 {
  "63e6752512": LEAN.shapes13_12,
  // self.f = Li8 as i16;
  "63f801635e": LEAN.shapes3_11,
  // g.f = (g.f as i32).wrapping_mul(Li32).wrapping_add(Li32) as i16;
  "64b82e4bf9": LEAN.shapes16_6,
  // self.f = ((self.f as i32) ^ (self.f as i32)) as u8;
  "64c0a06174": LEAN.shapes8_3,
  // *x = { m(x.f); *x }.wrapping_add(x as i64);
  "64cc413c0b": LEAN.shapes19_1,
  // x: Lu16,
  "65df8e0418": LEAN.shapes5_17,
  // *x = { m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x as i64), x[(x as i64) as usize]).to();
  "668b522f05": LEAN.shapes17_2,
  // x: (f64::INFINITY),
  "66ef68b08a": LEAN.shapes2_13,
  // self.f = (self.f as i32).wrapping_add(x as i32) as i16;
  "6713eb5cc0": LEAN.shapes19_10,
  // self.f.f[Li64 as usize] = ({ let x = self.f.f as u64; let x = Lu64; if x == L { L } else { x.wrapping_rem(x) } }) 
  "6750cc1d5f": merged(LEAN.shapes3_1, LEAN.shapes3_2, LEAN.shapes3_3),
  // self.f[(Li8 as i64) as usize][(Li8 as i64) as usize] = Lf32;
  "67c71ff35c": LEAN.shapes11_7,
  // self.v = self.f * (-Lf32);
  "682fffc71e": LEAN.shapes4_9,
  // x: std::array::from_fn(|_| std::array::from_fn(|_| [Li16; L])),
  "683d4b1944": LEAN.shapes12_1,
  // self.f.f = ({ let x = self.f.f[Li64 as usize] as u64; let x = Lu64; if x == L { L } else { x.wrapping_rem(x) } }).
  "6866dc0381": LEAN.shapes12_4,
  // x: false,
  "687428cc81": LEAN.shapes8_9,
  // __numbers_upper_N: Li32,
  "68cdda5f1a": LEAN.shapes13_17,
  // pub __inout_index_N: i64,
  "690693c479": LEAN.shapes18_1,
  // if x < -L { return i32::MIN; }
  "693c14b0bd": LEAN.shapes5_1,
  // pub fn m(&mut self, prg: &mut Programs, mut x: i16) -> i16 {
  "69b0552c65": LEAN.shapes19_8,
  // self.f = len(self.f.f[(self.f as i64) as usize].to::<L>());
  "6a2b5f2826": merged(LEAN.shapes15_3, LEAN.shapes15_14),
  // self.f = (self.f as i32).wrapping_abs() as i16;
  "6a41bda0a0": LEAN.shapes2_10,
  // pub x: f64,
  "6a98109119": LEAN.shapes11_5,
  // x = (self.f as i32).wrapping_mul(self.f as i32) as i16;
  "6b14b17ba7": LEAN.shapes19_10,
  // self.f = ((self.v as u64) / Lu64) as u32;
  "6b4f1bb990": LEAN.shapes7_5,
  // self.f = self.f.wrapping_add(self.f);
  "6bf6856d37": LEAN.shapes6_13,
  // pub fn __init(&mut self, g: &mut Globals) {
  "6cec059f2e": LEAN.shapes15_6,
  // x[(x as i64).wrapping_sub(__line_lower_N as i64) as usize].f = (x[(x as i64).wrapping_sub(__line_lower_N as i64) a
  "6d48208e3e": LEAN.shapes20_12,
  // pub fn m(&mut self, mut x: i16) -> i16 {
  "6dd22a92d0": LEAN.shapes14_14,
  // m(L, …u16, L, …i16, Li16, …, &mut self.f, …);
  "6e06410746": LEAN.shapes15_15,
  // pub fn m(mut x: u8) -> bool {
  "6e16e4ee84": LEAN.shapes13_12,
  // self.f = (self.f as u64) as u32;
  "6e691851a6": merged(LEAN.shapes5_5, LEAN.shapes5_9),
  // self.f = Li64.wrapping_add(Li64) as i16;
  "6e95d900d2": LEAN.shapes7_1,
  // (x as i64) as i32
  "6f8ef8f0bd": LEAN.shapes3_8,
  // x: (-Li32),
  "6f9ae8fd3a": LEAN.shapes1_1,
  // self.f.m_set(prg, self.__property_N);
  "6ff1de2a48": LEAN.shapes18_2,
  // self.f = m(self.f.to::<L>(), Li16).to::<L>().to();
  "7030300a1b": LEAN.shapes15_1,
  // self.f = x;
  "707233d6d6": LEAN.shapes11_11,
  // self.f[(Li8 as i64) as usize].m();
  "7073e4cc28": LEAN.shapes6_9,
  // *x = ((*x) as i32).wrapping_add(x as i32) as i16;
  "707715f6ab": LEAN.shapes19_10,
  // x = IecString::<L>::lit(B).to();
  "708b7c88b3": LEAN.shapes18_10,
  // self.f = { self.__inout_index_N = self.f; let __arg_N = self.m(); m(__arg_N, &mut self.f[(self.__inout_index_N as 
  "70b25e3c85": LEAN.shapes20_10,
  // pub fn m(mut x: i32, x: &mut bool) -> i32 {
  "72543de594": LEAN.shapes19_2,
  // self.f.f = (self.f as i32) <= Li32;
  "73351964cd": LEAN.shapes18_6,
  // self.f = true;
  "73505351ad": LEAN.shapes1_5,
  // self.f = (self.f as i32).max(Li32).min(self.f as i32) as i16;
  "deaa2bbf15": LEAN.shapes8_6,
  // self.f = Li64.max(Li64).min(Li64) as i16;
  "745a764511": LEAN.shapes7_1,
  // x: Lf32,
  "74845f98c6": merged(LEAN.shapes4_3, LEAN.shapes5_15, LEAN.shapes5_16),
  // x = x.with_char(x as i64, str.char_at(x as i64)).to();
  "7566f32b5e": LEAN.shapes15_2,
  // self.f = IecString::<L>::lit(iec_lreal_text(self.v).as_bytes()).to();
  "7587dbd531": LEAN.shapes9_1,
  // self.f = ((self.f as i32) ^ (self.f as i32)) as i8;
  "7589f5a1ee": LEAN.shapes8_3,
  // p: L,
  "75cc82a569": merged(LEAN.shapes1_6, LEAN.shapes1_8),
  // x = ({ let x = x as i32; let x = Li32; if x == L { L } else { x.wrapping_rem(x) } }) as i16;
  "7685022caa": LEAN.shapes20_4,
  // if (x.f as i32) < Li32 {
  "770670a973": LEAN.shapes18_6,
  // x = m(x, &mut (*x)).wrapping_sub(Li32);
  "77378f7efe": LEAN.shapes14_9,
  // pub fn m(mut __numbers_lower_N: i32, mut __numbers_upper_N: i32, x: &mut [i16]) -> i32 {
  "775c30eac7": LEAN.shapes16_15,
  // self.f = Li32.max(self.f as i32).min(Li32) as i16;
  "9d3d81580d": LEAN.shapes8_6,
  // self.f = (self.v as u64).wrapping_mul(Lu64).wrapping_sub({ let x = (self.v as u64).wrapping_mul(Lu64); let x = Lu6
  "7812f5a53d": merged(LEAN.shapes10_1, LEAN.shapes10_2),
  // pub __output_N: i16,
  "782a04d94c": LEAN.shapes13_10,
  // self.f[(self.f as i64).wrapping_add(-Li64) as usize].f = Li16;
  "785b5ff775": LEAN.shapes12_3,
  // x: (f32::INFINITY),
  "78615154a3": LEAN.shapes2_13,
  // self.f = self.f[(Li8 as i64) as usize].f;
  "7886e7bd17": LEAN.shapes2_3,
  // self.f.count = (self.f.f[((Li8 as i64) - Li64) as usize].f.f as i32).wrapping_add(self.f.f[((Li8 as i64) - Li64) a
  "789e5223f1": LEAN.shapes12_2,
  // *x = { m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x as i64), x).to();
  "78f3cafc1e": merged(LEAN.shapes16_2, LEAN.shapes16_3, LEAN.shapes16_10),
  // x = x.wrapping_add(x[(x as i64).wrapping_sub(__values_lower_N as i64) as usize] as i32);
  "7918d10820": LEAN.shapes20_12,
  // self.f = (self.f as u8) as f32;
  "798c276f84": LEAN.shapes5_10,
  // __numbers_lower_N: Li32,
  "79fd4d52a6": LEAN.shapes13_17,
  // let mut __property_N: i16 = Li16;
  "79ff186095": LEAN.shapes18_2,
  // x = ((*x) as i32).wrapping_add((*x) as i32) as i16;
  "7a6f282031": merged(LEAN.shapes15_4, LEAN.shapes15_9),
  // x = m(&mut str) as i32;
  "7a85af3c04": LEAN.shapes13_15,
  // __chain_value_N: false,
  "7a88c529f6": LEAN.shapes11_11,
  // self.f = (self.f as i32).wrapping_sub(Li32) as i8;
  "7aa0eab362": LEAN.shapes8_3,
  // pub fn m(mut x: i16, x: &mut i16) -> i16 {
  "7ab9128afd": LEAN.shapes18_9,
  // *x = { m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x as i64), { m(x); *x }.char_at((x as i64).
  "7b34ea5981": LEAN.shapes17_2,
  // self.f = (if self.f { Li64 } else { Li64 }) as i16;
  "ba75ffae84": merged(LEAN.shapes10_4, LEAN.shapes10_5),
  // pub fn scan(&mut self, g: &mut Globals, prg: &mut Programs) {
  "7c7cff3d31": LEAN.shapes19_8,
  // x = (x as i32).wrapping_mul(Li32) as i16;
  "7c881bc819": LEAN.shapes15_4,
  // self.f = (self.f as i32).wrapping_abs();
  "7cf7edd325": LEAN.shapes7_3,
  // x = { m(p); *x }.char_at((p as i64).wrapping_sub(Li64).wrapping_add(Li64));
  "7cfee53212": merged(LEAN.shapes16_2, LEAN.shapes16_10),
  // self.f = (self.f as i32).wrapping_sub(self.f as i32) as i16;
  "7d2d13ed81": LEAN.shapes9_3,
  // self.f = m(L, …u16, &mut self.f, …);
  "7db062ce2f": LEAN.shapes14_8,
  // self.f = { let __copy_N = IecString::<L>::lit(B); m(&__copy_N) };
  "7de11239a2": LEAN.shapes20_7,
  // self.f = Li32.wrapping_neg() as u8;
  // x = m(x, &mut (*x));
  "7e45a342fc": LEAN.shapes13_9,
  // self.f = IecString::<L>::lit(iec_dt_text(self.v as i64).as_bytes()).to();
  "7e482a6261": LEAN.shapes9_1,
  // x = (self.f as i32).wrapping_mul(Li32).wrapping_add((g.f as i32).wrapping_mul(Li32)).wrapping_add(x as i32) as i16
  "7ee47c4eab": LEAN.shapes17_7,
  // g.f = (g.f as i32).wrapping_add(Li32) as i16;
  "7ef1346b85": LEAN.shapes15_4,
  // self.f = ((self.f as i32) | (self.f as i32)) as u8;
  "7f28567c88": LEAN.shapes8_3,
  // if (self.f & (!self.f)) & ((self.f as i32) > Li32) {
  "7f4dd168c2": LEAN.shapes15_5,
  // self.v = (-Li32).wrapping_neg();
  // pub __chain_value_N: f64,
  "7fc67373d7": LEAN.shapes4_6,
  // self.f = IecString::<L>::lit(B).to();
  "803ee89d4f": LEAN.shapes2_6,
  // self.f = (self.f as i32).wrapping_sub(self.f as i32) as i8;
  "8049b483ae": LEAN.shapes8_3,
  // self.f.call(&mut (*x));
  "8064ae1570": LEAN.shapes13_9,
  // x = Li32;
  "8088e0ab18": LEAN.shapes12_10,
  // self.f = (self.f as i32).max(self.f as i32) as i8;
  "80e291be91": LEAN.shapes8_3,
  // pub fn x<const T: usize>(x: &IecString<T>) -> bool {
  "81253ce291": LEAN.shapes15_14,
  // self.m_set(self.__property_N);
  "81d1867d27": LEAN.shapes18_2,
  // pub fn call(&mut self, x: &mut [i16]) {
  "81ed699293": LEAN.shapes14_15,
  // self.f = ((self.f as i32) | (self.f as i32)) as u16;
  "81f1075b92": LEAN.shapes8_3,
  // take = self.f;
  "821a3bb974": LEAN.shapes17_9,
  // *x = { m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x.wrapping_sub(x).wrapping_add(Li32).max(Li
  "828ee45554": LEAN.shapes17_2,
  // self.f = match self.f { L => (*__lent_N).m(), L => (*__lent_N).m(), _ => panic!(S) };
  "82e802ebc9": LEAN.shapes20_14,
  // x = (((x as i32) == Li32) | (((x as i32) >= Li32) & ((x as i32) <= Li32))) | ((x as i32) == Li32);
  "82fcd0be19": LEAN.shapes16_5,
  // self.f = Lu8 != L;
  "83389dfa8a": LEAN.shapes3_11,
  // *x = ((*x) as i32).wrapping_add(self.f as i32) as i16;
  "833efb5917": LEAN.shapes19_10,
  // self.f = ((self.v as u64) / Lu64).wrapping_sub({ let x = (self.v as u64) / Lu64; let x = Lu64; if x == L { L } els
  "8346bf3968": merged(LEAN.shapes10_1, LEAN.shapes10_2),
  // pub fn m(mut str: IecString<L>, mut x: i16) -> IecString<L> {
  "83ed1aab47": merged(LEAN.shapes16_11, LEAN.shapes16_16),
  // self.f[((self.f as i64) - Li64) as usize] = self.f.f;
  "848701ece2": LEAN.shapes19_3,
  // pub fn m(mut x: f64) -> f64 {
  "84ac703739": LEAN.shapes13_12,
  // prg.f.f.f = Li16;
  "85168be6a7": LEAN.shapes17_5,
  // self.f = m(self.f, &mut self.f);
  "8539587ea0": LEAN.shapes14_10,
  // self.f = IecWString::<L>::lit(&[Lu16, …]).to();
  "8597dc45bd": LEAN.shapes2_6,
  // self.f = m(self.f as f64) as u32;
  "8653414194": LEAN.shapes6_11,
  // x: Li64,
  "870b70e195": merged(LEAN.shapes6_1, LEAN.shapes6_4),
  // self.f = (self.v as u8) as f32;
  "873f201d21": LEAN.shapes5_10,
  // { let x = true; let x = &mut self.f; *x = if x { *x | (Lu8 << L) } else { *x & !(Lu8 << L) }; }
  "87cd3925f5": LEAN.shapes20_13,
  // self.f = (g.f as i32).max(self.f as i32).min(g.f as i32) as i16;
  "83d24ce33a": LEAN.shapes20_3,
  // self.f = len(self.narrow.to::<L>());
  "8986d5305c": LEAN.shapes14_18,
  // self.units = { let mut __copy_N = Li16; let mut __copy_N = Li16; let x = m(Li16, &mut __copy_N, …); self.f = __copy_N; self.f = __copy_N; x };
  // (re-keyed from `self.units = m(Li16, &mut self.f, …);` — a routine's outputs are copied out after the call, transpile-review 20)
  "2421f6476e": LEAN.shapes18_1,
  // self.f = (self.f as i32).min(self.f as i32) as i8;
  "8a1bafcc9c": LEAN.shapes8_3,
  // let mut fb_init: bool = false;
  "8a9bb48ddb": LEAN.shapes2_11,
  // self.f = self.f.wrapping_shr(self.f as u32);
  "8b69355dc1": LEAN.shapes7_4,
  // x: { let mut v = T::new(); v.f = Li16; v },
  "8b9a7c5eea": LEAN.shapes7_11,
  // self.f.m(Li32.wrapping_neg() as i16);
  // { m(self.f); self.f.m_set(self.__property_N) };
  "8c658bedd7": LEAN.shapes15_10,
  // self.f.narrow();
  "8cca954ad7": LEAN.shapes3_9,
  // x = (x as i32).wrapping_add(Li32) as i16;
  "8ccaa880cd": LEAN.shapes15_4,
  // self.f = Li64.min(Li64).min(Li64).min(Li64) as i16;
  "8cd84736a1": LEAN.shapes8_6,
  // x.f[((x.f as i64) - Li64) as usize].f = x;
  "8d7dcea3f3": LEAN.shapes19_3,
  // self.count = (self.count as i32).wrapping_add(Li32) as i16;
  "8d8ff2c804": LEAN.shapes8_3,
  // x = x.with_char(x as i64, Lu8).to();
  "8e30e6691c": LEAN.shapes14_3,
  // self.f.f = (((self.f as i32) == Li32) | ((self.f as i32) == Li32)) | ((self.f as i32) == Li32);
  "8e4b1ce4cc": LEAN.shapes20_2,
  // self.f = ({ let x = self.f as i32; let x = self.f as i32; if x == L { L } else { x.wrapping_rem(x) } }) as i16;
  "8e689b07b9": LEAN.shapes10_3,
  // self.f = ((self.f as f64).sqrt() as f32) > Lf32;
  "8efdf97fb5": LEAN.shapes8_8,
  // self.f = (self.f as i32).min(self.f as i32) as u16;
  "8f1829f5b3": LEAN.shapes8_3,
  // if (g.f as i32) <= Li32 {
  "8f2ea71862": LEAN.shapes18_6,
  // self.f = (x as i32).wrapping_mul(Li32) as i16;
  "8ffd5ed266": LEAN.shapes19_10,
  // pub fn sum(&mut self, mut x: [i16; L]) {
  "9034f2a4d6": LEAN.shapes18_9,
  // m(L, …u16, Li16, …, L, …u16, &mut self.f);
  "9055680d64": LEAN.shapes15_15,
  // self.f = Li64 == Li64;
  "907aa92bfc": LEAN.shapes4_7,
  // self.f = (self.f.f as i32).wrapping_mul(self.f.f as i32) as i16;
  "90ba7cf588": LEAN.shapes16_6,
  // x: Lu64,
  "90c445f7cb": LEAN.shapes5_16,
  // self.f.f = IecWString::<L>::lit(&[Lu16, …]).to();
  "90e7185468": merged(LEAN.shapes15_1, LEAN.shapes15_12),
  // self.f = (self.__chain_value_N as f32) as f64;
  "915417cef0": LEAN.shapes7_6,
  // self.f = ({ let x = (self.f as u64).wrapping_mul(Lu64); let x = Lu64; if x == L { L } else { x.wrapping_rem(x) } }
  "91d3eef64b": LEAN.shapes10_1,
  // self.f.f[((Li8 as i64) - Li64) as usize].f.f = Li16;
  "91f6be3675": LEAN.shapes11_7,
  // self.f = m(self.f as f64) as u16;
  "923862ec54": LEAN.shapes6_11,
  // self.f = self.f.wrapping_shr(Li8 as u32);
  "924a0fdb2f": LEAN.shapes7_1,
  // let mut replace: IecString<L> = IecString::<L>::lit(B);
  "92f7142ab2": LEAN.shapes15_11,
  // 'loop_N: loop {
  "93a17fab28": LEAN.shapes11_9,
  // 'body_N: {
  "95094bd48a": LEAN.shapes10_6,
  // self.f = (x as i32).wrapping_add(Li32) as i16;
  "9610f67747": LEAN.shapes19_10,
  // self.f = match self.p { L => self.f, …, _ => panic!(S) };
  "96161d76eb": LEAN.shapes3_5,
  // self.sum = (self.f as i32).wrapping_add(self.f as i32) as i16;
  "964296462a": LEAN.shapes9_3,
  // x: { let mut v = T::new(); v.f = Li16; v.f = Lf32; v },
  "9689b156ea": LEAN.shapes2_8,
  // *x = Li16;
  "96a5b25b66": LEAN.shapes1_9,
  // self.f = (match self.f { L => Li64, …, _ => Li64 }) as i16;
  "96b55e688b": LEAN.shapes8_6,
  // self.f = match self.f { L => self.f.m(Li16), _ => panic!(S) };
  "96bf43c1e7": LEAN.shapes19_6,
  // pub fn m(mut x: i16) -> T {
  "96f5f06912": LEAN.shapes13_12,
  // self.f = ((self.f as i32) ^ (self.f as i32)) as i16;
  "97c6103a21": LEAN.shapes8_3,
  // (match self.f { L => self.f.m(), L => self.f.m(), _ => panic!(S) });
  "9831f2d691": LEAN.shapes20_14,
  // self.f.f = ((self.f as i32) >= Li32) & ((self.f as i32) <= Li32);
  "98716b4ff8": LEAN.shapes20_2,
  // if ((*str).char_at(x as i64) as i32) == Li32 { break; }
  "98ba0d2e70": LEAN.shapes15_9,
  // self.f = (self.f as i32).wrapping_sub(Li32) as i16;
  "9999dc327a": LEAN.shapes8_3,
  // self.f = self.f.rotate_left(Li8 as u32);
  "9a4cb2346e": LEAN.shapes7_1,
  // if m(x, …, true, &mut (*x), &mut (*x)) {
  "9a63db2a45": LEAN.shapes14_9,
  // self.f = m(self.f.to::<L>(), IecString::<L>::lit(B)).to::<L>().to();
  "9a8003dce0": LEAN.shapes16_1,
  // self.f = self.f[((Li8 as i64) - Li64) as usize][((Li8 as i64) - Li64) as usize][((Li8 as i64) - Li64) as usize][((
  "9b12fdbfc8": LEAN.shapes12_2,
  // self.f = (if false { Li64 } else { Li64 }) as i16;
  "faa5102f23": LEAN.shapes10_4,
  // self.v = Li64.wrapping_sub(Li64) as i16;
  "9b7b8014c4": LEAN.shapes7_1,
  // self.f = { let __copy_N = self.f; self.m(&__copy_N) };
  "9bb47dec44": LEAN.shapes19_7,
  // let mut x: u8 = Lu8;
  "9c1d0c1a6e": LEAN.shapes13_16,
  // self.f.f = if self.f { self.f } else { self.f };
  "c2ecf76c31": LEAN.shapes20_3,
  // self.f = ({ let x = self.v / Lu64; let x = Lu64; if x == L { L } else { x.wrapping_rem(x) } }) as u32;
  "9c7ca7c1f9": LEAN.shapes10_1,
  // pub fn call<const T: usize>(&mut self, x: &i16, x: &IecString<T>) {
  "9c8bf093b2": LEAN.shapes16_12,
  // pub fn m(mut str: IecString<L>, mut len: i16, mut x: i16) -> IecString<L> {
  "9c8d21e237": LEAN.shapes16_11,
  // self.ops[((Li8 as i64) - Li64) as usize] = L;
  "9ca82cec1d": LEAN.shapes19_3,
  // self.f = replace(self.f.to::<L>(), self.f.to::<L>(), Li16, …).to::<L>().to();
  "9cbdbcc28b": LEAN.shapes16_1,
  // self.f = self.f.wrapping_shl(Li8 as u32);
  "9d8cd15435": LEAN.shapes18_4,
  // self.f = { let x = self.f; let x = Lu32; if x == L { L } else { x.wrapping_rem(x) } };
  "9db3c795da": LEAN.shapes20_4,
  // pub __chain_value_N: i16,
  "9e66c9a561": LEAN.shapes4_6,
  // x[(__numbers_upper_N as i64).wrapping_sub(__numbers_lower_N as i64) as usize] = Li16;
  "9edcbf6da4": LEAN.shapes16_7,
  // self.f[((self.f as i64) - Li64) as usize] = Li16;
  "9f8b867884": LEAN.shapes19_3,
  // if (self.f as i32) < Li32 {
  "9f93398f3e": LEAN.shapes11_16,
  // self.f = (self.f as i32) != (self.f as i32);
  "9fb281f7a2": LEAN.shapes7_2,
  // self.f = Lu32 as u64;
  "9fb47c3123": LEAN.shapes18_4,
  // (match self.f.f { L => self.f.m(&mut self.v), _ => panic!(S) });
  "9fbd098efb": LEAN.shapes3_12,
  // pub fn m(&mut self, mut x: i16) {
  "a01f00db76": LEAN.shapes18_9,
  // if ({ m(x); *x }.char_at((x as i64).wrapping_sub(Li64).wrapping_add(x as i64)) as i32) == Li32 {
  "a021273b0d": merged(LEAN.shapes16_2, LEAN.shapes16_5, LEAN.shapes16_10),
  // self.f = (self.f as i32) as i16;
  "a078903418": LEAN.shapes5_9,
  // self.f = self.f == IecString::<L>::lit(B);
  "a095c1d0aa": LEAN.shapes7_7,
  // self.f[(Li8 as i64) as usize].f = (self.f[(Li8 as i64) as usize].f as i32).wrapping_add(Li32) as i16;
  "a0d3389a70": LEAN.shapes3_3,
  // self.f = (self.f as f64).sqrt();
  "a1adee154e": LEAN.shapes5_11,
  // v: Li16,
  "a29db6178b": merged(LEAN.shapes6_1, LEAN.shapes6_2, LEAN.shapes6_3),
  // x = ({ m(x); *x }.char_at((x as i64).wrapping_sub(Li64)) as i32) == Li32;
  "a328a51dbd": LEAN.shapes16_2,
  // self.f = (self.f as i32) == (self.f as i32);
  "a363bc4ca3": LEAN.shapes7_2,
  // self.f = m(Lu8, L, …i32, &mut self.f, …);
  "a39c1efab6": LEAN.shapes15_15,
  // self.f = { let mut x = std::mem::take(&mut prg.f); let x = x.f.map(prg); prg.f = x; x };
  "a3a49d3776": LEAN.shapes20_9,
  // if (x as i32) > Li32 {
  "a3ca286f93": LEAN.shapes18_6,
  // self.f = { let mut x = std::mem::take(&mut prg.f); let x = x.f.m_get(prg); prg.f = x; x };
  "a41f58717b": LEAN.shapes20_9,
  // pub x: u64,
  "a497507b30": merged(LEAN.shapes13_1, LEAN.shapes13_2),
  // if ((x as i32) >= Li32) & ((x as i32) <= Li32) {
  "a54ead1fbe": LEAN.shapes15_5,
  // self.f = { let __copy_N = IecString::<L>::lit(B); self.m(&__copy_N) };
  "a558076adc": LEAN.shapes20_7,
  // len
  "a573b540d2": merged(LEAN.shapes12_10, LEAN.shapes12_11),
  // pub fn m(mut x: i16, …) -> i16 {
  "a5c4faeebd": LEAN.shapes14_14,
  // ops: std::array::from_fn(|_| L),
  "a65506e4d8": LEAN.shapes18_8,
  // self.v = Li32.wrapping_neg() as i8;
  // self.f = ((self.f as i32) & (self.f as i32)) as u16;
  "a7ca0579a1": LEAN.shapes8_3,
  // x: { let mut v = T::new(); v.f = IecString::<L>::lit(B); v.f = IecString::<L>::lit(B); v },
  "a7ca9e8349": LEAN.shapes16_13,
  // self.f = (self.f as i32).wrapping_sub(Li32) as u16;
  "a851cc298d": LEAN.shapes8_3,
  // self.f = (-Li32).wrapping_neg();
  // self.f = (self.f as i32).wrapping_neg() as u8;
  "a9c2598276": LEAN.shapes7_3,
  // self.f = (*x) == IecString::<L>::lit(B);
  "ab6512a512": LEAN.shapes14_17,
  // pub fn m(&mut self, prg: &mut Programs) {
  "ab696e2449": LEAN.shapes7_8,
  // x: (-f32::INFINITY),
  "aba7baaaaa": LEAN.shapes2_13,
  // pub fn m(mut x: u16) -> u16 {
  "abc8bc67de": LEAN.shapes13_12,
  // self.f = self.f[(Li8 as i64) as usize];
  "abe3ae1f0b": LEAN.shapes11_7,
  // { let mut x = std::mem::take(&mut prg.f); x.call(prg); prg.f = x; }
  "abf2bb6e4e": LEAN.shapes3_6,
  // self.f.f = self.f.clone();
  "ac452bc801": LEAN.shapes13_11,
  // g.f[((g.f as i64) - Li64) as usize].f = self.f;
  "acb72c4272": LEAN.shapes19_3,
  // self.f = L;
  "ad25627749": LEAN.shapes1_8,
  // self.f.f = ((self.f as i32) == Li32) | ((self.f as i32) == Li32);
  "adb6559f1f": LEAN.shapes16_5,
  // self.f = m(self.f.to::<L>(), IecString::<L>::lit(B), Li32.wrapping_neg() as i16).to::<L>().to();
  "b7bdb5cfef": LEAN.shapes20_6,
  // self.f = self.f[((Li8 as i64) - Li64) as usize][(Li8 as i64) as usize][((Li8 as i64) - Li64) as usize];
  "ae08e85841": LEAN.shapes12_2,
  // self.f = (self.f as i32).max(self.f as i32) as u16;
  "ae0e0c28ea": LEAN.shapes8_3,
  // { let mut x = std::mem::take(&mut prg.f); x.call(g, prg); prg.f = x; }
  "ae38098da5": LEAN.shapes20_9,
  // self.f = (self.f as i32).wrapping_shr(Li8 as u32) as i8;
  "af004404ec": LEAN.shapes8_5,
  // self.f = IecString::<L>::lit(x!(S, self.f).as_bytes()).to::<L>().to();
  "af39c91205": LEAN.shapes9_2,
  // v: Lu32,
  "afa5d14dd9": LEAN.shapes6_1,
  // pub fn x<const T: usize>(&mut self, x: &IecString<T>) -> bool {
  "b03c447093": LEAN.shapes19_7,
  // self.f = IecString::<L>::lit(iec_dt_text(self.f as i64).as_bytes()).to::<L>().to();
  "b060fcca7b": LEAN.shapes9_2,
  // self.f = m(self.f).log10() as f32;
  "b07338e4d9": LEAN.shapes6_10,
  // if ((self.f as i32) == Li32) & ((self.f as i32) == Li32) {
  "b0965eecf6": merged(LEAN.shapes11_16, LEAN.shapes11_17),
  // self.f.f[Li64 as usize] = ({ let x = (self.f.f as u64) / Lu64; let x = Lu64; if x == L { L } else { x.wrapping_rem
  "b0fe4f487d": merged(LEAN.shapes3_1, LEAN.shapes3_2, LEAN.shapes3_3),
  // self.f.f = ({ let x = self.f as i32; let x = Li32; if x == L { L } else { x.wrapping_rem(x) } }) == Li32;
  "b1e8ba6d90": LEAN.shapes16_4,
  // if ((x as i32) < Li32) | ((x as i32) > x) {
  "b2d33739c5": LEAN.shapes15_5,
  // self.f = (if self.f { g.f as i32 } else { g.f as i32 }) as i16;
  "14e2fedf17": LEAN.shapes20_3,
  // x = __grid_lower_N;
  "b3a0495ed2": LEAN.shapes13_17,
  // self.f = T::new();
  "b3e78a179a": LEAN.shapes11_12,
  // self.f = self.f.f[(Li8 as i64) as usize];
  "b4183b4f7f": LEAN.shapes11_7,
  // self.f = (self.f as f64).cos() as f32;
  "b48af08c44": LEAN.shapes6_10,
  // x: (-Li8),
  "b501abe431": LEAN.shapes1_1,
  // self.f = { let x = ((self.narrow * Lf32) as f64).trunc(); if (-L..=L).contains(&x) { x as i32 } else { i32::MIN } 
  "b532048eaa": LEAN.shapes17_6,
  // x = { let __arg_N = m(x); m(__arg_N) };
  "b58894b5df": LEAN.shapes14_12,
  // pub fn m(mut x: IecString<L>, …, mut x: i16) -> IecString<L> {
  "b592939dbf": LEAN.shapes16_11,
  // { let mut __copy_N = self.f.clone(); self.m(Li16, Li32, …, &mut __copy_N); self.f = __copy_N; };
  "b6565109d7": LEAN.shapes20_9,
  // self.f = Li32 as i8;
  "b6a5a933fb": LEAN.shapes3_11,
  // if x >= L { return L; }
  "b7286c7932": LEAN.shapes4_5,
  // x.f = (x as i32) > Li32;
  "b733155a29": LEAN.shapes13_14,
  // if self.f > self.f.m_get() { break; }
  "b736e18f55": LEAN.shapes14_7,
  // self.f = m(x, &mut (*__lent_N));
  "b75c863ba4": LEAN.shapes18_3,
  // self.f = { let x = (self.v as u64).wrapping_mul(Lu64); let x = Lu64; if x == L { L } else { x.wrapping_rem(x) } };
  "b7631cfae9": LEAN.shapes10_1,
  // self.f = (self.f ^ self.f) ^ self.f;
  "b7bf67b59d": LEAN.shapes6_12,
  // pub fn m(mut x: u8) -> u8 {
  "b7cc1b2b1d": merged(LEAN.shapes13_12, LEAN.shapes13_16),
  // pub __numbers_upper_N: i32,
  "b894525f6e": LEAN.shapes13_17,
  // *x = { m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x as i64), { m(x); *x }.char_at((x as i64).
  "b8e7f28ba6": LEAN.shapes17_2,
  // pub fn map(&mut self, prg: &mut Programs) -> i16 {
  "b959cb02cf": LEAN.shapes19_8,
  // pub fn call(&mut self, g: &mut Globals) {
  "b9787e0d18": LEAN.shapes15_6,
  // self.f = (self.f as i32).wrapping_sub(self.f as i32) as u8;
  "b991267156": LEAN.shapes8_3,
  // self.f = ((self.f as i32) & (self.f as i32)) as u8;
  "ba37642ce3": LEAN.shapes8_3,
  // self.f = ((self.f as i32) | (self.f as i32)) as i16;
  "ba90e3c4fe": LEAN.shapes8_3,
  // pub fn m(&mut self, mut x: i16, …, x: &mut i16, …) -> i16 {
  "bb4c155c09": LEAN.shapes15_7,
  // self.f = (self.f as i32).min(self.f as i32) as u8;
  "bcb0fc562e": LEAN.shapes8_3,
  // self.narrow = self.f.f.narrow::<L>().to();
  "90205de00e": LEAN.shapes16_1,
  // self.f = if self.g { self.f } else { self.f };
  "12a2ae661a": LEAN.shapes9_5,
  // pub fn init(&mut self, prg: &mut Programs) {
  "bea3694884": LEAN.shapes7_8,
  // self.f = (self.f as i32) < (self.f as i32);
  "beb0779c8f": LEAN.shapes7_2,
  // self.f = (self.f as i32) > (self.f as i32);
  "bf88572dda": LEAN.shapes7_2,
  // self.sum = (self.sum as i32).wrapping_add(self.f[((self.f as i64) - Li64) as usize].f as i32) as i16;
  "bff12f96c5": merged(LEAN.shapes16_6, LEAN.shapes16_7),
  // pub fn replace(mut x: IecString<L>, …, mut x: i16, mut p: i16) -> IecString<L> {
  "c001fbb3b1": LEAN.shapes16_11,
  // pub fn m(&mut self, mut p: usize, x: &mut i16) -> i16 {
  "c0092c8e9b": LEAN.shapes19_9,
  // x = x.with_char(x.wrapping_add(x) as i64, Lu8).to();
  "c05be29130": LEAN.shapes15_2,
  // self.f = (self.f.f as i32).wrapping_mul(Li32) as i16;
  "c069593bcd": LEAN.shapes15_4,
  // self.f[(Li8 as i64) as usize] = Lf32;
  "c0e245211c": LEAN.shapes11_7,
  // x = (g.f as i32).wrapping_add(Li32) as i16;
  "c1a4f50099": LEAN.shapes15_4,
  // x[(x as i64) as usize] = Lu8;
  "c2409a5969": LEAN.shapes13_7,
  // self.f = (self.v as u64).wrapping_mul(Lu64);
  "c2729b1a2a": LEAN.shapes7_5,
  // self.narrow = self.f.narrow::<L>().to::<L>().to();
  "08b9196831": merged(LEAN.shapes15_1, LEAN.shapes16_11),
  // self.f = (self.f as i32).min(g.f as i32) as i16;
  "c2a92e6f4e": LEAN.shapes19_4,
  // self.f = (Lf64 - self.f).sqrt();
  "c2d750a62a": LEAN.shapes5_11,
  // self.f = m(self.f.to::<L>(), Li16, Li32.wrapping_neg() as i16).to::<L>().to();
  "e42f1ae167": LEAN.shapes16_1,
  // x: (-Lf64),
  "c35f240db9": LEAN.shapes1_1,
  // x.f = IecString::<L>::lit(B).to();
  "c49c211047": LEAN.shapes14_3,
  // self.f[((Li8 as i64) - Li64) as usize] = Li16;
  "c52c7994ca": LEAN.shapes11_7,
  // if x.is_nan() || !(-L..L).contains(&x) { return i64::MIN; }
  "c5844eabe9": LEAN.shapes8_2,
  // self.f = m(self.f.to::<L>(), self.f.f[(self.f as i64) as usize].to::<L>()).to::<L>().to();
  "c58cc5538f": merged(LEAN.shapes16_1, LEAN.shapes16_7),
  // x.f = x.f;
  "c5d30c56ec": LEAN.shapes17_10,
  // match x {
  "c6322760e4": LEAN.shapes17_10,
  // self.f = IecString::<L>::lit(iec_time_text(self.v as i64).as_bytes()).to();
  "c689147e80": LEAN.shapes9_1,
  // self.f = { let __arg_N = Li16; { let mut x = std::mem::take(&mut prg.f); let x = x.m(prg, __arg_N); prg.f = x; x }
  "c68f0b1ef6": merged(LEAN.shapes20_8, LEAN.shapes20_9),
  // if (self.f as i32) >= Li32 { break; }
  "c7ac9a5e64": LEAN.shapes11_16,
  // if self.__chain_value_N {
  "c7af448b33": LEAN.shapes11_11,
  // if ({ let x = self.f as i32; let x = Li32; if x == L { L } else { x.wrapping_rem(x) } }) != Li32 {
  "c7f76e08cf": LEAN.shapes11_14,
  // self.f = ((self.f as f64).sqrt() as f32) + Lf32;
  "c83ad009ae": LEAN.shapes8_8,
  // g.f[((g.f as i64) - Li64) as usize].f = IecString::<L>::lit(B).to();
  "c86923a1ee": LEAN.shapes20_12,
  // self.f = [Li16; L];
  "c8927952f2": LEAN.shapes11_12,
  // self.f = (!self.f) | self.f;
  "c8ac3c10c1": LEAN.shapes5_12,
  // pub fn m(&mut self, mut x: i16, …) -> i16 {
  "c8ca44a755": LEAN.shapes15_7,
  // self.f = IecString::<L>::lit(iec_ltime_text(self.v).as_bytes()).to();
  "c9573720ef": LEAN.shapes9_1,
  // x: std::array::from_fn(|_| T::new()),
  "c9c77500c6": merged(LEAN.shapes2_7, LEAN.shapes2_9),
  // self.f = (self.f as i32).wrapping_add(self.f as i32) as i16;
  "c9cd63632c": merged(LEAN.shapes9_3, LEAN.shapes9_13),
  // self.f.call(&mut (*__lent_N));
  "ca81b2092d": LEAN.shapes18_3,
  // m(x.f);
  "ca823a2c56": merged(LEAN.shapes17_1, LEAN.shapes17_10),
  // self.f = m(L, …i16, &mut self.f, …);
  "ca94bceedc": LEAN.shapes14_8,
  // x = { let __arg_N = m(x.f.to::<L>(), IecString::<L>::lit(B)); let __arg_N = x.f.to::<L>(); m(__arg_N, …) }.to::<L>
  "cb2199fcf3": LEAN.shapes17_4,
  // self.f = (self.f as i32).wrapping_mul(Li32).wrapping_add(self.f as i32) as i16;
  "cbab9cd013": LEAN.shapes9_3,
  // self.f = { let mut __copy_N = Li16; let mut __copy_N = Li16; let x = self.f.take(Li16, &mut __copy_N, …); self.f = __copy_N; self.f = __copy_N; x };
  // (re-keyed from `self.f = self.f.take(Li16, &mut self.f, …);` — a routine's outputs are copied out after the call, transpile-review 20)
  "1bb6d1cb14": LEAN.shapes19_11,
  // x = m(&mut x) as i32;
  "cbcde0e5de": LEAN.shapes13_15,
  // pub fn m(mut x: i32, x: &mut T) -> bool {
  "cc3063b338": LEAN.shapes15_7,
  // x = __numbers_lower_N.wrapping_mul(Li32).wrapping_add(__numbers_upper_N);
  "cc9778f81f": LEAN.shapes16_15,
  // *x = ({ m(x.f); *x } as i32).wrapping_add(x as i32) as i16;
  "cca22914d5": LEAN.shapes19_1,
  // if (self.f.f.f as i32) > Li32 {
  "cd54e9d497": LEAN.shapes14_6,
  // pub fn m_get(&mut self, prg: &mut Programs) -> i16 {
  "ceb0cb99a7": LEAN.shapes19_8,
  // self.f = ((self.f as i32) & (self.f as i32)) as i8;
  "ceb22698cf": LEAN.shapes8_3,
  // self.f = ({ let x = self.f as i32; let x = self.f as i32; if x == L { L } else { x.wrapping_rem(x) } }) as u8;
  "cedcee340b": LEAN.shapes10_3,
  // pub fn m(&mut self, mut x: i16) -> bool {
  "d00d314ec2": LEAN.shapes18_9,
  // self.f[((self.f as i64) - Li64) as usize] = (g.f / Lu64) as u32;
  "d04295d4c8": LEAN.shapes19_3,
  // if (self.f & (!self.f)) & ((self.f as i32) < Li32) {
  "d0865e3847": LEAN.shapes15_5,
  // self.f = self.f.widen::<L>().to::<L>().to();
  "e9e296435a": LEAN.shapes15_1,
  // pub fn x<const T: usize, …>(mut x: usize, mut x: u16, mut x: i16, …, mut x: usize, mut x: u16, x: &mut IecString<T
  "d231c1a7e5": LEAN.shapes17_11,
  // self.f.f = (((self.f as i32) >= Li32) & ((self.f as i32) <= Li32)) | ((self.f as i32) == Li32);
  "d263b8545d": LEAN.shapes20_2,
  // x: (-f64::INFINITY),
  "d2d239250b": LEAN.shapes2_13,
  // self.f = (Li64 / Li64) as f32;
  "d365a76953": LEAN.shapes5_14,
  // self.f = (self.f as i32).wrapping_neg() as u16;
  "d379abfe6a": LEAN.shapes7_3,
  // pub fn m(mut x: i32, mut x: i16, x: &mut i16) -> bool {
  "d39e19d533": LEAN.shapes19_2,
  // self.f = Li64.wrapping_sub(Li64) as i8;
  "d46e26c2aa": LEAN.shapes7_1,
  // x: { let mut v = T::new(); v.f = { let mut v = T::new(); v.f = Li16; v }; v.f = Li16; v },
  "d5d625ee73": LEAN.shapes3_7,
  // self.f = (self.f as i32).wrapping_add(Li32) as u8;
  "d67dd34190": LEAN.shapes8_3,
  // x[(x as i64).wrapping_sub(__line_lower_N as i64) as usize].f = x as i16;
  "d8a5dd49a9": LEAN.shapes20_12,
  // if !((x.wrapping_add(x) < Li32) & ((x.char_at(x as i64) as i32) != Li32)) { break; }
  "d8b7f34852": LEAN.shapes16_5,
  // pub fn m(mut x: i32, mut x: i16, x: &mut i32) -> bool {
  "d8e4a747d3": LEAN.shapes19_2,
  // self.f = (self.f as i32) == Li32;
  "d99adbcc4b": LEAN.shapes14_6,
  // self.f = (self.f as i32).wrapping_neg() as i8;
  "d9d76a4055": LEAN.shapes7_3,
  // pub fn x<const T: usize, …>(mut x: usize, mut x: u16, mut x: usize, mut x: i16, …, x: &mut IecString<T>, …) {
  "db57faba5d": LEAN.shapes17_11,
  // self.f = m(self.f.to::<L>(), self.f.to::<L>(), Li16).to::<L>().to();
  "db96948bf3": LEAN.shapes16_1,
  // self.f = (self.char as i32).wrapping_add(self.f as i32) as i16;
  "dbc172da6a": LEAN.shapes9_3,
  // pub fn len(mut str: IecString<L>) -> i16 {
  "dbcd1088a5": merged(LEAN.shapes15_7, LEAN.shapes15_14),
  // self.f = match self.f { L => self.f.m_get(), _ => panic!(S) };
  "dc1e3df820": LEAN.shapes19_6,
  // pub fn m(&mut self) -> IecString<L> {
  "dc8437c26a": LEAN.shapes18_10,
  // self.f = ({ m(self.f); self.f } as i32).wrapping_add(Li32) as i16;
  "dd1daf8424": merged(LEAN.shapes9_3, LEAN.shapes9_10),
  // pub fn m(mut x: i32, x: &mut f64) -> i32 {
  "dd28a02e7e": LEAN.shapes19_2,
  // pub fn m(mut x: i32, mut x: i16, x: &mut i8) -> bool {
  "dd8988b5d4": LEAN.shapes19_2,
  // fn m(x: usize) { if x == L { panic!(S); } }
  "dd94ff18a2": LEAN.shapes2_14,
  // pub x: bool,
  "de132e5019": LEAN.shapes1_5,
  // let x = if v < L { -((-v).round()) } else { v.round() };
  "de283d0ef6": LEAN.shapes8_1,
  // if !((x < x) & (x < x)) { break; }
  "de2f16610e": LEAN.shapes14_7,
  // pub x: usize,
  "de8528b197": LEAN.shapes1_12,
  // self.f = self.f.wrapping_shr(Li16 as u32) as u32;
  "de956f2a12": LEAN.shapes8_4,
  // self.f = len(self.v.to::<L>());
  "dea089f2fd": LEAN.shapes14_18,
  // *x = { m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x.max(Li32) as i64), Lu8).to();
  "deb9c88c25": merged(LEAN.shapes16_2, LEAN.shapes16_3),
  // self.f.__numbers_upper_N = self.__numbers_upper_N;
  "debabdec0d": LEAN.shapes15_13,
  // __inout_index_N: Li64,
  "def43ae4d0": LEAN.shapes18_1,
  // self.f = m(&mut self.f).to();
  "df1778304b": LEAN.shapes13_8,
  // pub fn m(&mut self, x: &mut i16) -> i16 {
  "dfc9d07c2c": LEAN.shapes15_7,
  // self.f.clamp();
  "e007ef42d8": merged(LEAN.shapes3_9, LEAN.shapes3_10),
  // self.f[(Li8 as i64) as usize] = Li16;
  "e02b80c3c1": LEAN.shapes11_7,
  // self.f = ((self.f as i32) | (self.f as i32)) as i8;
  "e1456a0eae": LEAN.shapes8_3,
  // self.f = self.f.wrapping_add((if self.f { -Li64 } else { Li64 }) as i16);
  "60fefc4d63": LEAN.shapes11_8,
  // self.f = m(self.f.to::<L>(), self.f.to::<L>()).to::<L>().to();
  "e205f81b84": LEAN.shapes16_1,
  // if (self.f as i32) <= Li32 { break; }
  "e2e0d67858": LEAN.shapes11_16,
  // x.f = L;
  "e3343dab4f": LEAN.shapes17_10,
  // x = __values_upper_N.wrapping_mul(Li32) as i64;
  "e37b53617c": LEAN.shapes15_13,
  // self.f = m(self.f as f64) as i16;
  "e3e3555f9c": LEAN.shapes6_11,
  // { let mut x = std::mem::take(&mut prg.f); x.f.call(prg); prg.f = x; }
  "e436b886c1": LEAN.shapes20_9,
  // x = L;
  "e496034f7b": LEAN.shapes12_9,
  // x: { let mut v = T::new(); v.f = Lf32; v },
  "e4b6325c44": LEAN.shapes2_8,
  // if ({ m(x); *x }.char_at((x as i64).wrapping_sub(Li64).wrapping_add(x as i64)) as i32) == Li32 { break; }
  "e6075a580f": merged(LEAN.shapes16_2, LEAN.shapes16_5, LEAN.shapes16_10),
  // let mut x: IecString<L> = IecString::<L>::lit(B);
  "e6646a0bd0": LEAN.shapes15_11,
  // x = x.wrapping_add(Li32) as i16;
  "e6ef5a4585": LEAN.shapes14_4,
  // self.f = (self.f as i32).max(g.f as i32) as i16;
  "e708298af7": LEAN.shapes19_4,
  // { let x = false; let x = &mut self.f; *x = if x { *x | (Lu16 << L) } else { *x & !(Lu16 << L) }; }
  "e76a0c7276": LEAN.shapes20_13,
  // if x > x.wrapping_sub(x) { break; }
  "e798927653": LEAN.shapes14_7,
  // self.f = (self.f as i32).wrapping_mul(Li32) as i16;
  "e7b84e4a19": LEAN.shapes8_3,
  // x = ((*x).m() as i32).wrapping_add(x.f as i32) as i16;
  "e7c2f94b63": merged(LEAN.shapes15_4, LEAN.shapes15_9),
  // self.f = ({ let x = (self.v as u64).wrapping_mul(Lu64); let x = Lu64; if x == L { L } else { x.wrapping_rem(x) } }
  "e7c5e77bb8": LEAN.shapes10_1,
  // self.f.f = (self.f as i32) == Li32;
  "e7e1a63970": LEAN.shapes14_6,
  // self.__chain_value_N = self.f;
  "e7e871371f": LEAN.shapes5_7,
  // self.units = len(self.narrow.to::<L>());
  "e8162bb9aa": LEAN.shapes14_18,
  // x = x.with_char(x.wrapping_add(x) as i64, x.char_at(x as i64)).to();
  "e8210b694c": merged(LEAN.shapes16_1, LEAN.shapes16_3),
  // pub fn fb_init(&mut self, mut x: bool) -> bool {
  "e82fbd8112": LEAN.shapes2_11,
  // x: Lu32,
  "e8954e2b0d": merged(LEAN.shapes4_1, LEAN.shapes4_2, LEAN.shapes1_10),
  // if self.f > self.f.m() { break; }
  "e8a1222ae6": LEAN.shapes14_7,
  // self.f = IecString::<L>::lit(x!(S, self.v).as_bytes()).to();
  "e921bd1d7e": LEAN.shapes9_1,
  // if ({ m(x); *__str_pst_N }.char_at(((x as i64).wrapping_sub(Li64) / Li64).wrapping_add(x as i64)) as i32) == Li32 
  "e9a5cabd36": LEAN.shapes17_12,
  // self.f = m(self.f.to::<L>(), Li32.wrapping_neg() as i16).to::<L>().to();
  "0a2a55e976": LEAN.shapes16_1,
  // self.copied = self.copied;
  "ea53989ac8": LEAN.shapes11_20,
  // if ((x == L) | (x == L)) | ((x as i32) == Li32) {
  "ea6f85988f": LEAN.shapes15_5,
  // x = x[((Li8 as i64) - Li64) as usize];
  "eb533b340b": LEAN.shapes14_2,
  // self.f = self.f.f[((Li8 as i64) - Li64) as usize].f.f;
  "ebc60e2668": LEAN.shapes11_7,
  // x = str.to();
  "ec1b55e90b": LEAN.shapes12_7,
  // if (x == L) | (x == L) {
  "ec21aafede": LEAN.shapes13_13,
  // x: (-Li16),
  "ec9a760059": LEAN.shapes1_1,
  // *x = ((x as i32) / (x as i32)) as i16;
  "ed3ad19a47": LEAN.shapes14_5,
  // pub fn m_set(&mut self, prg: &mut Programs, mut x: i16) {
  "ed425c8710": LEAN.shapes19_8,
  // self.f = (self.f as i32).wrapping_mul(Li32) as u16;
  "ed846b075d": LEAN.shapes8_3,
  // if x > __grid_upper_N { break; }
  "ed880b92a8": merged(LEAN.shapes14_7, LEAN.shapes14_15),
  // self.f = self.__chain_value_N as f32;
  "ee5f8f4ae1": LEAN.shapes6_8,
  // self.f = ({ let x = self.f as i32; let x = self.f as i32; if x == L { L } else { x.wrapping_rem(x) } }) as i8;
  "eea3dc7538": LEAN.shapes10_3,
  // self.f = m((self.narrow * Lf32) as f64);
  "eeb4929f34": LEAN.shapes14_13,
  // self.f = (self.v as u64) as u32;
  "eeb7e2463d": LEAN.shapes5_9,
  // m(L, &mut self.f);
  "ef4db7eb51": merged(LEAN.shapes12_6, LEAN.shapes12_9),
  // self.f = { m(self.p); self.f[(self.p as i64).wrapping_add(-Li64) as usize].f };
  "ef64f29f0d": LEAN.shapes3_4,
  // *x = ({ m(x.f); *x } as i32).wrapping_add((x as i8) as i32) as i8;
  "efd31f3397": LEAN.shapes20_15,
  // g.f.count = (g.f.count as i32).wrapping_add(g.f as i32) as i16;
  "eff90824ac": LEAN.shapes19_10,
  // (*x).call();
  "f0065dbd0b": LEAN.shapes12_5,
  // self.f.__numbers_lower_N = Li32;
  "f06209ef9e": LEAN.shapes14_15,
  // x[(x as i64).wrapping_sub(__grid_lower_N as i64) as usize][(x as i64).wrapping_sub(__grid_lower_N as i64) as usize
  "f07cf2da87": LEAN.shapes17_3,
  // x = x.with_char(x as i64, x.char_at(x as i64)).to();
  "f0973f1bcc": LEAN.shapes15_2,
  // x[(x.wrapping_add(x) as i64) as usize] = x[(x.wrapping_add(x) as i64) as usize];
  "f10c6b31a0": LEAN.shapes16_7,
  // self.f = self.v.m(&mut self.__output_N);
  "f1b8c2a1e6": LEAN.shapes14_11,
  // self.f = (self.f & (self.f | (self.f & (!self.f)))) | (self.f ^ self.f);
  "f22b4df758": LEAN.shapes9_12,
  // self.f = true as u8;
  "f2987aca6a": LEAN.shapes3_11,
  // *x = { m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x.wrapping_add(x) as i64), { m(x); *x }.cha
  "f31583df05": LEAN.shapes17_2,
  // pub fn m(&mut self, mut x: i16, …) {
  "f327cfe40a": LEAN.shapes18_9,
  // self.f = ((self.f as i32) ^ (self.f as i32)) as u16;
  "f35183a6a9": LEAN.shapes8_3,
  // if (len as i32) > Li32 {
  "f39a4e5fb5": LEAN.shapes13_14,
  // x as i64
  "f44fb59407": LEAN.shapes3_8,
  // self.f = self.f & (!self.f);
  "f474d0ca12": LEAN.shapes5_12,
  // pub x: [u64; L],
  "f4a4eb1ade": LEAN.shapes17_8,
  // self.f[((Li8 as i64) - Li64) as usize][((Li8 as i64) - Li64) as usize][((Li8 as i64) - Li64) as usize][((Li8 as i6
  "f59561bd3c": LEAN.shapes12_2,
  // self.f = (Li64 / Li64) as f64;
  "f5a6eb5ecf": LEAN.shapes5_14,
  // pub fn m(mut x: IecString<L>, …) -> i16 {
  "f5ca982c14": merged(LEAN.shapes15_7, LEAN.shapes15_14),
  // pub fn m(&mut self, g: &mut Globals) -> i16 {
  "f62e4d99a5": LEAN.shapes15_6,
  // pub fn m(mut x: i8) -> bool {
  "f75c7acc4a": LEAN.shapes13_12,
  // m(self.p);
  "f7ea0fc7a1": merged(LEAN.shapes11_1, LEAN.shapes11_2, LEAN.shapes11_3, LEAN.shapes11_4),
  // self.f = m(-Li32, …, &mut self.f);
  "f7faf582da": LEAN.shapes14_15,
  // self.f = (self.v / Lu64).wrapping_sub({ let x = self.v / Lu64; let x = Lu64; if x == L { L } else { x.wrapping_rem
  "f8319bc5b1": merged(LEAN.shapes10_1, LEAN.shapes10_2),
  // { let x = true; let x = &mut self.f; *x = if x { *x | (Li16 << L) } else { *x & !(Li16 << L) }; }
  "f85632e185": LEAN.shapes20_13,
  // self.f = m(self.f, Lf32);
  "f8b810062b": LEAN.shapes4_8,
  // x: std::array::from_fn(|_| [Li16; L]),
  "f9bdd4950a": LEAN.shapes2_7,
  // pub fn init(&mut self) {
  "fa7d5f176f": LEAN.shapes2_12,
  // if !(((((if self.f { -Li64 } else { Li64 }) as i16) >= Li16) & (self.f <= self.f)) | ((((if self.f { -Li64 } else { Li64 }) as i16) < Li16) & (self.f >= self.f))) { break; }
  "9358115574": LEAN.shapes11_8,
  // let mut map: i16 = Li16;
  "faf5605030": LEAN.shapes18_10,
  // self.m();
  "fb7e9e6ff4": LEAN.shapes8_10,
  // __chain_value_N: Lf64,
  "fbbfa869cf": LEAN.shapes4_6,
  // x: L,
  "fbde4d6e1e": LEAN.shapes1_8,
  // self.f = (self.f.f as i32).wrapping_add(self.f.f as i32) as i16;
  "fbfd8ba027": LEAN.shapes16_6,
  // self.f[(Li8 as i64) as usize] = (self.f[(Li8 as i64) as usize] as i32).wrapping_add(Li32) as i16;
  "fcc10694ff": LEAN.shapes12_2,
  // *x = { m(x); *x }.with_char((x as i64).wrapping_sub(Li64).wrapping_add(x.wrapping_add(x) as i64), Lu8).to();
  "fcc1e3ee2e": merged(LEAN.shapes17_1, LEAN.shapes17_2),
  // if self.f > self.__numbers_upper_N { break; }
  "fd16368fa8": LEAN.shapes15_13,
  // pub fn m_set(&mut self, mut x: i16) {
  "fda03fa84f": LEAN.shapes14_14,
  // pub fn x<const T: usize>(mut x: usize, mut x: u16, mut x: i16, …, mut x: usize, mut x: u16, x: &mut IecString<T>) 
  "fdb004dd33": LEAN.shapes17_11,
  // self.f = self.f.sqrt() as f32;
  "fdc2e175fa": LEAN.shapes5_11,
  // self.f = (self.f.wrapping_shr(Li16 as u32) & Lu32) != Lu32;
  "fdfbae2680": LEAN.shapes8_4,
  // fn m(v: f64) -> i64 {
  "fe6af35845": LEAN.shapes4_4,
  // self.f = m(Li32, …, &mut self.f);
  "fedbbc431c": LEAN.shapes14_15,
  // self.f = m(Li32.wrapping_neg() as i16);
}

/** A note with nothing in it, or an id that cannot be a construct id — refused, like an allowed lint with no reason. */
export function assertNotes(): void {
  const bad = Object.entries(NOTES).filter(
    ([id, n]) => !/^[0-9a-f]{10}$/.test(id) || (n.improvement ?? "").trim() === "" && (n.alternatives ?? []).length === 0,
  )
  if (bad.length > 0) throw new Error(`notes with no id or no content: ${bad.map(([id]) => id).join(", ")}`)
}

/** The notes whose construct no fixture emits any more — each one a judgement about Rust nobody produces. */
export function deadNotes(emitted: ReadonlySet<string>): string[] {
  return Object.keys(NOTES).filter((id) => !emitted.has(id)).sort()
}

/** Which of a fixture's constructs `NOTES` judged — the ids its row carries, deduplicated and sorted. */
export function notesOf(constructs: readonly string[]): Pick<FixtureMapRow, "notes"> {
  const noted = [...new Set(constructs)].filter((id) => NOTES[id] !== undefined).sort()
  return noted.length === 0 ? {} : { notes: noted }
}

/**
 * THE MAP'S `NOTES` SECTION — every note's full text, by construct id, with the construct as `normalizeRustLine`
 * prints it in a comment above. Written at the END of `map.generated.ts`, so the ids a row's `notes` names resolve in
 * the same file. A COPY of the authored table, never the source: edit `NOTES` here and regenerate.
 *
 * `lines` maps each construct id some fixture emits to its normalized line. A note with no line is a note about a
 * construct nobody emits — refused, never printed without the construct it is about.
 */
export function renderNotes(
  notes: Readonly<Record<string, ShapeNote>>,
  lines: ReadonlyMap<string, string>,
): string {
  const ids = Object.keys(notes).sort()
  const lineless = ids.filter((id) => !lines.has(id))
  if (lineless.length > 0) throw new Error(`these notes name a construct no fixture emits: ${lineless.join(", ")}`)
  const q = (s: string): string => JSON.stringify(s)
  const entries = ids.map((id) => {
    const n = notes[id]!
    return [
      `  // ${lines.get(id)}`,
      `  ${q(id)}: {`,
      ...(n.improvement === undefined ? [] : [`    improvement: ${q(n.improvement)},`]),
      ...(n.alternatives === undefined ? [] : ["    alternatives: [", ...n.alternatives.map((a) => `      ${q(a)},`), "    ],"]),
      ...(n.chosen === undefined ? [] : [`    chosen: ${q(n.chosen)},`]),
      ...(n.why === undefined ? [] : [`    why: ${q(n.why)},`]),
      "  },",
    ].join("\n")
  })
  return `
/**
 * THE REVIEW'S NOTES — the full text behind every row's \`notes\`, keyed by construct id, the construct as
 * \`normalizeRustLine\` prints it in the comment above each. GENERATED from the authored \`NOTES\` in
 * \`support/transpile-confidence.ts\`: edit it there and regenerate, never here.
 *
 *   \`improvement\`   what a Rust engineer would write instead
 *   \`alternatives\`  when several emissions are CORRECT: each option, as the reviewer put it
 *   \`chosen\`        the option the reviewer would pick, when one was named
 *   \`why\`           the reviewer's reason for it
 */
export const NOTES: Readonly<Record<string, ShapeNote>> = {
${entries.join("\n")}
}
`
}

// ── the edge differential ────────────────────────────────────────────────────────────────────────────────────

/*
 * THE INTERPRETER AGAINST THE COMPILED RUST, ON INPUTS NOBODY RECORDED — the review's step 3, as a column.
 *
 * `fixtures.test.ts` compares both backends to CODESYS on the values a fixture DECLARES. That says nothing about
 * the next input, which is where overflow, sign, NaN and truncation live. So every elementary variable the recorder
 * would read (`runPaths`) is seeded, one at a time, with each value below, the program is run for the fixture's
 * cycles in both backends, and every path is compared: same value, or both faulted.
 *
 *   integers       MIN, -1, 0, 1, MAX. "Overflow by one" and an out-of-range index are what MIN and MAX ARE to a
 *                  body that steps or indexes with them: one past the range is a wrap to the other end, which the
 *                  type cannot hold as a seed. An unsigned type has no -1; its -1 is its MAX.
 *   REAL / LREAL   ±0, ±1.5, ±2.5 (the tie rounding cases), NaN, ±inf, ±MAX, the smallest subnormal and ±1e19
 *                  (beyond every integer a conversion could land in), all as exact bit patterns.
 *   STRING         empty, and full to its capacity.
 *   BOOL           both.
 *
 * AGREEMENT IS NOT CORRECTNESS: the two backends share one IR, so they agree while both contradict CODESYS — the
 * review found most of its defects by hand for exactly that reason. `disagree` is a certain defect in one of them;
 * `agree` is only the absence of that one.
 *
 * NOT RUN WHERE THE ANSWER IS THE PLATFORM'S. `pow`, `ln`, `sin` and the rest are the operating system's libm on
 * both sides — Rust's `f64::powf` calls it, and so does the JS engine the interpreter runs on, except where it has a
 * path of its own — and IEEE-754 does not fix their last bit. Measured: `op_math_expt` and `expt_mixed_width`
 * disagree by one ULP on Windows. A verdict on those would be a fact about the machine that wrote the map, and the
 * gate recomputes it on Linux. So a program whose emitted Rust reaches libm is `not-run`, and says so; `sqrt`,
 * `abs`, `trunc` and the arithmetic operators are exact by the standard and stay in.
 *
 * DETERMINISTIC by construction: the inputs are fixed bit patterns, a CLOCKED fixture scans on a synthetic 10 ms per
 * scan in both backends rather than on a recorded instant, NaN is compared as a class (its payload is not a value
 * anything reads), and the verdict does not depend on how many lanes ran or in what order.
 */

type Seedable = "int" | "real" | "bool" | "string"
type InterpValue = Parameters<Runner["set"]>[1]
export interface EdgeSeed {
  label: string
  interp: InterpValue
  rust: string
}

const F32_EDGES: readonly (readonly [string, number])[] = [
  ["0", 0x00000000], ["-0", 0x80000000], ["1.5", 0x3fc00000], ["2.5", 0x40200000], ["-2.5", 0xc0200000],
  ["NaN", 0x7fc00000], ["+inf", 0x7f800000], ["-inf", 0xff800000], ["REAL_MAX", 0x7f7fffff], ["-REAL_MAX", 0xff7fffff],
  ["min_subnormal", 0x00000001], ["1e19", 0x5f0ac723], ["-1e19", 0xdf0ac723],
]
const F64_EDGES: readonly (readonly [string, bigint])[] = [
  ["0", 0x0000000000000000n], ["-0", 0x8000000000000000n], ["1.5", 0x3ff8000000000000n], ["2.5", 0x4004000000000000n],
  ["-2.5", 0xc004000000000000n], ["NaN", 0x7ff8000000000000n], ["+inf", 0x7ff0000000000000n], ["-inf", 0xfff0000000000000n],
  ["LREAL_MAX", 0x7fefffffffffffffn], ["-LREAL_MAX", 0xffefffffffffffffn], ["min_subnormal", 0x0000000000000001n],
  ["1e19", 0x43e158e460913d00n], ["-1e19", 0xc3e158e460913d00n],
]
const f32Of = (bits: number): number => new Float32Array(new Uint32Array([bits]).buffer)[0]!
const f64Of = (bits: bigint): number => new Float64Array(new BigUint64Array([bits]).buffer)[0]!

function seedable(t: Type): Seedable | undefined {
  if (t.kind !== "elementary") return undefined
  const f = t.elem.family
  if (f === "bool" || isBit(t)) return "bool"
  if (f === "int" || f === "bitstring" || f === "time" || f === "date") return "int"
  if (f === "real") return "real"
  if (f === "string") return "string"
  return undefined
}

/** The edge inputs of one variable of type `t` — empty for a type that is not elementary. */
export function edgeSeeds(t: Type): EdgeSeed[] {
  const kind = seedable(t)
  if (kind === undefined || t.kind !== "elementary") return []
  if (kind === "bool")
    return [
      { label: "FALSE", interp: false, rust: "false" },
      { label: "TRUE", interp: true, rust: "true" },
    ]
  if (kind === "int") {
    const { bits, signed } = t.elem
    const values = signed
      ? [-(1n << BigInt(bits - 1)), -1n, 0n, 1n, (1n << BigInt(bits - 1)) - 1n]
      : [0n, 1n, (1n << BigInt(bits)) - 1n]
    return values.map((v) => ({ label: `${t.elem.name}#${v}`, interp: v, rust: `(${v}i128) as _` }))
  }
  if (kind === "real")
    return t.elem.bits === 32
      ? F32_EDGES.map(([l, b]) => ({ label: `REAL#${l}`, interp: f32Of(b), rust: `f32::from_bits(0x${b.toString(16)})` }))
      : F64_EDGES.map(([l, b]) => ({ label: `LREAL#${l}`, interp: f64Of(b), rust: `f64::from_bits(0x${b.toString(16)})` }))
  const capacity = t.length
  if (capacity === undefined) throw new Error(`a ${t.name} with no capacity cannot be seeded full`)
  return [
    { label: "''(empty)", interp: "", rust: "IecStr::new()" },
    {
      label: `'A'x${capacity}(max length)`,
      interp: "A".repeat(capacity),
      rust: `IecStr::lit(&[65${t.name === "WSTRING" ? "u16" : "u8"}; ${capacity}])`,
    },
  ]
}

interface EdgePath {
  path: string
  type: Type
  global: boolean
  expr: string
}
/** What one fixture's edge run seeds and compares — or why it cannot run. */
export type EdgePlan =
  | { paths: EdgePath[]; variants: { label: string; seed?: { p: EdgePath; s: EdgeSeed } }[]; cycles: number; clock?: EdgePath }
  | { notRun: string }

/** A transcendental the platform's libm computes — the last bit of its answer is not the repo's (see above). */
const LIBM = /\.(powf|powi|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|ln|log|log2|log10|exp|exp2|exp_m1|ln_1p|cbrt|hypot)\(/

/** Does this emitted code reach the platform's libm? Read off the code itself, so it is the same answer everywhere. */
export function reachesLibm(code: string): boolean {
  return LIBM.test(code.slice(preludeLines(code) === 0 ? 0 : STRING_PRELUDE.length))
}

/** The variables a fixture's edge run seeds and compares: every recorder path the Rust can name as an elementary. */
export function edgePlan(t: LanguageTest, all: readonly LanguageTest[], pou: IrPou, code: string): EdgePlan {
  if (reachesLibm(code)) return { notRun: "reaches the platform's libm (pow, ln, sin…)" }
  const paths: EdgePath[] = []
  for (const path of runPaths(t, all)) {
    let access
    try {
      access = rustAccess(pou, path)
    } catch {
      continue // a path the recorder reads and the emitted struct does not hold as one field: nothing to compare
    }
    if (seedable(access.type) !== undefined) paths.push({ path, ...access })
  }
  if (paths.length === 0) return { notRun: "no elementary variable to seed or compare" }
  const variants: { label: string; seed?: { p: EdgePath; s: EdgeSeed } }[] = [{ label: "(declared inputs)" }]
  for (const p of paths) for (const s of edgeSeeds(p.type)) variants.push({ label: `${p.path} := ${s.label}`, seed: { p, s } })
  const clock = t.clock === undefined ? undefined : { path: CLOCK, ...rustAccess(pou, CLOCK) }
  return { paths, variants, cycles: t.cycles ?? 1, ...(clock === undefined ? {} : { clock }) }
}

/** The argument a harness's `main` takes to run the edge variants instead of its own body. */
export const EDGE_ARG = "edge"

/**
 * THE HARNESS'S LOOP GUARD — body entries one loop may make before a harness gives up on a run. CODESYS caps no
 * loop (`tr_27_loop_cap_*`), so neither backend does by default; but an edge seed can hand a loop a bound (or a
 * `WHILE flag`) nobody arranged, and a harness must still finish. The Rust a harness builds carries it
 * (`emitRust(pou, { loopGuard })`), above every recorded pass count (5,000,000, `tr_27_loop_cap_while_5000000`) since
 * the value pass shares that binary.
 */
export const HARNESS_LOOP_GUARD = 10_000_000

/**
 * The interpreter's guard on an EDGE variant — lower, because the interpreter is far slower than the Rust and a
 * runaway seed would otherwise cost seconds per variant (`cc6_loop_cannot_exit` has eleven). Both backends count
 * one body entry as one pass; a variant the interpreter gives up on has no answer, so it is not compared.
 */
const EDGE_INTERP_GUARD = 1_000_000

/**
 * The Rust that runs a plan's variants, and the `main` that dispatches to it — appended after the emitted code, so
 * the edge run shares the ONE compile each fixture already pays for. `body` is what `main` does otherwise: the value
 * pass prints the recorded paths there, the generator does nothing.
 */
export function edgeHarness(
  pou: IrPou,
  emitted: { usesGlobals: boolean; usesPrograms: boolean },
  plan: EdgePlan,
  body: string,
): string {
  const edgeFns =
    "notRun" in plan
      ? "fn __volt_edge() {}\n"
      : (() => {
          const args = [...(emitted.usesGlobals ? ["&mut g"] : []), ...(emitted.usesPrograms ? ["&mut prg"] : [])].join(", ")
          const arms = plan.variants.flatMap((v, k) =>
            v.seed === undefined ? [] : [`        ${k} => { ${v.seed.p.global ? "g" : "p"}.${v.seed.p.expr} = ${v.seed.s.rust}; }`],
          )
          const scans =
            plan.clock === undefined
              ? `    for _ in 0..${plan.cycles} { p.scan(${args}); }`
              : `    for i in 1..=${plan.cycles}u64 { g.${plan.clock.expr} = (i * 10_000_000) as _; p.scan(${args}); }`
          const prints = plan.paths.map((p) => {
            const kind = seedable(p.type)
            const field = `${p.global ? "g" : "p"}.${p.expr}${kind === "real" ? ".to_bits()" : kind === "string" ? ".units()" : ""}`
            return `    println!("{}\\t${p.path}\\t{${kind === "string" ? ":?" : ""}}", k, ${field});`
          })
          return `#[allow(unused_mut, unused_variables, clippy::all)]
fn __volt_edge_run(k: usize) {
    let mut p = ${pou.name}::new();
${emitted.usesGlobals ? "    let mut g = Globals::new();\n" : ""}${emitted.usesPrograms ? "    let mut prg = Programs::new();\n" : ""}${pou.init === undefined ? "" : `    p.init(${args});\n`}    match k {
${arms.join("\n")}
        _ => {}
    }
${scans}
${prints.join("\n")}
}
fn __volt_edge() {
    std::panic::set_hook(Box::new(|i| {
        let m = i.payload().downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| i.payload().downcast_ref::<String>().cloned()).unwrap_or_default();
        println!("!\\t{}", m.replace('\\n', " "));
    }));
    let a: Vec<String> = std::env::args().collect();
    let (from, to) = if a.len() > 2 { let k: usize = a[2].parse().unwrap(); (k, k + 1) } else { (0, ${plan.variants.length}) };
    for k in from..to {
        println!("#\\t{}", k);
        if std::panic::catch_unwind(|| __volt_edge_run(k)).is_err() { println!("P\\t{}", k); } else { println!("{}\\t=done", k); }
    }
}
`
        })()
  return `${edgeFns}fn main() {\n    if std::env::args().nth(1).as_deref() == Some("${EDGE_ARG}") { __volt_edge(); return; }\n${body}}\n`
}

interface Outcome {
  faulted: boolean
  /** The harness's loop guard gave up — no answer, so nothing to compare. */
  gaveUp?: boolean
  /** The variant printed its `=done` line — it ran to the end, as against a process that died inside it. */
  done: boolean
  values: Map<string, string>
}

function interpRender(v: unknown, t: Type): string {
  const kind = seedable(t)
  if (kind === "real" && t.kind === "elementary") {
    if (typeof v !== "number") return `?${String(v)}`
    if (Number.isNaN(v)) return "NaN"
    return t.elem.bits === 64
      ? new BigUint64Array(new Float64Array([v]).buffer)[0]!.toString()
      : String(new Uint32Array(new Float32Array([v]).buffer)[0]!)
  }
  // by UTF-16 UNIT, as the Rust prints `units()`: a WSTRING's surrogate pair is two units, and a code-point split made it one
  if (kind === "string")
    return typeof v === "string" ? `[${Array.from({ length: v.length }, (_, i) => v.charCodeAt(i)).join(", ")}]` : `?${String(v)}`
  return String(v)
}

function rustRender(raw: string, t: Type): string {
  if (seedable(t) !== "real" || t.kind !== "elementary") return raw
  const b = BigInt(raw)
  const nan =
    t.elem.bits === 64
      ? (b & 0x7ff0000000000000n) === 0x7ff0000000000000n && (b & 0xfffffffffffffn) !== 0n
      : (b & 0x7f800000n) === 0x7f800000n && (b & 0x7fffffn) !== 0n
  return nan ? "NaN" : raw
}

function interpOutcome(pou: IrPou, plan: Extract<EdgePlan, { paths: unknown }>, k: number): Outcome {
  const v = plan.variants[k]!
  let runner: Runner
  try {
    runner = run(pou, { loopGuard: EDGE_INTERP_GUARD })
    if (v.seed !== undefined) runner.set(v.seed.p.path, v.seed.s.interp)
    for (let i = 1; i <= plan.cycles; i++) {
      if (plan.clock !== undefined) runner.set(CLOCK, BigInt(i) * 10_000_000n)
      runner.scan()
    }
  } catch (error) {
    return { faulted: true, gaveUp: error instanceof LoopGuardError, done: false, values: new Map() }
  }
  return { faulted: false, done: true, values: new Map(plan.paths.map((p) => [p.path, interpRender(runner.get(p.path), p.type)])) }
}

function parseEdge(stdout: string): Map<number, Outcome> {
  const out = new Map<number, Outcome>()
  let current: Outcome | undefined
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.split("\t")
    if (parts[0] === "#") {
      current = { faulted: false, done: false, values: new Map() }
      out.set(Number(parts[1]), current)
    } else if (parts[0] === "P") {
      const o = out.get(Number(parts[1]))
      if (o !== undefined) o.faulted = true
    } else if (current !== undefined && parts.length >= 3) current.values.set(parts[1]!, parts.slice(2).join("\t"))
    else if (current !== undefined && parts[1] === "=done") current.done = true
  }
  return out
}

async function spawnEdge(argv: string[], timeoutMs: number): Promise<{ stdout: string; exit: number; killed: boolean }> {
  const p = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" })
  let killed = false
  const timer = setTimeout(() => {
    killed = true
    p.kill()
  }, timeoutMs)
  const [stdout, exit] = await Promise.all([new Response(p.stdout).text(), p.exited, new Response(p.stderr).text()])
  clearTimeout(timer)
  return { stdout, exit, killed }
}

/**
 * Run a built harness's edge variants and compare each with the interpreter. One process for all of them; a
 * process that dies part-way (a stack overflow aborts, it does not unwind) is re-run one variant per process, and a
 * variant that dies on its own counts as a fault — which is what CODESYS calls it too.
 *
 * A HANG IS NOT A VERDICT. Both backends are built with the harness's loop guard, so a variant that outlives its
 * timeout is a defect in one of them, and writing it down as `disagree` would make a timing fact a row of the map. It throws.
 */
export async function edgeVerdict(
  exe: string,
  pou: IrPou,
  plan: Extract<EdgePlan, { paths: unknown }>,
): Promise<{ verdict: "agree" | "disagree"; first?: string }> {
  const all = await spawnEdge([exe, EDGE_ARG], 120_000)
  if (all.killed) throw new Error(`${exe}: the edge run did not finish in 120s — a hang in the emitted Rust`)
  let outcomes = parseEdge(all.stdout)
  const complete = [...outcomes.values()].filter((o) => o.faulted || o.done).length === plan.variants.length
  if (all.exit !== 0 || !complete) {
    outcomes = new Map()
    for (let k = 0; k < plan.variants.length; k++) {
      const one = await spawnEdge([exe, EDGE_ARG, String(k)], 60_000)
      if (one.killed) throw new Error(`${exe} ${EDGE_ARG} ${k}: did not finish in 60s — a hang in the emitted Rust`)
      const o = parseEdge(one.stdout).get(k) ?? { faulted: true, done: false, values: new Map() }
      if (one.exit !== 0) o.faulted = true
      outcomes.set(k, o)
    }
  }
  for (let k = 0; k < plan.variants.length; k++) {
    const interp = interpOutcome(pou, plan, k)
    if (interp.gaveUp) continue
    const rust = outcomes.get(k) ?? { faulted: true, done: false, values: new Map() }
    const label = plan.variants[k]!.label
    if (interp.faulted !== rust.faulted)
      return { verdict: "disagree", first: `${label}: interpreter ${interp.faulted ? "faults" : "runs"}, Rust ${rust.faulted ? "panics" : "runs"}` }
    if (interp.faulted) continue
    for (const p of plan.paths) {
      const want = interp.values.get(p.path)
      const raw = rust.values.get(p.path)
      if (raw === undefined) return { verdict: "disagree", first: `${label}: Rust printed no ${p.path}` }
      const got = rustRender(raw, p.type)
      if (want !== got) return { verdict: "disagree", first: `${label}: ${p.path} interpreter ${want}, Rust ${got}` }
    }
  }
  return { verdict: "agree" }
}


/** Which vendors this fixture is recorded as not matching — derived from the authored sets in `divergences.ts`. */
export function divergesOf(name: string): FixtureMapRow["diverges"] {
  const found = new Map<string, "triage" | "known">()
  if (CODESYS_TRIAGE.has(name)) found.set("codesys", "triage")
  if (TWINCAT_TRIAGE.has(name)) found.set("twincat", "triage")
  for (const [vendor, set] of Object.entries(KNOWN_DIVERGENCES)) if (set.has(name)) found.set(vendor, "known")
  if (found.size === 0) return undefined
  // BY VENDOR NAME, always. The sets are walked in their own order, so a fixture in both vendors' known-divergence
  // lists came out `{twincat, codesys}` here and `{codesys, twincat}` in the generated file — the same fact, and
  // the gate compared them as JSON and called six rows stale.
  return Object.fromEntries([...found].sort(([a], [b]) => a.localeCompare(b)))
}

/** One row as it is written — the key order is fixed so a regeneration diffs against the last one. */
export function printRow(name: string, row: FixtureMapRow): string {
  const parts = [`evidence: ${JSON.stringify(row.evidence)}`]
  if (row.tier !== undefined) parts.push(`tier: ${JSON.stringify(row.tier)}`)
  if (row.rust !== undefined) parts.push(`rust: ${JSON.stringify(row.rust)}`)
  if (row.lints !== undefined && row.lints.length > 0)
    parts.push(`lints: [${row.lints.map((l) => JSON.stringify(l)).join(", ")}]`)
  if (row.pedantic !== undefined) parts.push(`pedantic: ${row.pedantic}`)
  if (row.edge !== undefined) parts.push(`edge: ${JSON.stringify(row.edge)}`)
  if (row.size !== undefined) parts.push(`size: ${row.size}`)
  if (row.shape !== undefined) parts.push(`shape: ${JSON.stringify(row.shape)}`)
  if (row.notes !== undefined) parts.push(`notes: [${row.notes.map((id) => JSON.stringify(id)).join(", ")}]`)
  if (row.diverges !== undefined)
    parts.push(
      `diverges: { ${Object.entries(row.diverges)
        .sort()
        .map(([v, how]) => `${v}: ${JSON.stringify(how)}`)
        .join(", ")} }`,
    )
  return `  ${/^[A-Za-z_]\w*$/.test(name) ? name : JSON.stringify(name)}: { ${parts.join(", ")} },`
}

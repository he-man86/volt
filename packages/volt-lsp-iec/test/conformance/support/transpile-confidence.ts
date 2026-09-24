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
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { IrPou } from "../../../src/transpile/index.js"
import { CODESYS_TRIAGE, KNOWN_DIVERGENCES, TWINCAT_TRIAGE } from "./divergences.js"
import type { LanguageTest } from "../types.js"

// ── the tier ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Simplest first. The sweep in `openspec/changes/transpile-confidence-map` walks these in order. */
export const TIERS = ["decl", "arith", "control", "aggregate", "call", "indirect"] as const
export type Tier = (typeof TIERS)[number]

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
    for (const k of ["left", "right", "value", "index", "operand", "tag", "of", "base"]) expr(n[k])
    for (const k of ["args", "elements", "arms"]) if (Array.isArray(n[k])) (n[k] as unknown[]).forEach(expr)
    place(n.place)
  }
  const place = (p: unknown): void => {
    if (p === null || typeof p !== "object") return
    const n = p as Record<string, unknown>
    if (n.root !== undefined) seen.add("place-root")
    for (const step of (n.path ?? []) as Record<string, unknown>[]) {
      seen.add(`place-${String(step.kind)}`)
      expr(step.index)
    }
  }
  const stmt = (s: unknown): void => {
    if (s === null || typeof s !== "object") return
    const n = s as Record<string, unknown>
    if (typeof n.kind === "string") seen.add(`stmt-${n.kind}`)
    for (const k of ["value", "cond", "selector", "test"]) expr(n[k])
    place(n.target)
    for (const k of ["then", "else", "body", "init", "step", "arms", "args"])
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

// ── where the correctness evidence is ────────────────────────────────────────────────────────────────────────

/** Which oracle reached the fixture's EMITTED RUST — not the interpreter, which `evidence` already covers. */
export type Correctness = "vendor" | "compiles" | "none"

const RUNS = JSON.parse(readFileSync(join(import.meta.dir, "..", "recordings", "codesys.run.json"), "utf8")).tests as Record<
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
export function correctnessOf(name: string, evidence: string, lowers: boolean): Correctness {
  if (!lowers) return "none"
  // THE EVIDENCE IS PASSED IN, not read off the fixture. The generator runs before the map it writes is merged, so
  // `t.evidence` is undefined there — read from the fixture, every row came out `compiles` and not one said
  // `vendor`, which is the strongest thing this field has to say.
  return evidence === "confirmed" && RUNS[name]?.values !== undefined ? "vendor" : "compiles"
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
  "clippy::min_max":
    "`limit_inverted_bounds` asks what LIMIT answers when MN > MX, so `.max(100).min(0)` — a chain clippy can prove constant — IS the question. CODESYS answers MX for every IN and `limit` prints MIN(MAX(…)) for exactly that reason",
  "clippy::unnecessary_min_or_max":
    "`max_min_basic` and `max_extensible` put LITERALS through MIN/MAX to ask what the operators do with them, so the chain folds; the emission is faithful",
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
export const LINT_FLAGS: readonly string[] = ["-W", "warnings", "-W", "clippy::all", "--error-format=json"]

/**
 * THE ALLOW-LIST IS APPLIED IN THE PARSER, NOT AS `-A` FLAGS. It was flags, which is the obvious way and made the
 * policy unfalsifiable: a lint the compiler was told to allow never reaches the output, so an entry that excuses
 * NOTHING looks exactly like one doing its job. Two of them were (`non_camel_case_types`, `non_snake_case`),
 * written from reasoning and never produced by any of the 2,295 lowered fixtures.
 *
 * Reading every warning and splitting it here costs nothing — the build already emits JSON — and it gives
 * `excusedFindings` the other half, so the generator can refuse to write a map while an entry excuses nothing.
 */

/** One finding on a fixture's emitted Rust. */
export interface Finding {
  code: string
  line: number
}

/**
 * The findings in a `--error-format=json` stderr, minus the policy. A parser over the compiler's own output rather
 * than over its rendered text, because the rendered form wraps and a lint name can land mid-line.
 */
export function findings(stderr: string): Finding[] {
  const out: Finding[] = []
  for (const raw of stderr.split("\n")) {
    if (!raw.startsWith("{")) continue
    let parsed: { level?: string; code?: { code?: string }; spans?: { line_start?: number }[] }
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue // a line that is not one JSON diagnostic carries no finding; a real error arrives on its own
    }
    const code = parsed.code?.code
    if (parsed.level !== "warning" || code === undefined || code in ALLOWED) continue
    out.push({ code, line: parsed.spans?.[0]?.line_start ?? 0 })
  }
  return out
}

/**
 * The findings that are about the EMITTED CODE, not about whatever the caller appended to it.
 *
 * Both callers compile `emitRust(pou).code` plus a `main` of their own — the gate's prints the recorded variables,
 * the generator's is empty — and the gate's `println!` calls raise lints of their own. Filtering by line keeps the
 * two producers measuring the same thing, which is the whole reason a generated file can be checked at all.
 */
export function emittedFindings(stderr: string, emittedLines: number): Finding[] {
  return findings(stderr).filter((f) => f.line > 0 && f.line <= emittedLines)
}

/**
 * The lints the policy EXCUSED on this fixture's emitted code — the other half of `emittedFindings`.
 *
 * Counted so a dead allow-list entry is visible. Two of them were written from reasoning rather than measurement
 * (`non_camel_case_types`, `non_snake_case`) and excused nothing at all: the emitter already carries the attribute
 * for the first, and `snake()` makes the second impossible. An entry that excuses nothing is the decoration the
 * block above warns about, and nothing could tell — the rows only ever recorded what was NOT allowed.
 */
export function excusedFindings(stderr: string, emittedLines: number): string[] {
  const out: string[] = []
  for (const raw of stderr.split("\n")) {
    if (!raw.startsWith("{")) continue
    try {
      const parsed = JSON.parse(raw) as { level?: string; code?: { code?: string }; spans?: { line_start?: number }[] }
      const code = parsed.code?.code
      const at = parsed.spans?.[0]?.line_start ?? 0
      if (parsed.level === "warning" && code !== undefined && code in ALLOWED && at > 0 && at <= emittedLines) out.push(code)
    } catch {
      continue
    }
  }
  return out
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

// ── the row ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ONE ROW PER FIXTURE, AND ONE FILE — `fixtures/map.generated.ts`.
 *
 * `evidence` used to live in a generated module of its own and this would have been a second one beside it. Two
 * files, two `bun run`s, and a reader asking "what do we know about this fixture?" opening both. They are the same
 * question — is it evidenced, does it lower, does the Rust match, is the Rust any good — so they are one row.
 *
 * `tier`, `rust` and `lints` are absent on a fixture that does not lower: a `refused` one has no emitted Rust to
 * rate, and an empty `lints` must never be reachable except by actually being clean.
 */
export interface FixtureMapRow {
  evidence: NonNullable<LanguageTest["evidence"]>
  tier?: Tier
  rust?: Correctness
  /** The lint codes that survive `ALLOWED`, deduplicated and sorted — the work list, shrinking tier by tier. */
  lints?: readonly string[]
  /**
   * The vendors whose recording this fixture does not match — `divergences.ts`'s four sets, as a per-fixture fact.
   *
   * MEMBERSHIP HERE, REASONS THERE. A divergence is a decision somebody made with evidence, and the paragraphs
   * explaining each one are the valuable half; generating over them would delete them. So `divergences.ts` stays
   * the authored source and this carries only the names it holds, so that one row answers the whole question about
   * one fixture without opening a second file. `triage` is an open false positive; `known` is a documented
   * mismatch that is not the LSP's to fix.
   */
  diverges?: Readonly<Record<string, "triage" | "known">>
}

/** The transpile half of a row: what came out of the backend, and what the linter says about it. */
export function transpileHalf(
  t: LanguageTest,
  evidence: string,
  pou: IrPou | undefined,
  stderr: string,
  emittedLines: number,
): Pick<FixtureMapRow, "tier" | "rust" | "lints"> {
  if (pou === undefined) return {}
  const lints = [...new Set(emittedFindings(stderr, emittedLines).map((f) => f.code))].sort()
  return {
    tier: tierOf(pou, t.pouName),
    rust: correctnessOf(t.name, evidence, true),
    ...(lints.length > 0 ? { lints } : {}),
  }
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
  if (row.diverges !== undefined)
    parts.push(
      `diverges: { ${Object.entries(row.diverges)
        .sort()
        .map(([v, how]) => `${v}: ${JSON.stringify(how)}`)
        .join(", ")} }`,
    )
  return `  ${/^[A-Za-z_]\w*$/.test(name) ? name : JSON.stringify(name)}: { ${parts.join(", ")} },`
}

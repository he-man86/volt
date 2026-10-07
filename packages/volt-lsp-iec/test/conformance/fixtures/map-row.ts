/**
 * THE MAP'S ROW TYPE — what `map.generated.ts` holds, beside it.
 *
 * Pure data shapes, no logic: the generated map and the `./conformance` package export reach this file, and the
 * published build (`tsconfig.build.json`) compiles what they reach. The functions that COMPUTE a row live in
 * `../support/transpile-confidence.ts`, a test-runner helper on Bun-only APIs (`Bun.spawnSync` through `rustc.ts`)
 * that a `dist/` for a runtime that is not Bun must never contain — so the map imports its types from here, not there.
 */
import type { LanguageTest } from "../types.js"

// ── the tier ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Simplest first. The sweep in `openspec/changes/transpile-confidence-map` walks these in order. */
export const TIERS = ["decl", "arith", "control", "aggregate", "call", "indirect"] as const
export type Tier = (typeof TIERS)[number]

// ── where the correctness evidence is ────────────────────────────────────────────────────────────────────────
/**
 * Which oracle reached the fixture's EMITTED RUST — not the interpreter, which `evidence` already covers.
 *
 * THERE IS NO `none`. A fixture that does not lower carries no row half at all — the generator writes no `tier` for it —
 * so the signal for one is `transpile.tier === undefined`, not a value of this. `none` was in the union and
 * documented in `types.ts`, and it was unreachable: a reader checking `rust === "none"` wrote dead code.
 */
export type Correctness = "vendor" | "compiles" | "rejected"

/** The interpreter against the compiled Rust on the edge inputs — computed by `edgeVerdict` (`../support/transpile-confidence.ts`, where the method is documented). */
export type EdgeVerdict = "agree" | "disagree" | "not-run"

// ── the notes ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ONE CONSTRUCT THE REVIEW JUDGED, keyed by its construct id (`emissionShape(...).constructs`).
 *
 *   `improvement`   what a Rust engineer would write instead (`transpile-lean-candidates`)
 *   `alternatives`  when several emissions are CORRECT: each option, as the reviewer put it
 *   `chosen`        the option the reviewer would pick, when one was named
 *   `why`           the reviewer's reason for it
 *   `tasks`         WHO OWNS IT, one owner per review item the note merges, in item order: the id of the openspec
 *                   `transpile-restructure` task that resolves that item (`7.3.1`, `4.2`, …), or `keep:<reason>` for an
 *                   item that says nothing needs to change. Required: the generator refuses a note without one, an
 *                   item's task id that its `tasks.md` does not have, and one already ticked (`assertNotes`).
 *
 * AUTHORED IN `../support/transpile-confidence.ts` (`NOTES`), RENDERED IN THE MAP. A row carries `notes` — the ids of the noted constructs it emits — and the
 * map ends with a generated `NOTES` section holding every note's full text under its construct line (`renderNotes`),
 * so a reader goes from a row to its reasons in the same file. The prose is WRITTEN there, where a regeneration
 * cannot delete it; the map's copy is regenerated from this one and `fixtures.test.ts` fails when it drifts. And
 * like `ALLOWED`, a note outlives its construct silently unless something refuses it: the generator and
 * `fixtures.test.ts` both fail on a key no fixture emits any more.
 */
export interface ShapeNote {
  improvement?: string
  alternatives?: readonly string[]
  chosen?: string
  why?: string
  tasks: readonly string[]
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
  /** How many clippy::pedantic and clippy::perf findings the emitted code carries, once per occurrence. */
  pedantic?: number
  /** The interpreter against the compiled Rust on the edge inputs — `edgeVerdict`, or `not-run` and the header says why. */
  edge?: EdgeVerdict
  /** Emitted Rust lines per ST line, to one decimal — `sizeRatio`. */
  size?: number
  /** The id of the fixture's emission shape — its constructs in order (`emissionShape`). */
  shape?: string
  /** The ids, sorted, of its constructs that carry a review note — each one's text is in the map's `NOTES` section. */
  notes?: readonly string[]
}

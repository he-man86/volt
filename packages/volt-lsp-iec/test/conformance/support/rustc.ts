/**
 * The Rust toolchain the EMITTED-RUST half of the suite runs against — found once, refused once.
 *
 * **Why this is not just `Bun.which("rustc")` at two call sites.** It was, and the two sites guarded with
 * `describe.skipIf(rustc === null)`, which is exactly right on an engineer's laptop and was quietly wrong
 * everywhere else: CI had no Rust toolchain, so both suites skipped, and the skip looked identical to a pass.
 * Measured 2026-09-17 — 3,627 assertions with `rustc` on PATH, 2,423 without. **~1,200 assertions covering
 * the emitter — the actual deliverable — ran on one machine and nowhere else**, which is the condition that
 * let five emitter defects and three interpreter/emitter divergences accumulate unseen.
 *
 * So the skip stays (a contributor without Rust can still run everything else), and it stops being silent:
 * `VOLT_REQUIRE_RUSTC=1` turns a missing toolchain into a THROW. CI sets it. The rule lives here rather than
 * in each test file because one rule spelled twice is how the two copies drift.
 */

/** The `rustc` binary, or null when there is none on PATH. */
export const RUSTC: string | null = Bun.which("rustc")

/**
 * True when the emitted-Rust suites must be skipped — i.e. no toolchain AND the caller did not demand one.
 *
 * Throws instead of answering true when `VOLT_REQUIRE_RUSTC=1` and there is no toolchain: a run that was told
 * the emitter must be verified, and cannot verify it, has to fail rather than report green on 2,423 of 3,627
 * assertions.
 */
export function skipRustSuite(): boolean {
  if (RUSTC !== null) return false
  if (process.env.VOLT_REQUIRE_RUSTC === "1")
    throw new Error(
      "VOLT_REQUIRE_RUSTC=1 but no `rustc` on PATH. The emitted-Rust differential is the only check the " +
        "EMITTER has — skipping it here would report green while ~1,200 assertions never ran. Install a Rust " +
        "toolchain (`rustup toolchain install stable`), or unset VOLT_REQUIRE_RUSTC to skip it deliberately.",
    )
  // eslint-disable-next-line no-console
  console.warn(
    "  [transpile] no `rustc` on PATH — SKIPPING the emitted-Rust differential. The interpreter half still " +
      "runs; the emitter is UNVERIFIED in this run.",
  )
  return true
}

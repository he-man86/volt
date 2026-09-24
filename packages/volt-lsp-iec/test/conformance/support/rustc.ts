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
 * `clippy-driver`, or null. It is a drop-in for `rustc` that also runs the lints, so the emitted-Rust pass builds
 * with it when it is there and gets the OPTIMALITY half — the `transpile` map's `lints` — for the compile it was
 * already paying for. Without it the values are still compared and the lint rows are not checked, which is
 * reported rather than silent, for the reason the block above spells out.
 *
 * It ships with rustup's default profile (`rustup component add clippy` otherwise), so on a machine that has a
 * toolchain at all this is normally present.
 */
export const CLIPPY: string | null = Bun.which("clippy-driver")

/**
 * True when the lint half must be skipped. Same rule as `skipRustSuite`, same reason it is not a silent skip:
 * `VOLT_REQUIRE_RUSTC=1` says this run was told to verify the emitter, and half-verifying it has to fail.
 */
export function skipLintCheck(): boolean {
  if (CLIPPY !== null) return false
  if (process.env.VOLT_REQUIRE_RUSTC === "1")
    throw new Error(
      "VOLT_REQUIRE_RUSTC=1 but no `clippy-driver` on PATH. The emitted Rust would be compiled and never " +
        "linted, so every `transpile.lints` row would go unchecked while the run reported green. " +
        "`rustup component add clippy`.",
    )
  // eslint-disable-next-line no-console
  console.warn(
    "  [transpile] no `clippy-driver` on PATH — the emitted Rust is compiled but NOT linted, so the " +
      "`transpile` map's lint rows are unchecked in this run.",
  )
  return true
}

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

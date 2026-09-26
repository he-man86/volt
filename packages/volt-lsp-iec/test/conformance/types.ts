/**
 * THE FIXTURE — one question put to the vendor, and everything known about the answer.
 *
 * A fixture is not a test. It is a piece of ST plus enough context to put it to a real CODESYS, and the suite's
 * gates are the CONSUMERS of what comes back. Reading one entry should tell you what it asks, what the vendor said,
 * and how far we are from matching it — which is why the flags below carry reasons rather than booleans.
 *
 * WHO CONSUMES A FIXTURE:
 *   `scripts/record-language.ts`  pushes the source through a live bridge and records the compiler's diagnostics
 *                                into `recordings/<vendor>.build.json`.
 *   `scripts/record-exec.ts`      runs it in CODESYS simulation and records variable values into
 *                                `recordings/codesys.run.json`. Self-launching; not a bridge op.
 *   `fixtures.test.ts`           ONE gate over all of it, driven by the fixture's `evidence` rating: the LSP's
 *                                diagnostics against the BUILD recording (the precision ratchet), the interpreter
 *                                AND the emitted Rust against the RUN recording (the only place values are
 *                                compared), every source CODESYS rejects as an LSP error too, and the rating
 *                                itself recomputed so a stored one cannot go stale. It was four files that each
 *                                re-selected their own subset, so a fixture in a state nobody had thought of was
 *                                covered by none of them.
 *   `backends.test.ts`           the two backends against EACH OTHER, where no recording reaches.
 *   `suite.test.ts`              whether enough is being ASKED — the census, the grammar and the vendor's index.
 *
 * THE ORACLE IS CODESYS. TwinCAT has its own build recording and is compared where it differs, but the execution
 * oracle — the one that decides what a program MEANS — is CODESYS 3.5.21.40 (SP21). See `exec-oracle-recorder`.
 */

/** One conformance fixture: the source, how to reach it from PLC_PRG, and what is known about the vendor's answer. */
export interface LanguageTest {
  /** Unique slug — the key in every recording, and the name a gate reports. */
  name: string
  /** The POU name as it appears in the IDE's project tree. Must start with a `LANG_`-prefixed identifier
   *  (`FB_LANG_*`, `GVL_LANG_*`, `DUT_LANG_*`, `ITF_LANG_*`) so the recorder's cleanup sweep catches it — a fixture
   *  named otherwise is left behind in the project and the next run inherits it. */
  pouName: string
  /** Item kind on the bridge. Every writable source kind materializes as one kind-named file (`.fb`/`.prg`/`.fun`/`.itf`/`.gvl`, and a DUT under its subtype `.struct`/`.enum`/`.union`/`.alias`). */
  kind: "function_block" | "function" | "program" | "gvl" | "dut" | "interface"
  /** What the test exercises — short label for reports. */
  feature: string
  /** Self-contained workspace file content — POU + sibling children
   *  in the canonical assembled ST layout the bridge's StSplitter
   *  reads (and PouToStText emits on /fetch). */
  source: string
  /** Anchor in the reference doc. Format: `<filename>#<section>` or `<filename>:L<line>`. */
  fromDoc: string
  /**
   * VAR section snippet for PLC_PRG (e.g. `"fb : FB_LANG_hide_var;"`).
   * TwinCAT only analyzes code reachable from the program entry point —
   * without an instantiation in PLC_PRG, the test POU is dead code
   * and the compiler doesn't generate diagnostics for it. Required
   * for function_block / function tests; optional for ones whose
   * presence alone matters (interface declarations etc.).
   */
  plcPrgVar?: string
  /** PLC_PRG body snippet — e.g. `"fb();"` — that exercises the instantiation. */
  plcPrgBody?: string
  /**
   * Skip this test in the recorder's TC/CODESYS push pass. The LSP's
   * replay still consumes it — useful for fixtures that exercise
   * static-analysis paths the LSP cares about but that the real
   * compilers can't accept (e.g. intentionally-malformed inputs whose
   * recorded "diagnostics" would just be parse-error noise, drowning
   * the signal). The replay flags this entry as "lsp-only" and
   * skips the `lspFlagged === ideFlagged` cross-check.
   */
  recorderSkip?: boolean
  /**
   * A vendor whose DRIVER refuses to take this fixture, with the refusal in its own words. Not a skip anyone
   * chose: `volt push` comes back rejected and there is nothing to record, so the fixture has ground truth on
   * the other vendor and none here.
   *
   * **The refusal is VOLT'S, and whether the IDE would have taken it is unproven.** Each reason blames TwinCAT's
   * PLCopen importer — an unconditional jump or return (it is said to require both wired to a condition), an
   * Execute box, a box output pin wired straight to a variable — and every one of those is the DRIVER's rule,
   * written from what it could express at the time. "TwinCAT cannot" and "Volt does not" read identically from
   * out here, which is why `volt-cli`'s `test/e2e/graphical/refused-shapes.test.ts` holds them as a ratchet that
   * may only shrink: the day a driver learns one, that suite fails and says to take it off the list.
   *
   * So this field records WHERE the ground truth is missing and WHY it is missing, not that it cannot exist.
   * Distinct from `recorderSkip`, which is about a fixture nothing can usefully record on EITHER vendor.
   */
  vendorRefuses?: { vendor: "codesys" | "twincat"; reason: string }
  /**
   * Skip this test in the EXECUTION recorder (`record:exec`) only — with the reason, in the reason's own words.
   * The BUILD recording is still taken and the LSP still replays it; the only thing withheld is a set of
   * variable values after N scans. Distinct from `recorderSkip`, which withholds a fixture from BOTH recorders
   * and marks it lsp-only.
   *
   * **This must never stand in for a recorder that is merely unfinished.** A reason here is either
   *   NOTHING TO MEASURE — a loop that cannot exit never completes its scan, so the done flag cannot rise and
   *     no values exist to read. That is the fixture working as designed.
   *   NOTHING TO COMPARE — the execution oracle exists to check the ST transpiler, and the transpiler's input
   *     contract is "code CODESYS compiles" (`src/transpile/index.ts`): ST. A graphical body has no lowering,
   *     so a recording of one would have no consumer.
   * Anything else — a shape the recorder COULD load and something downstream WOULD use — is a gap to close, and
   * writing a confident sentence here instead is how it stops being visible.
   */
  execSkip?: string
  /**
   * Paths whose recorded value is the IDE's WALL CLOCK at the moment it was recorded — `TIME()` read into a variable.
   * No run can reproduce that instant: the transpiler reads the clock its harness sets (`CLOCK`), never a wall clock.
   * The replays compare every other path, and hold these only to having been produced.
   */
  wallClock?: readonly string[]
  /** Optional human note explaining why we expect what we expect. */
  note?: string
  /** Scan cycles a run records after (`recordings/codesys.run.json`). Default 1. */
  cycles?: number
  /** CODESYS refuses the source, with a fragment of its error text: outside the transpiler's input contract, and an LSP
   *  error that must be present (`fixtures.test.ts`, the `refused` row). */
  refused?: string
  /** A consumer that deliberately does not check this case yet — the reason, with its date. */
  deferred?: { lsp?: string; transpile?: string }
  /**
   * HOW WELL THIS FIXTURE IS EVIDENCED — written by `bun run rate:fixtures`, checked by `fixtures.test.ts`.
   *
   * GENERATED, like a lockfile: it is derived from the recordings and the flags below, so it is never edited by
   * hand and never trusted on its own. The gate recomputes every rating and fails if a stored one disagrees, which
   * is what lets it sit here without going stale — a fixture whose evidence changed but whose file did not is
   * exactly the rot this would otherwise introduce.
   *
   * It is here because a fixture should be readable ALONE. The recordings are one 300 KB JSON keyed by name; asking
   * "is this one actually confirmed?" used to mean opening it.
   *
   *   `confirmed`    the vendor RAN it, we run it, and the `confirmed` row asserts its values in both backends.
   *   `refused`      the vendor REJECTS the source and so do we — a confirmed negative, and how the input contract
   *                  is pinned. `refused` (the field) carries the vendor's own words.
   *   `not-lowered`  the vendor ran it and lowering refuses, saying why. A COVERAGE gap, not a wrong answer.
   *   `diverges`     the vendor answered, we execute it, and we do not match. `deferred.transpile` says what was
   *                  measured and why it is not matched yet. The only rating that means something is WRONG.
   *   `lsp-gap`      CODESYS refuses it, we know, and the LSP does not say so yet (`deferred.lsp`).
   *   `unasked`      no recording. The fixture states a question nobody has put to CODESYS; it proves nothing yet,
   *                  and this is the normal state of a fixture written before the next `record:exec`.
   *   `unaskable`    `execSkip` / `recorderSkip` — there is no execution ground truth to have.
   */
  evidence?: "confirmed" | "refused" | "not-lowered" | "diverges" | "lsp-gap" | "unasked" | "unaskable"
  /**
   * WHAT THIS FIXTURE TRANSPILES TO — written by `bun run rate:fixtures`, checked by `fixtures.test.ts`, generated
   * for the same reason `evidence` is and merged in `fixtures/index.ts` the same way.
   *
   * `evidence` above says how well the fixture is EVIDENCED. This says what came out of the backend and what is
   * wrong with it — the half nobody could ask about while the emitted Rust was only an oracle:
   *
   *   `tier`         the band of the language this fixture's own body reaches, from the lowered IR. The
   *                  simplest-first ladder the emitter sweep walks; `support/transpile-confidence.ts` defines it.
   *   `rust`         which oracle reached the emitted RUST — `vendor` when the recording's values came back out of
   *                  it, `compiles` when the compiler accepted it and no recorded value reaches it, `rejected`
   *                  when the compiler refused it. Taken from the compiler's exit status, never inferred.
   *   `lints`        what the Rust linter still says about the emitted code, after a policy that names a reason
   *                  per allowed lint. Empty is the goal; a non-empty list is the work left on that construct.
   *
   *   `diverges`     the vendors whose recording this fixture does not match, from `support/divergences.ts` —
   *                  `triage` for an open false positive, `known` for a documented mismatch. The membership is
   *                  here so one row answers the whole question; the REASON stays in that file, where prose belongs.
   *
   * A fixture that does not lower carries no `tier`, `rust` or `lints` at all — that absence IS the signal, and
   * it must not be able to read as clean.
   */
  transpile?: {
    /** The literals of `TIERS` in `support/transpile-confidence.ts`, spelled out because importing it here would
     *  be a cycle — that module imports this one for `LanguageTest`. `fixtures.test.ts` recomputes every value
     *  with the real `tierOf`, so a drift between the two lists is a red test rather than a silent widening. */
    tier?: "decl" | "arith" | "control" | "aggregate" | "call" | "indirect"
    rust?: "vendor" | "compiles" | "rejected"
    lints?: readonly string[]
    diverges?: Readonly<Record<string, "triage" | "known">>
  }
  /**
   * The object NAME of each VAR_GLOBAL block in `source`, in order. A GVL names nothing in its own text, so one is
   * named after `pouName` — which is fine for a fixture with a single list and wrong for one with two, where both
   * objects would collide on the wire. A fixture that needs two lists declaring the SAME global (the only way to
   * reach `ambiguous-global`) names them here.
   */
  gvlNames?: readonly string[]
}

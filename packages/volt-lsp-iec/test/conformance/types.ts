/**
 * Shared types for the language-conformance test catalog.
 *
 * Each per-category file (pragma-tests.ts, lifecycle-tests.ts, …)
 * imports `LanguageTest` from here, so the shape stays in ONE place
 * even when the catalog is sliced across many files.
 */

/**
 * One conformance test entry. The recorder uses it to push the source
 * to TwinCAT + record the compiler's response; the replay test uses
 * it to run the LSP's semantic diagnostics on the same source and
 * compare against the recorded TC outcome.
 */
export interface LanguageTest {
  /** Unique slug; identifies the test in reports and the expected-tc.json map. */
  name: string
  /** TwinCAT POU name as it appears in the project tree. Must start with a `LANG_`-prefixed identifier (FB_LANG_*, GVL_LANG_*, DUT_LANG_*, ITF_LANG_*) so the recorder's cleanup sweep catches it. */
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
  /** Optional human note explaining why we expect what we expect. */
  note?: string
  /** Scan cycles a run records after (`recordings/codesys.run.json`). Default 1. */
  cycles?: number
  /** CODESYS refuses the source, with a fragment of its error text: outside the transpiler's input contract, and an LSP
   *  error that must be present (`refused.test.ts`). */
  refused?: string
  /** A consumer that deliberately does not check this case yet — the reason, with its date. */
  deferred?: { lsp?: string; transpile?: string }
  /**
   * The object NAME of each VAR_GLOBAL block in `source`, in order. A GVL names nothing in its own text, so one is
   * named after `pouName` — which is fine for a fixture with a single list and wrong for one with two, where both
   * objects would collide on the wire. A fixture that needs two lists declaring the SAME global (the only way to
   * reach `ambiguous-global`) names them here.
   */
  gvlNames?: readonly string[]
}

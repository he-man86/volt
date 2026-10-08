/**
 * The CORRECTNESS of a fixture: which oracle reached its emitted Rust (transpile-review 48), and whether a rejected
 * emission is a defect (split out of the confidence module, transpile-restructure 1.8.3).
 */
import { lex } from "../../../../src/frontend/syntax/index.js"
import type { Correctness } from "../../fixtures/map-row.js"
import { RUNS } from "../recordings.js"

/**
 * `vendor` is the strong one and the only one that compares a VALUE: the "confirmed — the same values out of the
 * emitted Rust" block in `transpile-replay.test.ts` compiles this fixture, runs it and asserts the recording's own numbers.
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

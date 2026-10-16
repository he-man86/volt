/**
 * The graphical languages (FBD/LD) as network text, against the real compiler — the CLEAN half.
 *
 * WHY THESE EXIST. Before them, all eleven graphical fixtures were ERROR cases, and six were the same `???`
 * marker in different slots (`network-unresolved.ts`, `check-coverage.ts`). Not one graphical body in the whole
 * catalog COMPILED. That left the language's own surface unmeasured — fan-out, coil storage, edge modifiers,
 * output pins, EN/ENO, EXECUTE, jumps, network header fields — and, worse, left the zero-false-positive gate
 * with nothing to bite on: a gate that asks "is every LSP message a real IDE message" cannot catch a false
 * positive on a VALID network when no valid network exists to check.
 *
 * So most of what follows is expected to record CLEAN (`buildSuccess: true`, no diagnostics). A clean fixture is
 * not a weak one here — it is the only shape that can catch the LSP inventing a diagnostic about correct
 * graphical code, which is the failure mode network text is most exposed to (its checks were written against a
 * grammar, not against builds).
 *
 * Each form is spelled from `packages/volt-cli/docs/network-text.html` (statement forms, operators). Where a form has a documented
 * MEASURED history, the fixture says so — `S=`/`R=` especially: a reset coil used to come out as a set coil
 * (the vendors spell it `Negation + Set` on the target), which is silent data corruption in a real project, and
 * nothing in this suite held the compiler's opinion of the three coil kinds until now.
 *
 * NOT here: mixing operator kinds in one group (`(a AND b OR c)`) and an infix box with a named output pin.
 * Both are refused by Volt's own reader/writer before a build can happen, so they belong to the format's tests,
 * not to a compiler oracle.
 */
import type { LanguageTest } from "../../types.js"
import { NETWORK_GRAPHICAL_TESTS_A } from "./network-graphical-a.js"
import { NETWORK_GRAPHICAL_TESTS_B } from "./network-graphical-b.js"

export const NETWORK_GRAPHICAL_TESTS: readonly LanguageTest[] = [...NETWORK_GRAPHICAL_TESTS_A, ...NETWORK_GRAPHICAL_TESTS_B]

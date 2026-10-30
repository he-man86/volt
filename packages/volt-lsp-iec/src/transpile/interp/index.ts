// Backend — the IR interpreter. Runs the same IR the emitters print, so it is the oracle they are checked against:
// `machine.ts` evaluates, `frame.ts` reads and writes places, `calls.ts` builds a call's frame, `runner.ts` prepares a POU.
export { LoopGuardError } from "./machine.js"
export { run, type Runner } from "./runner.js"
export { RunnerValueError } from "./set-value.js"

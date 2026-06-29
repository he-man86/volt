#!/usr/bin/env bun
/**
 * `volt` binary entry — ONE self-contained binary = our opencode + the PLC CLI.
 *
 * PLC verbs run the volt-git CLI (`./bin.ts`); everything else (bare `volt`, run, auth, debug, …) IS the
 * opencode agent, imported IN-PROCESS — opencode's CLI reads process.argv at module top, runs, and exits.
 * `bun --compile --conditions=browser` bundles both in, so there's no spawn and no external opencode.
 *
 * Excluded from typecheck (tsconfig `exclude`): it imports opencode's raw .ts source, which uses a looser
 * moduleResolution than this package. ponytail: thin router, not worth a second tsconfig — compile-checked.
 * The verb set must stay in sync with bin.ts's switch (a verb here but not there → falls through to USAGE;
 * a verb there but not here → wrongly routed to opencode).
 */
const VOLT_VERBS = new Set(["init", "pull", "push", "build", "status", "log", "diff", "show", "merge", "help"])
const first = process.argv[2]
if (first !== undefined && VOLT_VERBS.has(first)) {
  await import("./bin.js") // the PLC CLI (auto-runs main with process.argv)
} else {
  await import("opencode/index") // our opencode, in-process — never returns (it process.exit()s)
}

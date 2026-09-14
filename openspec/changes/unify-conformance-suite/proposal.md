# One conformance suite for the LSP and the transpiler

## Why

The conformance fixtures cover almost every feature of the language, and every one is a snippet pushed to the IDE and
built. Today only the LSP answers to them. The transpiler has its own, much smaller list:

- `test/conformance/` — 426 fixtures, each BUILT through the live bridge; the recording is CODESYS's (and TwinCAT's)
  diagnostics, and the LSP replay must match them (no false positives, an agreement floor: CODESYS 354).
- `test/exec/` — 117 programs RUN in the CODESYS simulator; the recording is every variable after N scans, and the
  interpreter and the emitted Rust must match it.

They are one question — *what does CODESYS do with this source* — at two levels, asked of two consumers that never see
each other's half:

- The 109 exec programs that compile have never been through the LSP, though each is a false-positive check on valid code.
- The ~400 fixtures that compile have never been RUN, though each is a feature the transpiler must execute correctly — the
  broadest execution test Volt could have, already written.
- The only bridge is `rejects-lsp.test.ts`, hand-wired for the 8 programs CODESYS refuses.

The user proposed it on 2026-09-14: "we could extend it with the desired response for the transpiled code … they are
all code snippets that are pushed to the IDE and we can directly check for result in rust and ide and lsp".

## What changes

1. **One case list** in `test/conformance/fixtures/`. The exec programs become fixtures through a `program(vars, body)`
   helper, keeping their names.
2. **Every case that builds is also run.** The simulator recorder loads a fixture's units, runs PLC_PRG for its cycles and
   records every variable — PLC_PRG's own and each instance's members. That recording is the transpiler's expectation.
3. **Three checks per case**, each against CODESYS:
   - build diagnostics ↔ the LSP (the replay, unchanged in its rules);
   - run values ↔ the interpreter, and ↔ the emitted Rust;
   - a case CODESYS refuses is outside the transpiler's input contract and must be an LSP error.
4. **A case the transpiler cannot lower yet is a counted todo, never a pass or a silent skip.** Most fixtures are FB-shaped
   and wait on phase 3 (FB instances, members, GVLs); the count of fixtures that lower and match is phase 3's progress
   measure, and it only rises.
5. **One recording per recorder**: `codesys.build.json`, `twincat.build.json` (bridge) and `codesys.run.json`
   (simulator). The two recorders stay separate — different mechanisms, never run together — and read the one list.
6. **`test/exec/` is deleted**; the recorders, `package.json`, TESTING.md, the docs and the 52 `test/exec` citations in
   `src/` point at the suite.

## Non-goals

- Merging the two recorders, or recording runs on TwinCAT (no simulator path is proven there).
- Changing any case's premise, source or expectation. Moving the exec programs is gated by a before/after comparison of
  every test's name and result; the new recordings are additions, never edits.
- `test/corpus/` and `test/lsp/` — different oracles, untouched.

## Impact

`packages/volt-lsp-iec` test tree, both recorder scripts (the simulator one gains fixture loading and instance reads),
`package.json` (`test` script; the `./conformance` export keeps its path), TESTING.md and the docs citing `test/exec`. No
product code changes, except the LSP and transpiler fixes the new recordings expose — each its own commit.

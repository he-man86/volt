# Tasks — unify-conformance-suite

## 1. Gate first

- [x] 1.1 `scripts/suite-snapshot.ts`: run the suites with the JUnit reporter and write `status  describe › title`, sorted,
      file names dropped; `--compare` fails on any difference. BEFORE: `suite-snapshot.before.txt`, 238 tests (237 pass, 1
      skip).

## 2. The move (no new recordings)

- [x] 2.1 `LanguageTest` gains `cycles?`, `refused?`, `deferred?` (design §1); documented in `types.ts`.
- [x] 2.2 The mapping from an exec case to a fixture — the program IS PLC_PRG (design §1, measured against both recorders).
- [x] 2.3 The 117 cases moved into `fixtures/execution.ts` with every entry's text unchanged, registered as the `execution`
      category. A split by topic is cosmetic and left for when the file grows; the section headers already group it.
- [x] 2.4 `standard-library.ts` → `test/conformance/support/`, beside the new `plc-prg.ts` (the one PLC_PRG text).
- [x] 2.5 Recordings renamed and moved, contents untouched: `codesys.build.json`, `twincat.build.json`,
      `codesys.run.json`; both recorders write them.
- [x] 2.6 `differential.test.ts` → `transpile.test.ts`; `rejects-lsp.test.ts` → `refused.test.ts`; the replay reads the
      build files.
- [x] 2.7 AFTER snapshot identical to BEFORE: 238 = 238, no line differs.
- [x] 2.8 `test/exec/` deleted; `package.json` `test` script; the `src/` citations, `docs/architecture.md`, README and the
      `transpile-st-to-rust` design point at the suite. Committed on its own.

## 3. Measure the simulator before extending it

- [ ] 3.1 Probe (a scratch runscript, not the recorder): load a multi-unit fixture — a DUT + an FB instantiated in PLC_PRG
      — into the simulator project, build, run one cycle, read `PLC_PRG.inst.member`. Record what works, what fails and
      the exact API in design §2.
- [ ] 3.2 If a step is impossible headless: measure the GUI bridge path before choosing it (the online object and a
      running script, design §2). Stop and report to the user if neither works.

## 4. Run every fixture

- [ ] 4.1 `record-exec.py` loads each case's units (not only PLC_PRG's text) and reads every variable path design §2
      defines; the path list is derived from the parsed fixture, shared by the recorder and the replay.
- [ ] 4.2 `transpile.test.ts` over every case: lowered → both backends must equal every value; not lowered → a todo
      naming the lowering code; a floor on "lowered and matching" that only rises, and a per-code summary.
- [ ] 4.3 Record runs for all fixtures that build. Every transpiler divergence on a case that lowers: fix, colocated src
      test, why it was missed — each its own commit.

## 5. Build-record the programs

- [ ] 5.1 Build-record the program cases on CODESYS through the bridge (`RECORD_ONLY` over the execution category).
- [ ] 5.2 Every new LSP false positive or missed error: fix, colocated src test, why missed — each its own commit. Raise
      the CODESYS agreement floor.
- [ ] 5.3 TwinCAT build pass for the program cases when the TwinCAT worker is available; the replay tolerates unrecorded
      cases until then.
- [ ] 5.4 A case the bridge and the simulator disagree on (compiles in one only) is written into design §6 as a finding.

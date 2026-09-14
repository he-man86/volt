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

- [x] 3.1 Probe (a scratch runscript, not the recorder): load a multi-unit fixture — a DUT + an FB instantiated in PLC_PRG
      — into the simulator project, build, run one cycle, read `PLC_PRG.inst.member`. DONE 2026-09-14 over four shapes
      (DUT + FB, METHOD, PROPERTY, ACTION): all load, build, run and clean up headless; members read, composites do not
      (design §2).
- [x] 3.2 Not needed — headless covers it.

## 4. Run every fixture

- [x] 4.1 `record-exec.py` loads each case's units (not only PLC_PRG's text) and reads every variable path design §2
      defines; the path list is derived from the parsed fixture, shared by the recorder and the replay. DONE 2026-09-14:
      `support/fixture-units.ts` + `support/run-paths.ts` (equal to the recorded names for all 109 execution cases); an
      unreadable path is kept apart (`unreadable`) instead of losing the case; `RECORD_ONLY` merges like the bridge
      recorder. A trial over two execution cases and five fixtures left the execution values byte-identical.
- [x] 4.2 `transpile.test.ts` over every case: lowered → both backends must equal every value; not lowered → a todo
      naming the lowering code; a floor on the cases that lower, and a per-code summary.
- [x] 4.3 Record runs for all fixtures that build. Every transpiler divergence on a case that lowers: fix, colocated src
      test, why it was missed — each its own commit. DONE 2026-09-14: 366 cases recorded. The first pass failed 21
      fixtures on the LOADER, not the product — a body lost its trailing `END_FOR`/`END_IF`; a fixture using another's
      base FB, interface, struct or global loaded alone; an interface was written whole instead of header + prototypes;
      a subrange value was read (refused online) — fixed in `support/`, re-recorded (design §2). Two fixtures fault at
      run time (a pointer written before it is set) and are counted todos naming it. 111 cases lower (floor), the rest
      are todos by code (`stmt-call_stmt` 226 — phase 3). ONE divergence: an alias type's initializer was dropped
      (`type_dut_alias_with_init`), fixed in `lower.ts` with an interp test.

## 5. Build-record the programs

- [x] 5.1 Build-record the program cases on CODESYS through the bridge (`RECORD_ONLY` over the execution category).
      DONE 2026-09-14: 117 recorded, no false positive, agreement 354 → 460.
- [x] 5.2 Every new LSP false positive or missed error: fix, colocated src test, why missed — each its own commit. Raise
      the CODESYS agreement floor. DONE 2026-09-14: 11 misses. The build warnings carry no line, so 37 one-expression
      `cc_*` probes pinned each rule first; fixed: an operator's same-width sign change (arithmetic → signed, bit
      operations → unsigned, comparisons only from 32 bits), a chained assignment's inner store, an over-long WSTRING,
      a REAL literal beyond REAL, a typed literal sum. Agreement 460 → 503. OPEN, not fixed: `power_operator_rejected`
      and `ampersand_operator_rejected` — the compiler resumes after the bad token and reports the rest of the line
      again (a parse-recovery cascade); and an FB's over-long initializer, which the build reports TWICE — as it does
      for every STRING one already recorded.
- [ ] 5.3 TwinCAT build pass for the program cases when the TwinCAT worker is available; the replay tolerates unrecorded
      cases until then.
- [x] 5.4 A case the bridge and the simulator disagree on (compiles in one only) is written into design §6 as a finding.
      DONE 2026-09-14: none — design §6.

# Design — one conformance suite

## 1. The case model: the fixture type gains its run expectation

`LanguageTest` (426 fixtures) stays the case type. It gains:

```ts
interface LanguageTest {
  name: string; pouName: string; kind: …; feature: string; source: string; fromDoc: string
  plcPrgVar?: string; plcPrgBody?: string
  /** Scan cycles the run records after. Default 1. Every case that builds is run; this only sets how long. */
  cycles?: number
  /** CODESYS refuses the source, with a fragment of its error text — outside the transpiler's input contract, and an LSP
   *  error that must be present (today's exec `rejects`). */
  refused?: string
  /** A consumer that deliberately does not check this case yet — the reason, with its date. */
  deferred?: { lsp?: string; transpile?: string }
}
```

A fixture already says everything a run needs: its units (`source`) and how PLC_PRG uses them (`plcPrgVar`,
`plcPrgBody`). **An exec program is a fixture with no units whose program IS PLC_PRG** — measured against both recorders
before the move: the bridge recorder writes PLC_PRG from `plcPrgVar`/`plcPrgBody` and pushes no item for an empty
`source`, the LSP replay analyzes the same synthesized PLC_PRG, and the simulator recorder already runs exactly that
program. One mapping converts every case, so no entry is rewritten by hand (`fixtures/execution.ts`):

```ts
{ name: "signed_overflow", vars: "si : SINT := 127; …", body: "si := si + 1; …" }
// → kind "program", pouName "PRG_LANG_signed_overflow" (keeps the replay's file URIs unique), source "",
//   plcPrgVar vars, plcPrgBody body, cycles, refused (was `rejects`), deferred.transpile (was `deferred`)
```

A first draft wrapped each program as `PRG_LANG_<name>` called from PLC_PRG; that would have built a different program
from the one the simulator records, for no gain. The PLC_PRG text itself now has one home, `support/plc-prg.ts`, used by
both recorders and both replays.

**Alternative rejected — a new shared case type with an adapter for each old one.** It would touch all 426 fixtures for no
new information; a fixture already describes a program, and "run it" adds only a cycle count.

## 2. What a run records

After `cycles` scans, the simulator reads every variable reachable from PLC_PRG, flattened to dotted paths:

```json
"cc_enum_into_int": { "cycles": "INT#1", "values": { "inst_cc_enum_int.x": "INT#1" } }
"signed_overflow":  { "cycles": "INT#1", "values": { "prg_lang_signed_overflow.si": "SINT#-128", … } }
```

The paths come from the parsed fixture (PLC_PRG's `plcPrgVar` instances, expanded through each FB's declared variables;
a called PROGRAM's variables under its name), so the recorder and the replay derive the same list from the same source.
A value CODESYS displays lossily is compared as displayed, as `test/exec` already does (a TOD modulo a day).

**Measured headless, 2026-09-14** (`scripts/probe-fixture-run.py` on CodesysTestProject, four fixtures: a DUT + FB, an
FB + METHOD, an FB + PROPERTY, an FB + ACTION):
- a fixture loads through the scripting API: `create_dut(name, DutType.Structure)`, `create_pou(name=, type=, language=)`,
  `create_method(name=)`, `create_action(name=)`, `create_property(name=)`, each written through
  `textual_declaration`/`textual_implementation`. `create_property` makes BOTH accessors; the one a fixture does not
  declare is removed. All four built with no message, ran, and were removed again (`remove()`), so the next case starts
  from the committed project;
- an instance member reads like a scalar — `PLC_PRG.inst_cc_enum_int.x` is `INT#1`, `PLC_PRG.fb_upr.iBacking` `INT#42`;
- a COMPOSITE does not: reading `PLC_PRG.inst_cc_enum_int` raises "Invalid pointer size.". So a run records LEAF paths
  only, which is what `support/run-paths.ts` derives;
- `call_after_init` recorded `fb_cai.iCounter = INT#0` after one scan — a vendor answer the fixture now carries.

The units are split by `support/fixture-units.ts` from the parser's spans; a pragma above a member (`{attribute
'call_after_init'}`) travels with it. No GUI bridge is needed.

**Measured over the full recording, 2026-09-14** — the first pass failed 21 fixtures, every one on the LOADER:
- a body is its statements minus only the UNIT's terminator — stripping any trailing `END_…` cut `END_FOR` off a method;
- a fixture that names another fixture's base FB, interface, struct (field type or `STRUCT EXTENDS`) or VAR_EXTERNAL
  global needs that fixture in the project — the replay's cross-fixture project had hidden it. `withDependencies`
  resolves them by name, transitively; the recorder loads them and the transpiler lowers from the same text;
- an interface object holds only its header; each METHOD/PROPERTY prototype is its own child, and a property gets only
  the accessors its text names — an unnamed SET made CODESYS demand `__SETVALUE` of a GET-only implementation;
- a subrange value (`INT(0..100)` or a DUT that is one) does not read online: "Type 'Subrange' is not a literal type.";
  such paths are not recorded;
- a fixture written only to BUILD can fault when run — `use_pointer_deref_struct_field` and `cc_fp_ptr_deref` write
  through a pointer before it is set; the application stops and the recorder times out. The replay counts them as todos
  naming the fault; a fixture that does not COMPILE in the simulator is a loader bug and fails.

## 3. Recordings: one file per recorder, never two writers

| file | recorder | mechanism | per case |
|---|---|---|---|
| `recordings/codesys.build.json` | `record:language` | live GUI bridge, CODESYS | `{ buildSuccess, diagnostics }` |
| `recordings/twincat.build.json` | `record:language` | live bridge, TwinCAT worker | `{ buildSuccess, diagnostics }` |
| `recordings/codesys.run.json` | `record:exec` | headless simulator | `{ cycles, values }` or `{ error }` |

These start as today's `expected-codesys.json`, `expected-tc.json` and `test/exec/recordings/expected-codesys.json`,
renamed and moved with contents unchanged. **Alternative rejected — one file per vendor holding `{ build, run }`.** Two
recorders would write one file; they already must not run together, and a merge bug there would silently drop a level.

The simulator keeps its own compile check (a case that does not compile records `{ error }`), as a guard on the run —
the build level has one owner, the bridge. A case where the two disagree on whether it compiles is a finding (§6).

## 4. Consumers

| test | reads | asserts |
|---|---|---|
| `replay.test.ts` (LSP) | every case × `*.build.json` | no false positive; agreement ≥ floor — its rules unchanged, over more cases |
| `refused.test.ts` (LSP) | cases with `refused` | an LSP error containing the fragment (was `test/exec/rejects-lsp.test.ts`) |
| `transpile.test.ts` | every case × `codesys.run.json` | lowered → interpreter and emitted Rust equal every recorded value; not lowered → a todo naming the lowering code |
| `coverage.test.ts` | every case | every grammar operator appears in one |

**"Not lowered" is a todo, never a pass or a skip, and never a failure.** Lowering is total and reports why it refused
(`stmt-call_stmt`, `place-shape` …). A todo carries that code, so the report shows what blocks the most cases — the same
ratchet `scripts/lower-completeness.ts` gives over the corpus, over the fixtures. The number of cases that lower and
match is printed and held by a floor that only rises, like the replay's agreement floor. A case that LOWERS and then
disagrees with CODESYS is a failure, as in `test/exec` today.

A case with `refused` has no run recording and is not a transpiler case. A case whose build fails without `refused` is a
fixture about a compiler message — the LSP's, never the transpiler's.

## 5. The migration is gated

Before anything moves, a snapshot records every test in `test/conformance` and `test/exec` as `title → pass | fail |
todo | skip` (bun's JUnit reporter). After the move, the snapshot must be identical except for the files a test lives
in. Titles do not change, so the comparison is exact; any drift is a migration bug, never an expectation to update.

The new recordings — build for the exec programs, run for the fixtures — come AFTER the gated move, as their own steps:
they change what the suite checks, so they must not be mixed into a move that must not.

## 6. Findings the new recordings will produce

- **LSP false positives on the exec programs**, and **transpiler divergences on the fixtures that already lower** (every
  scalar-only fixture with a body). Each is handled per the standing rule — the recording is the fixture; fix, colocated
  src test, why it was missed — and makes its step red until fixed.
- **Bridge and simulator disagreeing on whether a case compiles** (both use `CodesysTestProject.project`, so unlikely).
  Written down here, not smoothed over.

## 7. Citations

`src/` cites cases as ``test/exec `name` `` (52 places, 14 files) and ``conformance `name` ``. Names are unique across both
lists today (checked: no overlap), so every citation becomes ``conformance `name` `` and still resolves.

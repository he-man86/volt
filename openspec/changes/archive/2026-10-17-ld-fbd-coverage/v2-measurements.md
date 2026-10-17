# 2R.6 v2 — live measurements (2026-10-17)

CODESYS 3.5.21.40 (headless SP21 batch runscript on a copy of `CodesysTestProject.3.5.21.40.project`, every case its own
POU called from `PLC_PRG`, built, then RUN in a fresh online simulation; the POU removed before the next case so every
build is clean — the fixture baseline built with 0 messages). TwinCAT 4024.74 x86 (`ide.ps1 -Instance v2-measure`,
fixture 14 copy; build = the bridge `build` op with `PLC_PRG` calling only that POU). Lab: session scratchpad `v2lab\`
(gen1/gen2/gen5 + cases1–6 + `*.out.json`, `exports\`, `tc\out\`, `model.py`, `tcgen.py`).

Built how: **P** = PLCopen import (authoring tool), **M** = NWL object model, built the way `CodesysNetworkWriter`
builds (`BoxTreeBox`, `AppendInputItem`, `Outputs.AppendOutputItem` + `InsertOutputItem(i, null)`, `OutputParams`),
committed through `GetObjectToModify`/`SetObject`; **R** = M exported native → renamed → `import_native` (the archive
reloaded). LD rows are the FBD tree with `DefaultViewMode = "Ld"` (SP21 PLCopen LD imports land in the LD2 editor, #32).
TwinCAT **A** = archive written through `ImplementationText` (see "TwinCAT" below for why A has no build verdict).

S = stores, B = builds 0 errors, R = runs correctly. `outs` = `OutputItems` per `OutputParams.Names` slot (`∅` = the
vendor's null, `''` = empty operand). MOI = the live `MainOutputIndex`.

| # | case | built | CODESYS S/B/R | TwinCAT S/B/reload/editor | stored members that matter | verdict for v2 |
|---|---|---|---|---|---|---|
| 1a | `y` via `MOVE t => y ENO EN (MOVE 1 => t ENO EN c)`, `lamp` on the outer ENO; FBD + LD | P, LD view | S B R: c=1 → t=1, y=1, lamp=1 in scan 1; c=0 → all 0 | P: S B / – / – | EN is input slot 0; inner MOVE `outs [∅,'t']`, outer `[∅,'y']`, both MOI 0 | spell as v2 |
| 1b | EN false, input subtree a CTU `CV => n` | P (+LD) | S B R: c=0 → **n=1** (CTU ran), z=0 | P: S B | CTU nested in MOVE's input slot | inputs are NOT skipped |
| 1c | EN false, input subtree `MOVE 5 => v ENO EN one` | P | S B R: c=0 → **v=5** | P: S B | | same |
| 1d | EN box vs input box order (`EN (MOVE 1 => t)`, input `MOVE t => u`, and swapped) | M | S B R: EN-slot box first (u=1); swapped: u=0 | – | nested boxes in slot order | stored order = run order |
| 1e | EN box vs input operator (`EN (MOVE 1 => t)`, input `t ADD 10`; `EN t GT 0`, input `MOVE 5 => t`) | M | S B R: y=11; z=1 (GT saw t=5) | – | | operator expressions read AFTER every nested box |
| 2 | split defined in EN slot, read in input slot; and reversed | M, R (PLCopen import of the fan-out raised a modal "Assertion Failed" in `FBDImplementationPartFactory.ConnectToExistingBoxTree`; POU not created) | S B R both: y=1 in scan 1 (a∧b), 0 when b=0; reimport identical | A: S (archive read back with the Demux) | `Demux 1` with Input in one slot, without in the other | same scan either way |
| 3a | MOVE/GT **with ENO pin** read by its VALUE | M, R; P | M/R: S, **B ✗** `ENO output is not used as main output. Please connect ENO to the rest of the network.` (+ `Identifier '__X__ImpVar19' not defined`). P: the importer rewrites it to an ENO read + `=> lamp` pin (`[∅,'lamp']`), builds, runs ENO | P: S (`['',∅]` kept), B ✗ same message | `outs ['',∅]` → MOI 1 | not storable as a build: refuse |
| 3b | CTU with EN+ENO read through `.CV` | M, R; P | M/R: S, B ✗ `ENO output is not used as main output…` + `Cannot convert type 'BOOL' to type 'USINT'`. P: importer drops CV, reads ENO | P: S, B ✗ same | `outs ['','',∅]` → MOI 2 | refuse |
| 3c | box with EN read through ENO, data output unwired | M, R; P | S, **B ✗** for every form: `''` → `The assignment target is not specified.`; `∅` / two `∅` / no data slot → `Identifier '__X__ImpVar19' not defined` | P: B ✗ `Assignment target not specified` | builds only with the data pin wired (`[∅,'t']`, 1a) or on an FB (CTU `[∅,'','n']`, 10) | operator box read via ENO needs `=> v`: refuse without |
| 3d | MOVE with EN, ENO member false, names `['']`, read by value | M, R | S B R (y=k when c, 0 when not) | P (V5): S B | `En=True Eno=False outs [∅]` | = case 5 |
| 4a | FB that DECLARES `ENO` (no EN), read through `ENO` / through `.Q` | P, M, R | S B R both: ENO read lamp=c; Q read lamp=¬c (MOI 1) | P: S B both | `outs [∅,'']` / `['',∅]`, `En=None` | `ENO` here is an ordinary output: `.ENO` / `.Q` |
| 4b | function `V4Fn(v)` with ENO, no EN, consumed | P, M | S, B ✗ `'ENO' is no component of 'V4Fn'` + `Cannot convert type 'Unknown type: 'V4Fn.ENO'' to type 'BOOL'` | P: S, B ✗ same | | refuse by name |
| 4c | ADD with ENO, no EN: consumed / top level | P, M | S, B ✗ `An inconsistent element has been detected (Missing EN pin). Consider making a correction.` (both) | P: S, B ✗ `Inconsistent element detected (Missing EN pin)` | | refuse by name |
| 5 | EN without ENO: MOVE, ADD, user function — top level and consumed | P, M, R | S B R all six: x=3/0, y=k/0, sum=3/0, res=(v>5)/0 | P: S B all | `En=True`, names `['']` (fn `['   ']`), consumed `outs [∅]` | spell: `MOVE 3 => x EN c`, `y := MOVE k EN c` |
| 6 | `a GT 5 EN c` read by value, FBD + LD | P, M, R | S B R all: lamp = c ∧ a>5 | P: S B | `En=True Eno=False/None`, names `['']`, `outs [∅]`, MOI 0 — **the M build compiles** (N21's `ImpVar` failure is gone with `outs [∅]`) | spell: `lamp := a GT 5 EN c` |
| 7a | `MOVE 7 => x ENO => lamp EN c`, CTU call, function call — top level | P | S B; **lamp never written** (c=1 → lamp 0, x=7; toggle → 0) on all three, clean build | P: S B (all three) | `outs ['lamp','x']`, MOI None | stores and builds, does nothing: keep #23's loss-free spelling + LSP warning |
| 7b | the same with a consumer of the box | P, M, R | S, B ✗ `ENO output is not used as main output…` | P: S, B ✗ same | `outs ['lamp',∅]` → MOI 1 | refuse |
| 8 | `NOT` / `R_EDGE` on a box read through ENO | P | S B R: NOT → lamp = ¬c; R_EDGE → scan 1 lamp 1, scan 2 lamp 0 | P: S B | box `Flags` 1 (Negation) / 16 (Rtrig) | spell the flag on the box |
| 9 | Execute box read through ENO: top level, in a chain, BRANCH feed, AND operand | M, R | S B R **after a second commit or a reload**: chain i=1 t=1 lamp=1; branch x=d∨e when go; AND x=go∧d. **A single model commit stores the ST (export holds `i := i + 1;`) but the code does not run** (i=0) in top-level, chain and AND; the reimport of that same archive runs (i=1) | A: S | `EXECUTE` `outs [∅]`, names `['ENO']`, MOI 0 | spell; writer finding below |
| 10 | CTU's ENO as AND operand / as BRANCH feed (LD) | P / M, R | S B R: lamp = c∧d; x = c∧(d∨e) | P (AND): S B | Parallel `BoxShortCircuit`, feed = CTU `[∅,'','n']` | spell |
| 11 | `lamp S= lamp R= c` and `lamp R= lamp S= c`, one assign | M, R (LD) | S B R: S then R → 0; R then S → 1 (from FALSE and from TRUE) | A: S | Assign targets `[lamp F2, lamp F3]` in that order | last stored coil wins = stored order |
| 12 | push: set the connection through the model | M, R | `MainOutputIndex` has no setter (no door: property without setter, no backing field) — and needs none: **the null's position IS the connection** — `outs [∅,…]` → MOI 0, `['',∅]` → MOI 1, `['','',∅]` → MOI 2, read live before the commit, after it, and after export+reimport. The compiler honours it: value/`.name` reads with EN fail by the message above; ENO reads build | A: the archive states it the same way (the one null in `OutputItems`, no `MainOutputIndex` member); the TC importer keeps a value/`.CV` connection as `['',∅]` / `['','',∅]` and the build answers the CODESYS message | push CAN set it on both vendors |

## Decides

- **Evaluation order.** Not "EN first" and not "inputs first": every nested box (a call, an enabled box, an Execute
  box) in any slot runs before its consumer, in stored slot order — EN (slot 0) first, then the inputs — and **regardless
  of the consumer's EN** (1b: a CTU under a disabled MOVE counted; 1c: an enabled MOVE under one wrote `v`). Inline
  operator expressions (`GT`, `ADD`) read their operands after all nested boxes ran (1e). A split reads the same scan
  whichever slot defines it (2). A chain runs in one scan (1a). Consequences: v2's root-first text (EN slot before
  inputs, nested box written where stored) gives the run order of nested boxes by text order; the "a box runs after its
  EN and inputs" rule is right; the LSP/doc must not suggest a disabled box skips its input boxes.
- **ENO pin and connection are one fact for any box with EN.** A box with EN and an ENO output read by its value or by
  `.name` stores (S) but never builds on either vendor: `ENO output is not used as main output. Please connect ENO to
  the rest of the network.` (3a, 3b, 7b). So v2 rule 2's open question closes: consumed + EN + ENO pin ⇒ read through ENO;
  "shows `ENO`" is "connected through ENO". The only box with an `ENO` read by something else is an FB that DECLARES
  `ENO` as an output (4a): there `ENO`/`Q` are ordinary outputs (`.ENO`, `.Q`, both run).
- **The push can set the connection on both vendors.** CODESYS: no member to write and none needed — the position of
  the single null in `Outputs` is the connection; `MainOutputIndex` derives from it at build time, on commit and on
  reload (12). N21's "read-only and stays None" holds only for a box built with no null. TwinCAT: the archive states it
  identically (the null in `OutputItems`), and a value/`.CV` connection set there is what the build judges (3a/3b on A
  via the importer). Every connection the compiler accepts is therefore writable; the ones it rejects are 3a/3b/7b.
- **Consequences for the v2 rules.**
  - Rule 1 (`name, outputs, ENO, EN src`) holds; add: an operator box with EN read through ENO needs its data output
    wired (`MOVE 1 => t ENO EN c`) — `x := MOVE 1 ENO EN c` with no `=> v` does not build in any storable form (3c).
  - EN without ENO is an ordinary storable, buildable, runnable state on MOVE, ADD, functions and comparisons, top level
    and consumed (5, 6): `y := MOVE k EN c`, `lamp := a GT 5 EN c` — one rule, no comparison exception, and the writer
    builds the consumed ones with `Eno=false`, names `['']`, `outs [∅]` (6 now builds; the N21 shapes held no null).
  - ENO without EN: refused by name on operators (`Missing EN pin`) and functions (`'ENO' is no component`) (4b, 4c);
    on an FB it is a declared output, not a pin state (4a).
  - `ENO => lamp`: stores and builds top level on calls and words but the variable is never written (7a) — keep the
    spelling (loss-free pull) with the LSP warning; with a consumer it does not build (7b): refuse.
  - `NOT`/`R_EDGE` on a box read through ENO: box flags, run as written (8). Two coils on one variable: stored order,
    last wins (11) — the text's order must be the stored order.
  - Execute box: reads through ENO in a chain, a BRANCH feed and as an operand (9) — no special case in the grammar.

## Findings outside the grammar

- **CODESYS writer risk (9):** an Execute box built through the object model in ONE `SetObject` stores its ST but the
  build does not run it until the object is committed again or reloaded. Volt's writer builds it in one commit; its
  round-trip tests compare text, not behaviour. Worth a run check before 2R.6 lands.
- **PLCopen importer (CODESYS) is not an authoring oracle for connections:** a value read of an ENO box becomes an ENO
  read plus an output pin to the same variable (3a, 4a `.Q`), and a `.CV` read is dropped (3b); an output fanned into a
  box's EN and input raised a modal assertion (2). TwinCAT's importer kept all of them as drawn.
- IL operator names `R` and `S` are not usable as variable names in an ST declaration (`st` was known).

## Not measured, and why

- **TwinCAT runs:** not attempted beyond N17's finding (no runtime licence); CODESYS run verdicts stand for both.
- **TwinCAT reload/editor, and the build of archive-written (A) POUs:** my XAE crashed four times (APPCRASH in
  `TwinCAT System Manager.dll` 3.1.0.4384, offset `0x00bcc7e8`, c0000005) — on a tree lookup of the root `PLC_PRG`
  item, on `Solution.Close`, and twice right after the worker's `connect` + `fetch`, the last time on a fresh copy of the
  unmodified fixture 14 while the other session's XAE served a project of the same name. The A POUs also built clean
  where they should not have (a deliberately broken one built), so their B column is empty rather than trusted. The
  TwinCAT S/B column above is the PLCopen-imported POUs (S = `ImplementationText` read back, B = bridge build) and the A
  archives' read-back. Open the editor and reload once the crash is understood.
- LD BRANCH and coil cases (10, 11) and the Execute box on TwinCAT: archives only (no Parallel archive form measured).

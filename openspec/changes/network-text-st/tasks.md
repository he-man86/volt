Owner, 2026-10-27: "just go ahead". Read-only first. Section 1 is docs only and runs while language-line is being built;
sections 2–3 change network-text code that language-line also touches, so they start only after language-line is
archived.

## 1. Census and design

- [x] 1.1 Census (no product code): every NWL node kind and flag in the six corpora and the fixtures, with counts, from the
      models the current reader builds (NetworkModel), not from text greps. Per kind: its plain-ST spelling per the
      1.2 measurements, or "ST cannot carry it". Written into design.md.
      Done 2026-10-27, counted on models by a scratch xunit probe (deleted). Sources: the corpus (46 bodies and 394
      networks, 0 unreadable), the accept cases (121), and the TwinCAT native archives (130 `.nwl.xml`, 0 refused).
      Corpus numbers:
      - Keyword-operator boxes: 906 (AND 648, OR 184, comparisons 45, arithmetic 29). 264 have more than 2 inputs,
        and 296 are nested in another one.
      - NOT boxes 3, negated leaves 359, negated pins 6.
      - LD Parallel 17 against 180 LD OR boxes.
      - Function boxes 227 (MOVE 102), FB boxes 157 (93 read by name, 4 `???`). 184 boxes sit at a tree's root.
      - EN 226 (37 unwired, 40 without ENO), ENO 187 (58 EN chains). Execute boxes 12.
      - Coils 483 (set 118, reset 128, 40 with several targets, 4 fed by the bare rail, 6 mid-rung).
      - Demux: 140 definitions (4 fed by the bare rail), 436 references.
      - Result pin wired to a variable (`v MUL 10 => x`): 130 (ADD 17, SUB 5, MUL 5, DIV 2, MOVE 101); 4 outputs `=> ???`.
      - TwinCAT archives: the 5 hand-drawn LD parallels are stored as an OR box, not a Parallel.
      - Edge leaves 1, return 1, jumps 0, negated coils 0, one lone empty leaf.
      - Networks: 260 titles, 20 comments, 2 labels, 3 disabled, 22 empty.
      Correction to the first census: the 4 Terminator-valued Assigns are rail-fed coils, not unconditional jumps.
      ST cannot carry: NOT box vs negation, Parallel vs OR box, EN/ENO, the Execute boundary, a mid-rung coil, a
      rail-fed coil or wire, a wired result pin, an output to `???`, and the shapes v2 spells today (`???` instance,
      negated and edge coils, edge leaves, pin/output/EN flags). These go to 1.3/1.4.
      Niche, accepted loss: the empty lone leaf (1).
      1a (review fixes, 2026-10-27, docs only): the result-pin row was 115 (MOVE 86); it is 130 (MOVE 101). The probe
      had left out the 15 MOVE boxes on an EN-chain continuation line, which it counted for the operators. 130 + 43
      named-output boxes + 4 `=> ???` = 177, the "outputs wired" row. Dropped the "ENO as the connected output" clause:
      58 boxes form EN chains, and a top-level box has no connected output. The MOVE row's `x := MOVE(v);` now covers
      only the MOVE an Assign consumes (1); the other 101, and all 29 arithmetic boxes, are result-pin boxes. 1.2's
      "most frequent boxes" used token counts (AND 996, NOT 385, …) and now uses the 1.1 model counts.
      Gate (a clean HEAD worktree, because the main tree holds language-line's in-progress build): typecheck green on all
      5 packages. Full LSP suite with VOLT_REQUIRE_FULL=1: 10386 pass, 0 fail, 34 skip, 428 todo (824 s). The first run,
      while the machine was loaded (1127 s), had 2 timeouts: `check-size` and `workspace-store` incremental index. Both
      pass alone and in the re-run. No fixture or transpiler change, so the map is not regenerated. `openspec validate`
      fails on the missing `specs/` delta; that is pre-existing at HEAD and not part of this step.
- [x] 1.2 Measured 2026-10-27, CODESYS 3.5.21.40, one POU per case, each called from PLC_PRG and built alone (228
      builds; an uncalled POU is never compiled). Results (raw: the session scratchpad's nts-results.tsv, not kept):
      - The 14 keyword operators (AND OR XOR ADD SUB MUL DIV MOD GT GE EQ NE LE LT) have NO call form: `ADD(i, j)` and
        `AND(a, b)` are syntax errors (C0189/C0007/C0009), positional, extensible, formal or with EN/ENO. Infix only:
        `a AND b AND c`, `i + j + k`, `i > j`, `i MOD j`. They are the most frequent boxes in the corpora (1.1 model
        counts: AND 648, OR 184, comparisons 45, arithmetic 29; MOVE, a built-in, 102).
      - Built-in operators (MOVE, SEL, MUX, LIMIT, MIN, MAX, ABS, SQRT, …, SHL…ROR, EXPT, TRUNC, ADR, SIZEOF, the
        conversions): positional calls only. Named pins are an error (C0077/C0046/C0018). MIN, MAX and MUX are extensible
        positionally.
      - Library and user functions (CONCAT, LEN, REPLACE, DELETE (pins STR/LEN/POS), user `NtsFn`): positional and
        formal both clean.
      - EN/ENO exist on NOTHING in CODESYS ST: operators, conversions, library and user functions and FBs all refuse
        them (C0037 'EN' is no input of 'TON', C0038, C0040, C0002/C0022). A box with EN/ENO has no direct ST call.
      - NOT: `NOT a` and `NOT(a)` are both the operator (one AST); `NOT(IN := a)` is an error.
      - FB calls clean: `t1(IN := a, PT := T#1S); x := t1.Q;` and `t1(…, Q => xb, ET => xt);`.
      - Clean: `JMP lbl;` and labels (`lbl:`, `lbl: ;`); `IF a THEN JMP lbl; END_IF`; `IF a THEN RETURN; END_IF`;
        `x S= a;`, `x R= a;`, `xb S= ok R= a;`, `xb := ok := a;` (a chained assignment).
      - Side finding: declaring `s` or `r` fails in CODESYS too (C0009); see lsp-field-false-positives task 2.
- [x] 1.3 Measure what 1.1 leaves open, in CODESYS through the shipped bridge on a fixture copy (an `ide.ps1` instance
      of this change, closed after). Questions: does an LD body store an AND/OR box apart from series/parallel contacts,
      and how; what EN/ENO does at run time (is ENO always EN, for operators, functions and FBs?); and which ST each
      remaining node needs (branches, edge contacts, negated coils and pins, EXECUTE). No product code.
      Measured 2026-10-27, CODESYS 3.5.21.40 64-bit, `ide.ps1 up -Instance network-text-st -NoBuild` on a copy of
      CodesysTestProject.3.5.21.40 (closed cleanly after). 57 PROGRAMs (53 run, 4 only built: they fail it), each beside an ST twin (the candidate plain ST),
      both called from PLC_PRG and run 8 scans in simulation on one stimulus (a, b, en, i per scan); every scan's
      outputs read back. 37 were authored by CODESYS's own PLCopen importer, 20 built as NWL objects with the calls the
      shipped writer makes (the importer drops edge coils, moves a mid-rung coil and cannot make a Parallel or an
      Execute box). Scratch scripts and raw traces in the session scratchpad (`m13/`), not kept.
      - Authoring: SP21's PLCopen import makes an `<LD>` body an LD2 (`LadderImplementationObject`), not NWL. The line
        `<!--ObjectVersion: LD1-->`, which CODESYS's own export writes, makes it NWL.
      - AND/OR box vs contacts: yes, stored apart, and the output list is the marker. Contacts are an AND (series) or
        OR (parallel) box with no output item and no output name (`OutputParam.Names []`), `MainOutputIndex` null. A
        drawn AND/OR box has one output item (null), names `['']` and `MainOutputIndex` 0. `EN`/`ENO` are no marker
        (the importer leaves them null on a box, hand-drawn boxes hold false), nor is `Flags.Fixed` (false on 3 of
        pro2193's 4 FBD box ANDs). Corpus, every AND/OR box classified by its output list in the recorded archives
        (`test/fixtures/nwl-corpus`; on CODESYS `MainOutputIndex` agrees on every one: 0 on every drawn box, null on
        every contact). Split by the body's `DefaultViewMode`, which records only the editor view the object opens in,
        not where contacts may stand: CODESYS LD-view 636 contact ANDs and
        178 contact ORs against 1 AND box, 1 OR box and 3 NOT boxes; FBD-view 13 box-form AND/OR (lenze-mid 9, pro2193 4)
        and 1 contact-form OR (pro2193 `Cylinder_53ValveFB/SetAlarm`, nested under drawn-box ANDs: contacts occur in an
        FBD-view body, so the contact form is not an LD-only fact and 1.4 must not tie it to `%LANGUAGE LD`); TwinCAT
        (twincat-project14 `POUexecute`, LD) 1 AND box and 1 OR box. That is
        830 + 2 = 1.1's 832 (AND 648, OR 184), and LD ORs 178 + 1 + 1 = 1.1's 180. Volt's model holds the difference
        only as the stored `OutputParam.Names` the CODESYS reader carries (`Box.Members`); a text read derives `[]`,
        the contact form, so rebuilding a box-form AND/OR is named by `RebuildLoss`, and the text does not spell it.
        Run time: identical (series = box AND, parallel = box OR, all traces equal). CODESYS's own PLCopen export draws
        a box-form OR as contacts in LD view.
      - The importer stores a parallel branch holding an FB box without EN as one input of the contact OR, not as a
        Parallel (runs as `cnt(IN := b); out := a OR cnt.Q;`, every scan). In the corpus, 12 of the 17 Parallels hold
        a drawn box on a branch (8 with EN, 4 FBs or functions without), 5 hold contacts only.
      - EN/ENO, all 8 kinds measured (ADD, GT, MOVE, LIMIT, a user function, CTU, a user FB, EXECUTE): EN FALSE skips
        the box (an FB is not called, a function result is not assigned, the output keeps its value) and ENO = EN on
        every scan. A POU that does not declare ENO cannot set it: `ENO := …` in its body is a compile error
        ("Identifier 'ENO' not defined", "'ENO' is no valid assignment target"). A POU that declares EN/ENO as its
        own members can (lenze-mid WSM and Dryer, 55 library POUs); 1c measured those boxes. Twin
        `IF en THEN <box>; END_IF; eno := en;` equals every trace, the EN chain (MOVE.ENO → MOVE.EN → coil) too.
        An unwired EN (Terminator) runs every scan.
      - The 130 result-pin boxes (1.1) all have EN and ENO (8 with an unwired EN, 1 fed by a mid-rung Assign): result
        on output slot 1, ENO on slot 0. So they are `IF en THEN x := v * 10; END_IF` (traces equal). A root function
        box without EN whose result slot 0 holds a variable builds clean and never writes it (0 such function boxes in
        the corpus; 1 FB, `L_FECA.L_GetErrorTextFromFileReadArray` in lenze-mid, stores a target on slot 0).
      - EN without ENO, consumed by value (the 40 comparisons). Measured on two operators only, GT (a comparison,
        BOOL) and ADD (arithmetic, INT), so the data separates neither the result type from the operator kind nor (for
        ADD, consumed only by a root Assign) the consumer's position; the rule stands as "an enabled comparison" against
        "an enabled arithmetic box", not by the consumer's type. An enabled comparison gives FALSE when EN is FALSE, not
        the held value: `out := en AND (i > 3);` directly, `out := a AND en AND (i > 3);` inside an AND (traces equal). The
        hold twins differ at scans 4 and 7 (EN FALSE, i > 3), both `IF en THEN out := i > 3; END_IF;` and a held
        result inside the AND (`IF en THEN t := i > 3; END_IF; out := a AND t;`). The same box pushed through the
        shipped bridge (``out := i GT 3 EN `en`;`` and ``out := a AND (i GT 3 EN `en`);``) builds clean, stores what the
        probe built (`EN` true, `ENO` false, one null output item named `''`, `CallType Gt`, `MainOutputIndex` 0) and
        runs the same traces. An enabled ADD consumed by a root Assign (`o := ADD[EN](i, j)`) keeps its value:
        `IF en THEN o := i + j; END_IF` equal, `o := SEL(en, 0, i + j)` differs. Not measured: a BOOL box that is not a
        comparison (an AND, a BOOL function, with EN and no ENO) and an enabled arithmetic box nested in another box.
        The corpus holds neither (all 40 are comparisons); 1.4 measures them before it states a rule wider than these two.
      - Negations: negated contact, NOT box (LD and FBD), negated input pin (`InputFlags`, needs the importer's
        `BoxInputFlagsSupported` attribute; without it the importer puts the negation on the leaf) and negated leaf
        all run as `NOT a`. Negated coil (`Negation` without `Set` on the target) runs as `out := NOT a`.
      - Coils: set `S=`, reset `R=`, two targets on one Assign (`out := a; out2 := a`), rail-fed coil (Terminator
        value) `out := TRUE`, a rail-fed wire `w := TRUE` then `out := w AND a`, and a mid-rung coil
        (`out2 := AND(Assign(out := a), b)`) runs as `out := a; out2 := a AND b;`. All twins equal.
      - Edge contacts: `Rtrig`/`Ftrig` on a leaf = `R_TRIG`/`F_TRIG` on the VARIABLE, called every scan, also behind a
        series contact. Twin `rt(CLK := a); out := en AND rt.Q;` equal on a second stimulus where `a` rises while `en`
        is TRUE (scan 1: a one-scan pulse) and `en` turns on while `a` is already TRUE (scan 5: no pulse). The other
        candidates differ there: `out := FALSE` at scan 1, an edge of the whole rung (`rt2(CLK := en AND a)`) at scan 5.
      - Edge coils: the importer drops `edge` on a coil, and a coil target with `Rtrig`/`Ftrig` set (stored, Flags 16/32)
        builds with no message and runs as a PLAIN coil (`out := a`, not a pulse). CODESYS has no edge coil.
        Corpus 0, cases 3 (Volt's own `R_EDGE x := a;`).
      - Parallel, `Sequential`: every branch runs, the EN box on each scan the feed is TRUE (twin
        `IF en THEN cnt(…); END_IF; out := en AND (en OR a);` equal). `BoxShortCircuit` (superseded by 1.4, which
        measured the rule for any box: the box branch runs unless the feed and a box-free branch are both TRUE, and
        also when the feed is FALSE; here the box's EN was the feed, so it ran only when the feed was TRUE): the box
        branch runs ONLY when the feed is TRUE and no contact branch is TRUE, whichever branch comes first (box first or last: calls 2
        against 4; no feed: 3 against 8). Plain ST carries it as a guard: `IF en AND NOT a THEN cnt(IN := b, calls => o);
        END_IF; out := en;` (box first and box last), `IF NOT a THEN cnt(…); END_IF; out := TRUE;` (no feed), traces
        equal; the Sequential twin differs. This covers ONE shape: a single enabled FB on a branch, EN fed by the
        feed, the branch value its ENO (= the feed). The corpus's 17 Parallels hold none of it: of the 16
        BoxShortCircuit ones, 4 hold a box without EN (a TOF FB, 3 `fc_CamC_CC_UDT` FUNCTION calls: the branch value
        is the box's own output, not the feed), 7 hold enabled comparisons or arithmetic (EQ ×2, GE, GE/ADD/MUL,
        GE + TON, LE/GE/LT, GE/LE/GT: their value is FALSE when disabled, N41, not ENO), and 4 of those hold 2 to 6
        boxes on their branches (call order inside a branch not measured); the one Sequential holds an LE[EN].
        Before 1.4 decides on the guard it measures a no-EN function branch, an enabled-comparison branch and a
        branch with several boxes.
      - EXECUTE: the ST runs only after a second commit (as execute-runs.test.ts says); then
        `eno := EXECUTE[EN := en](o := o + i;)` = `IF en THEN o := o + i; END_IF; eno := en;`, and a root Execute box
        with an unwired EN runs every scan. Twins equal.
      - `???`, probe-built: an FB box with instance `???` and wired pins fails the build ("Expression expected instead
        of '?'", "Program name, function or function block instance expected"); an `ADD[EN]` whose result pin is wired
        to `???` fails it ("The assignment target is not specified."). The corpus shapes are not those, and the
        recorded lenze-mid build has 0 errors: the 4 `???` instances (every pin empty) are in `MotionControl/POU`,
        which is `%EXCLUDE_FROM_BUILD`, so never compiled. The 4 `=> ???` are in `Mach1_MIDS` (3) and `AHWF` (1), both
        compiled (MainTask → General → Mach1_MIDS → AHWF), so that stored shape builds. They are NOT result pins: each
        box stores `OutputParam.Names ['ENO']` and two output slots `[null, '???']`, and only one callee has a result
        (`Alarms_V5_1_100 : BOOL`); `SideCorrection` and `SpeedCalculationDryer` are PROGRAMs and
        `SpeedCalculationTrayfiller` a FUNCTION with no return type. So three hold `???` in N37's extra unnamed slot of an
        enabled call (`RebuildLoss.ExtraOutputSlots`), one in a BOOL function's result slot. All four store
        `CallType Function`, which therefore does not show the callee is a function: of lenze-mid's 14 enabled PROGRAM
        calls, 11 store `CallType Program` and 3 `CallType Function` (2 of them these). 1.4 spells them neither as
        `??? := f(…)` nor as result pins.
      Not measured (Volt-side, for 2.2): whether an omitted pin reads back as unwired.
      1b (review fixes, 2026-10-27, re-measured on a fresh `ide.ps1 -Instance network-text-st` copy, closed after): all
      53 runnable cases re-run on the same stimulus, with the kept twins plus the candidates the bullets above choose
      between. Twin equal on every case except the ones the bullets name, and four importer artifacts: the
      importer moves a mid-rung coil (`M13_ld_mid_coil`; the NWL-built case is equal), stores an EN box on a parallel
      branch as a series AND (`M13_ld_par_enbox`, `…_first`: `out = a`) and drops a fed parallel's network
      (`M13_ld_fed_par_enbox`: empty body). The NWL-built `N13_par_*` cases measure those shapes. The 4 only built:
      the two `???` cases and the two whose helper assigns `ENO`. DIALECT N21 is stale on two points, and its
      corrections go with 3.2, because DIALECT.md and the reader are in language-line's working set now: a consumed
      enabled comparison builds since 2R.5 (N41 #26 and the push above), and a GT box the push builds stores
      `MainOutputIndex` 0 once the vendor resolves its `CallType`, so the `CodesysNetworkReader` comment "absent on
      every box a push built" holds for the contact AND it builds (null), not for an operator box. The reader takes a
      stored index first, so its behaviour is unaffected.
      1b review (2026-10-27, docs only, counted on the recorded archives `test/fixtures/nwl-corpus` by scratch
      scripts, not kept): six findings, all fixed in the bullets above and in design.md. (1) `=> ???`: 1 of the 4 is
      a result pin, 3 sit in an enabled call's extra slot; the reviewer's "only AHWF's call is `CallType Program`" was
      inverted (11 of the 14 enabled PROGRAM calls store `Program`), the point stands: 3 PROGRAM calls store
      `Function`. The 1.1 function-box counts (227; library or user POU 124; EN on a function 132) include these 14
      PROGRAM calls (the model has no program kind: a box without an instance is `CallKind.Function`). (2)
      BoxShortCircuit guard scoped to the one measured shape; the corpus shapes go to 1.4 as measurements. (3) The
      reader's other comments ("absent on the AND/OR boxes (census 1.6)", `UnstoredMainOutput`) are false too: added
      to 3.2. (4) EN
      without ENO stated per operator kind; the reviewer's "both consumed by a root Assign" holds for ADD only (GT
      was also measured inside an AND, `N13_gt_en_value_and`). (5) design.md rows 38, 46, 50, 64, 69 and the open
      list now carry 1.3's answers. (6) The AND/OR split is by editor view, and contact form occurs in an FBD-view
      body (pro2193 `SetAlarm`). For the owner (a grammar edge case, not doc content): contacts are not tied to the
      body's language, so the subset cannot say "contacts only in LD".
      Gate 1b: typecheck green on all 5 packages; full LSP suite with VOLT_REQUIRE_FULL=1: 10392 pass, 0 fail, 34 skip,
      428 todo (594 s). No fixture or transpiler change, so the map is not regenerated.
- [x] 1.4 design.md (design-first, before any code): the mapping per node kind. It must decide:
      - EN/ENO: the `IF en THEN <box> END_IF` pattern, chains, and ENO targets; or a `%` line if ST cannot carry it;
      - the operator-chain rule (one chain = one extensible box, brackets nest);
      - wire variables: name and declaration;
      - statement order (ST evaluation order) and how statements group into one rung;
      - the `%NETWORK`/`%LABEL`/`%DISABLED` lines;
      - the network subset the LSP allows;
      - the oracles.
      Before deciding, it measures what 1.3 left out (1b review): a BoxShortCircuit branch holding a no-EN function,
      an enabled comparison and several boxes; an enabled non-comparison BOOL box and a nested enabled arithmetic box
      consumed by value. The 3 `=> ???` in an enabled call's extra slot and the 1 in a result slot are spelled as
      what they are, not as result pins. It takes up every design.md row that still points at 1.3.
      Every case where plain ST cannot carry a stored difference is listed with the choice made and why. The owner
      said go ahead, so the design is decided by evidence here and reported to the owner. It does not wait.
      Done 2026-10-27 (design.md "1.4 Mapping"). Measured on CODESYS 3.5.21.40 64-bit, `ide.ps1 -Instance
      network-text-st` on a fixture copy, closed after: 42 PROGRAMs (37 NWL-built, 5 ST-only) beside 1 to 3 candidate
      ST twins, 10 scans in simulation, outputs plus a call log per scan (scratch, not kept). Findings:
      - BoxShortCircuit, all 12 corpus-like box shapes: a branch holding a box runs (all its boxes, inner first) unless
        the feed and a box-free branch are both TRUE; with the feed FALSE it runs. 1.3's EN shape follows the same rule.
      - An enabled box without ENO read by value: under an Assign it holds (`IF en THEN x := <box>; END_IF`; AND, OR,
        a BOOL and an INT function, ADD); a comparison is FALSE when disabled, also as another comparison's EN; any
        other enabled box inside a box does not build ("A box with EN can be used for comparison operators only.").
      - The four `=> ???`: stored as an extra slot past the names `['ENO']`; built that way they compile and run as the
        plain call. Not result pins, and the 1.3 "result slot" reading was the probe's own naming.
      - CODESYS calls a tree's FB boxes before evaluating the tree (`AND(f(a), s1(b).Q)` calls s1 first).
      - An assignment is an expression: `out2 := (out := a) AND b;` (also `S=`, two targets, inside a call) builds and
        runs as the mid-rung coil.
      - 139 corpus Demux definitions, each read after it in its network.
      Decisions: EN is `IF en THEN … END_IF`, an enabled value goes through a wire set in THEN and ELSE; wires `w1…` per
      body, undeclared, defined once before a read; FB boxes are statements before their item; mid-rung coil is the
      assignment expression; the label is an ST label; `=> ???` is the plain call. Stored members (runs the same,
      RebuildLoss on rebuild): +6 rows, among them a call-free Parallel (8 in 7 networks) as its OR and the rail-fed
      coil/wire (8) as `TRUE`. Refused by name: a Parallel with a call on a branch (5, lenze-mid; their 5 networks),
      an enabled non-comparison box nested in a box (0, CODESYS refuses it), and the niche list (edge contact 1,
      `???` instance 4, ENO without EN 1, lone empty leaf 1, pin/output edge and output negation 0; 1c re-files these,
      see below). For the owner:
      the Parallel-with-a-call guard form, brackets carrying meaning in operator chains, the wider RebuildLoss, the
      `???` instance losing push, `%EXECUTE` as the only `%` pair. Docs only, no code: the gate runs typecheck and
      the suite; the fixture map is not regenerated.
      1c (review fixes, 2026-10-27, docs plus one live measurement): six findings, all fixed in design.md.
      Measured on CODESYS 3.5.21.40 64-bit (`ide.ps1 -Instance network-text-st -CodesysCulture en`, closed after), 9
      NWL-built PROGRAMs beside 2 to 3 ST twins, 10 scans (design.md "Measurements (1c)").
      (1) EN/ENO the callee declares: the 1.3 sentence "ENO cannot be set inside a POU" was false (corrected above).
      WSM's and Dryer's boxes store `En`/`Eno` false; they run as plain calls with formal pins
      (`ef(EN := en, IN := a, ENO => t)`, equal), not as enabled boxes. A box that shows its own EN over such a
      callee runs as the enable IF and never sets the declared EN. On the five CODESYS archives the flags agree with
      the pin names on every other box (225). Decision: the enable is the stored flag, the pins are formals; the
      current reader keys on the pin name (`HasEnableSlot`/`HasEnoSlot`), so 2.2 reads the flag. Dryer ("ENO without
      EN", refused) is now spelled.
      (2) The Parallel criterion is "a side effect on a branch" (a call, an output wired to a variable, a coil), not
      "a call". Measured: a result-pin ADD on a branch follows the skip rule; a coil on a branch never wrote its
      target and no twin of three is equal. Corpus 0 (the 5 side-effect branches are the 5 calls).
      (3) Wires are named on a per-network `%WIRES w1, w2` line instead of being decided by scope; a wire name that
      is also in scope is refused by name.
      (4) The owner rule ("every stored shape gets a spelling") is restored; the edge contact, the `???` instance,
      pin/output edges and negations, the Parallel with a side effect and the negated and edge coils (rebuild loss)
      are "Open for the owner", each with what v2 spells today, not filed as niche.
      (5) Labels: a trailing label with no statement and two labels in a row build in ST and run as the networks;
      a jump to a disabled network's label does not build in CODESYS, so dropping a disabled network's text with its
      label in the twin is the IDE's own behaviour.
      (6) The 1.3 BoxShortCircuit bullet is annotated as superseded; the evidence gap (scratch probes) and the 3 of 12
      Parallel shapes judged on call logs are stated in design.md, to be closed by 2.4's exec cases.
      1c gate (review fixes, 2026-10-27, docs only; every finding re-checked on the recorded archives
      `test/fixtures/nwl-corpus` and the 1c traces by scratch scripts, not kept). Five findings, all confirmed and
      fixed in design.md:
      (1) Unwired input pin (7 / 5 / 2): the 7 corpus pins are all LD bare-rail Terminators on boxes without `En`
      (AHWF `WSM.EN`, 4× `fc_CamC_CP_UDT.iEN`, `fc_CamC_LS_Base2.i_xEnable`, `TOF.IN` on a Parallel branch). 1c's
      `N15_enfb_pin_rail` shows a rail-fed pin is TRUE (`EN := TRUE` twin equal, the pin left out all FALSE). Row 75
      now spells it `X := TRUE`, a stored member beside the rail-fed coil and Demux (4 + 4 + 7); a mapping row added;
      the "omitted pin reads back as unwired" question for 2.2 is gone.
      (2) Demux over an FB box (4: `R_TRIG` ×3, `Dryer`, read 2 to 6 times; enabled MOVE 1 and ADD 1 are the same
      case for the enabled-IF form): one rule for all three wire definitions, "read twice or more is a Demux, read
      once is the box where it is read"; `w1 := <tree>;` read once is refused by name. All 139 archive definitions are
      read 2+ times (0 once). Reported to the owner as a grammar edge case: the read count decides the node, and a
      Demux read once (0) has no spelling.
      (3) A jump to a disabled network's label: the subset now states a `%DISABLED` network is not part of the
      compiled body, so its label is no jump target and the `JMP` is CODESYS's "No such label" error (LSP parity);
      the exec twin drops its text, label included. The 1c bullet is corrected: both twins run kept `lx:` on the next
      network and built; a twin without the label was not run. Reported to the owner.
      (4) Parallel with a coil on a branch: restated as "CODESYS drops the coil" (`out = en AND (a OR c)` on all 10
      scans, computed from the stimulus; `out2` never set), shape built through the API only.
      (5) EN/ENO counts by the stored flag: EN 225 (FB 24, unwired 36), ENO 185; on the five archives the flags agree
      with the names on 224 boxes with an EN pin and 1074 with neither; WSM was in EN, both in ENO; neither is an
      EN-chain link. (1.1's "EN 226 … ENO 187" above is the pin-name count.)
      No product code, fixture or transpiler change, so no failing test applies and the map is not regenerated.
      Gate 1c (a clean HEAD worktree, 934abd81b9): typecheck green on all 5 packages; full LSP suite with
      VOLT_REQUIRE_FULL=1: 10392 pass, 0 fail, 34 skip, 428 todo (819 s). Two earlier runs were not green for
      reasons outside the change: `check-size` timed out under machine load (40 s; 2.5 s alone, green), and the
      worktree's bun store lost `vscode-languageserver-protocol` between runs (16 fail "Cannot find module";
      `bun install` restored it).

## 2. Read-only (after language-line is archived)

Owner, 2026-10-27: "go ahead with your proposals for section 2". Start from the gap probe (branch
`worktree-agent-a334baa03b87b3d4b`, 911876691e: `test/shared/StNetworkWriter.cs`, `StNetworkReader.cs`, `StNetworkProbe.cs`
and its three probe tests): move writer and reader into `src/` and build on them, do not rewrite from scratch. The two
new stored members and the adopted open-point choices are in design.md ("Gap probe"). The four open-list shapes
(Parallel with a side effect, `???` instance, edge contact, edges/negations on pins) are `%UNSUPPORTED` during the
read-only phase only; 3.0 spells them.

Restart note (2026-10-27): the first section-2 run was stopped mid-2.1 when the owner set "every box is a call"
(design.md "Revision"). Its UNCOMMITTED work in the tree (StNetworkWriter moved to `src/`, StNetworkOracle, the
switch and vendor-reader wiring, test updates) is kept: continue it, change only the spelling to the revision.

- [ ] 2.1 Writer: NWL → plain ST network text (behind `NetworkTextSwitch`, as LD/FBD are today). A push of an LD/FBD body is
      refused by name until section 3 ("LD/FBD push comes back with the plain-ST reader"). Measure first, in CODESYS on
      an `ide.ps1` fixture copy: an unconnected input pin (Leaf `""`, 10 lenze networks) left out of the call — does the
      text compile and run as the network? If yes it is the pin left out, restored from the callee's declaration;
      if not, `%UNSUPPORTED`.
- [ ] 2.2 C# reader of the plain-ST form into the NWL model (it is needed for the oracle). Round-trip oracle: every corpus and
      fixture network → text → model gives the identical tree. The model takes EN/ENO from the box's stored `En`/`Eno`
      flags, not the pin name (1c: WSM, Dryer), and wires from the network's `%WIRES` line (read twice or more: a
      Demux; once: the box where it is read).
- [ ] 2.3 LSP: a network body is read by the ST front-end, plus ONE subset check (what a network may hold, refused
      by name). No network lexer, grammar or keyword list. LSP conformance against the same case set. A `%DISABLED`
      network's label is no jump target (CODESYS: "No such label … within the scope of the JMP statement").
- [ ] 2.4 Exec oracle: the corpus networks' text compiled in CODESYS as called ST bodies, 0 errors; behaviour equal on
      the exec-oracle cases.

## 3. Push and cleanup

- [ ] 3.0 100% coverage (owner, 2026-10-27: "of course we need 100% coverage in the end"; memory support-all-ld-fbd):
      every shape the IDE can store gets a plain-ST spelling — the four open-list shapes, the lone empty leaf, the
      Demux read once, and every accept-case gap of the probe; and every stored member that is its own toolbox element
      gets its own function name (design.md "Revision": one function per toolbox element), so a rebuilt network keeps it. Gate: 0 `%UNSUPPORTED` on the corpora, the TwinCAT archives
      and the accept cases. The v2 reader is not deleted (3.2) before this is green. Each new spelling measured in
      CODESYS first (compiles, runs as the network).
- [ ] 3.1 Push through the new reader (NetworkPairing, the derivation, RebuildLoss as today); the full e2e suite on
      both vendors.
- [ ] 3.2 Delete the old reader, lexer, spelling and the LSP's network parser; rewrite `docs/network-text.html` (much
      smaller: the mapping table and the subset); the case set re-recorded. Correct DIALECT N21 and the
      `CodesysNetworkReader` `MainOutputIndex` comments by 1.3's 1b note: "absent on every box a push built" holds only
      for the contact AND it builds, and "absent on the AND/OR boxes (census 1.6)" / "the AND/OR boxes an engineer
      drew" (`UnstoredMainOutput`) is false: every drawn AND/OR/NOT box stores 0 (15 AND/OR, 3 NOT); only the
      contact form (814 in LD-view bodies, 1 in an FBD-view body) stores null.
- [ ] 3.3 Close: cold full suites, the release matrix, archive.

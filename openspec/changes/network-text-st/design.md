# network-text-st — design

## 1.1 Census: NWL nodes in the corpora, and their plain-ST spelling

**Target.** Every node kind and flag the IDE stores, counted on the models (`NetworkModel`). Each one gets its plain-ST
spelling per 1.2, or the marker *ST cannot carry it*, which sent it to 1.3/1.4. Each such row now names the 1.4 choice.

**Choice:** count models, from three sources:
- **corpus**: the six corpora, read by today's reader with the push's scope (each body against its project's
  declarations). That gives 46 bodies and 394 networks, 0 unreadable, the same tally `ModelRoundTripOracleTests` pins,
  so the read is lossless;
- **cases**: the accept case set (`test/fixtures/network-text/accept`), 121 cases, all read;
- **archives**: the TwinCAT native corpus (`test/fixtures/tc-native-corpus/import/*.nwl.xml`), 130 bodies TwinCAT
  serialized itself, read by `TcNetworkReader`, 0 refused.

The archives replace the corpus's 109 `.network.txt` texts: they are the IDE's own store, and they include the hand
shapes (contacts, branches, edges, negated pins) that have no text.

Language-line is mid-build, so the probe spelled the corpus's `IMPLEMENTATION X` as `%LANGUAGE X` and dropped
`IMPLEMENTATION NONE` in memory. The probe was a scratch xunit test in `Volt.Ide.Twincat.Tests`, deleted after the run.

The owner's rule holds for every row: each stored shape gets a spelling, and "0 in the corpus" is no reason to refuse
one. A row this design does not spell is listed under "Open for the owner" below, with what v2 spells for it today,
and is not filed as decided. The one exception is 1.1's lone empty leaf (1), recorded under the owner's triage rule
("niche: accepted loss": about zero corpus occurrences and not trivial to fix).

**Rejected:** text greps (they count spellings, not nodes) and a live IDE walk (it adds nothing over a corpus that the
oracle round-trips 1:1).

Bodies (corpus / cases / archives): LD 36 / 97 / 15, FBD 10 / 24 / 115.
Networks: LD 356 / 105 / 15, FBD 38 / 24 / 132.

| Node | corpus / cases / archives | Plain ST |
|---|---|---|
| keyword-operator box (AND OR XOR ADD SUB MUL DIV MOD GT GE EQ NE LE LT) | 906 / 70 / 95 | infix only (1.2) |
| · AND · OR | 648 · 184 / 33 · 2 / 45 · 25 | `a AND b`, `a OR b` |
| · comparisons · arithmetic (corpus: ADD 17, SUB 5, MUL 5, DIV 2; no MOD) · XOR | 45 · 29 · 0 / 13 · 21 · 1 / 7 · 17 · 1 | `i > j`, `i + j`, `a XOR b`. All 29 corpus arithmetic boxes have their result pin wired to a variable: see the result-pin row |
| · more than 2 inputs (an extensible box) | 264 / 8 / 6 | one chain `a AND b AND c` |
| · nested in another keyword-operator box | 296 / 6 / 21 | brackets `(a OR b) AND c` |
| NOT box | 3 / 2 / 3 | `NOT a`. **ST cannot carry it** apart from the next two rows: 1.2 measured `NOT(a)` and `NOT a` as one AST. 1.4: over a leaf, a stored member; over a tree, `NOT (a AND b)` |
| negated contact or leaf | 359 / 10 / 2 | `NOT a` |
| negated input pin | 6 / 3 / 0 | `NOT a` |
| LD Parallel (BoxShortCircuit 16, Sequential 1; 3 branches 1; no feed 5) vs LD OR box (180) | 17 / 16 / 0 | `a OR b` for both. **ST cannot carry it** (Parallel vs box, and Mode). 1.3: 178 of the 180 are contacts (the OR box with no output item), 1 a drawn OR box, 1 TwinCAT's; run time identical. 1.4 measured the corpus shapes: a Parallel with no side effect on a branch (8 in 7 networks) is the OR it computes, the Parallel a stored member; one with a side effect on a branch (5, all calls, and the 4 side-effect-free ones nested in them) is open for the owner |
| · TwinCAT: a hand-drawn LD parallel is stored as an OR box | – / – / 5 | the archives' 5 LD parallels (`Vn_ld_parallel2`, `…3`, `…_series`, `…_then_series`, `Vn_ld_series_parallel`) each hold one `BoxType "OR"` box and no `BoxTreeParallel`: TwinCAT has no Parallel-vs-OR distinction in LD (a measured vendor asymmetry, counted in the 25 archive OR boxes above). 1.3 |
| function box, Execute excluded (corpus: incl. 14 enabled PROGRAM calls, lenze-mid: the model has no program kind) | 227 / 60 / 43 | a call |
| · MOVE (stored as a function call) | 102 / 47 / 3 | `x := MOVE(v);` positional (1.2: a built-in takes no formals), only for a MOVE an Assign consumes (corpus: 1). The other 101 corpus MOVE boxes have their result pin wired to a variable: see the result-pin row |
| · other built-ins (TO_STRING; in archives MAX, MIN, MUX, SEL, LIMIT, SHL…ROR, trig, conversions, ADR, SIZEOF) | 1 / 2 / 35 | positional |
| · library or user POU (incl. CONCAT, LEN, DELETE, REPLACE; and the 14 PROGRAM calls) | 124 / 11 / 5 | formals as stored (`f(IN := a, o => y)`), 1.2 clean |
| box with outputs wired (`=>`) · with a named output (boxes; corpus: 87 named output pins on the 43; 177 = 130 result-pin boxes + 43 named-output boxes + 4 `=> ???`) | 177 · 43 / 54 · 5 / 0 · 0 | `o => y` in a formal call |
| · keyword operator or built-in whose result pin is wired to a variable (`v MUL 10 => x`): ADD 17, SUB 5, MUL 5, DIV 2 (every corpus arithmetic box), MOVE 101 (15 of them on an EN-chain continuation) | 130 / – / – | **ST cannot carry it**: `x := MOVE(v);` / `x := i * j;` read back as an Assign root over the box, not a box with a wired result pin, and an operator has no call form (1.2). 1.4: `IF en THEN x := v * 10; END_IF` is the result-pin box (all 130 have EN and ENO) |
| · output slot wired to `???` (Mach1_MIDS ×3, AHWF ×1) | 4 / – / – | **ST cannot carry it**: `=> ???` names no variable. 1.3: builds (compiled, 0 errors); 1 is a BOOL function's result slot, 3 the extra unnamed slot of an enabled call (2 PROGRAMs, 1 FUNCTION with no type; `RebuildLoss.ExtraOutputSlots`), all `CallType Function`. Not result pins. 1.4 (re-read): all four store the output names `['ENO']` and the slots `[null, '???']`, so the `???` slot is an extra slot past the names (N37), and each runs as its plain call (measured): `SideCorrection();`, the slot `RebuildLoss.ExtraOutputSlots` |
| FB box | 157 / 14 / 19 | `t1(IN := a, PT := p);` |
| · output read by name | 93 / 7 / 0 | `x := t1.Q;` after the call. 1.4: `t1(IN := a, Q => w1);` then `w1`, so a leaf `t1.Q` stays a leaf |
| · instance `???` | 4 / 1 / 0 | **ST cannot carry it**: `???(…)` is no call. v2 spells it today (`??? : TYPE(…)`, added so the Lenze POU can be pushed back). 1.4: open for the owner (4, all in one POU excluded from build) |
| box at a tree's root (no Assign) | 184 / 33 / 20 | a call statement `f(…);` / `t1(…);`. 1.3: a root function box without EN whose result slot holds a variable builds and never writes it (0 in the corpus) |
| EN (the box's stored `En`, 1c) | 225 / 63 / 2 | **ST cannot carry it**: CODESYS ST has no EN/ENO (1.2). 1.4: `IF en THEN … END_IF`; an enabled value through a wire set in its THEN and ELSE |
| · on a keyword operator · function or built-in · FB | 69 · 132 · 24 / 10 · 50 · 3 / 1 · 1 · 0 | as above |
| · EN unwired | 36 / 3 / 0 | as above |
| · EN without ENO (in the corpus: all 40 are comparisons) | 40 / 11 / 2 | as above |
| ENO (the box's stored `Eno`) | 185 / 59 / 0 | as above |
| · ENO is the connected output (an EN chain) | 58 / 37 / 0 | as above |
| · EN or ENO the callee declares itself (box `En`/`Eno` false; lenze-mid `IDB_WSM` EN+ENO, `IDB_Dryer` ENO) | 2 / 0 / 0 | not an enable: a formal pin. `IDB_WSM(EN := TRUE, …, ENO => w1);` (1c). The first census matched EN/ENO by pin name and counted WSM in EN, EN unwired and FB EN, and both boxes in ENO; the rows above now count the flag. On the five CODESYS archives the flags agree with the names on every other box: 224 with an EN pin (40 EN only, 184 EN and ENO) and 1074 with neither. Neither box stands in another box's EN slot (WSM feeds an AND; Dryer reaches three GE boxes' EN through a Demux), so the EN-chain row is unchanged |
| Execute box | 12 / 9 / 0 | the snippet is already ST. **ST cannot carry it** (where the box starts and ends). 1.4: `%EXECUTE` … `%END_EXECUTE` |
| coil (Assign at a tree's root) | 483 / 142 / 131 | `x := v;` |
| · set · reset | 118 · 128 / 5 · 5 / 2 · 2 | `x S= v;` `x R= v;` |
| · several targets | 40 / 7 / 7 | `a := b := v;`, a chained assignment (1.2 clean). No wire |
| · fed by the bare rail (Terminator value, no jump) | 4 / 2 / 0 | **ST cannot carry it** apart from a `TRUE` leaf: `x := TRUE;` is a different tree. 1.4: `x := TRUE;`, the Terminator a stored member (1.3: same run) |
| · negated coil | 0 / 2 / 3 | **ST cannot carry it**; v2 spells it (`NOT x := a;`). 1.4: `x := NOT a;`, a stored member (runs the same; a rebuild names it in RebuildLoss, where v2 kept it: open for the owner) |
| · edge coil (rising, falling) | 0 / 3 / 0 | **ST cannot carry it**; v2 spells it (`R_EDGE x := a;`). 1.4: `x := a;`, a stored member (1.3: CODESYS runs it as a plain coil; a rebuild names it in RebuildLoss, where v2 kept it: open for the owner) |
| mid-rung coil (Assign nested in a tree) | 6 / 2 / 0 | 1.3: runs as `out := a; out2 := a AND b;`. 1.4 measured an assignment inside an expression: `out2 := (out := a) AND b;` builds and runs the same, also with `S=` and two targets |
| Demux: definitions · references | 140 · 436 / 11 · 14 / 4 · 10 | a wire variable `w := …;` then `w`. 1.4: named `w1`, `w2`, … per body, declared by nobody; every corpus definition is read, after it (139 of 139 in the CODESYS archives) |
| · definition fed by the bare rail (Terminator input: `split2 := ;` ×4, GeneralProgramFlags) | 4 / – / – | **ST cannot carry it**: `w := ;` is no ST, `w := TRUE;` reads back as a Leaf. 1.4: `w := TRUE;`, as the rail-fed coil |
| edge contact or leaf (rising, falling) | 1 / 3 / 3 | **ST cannot carry it**: ST has no edge operator, and `R_TRIG` needs an instance. v2 spells it (`R_EDGE NOT clk`). 1.3 measured an equal twin, `rt(CLK := a); out := en AND rt.Q;`. 1.4: open for the owner (1) |
| edge on a pin, or edge/negation on a box output or EN (negated input pins: the row above) | 0 / 6 / 0 | **ST cannot carry it**; v2 spells it (`TON(NOT IN := v …)`). 1.4: open for the owner (0) |
| unwired input pin (a Terminator on a named pin; the corpus's 7 are all LD bare-rail pins on boxes without `En`: AHWF `WSM.EN`, 4× `fc_CamC_CP_UDT.iEN`, `fc_CamC_LS_Base2.i_xEnable`, `TOF.IN` on a Parallel branch) | 7 / 5 / 2 | **ST cannot carry it** apart from a `TRUE` leaf. 1c: a rail-fed pin is power flow, TRUE (`ef(EN := TRUE, …)` equal); leaving the pin out differs (FALSE into a function, the held value into an FB). 1.4: `X := TRUE`, the Terminator a stored member, as the rail-fed coil and wire |
| jump · return | 0 · 1 / 7 · 4 / 2 · 2 | `IF c THEN JMP l; END_IF` / `IF c THEN RETURN; END_IF` (unconditional: `JMP l;` / `RETURN;`) |
| a tree that is a lone leaf with no operand | 1 / 0 / 0 | **ST cannot carry it**: `;` is no node. Niche, accepted loss (1) |
| network: title · comment · label · disabled | 260 · 20 · 2 · 3 / 5 · 3 · 9 · 2 / 0 · 0 · 0 · 0 | `%NETWORK "…"`, `//` lines, an ST label `l:`, `%DISABLED` |
| network: empty · unsupported | 22 · 0 / 1 · 1 / 0 · 0 | an empty `%NETWORK`, `%UNSUPPORTED "<shape>" #hash` |

**Corrections to the first census (same day):**
- The 4 corpus Assigns with a Terminator value are not unconditional jumps. They are coils fed by the bare rail. The
  corpus holds no unconditional jump or return.
- The table now counts the native archives, not the corpus texts. The three texts that no longer read
  (`Vn_enable_and`, `Vn_enable_move`, `Vn_move_stmt`) are not needed for the count.
- The output row changed unit. The first census counted pins on function boxes (result output 134, named output 87);
  this one counts boxes with any output wired (177) and boxes with a named output (43, carrying the same 87 named pins,
  re-counted by `grep -oE "[(,] *\w+ => "` over the 46 LD/FBD bodies). The result pins wired to a variable now have
  their own row (130).
- Added after review: the 130 result-pin boxes, the 4 `=> ???` outputs, the 4 rail-fed wire definitions and TwinCAT's
  LD parallel stored as an OR box were missing.

**Still refused by name (unchanged, below the text):** an unmeasured Parallel mode, a flag on a Demux, Parallel or
Assign item, a null input slot, a missing pin-flag list, and an unreadable Execute snippet (`BoxRefusals`,
`UnheldFlags`).

**Open after 1.3:** taken up by 1.4 below (an unwired pin is not left out of the call: 1c).

**Niche, accepted loss:** the empty lone leaf (1).

**Migration:** none in this step. The corpus stays v2 text until 2.1 re-pulls it through the plain-ST writer.

## 1.4 Mapping: NWL → plain ST

**Target.** A network body is ST that CODESYS compiles and runs as the network, and that reads back to the stored tree.
Volt adds only `%` lines. Decided on 1.1–1.3 and the measurements below.

**Revision (owner, 2026-10-27: "these are just functions", "similar to LIMIT", "the LSP knows what they are", "like a
MOVE_EN() and a MOVE() function", "in the end in CS they are also 2 sep blocks you choose from", "is it possible to
have them both named GT(").** One rule: **every element the IDE's toolbox offers has its own spelling**, so the text
alone says which element is stored and nothing is told apart by context.
**Every box is a call** (owner, 2026-10-27: "i thought we only use functions so GT(temp>80) and GT_EN(EN= …"),
the 14 keyword operators included: `GT(temp, 80)`, `ADD(i, j)`, `AND(a, b, c)`, `NOT(a)`. An extensible box is one call
with all its inputs, a nested box a nested call, so brackets carry no meaning and the operator-chain rule below is
gone. Infix `a AND b`, `a OR b`, `NOT a` remain only for what the LD toolbox draws as contacts (series, parallel,
negated contact); a drawn AND/OR/NOT box in LD is the call. FBD has no contacts, so FBD is calls only.

**An enabled box is its own function, `<name>_EN`** (owner, 2026-10-27: "chaining EN blocks goes through the enable
out … chaining blocks without enable goes through output. so the return value is diff."). A call's return value is
the line that leaves the box toward the next box: a plain box's value, an enabled box's ENO. One name cannot return
both, so the box and the box with EN/ENO are two functions, as they are two toolbox elements. `<name>_EN` takes `EN`
first, then the box's pins as stored (positional for a built-in, formal otherwise), returns ENO (comparisons too), and
its value leaves through `OUT =>`. A chain nests exactly as drawn. ENO is wired when the return is used and not wired
when the call is a statement (the probe's 3 ENO gaps close). A callee that declares its own `EN` (55 library POUs)
keeps `f(EN := …)` as its own pin; `f_EN(…)` is the enabled box, so the clash is gone. The LSP knows every one of these
functions as it knows LIMIT (`frontend/types/builtins.ts`): no library file, no namespace, no network rule. CODESYS ST
refuses the operator call form and EN/ENO (1.2), so the exec twin rewrites both (infix; the IF of 1.3).

```
tooHot := GT(temp, 80);
ok     := GT_EN(EN := auto, temp, 80, OUT => alarm);
run    := AND(start, NOT(stop), ok);
done   := MOVE_EN(EN := MOVE_EN(EN := c, 1, OUT => x), 2, OUT => y);
GT_EN(EN := auto, temp, 80, OUT => hot);          // ENO not wired
```

(A same-name variant, `GT(EN := …, ENO => w)`, was considered and dropped the same day: its return value would depend
on whether `EN` is passed, and chains would need a wire per link.)

This overrides the "Boxes are their ST form" choice, the operator rows of the mapping table, the bracket edge case,
and the probe's "an enabled comparison returns its value".

This replaces every `IF en THEN …` row below (EN, EN chain, result pin, ENO by value, enabled comparison). The same
rule spells the stored members below where the toolbox has its own element (contact vs drawn box: infix vs call;
negated/edge contact, negated/edge coil: 3.0 measures the toolbox and fixes their spelling).

### Measurements (1.4)

CODESYS 3.5.21.40 64-bit, `ide.ps1 up -Instance network-text-st -NoBuild` on a fixture copy, closed after. 42 PROGRAMs:
37 built as NWL objects with the calls the shipped writer makes, 5 ST-only, each beside 1 to 3 candidate ST twins, all
called from PLC_PRG and run 10 scans in simulation on one stimulus (a, b, c, en, i per scan). Per scan the run reads
the outputs and a call log: every helper (an FB, a BOOL and an INT function, a PROGRAM) appends its id to one global,
reset before each program call, so a trace shows which boxes ran and in what order. Scratch scripts and raw traces in
the session scratchpad (`m14/`), not kept.

- Parallel, the corpus shapes (16 BoxShortCircuit cases: 12 shapes holding a box, 3 of them built twice for the rule twin, 1 pure; 1 Sequential): a branch that holds a box runs (all its boxes, in tree order,
  inner first) on every scan EXCEPT when the feed and a branch without a box are both TRUE. With the feed FALSE it
  runs. A TRUE box branch does not skip a later box branch, and branch order does not matter. This is 1.3's rule
  too: there the box had EN on the rail (the feed), so it ran only when `en AND NOT a`. The 12 box shapes
  (a no-EN function last, first, inside a contact series, with no feed; a no-EN FB beside `TRUE` (lenze's TOF) and
  beside a contact; two FBs in an EN chain, in a series and nested; two box branches before and after the contact): the twin
  `IF NOT (en AND a) THEN t := f(x := b); END_IF; out := en AND (a OR t);` is equal on 9 of these 12 shapes, and the
  other 3 (the function first, the FB beside a contact, the nested FBs) follow the rule in their call logs. Plain
  `out := en AND (a OR f(x := b));` calls `f` on every scan (twin differs). The pure branches (an enabled comparison with EN
  on the rail beside a self-hold, a Sequential `LE`) equal `out := en AND ((i > 3) OR out);`.
- Enabled box without ENO, consumed by value (9 cases). Under an Assign, every box runs as
  `IF en THEN x := <box>; END_IF` (the target holds when EN is FALSE): AND, OR, a BOOL function, an INT function, ADD.
  A comparison is FALSE when disabled, also as another comparison's EN: `LE[EN := GE[EN := en](i, 3)](i, 6)` equals
  `out := en AND (i >= 3) AND (i <= 6);`. Any other enabled box inside another box (AND in OR, a BOOL function in AND,
  SUB in ADD, ADD in GT, an INT function in ADD) does not build: "A box with EN can be used for comparison operators
  only." 0 in the corpora.
- `=> ???`, built as the corpus stores the four (output names `['ENO']`, slots `[null, '???']`): builds clean and runs
  as the plain call, the slot ignored: `IF en THEN f(x := a); END_IF` (a BOOL function: Mach1_MIDS's `Alarms_V5_1_100`)
  and `p(x := a);` (a PROGRAM stored as `CallType Function`, EN unwired: AHWF's `SideCorrection`). 1.3's probe, which named the slot, does
  not build: the slot is extra (past the names), not a result pin.
- Call order in one tree: `out := AND(f(a), s1(b).Q)` and `AND(s1(b).Q, f(a))` both call `s1` before `f` (twin
  `s1(IN := b); out := f(a) AND s1.Q;`). CODESYS calls a tree's FB boxes before it evaluates the tree. Two items run
  in item order.
- An assignment is an ST expression in CODESYS (5 ST cases, builds and runs as the 1.3 twins):
  `out2 := (out := a) AND b;`, `out2 := b AND (out := a);`, `out2 := (eno := out := a) AND b;`,
  `out2 := (out S= a) AND b;` (the value is `a`), `cnt(IN := (out := a));`.
- Counted on the recorded CODESYS archives (`test/fixtures/nwl-corpus`): 139 Demux definitions, every one read in its
  network and after it; none read without one.

**Evidence.** The 1.3/1.4 probe scripts and raw traces were scratch and are not in the repo. Every case above and in
1c is listed by its stored shape and its twin, so 2.4 rebuilds each one as an exec case (oracle 3). Until then, three
of the twelve Parallel box shapes (the function first, the FB beside a contact, the nested FBs) rest on call logs
only: their twins differed, so the rule is unproven there until an exec case with an equal twin exists.

### Measurements (1c)

Same setup (`ide.ps1 up -Instance network-text-st -NoBuild -CodesysCulture en`, closed after), 9 NWL-built PROGRAMs
beside 2 to 3 ST twins, 10 scans, outputs and call log per scan. Helper FBs: `NtsEnFb` declares `EN : BOOL` (input)
and `ENO : BOOL` (output) itself, body `seen := EN; ENO := EN AND IN; Q := IN;`; `NtsEnoFb` declares only `ENO`, body
`ENO := NOT IN;`. The bodies set ENO apart from EN, so a trace shows whose ENO the network reads.

- A callee that declares EN/ENO, built as the corpus stores WSM (box `En`/`Eno` false, input names `[EN, IN]`,
  output names `[ENO, Q, seen]`): the box is called on EVERY scan, its EN pin passes into the declared input, and
  the value read is the callee's own ENO. Equal: `ef(EN := en, IN := a, seen => out2, ENO => t); out := t;`. The 1.4
  enable twin (`IF en THEN ef(…); t := TRUE; …`) differs. With EN on the rail (AHWF's shape, `ENO AND b`), equal:
  `ef(EN := TRUE, IN := a, seen => out2, ENO => t); out := t AND b;`; leaving EN out (the rail as no pin) differs
  (`out` FALSE on every scan). So a pin on the bare rail is TRUE, the shape of all 7 corpus unwired pins.
- The same callee in a box that shows its own EN/ENO (`En`/`Eno` true): the box's enable wins. The callee is called
  only when `en`, its declared EN input is never set (`seen` FALSE), and ENO = EN. Equal: the 1.4 enable twin.
  CODESYS builds both shapes.
- A callee that declares only ENO, built as the corpus stores Dryer (`En`/`Eno` false, output names `[ENO, …]`, the
  box read at slot 0): the value is the callee's ENO. Equal: `eo(IN := a, ENO => t); out := t;`; `out := TRUE` differs.
- So the enable is the box's stored `En`/`Eno` flags, not a pin named EN/ENO. On the five CODESYS archives the two
  agree on every box but WSM and Dryer.
- Parallel (BoxShortCircuit, feed `en`, one branch `c`) with a side effect and no call on the other branch: a
  result-pin `ADD[EN := rail](o, 1) => o` follows the measured skip rule (equal:
  `IF en AND NOT c THEN o := o + 1; END_IF; out := en;`; the 1.4 call-free twin, which increments every scan the feed
  is TRUE, differs). A coil on the branch (`(out2 := a)`): CODESYS drops the coil. `out2` stays FALSE on every
  scan (also at scan 2: `a` and `en` TRUE, `c` FALSE), and `out` equals `en AND (a OR c)` on all 10 scans (computed
  from the stimulus, not run as a twin). The three twins run (the assignment expression, the guards
  `NOT (en AND c)` and `en AND NOT c`) all write `out2`, so they differ. The probe built this shape (an Assign as a
  Parallel branch) through the API; whether CODESYS's own editor can store it was not checked.
- Labels. ST builds a label with no statement after it (`…; l2:` at the end of the body) and two labels in a row
  (`l1: l2: out2 := c;`). Both run as the networks they come from (a jump to a labelled empty last network; a
  labelled empty network before a labelled one). A jump to the label of a disabled network does not build in
  CODESYS ("No such label 'LX' within the scope of the JMP statement"): the label belongs to the disabled network,
  which is not compiled. The two twins run both kept `lx:` (on the next network's statement) and built clean, so
  neither is that network's twin; a twin without the label was not run.

### The mapping

| NWL | Plain ST |
|---|---|
| leaf, negated leaf | `a`, `NOT a` |
| AND / OR, contacts or drawn box | `a AND b`, `a OR b` |
| extensible operator box (AND OR XOR ADD MUL) | one unbracketed chain is one box: `a AND b AND c`; brackets nest: `(a AND b) AND c` |
| other operator boxes | infix: `i - j`, `i > 3`, `i MOD 2`; a chain nests left: `i - j - k` |
| NOT box | `NOT (a AND b)` |
| built-in operator | positional: `SEL(g, a, b)`, `x := MOVE(v)` |
| function | formals as stored: `f(IN := a, o => y)` |
| FB box | a statement before the item that reads it: `t1(IN := a, PT := T#1S, Q => w1);` |
| box at the root | a call statement: `f(IN := a);`, `t1(IN := a);` |
| coil, set, reset, several targets | `x := v;`, `x S= v;`, `x R= v;`, `x := y := v;` |
| mid-rung coil | `out2 := (out := a) AND b;` |
| Demux | a wire read twice or more: `w1 := a AND b;`, or over an FB box `t1(CLK := a, Q => w1);`, then `w1` at each read; the name listed on the network's `%WIRES` line |
| EN (the box's stored `En`) | `IF en THEN f(IN := a); END_IF` |
| EN/ENO pins the callee declares (`En`/`Eno` false) | formal pins: `IDB_WSM(EN := TRUE, IN := a, ENO => w1);` |
| input pin on the bare rail (Terminator) | `TRUE`: `f(x := TRUE)`, `t1(IN := TRUE)` |
| EN chain | the next box in the same IF: `IF en THEN x := MOVE(v); y := MOVE(x); END_IF` |
| result pin wired (130) | `IF en THEN x := v * 10; END_IF` |
| ENO read by value | `IF en THEN t1(IN := a); w1 := TRUE; ELSE w1 := FALSE; END_IF` |
| enabled comparison read by value (40) | `IF en THEN w1 := i > 3; ELSE w1 := FALSE; END_IF` |
| Execute box | `%EXECUTE` … `%END_EXECUTE` around its ST, inside its EN `IF` when EN is wired |
| Parallel, no side effect on a branch (no call, no output wired to a variable, no coil) | the OR it computes: `out := en AND ((i > 3) OR out);` |
| jump, return | `IF c THEN JMP l; END_IF`, `IF c THEN RETURN; END_IF`, `JMP l;` |
| network | `%NETWORK "title"`, then `%DISABLED`, then `%WIRES w1, w2`, then `//` comment lines, then the label `l:` (also on an empty network: `l:` with no statement after it builds, 1c) |

**Choice.**
- Boxes are their ST form: the 14 keyword operators infix (1.2: no call form), every other box a call. An FB box is
  a statement before the item that reads it, which is CODESYS's own order (measured: FB boxes run before their tree).
- EN is the box's stored `En`/`Eno` flags, never a pin's name. A pin the callee declares as `EN` or `ENO` (WSM,
  Dryer, 55 library POUs declare ENO) is an ordinary formal, `EN := …` / `ENO => w1` (1c: a call every scan, the
  declared input set, the callee's ENO read). CODESYS ST refuses `EN :=` on a callee that does not declare it (1.2),
  so the text has one meaning. The model reads the flags (2.2): the current reader keys EN/ENO on the pin name
  (`NetworkModel.HasEnableSlot`/`HasEnoSlot`), which reads WSM as an enabled box; a rebuild of that network writes
  `En` true, and CODESYS then stops passing the declared EN (1c: `seen` FALSE).
- An enabled box (`En` true) is the IF that runs it (1.3: equal on all 8 kinds). A value that comes out of an enabled box goes through a
  wire set in both branches: `TRUE` for its ENO (ENO = EN on an enabled box, 1.3 and 1c), the comparison for an enabled comparison (FALSE when
  disabled, measured). An enabled non-comparison box read by value exists only under an Assign (CODESYS refuses it
  elsewhere), where it holds, so it is `IF en THEN x := <box>; END_IF` with no ELSE.
- A wire is a name on its network's `%WIRES` line, so the text alone says what is a wire: a scope change outside the
  network (a GVL or the POU's VAR block gaining `w1`) can never turn a wire into a coil. A wire name that is also
  declared in reach is refused by name (LSP and push), never read as the variable. The writer numbers wires `w1`,
  `w2`, … across the body, skipping names in scope, so one name has one type: its definition's type. The LSP and the
  exec twin declare them (the twin in `VAR_TEMP`); the POU's declaration is never touched. A wire is defined once, before it is read.
  Three definitions: `w1 := <tree>;`, `Q => w1` (or `ENO => w1`) on an FB call, and `w1 := …` in an enabled box's IF.
  One rule says what a wire is, for all three: a wire read twice or more is a Demux over its definition; a wire read
  once is the box itself, standing where it is read (an FB box or an enabled box, which have no expression form).
  This is where CODESYS stores a split: all 139 archive Demux definitions are read 2 to 6 times, none once.
  `w1 := <tree>;` read once is refused by name: that tree is written inline. Archive Demux definitions over a box:
  FB 4 (`R_TRIG` ×3, `Dryer`: `Q => w1` / `ENO => w1` read 2 to 6 times), enabled MOVE 1, enabled ADD 1, other
  functions 8, AND 48, OR 5.
- An item is one root statement: an assignment (`:=`, `S=`, `R=`, `a := b := v`), a call, an EN `IF`, or a jump,
  after the FB calls and enabled-box IFs whose wires it reads. Items run in network order.
- A network label is an ST label, the network's first statement (`l:`), because it is code: the jump's target.
  `%NETWORK`, `%DISABLED` and the comment are not code, so they are `%` lines and `//` lines.
- The LSP subset (one check, refused by name): the statements above; a name assigned in a network is either declared
  in reach (a coil) or on its `%WIRES` line (a wire), never both; an IF only in the three forms above (EN, an
  enabled value with ELSE, a jump), never nested; no FOR, WHILE, REPEAT, CASE or ELSIF; no comment after the first
  statement. Full ST only between `%EXECUTE` and `%END_EXECUTE`. A `%DISABLED` network is checked for the subset,
  not for types, and is not part of the compiled body: CODESYS does not compile it, so its label is no jump target
  and a `JMP` to it is the error CODESYS gives ("No such label … within the scope of the JMP statement", 1c). The
  exec twin drops a disabled network's text, its label included.
- Oracles: (1) model → text → model is identical on the 394 corpus networks, 121 cases and 130 TC archives, except the
  stored members below; (2) the LSP gives the C# reader's refusals on the case set; (3) exec: each corpus body's
  text builds as a called ST twin with 0 errors, and the 1.3, 1.4 and 1c cases become exec cases with equal traces.

**Rejected:** a call form for operators (syntax error, 1.2). EN as a `%` line (the compiler would run the box
unconditionally). A `%LABEL` line (a label is code, and ST has one). ENO read as the IF's condition repeated
(ambiguous with a leaf of that name, e.g. `split4`). A wire as "a name the scope does not declare" (the same text
changes meaning when a declaration appears elsewhere). EN/ENO keyed on the pin name (WSM and Dryer run as plain calls,
1c). Blank lines as item boundaries (layout with meaning). Inline FB
calls (no ST form). Pragmas `{…}` (keywords in braces, unmeasured). `en AND (i > 3)` for an enabled comparison (runs
the same, measured, but reads back as a series contact). A wire for a mid-rung coil (the assignment expression is the
node itself).

**Stored members, not spelled.** Each runs the same as its spelling (1.3, 1.4); pairing keeps it on an unchanged
network, and RebuildLoss names it on a rebuilt one.
- contacts vs a drawn AND/OR box (15 drawn);
- where a negation is stored: a NOT box over a leaf, a negated pin, coil or EN vs a negated leaf (3 NOT boxes, 6 pins;
  `NOT a` reads back as a negated leaf, `NOT (<tree>)` as a NOT box);
- EN on the rail (unwired at the root, 37; the feed on a Parallel branch) vs no EN;
- an Assign over an enabled box without ENO vs a result-pin box (0; `IF en THEN x := … END_IF` reads back as the
  result pin, the 130 form), and a result-pin box with EN on the rail vs an Assign over the box (8 of the 130:
  `x := v * 10;` reads back as the Assign);
- a coil, a Demux or an input pin fed by the bare rail vs `TRUE` (4 + 4 + 7);
- an edge flag on a coil (0; CODESYS runs a plain coil);
- a side-effect-free Parallel vs the AND/OR it computes, and its Mode (8 Parallels in 7 networks);
- an extra output slot past the names, including the four `???` ones (`RebuildLoss.ExtraOutputSlots`, as today);
- an operand that holds an ST expression (`INT_TO_WORD(x)`, `a.Speed*10`; 20 lenze networks) vs the boxes it reads
  back as: it runs the same (owner, 2026-10-27, gap probe 911876691e);
- TwinCAT's unconditional jump/return value stored as an empty leaf vs the rail CODESYS stores (`JMP l;`; 2 TwinCAT
  archives).

**Gap probe (911876691e, branch `worktree-agent-a334baa03b87b3d4b`):** a prototype writer and reader round-tripped
every recorded network: corpus 355 of 394 (90.1%) identical or stored members only; TwinCAT archives 96.6%. With the two
stored members above, ~97%. Open-point choices it made, adopted: an enabled keyword operator is `ADD(EN := c, x, 1,
OUT => x)` (EN first, then positional pins as stored); an enabled comparison returns its value, every other enabled box
returns ENO; an enabled FB is `t1(EN := c, IN := a, ENO => w)`. Whether an enabled box has an ENO is read from the
callee's declaration (3 accept cases, 0 corpus), so the reader takes the callee signatures the LSP already has.
An unconnected input pin (Leaf `""`, 10 lenze networks) is measured in 2.1 (candidate: the pin left out, restored from
the callee's declaration).

**Refused by name** (`%UNSUPPORTED`, kept on push):
- an enabled non-comparison box read by its value anywhere but as a coil's value (0): inside another box CODESYS does
  not build it; the same refusal covers a read through a wire read twice or more and a jump's condition (unmeasured in
  CODESYS, 3.0 measures it), so writer, reader and LSP draw one line;
- `X_EN(…)` where anything in reach (a POU, an instance, a variable) is named `X_EN` (0; the corpora declare a variable
  `M_EN` 5 times and no box `M`): the text would have two meanings;
- the lone empty leaf (1): niche, accepted loss (1.1).
- a box written before its item (an FB, an Execute box, an enabled box read by value) that reads a wire its own item
  defines inline (`(w1 := …)`): the text would read the wire before it is set, and CODESYS's order for that shape is
  unmeasured; niche: accepted loss (0 occurrences in the corpora), 3.0 measures it.

**Open for the owner** (the owner's rule: every stored shape gets a spelling). Until the owner decides, each is written
`%UNSUPPORTED` and kept on push. Each is a regression against v2, which spells it today:
- A Parallel with a side effect on a branch: 5 in the corpus, all calls, all lenze-mid (TOF, TON, 3×
  `fc_CamC_CC_UDT`), whose 5 networks hold 4 more side-effect-free Parallels. v2: `BRANCH … SHORTCIRCUIT`
  (`Mach1_Drives.pou:87`). The measured twin for a call or a wired result pin is
  `IF NOT (en AND a) THEN t1(IN := en, Q => w1); END_IF; out := en AND (a OR w1);`, plain ST that runs the same, but
  reading it back means recognising the guard and the OR as one node. A coil on a branch: CODESYS drops it and runs
  the OR (`out := en AND (a OR c);`, 1c), so a text that runs the same cannot keep the coil; 0 in the corpus, built
  through the API only (whether the editor stores it is unchecked).
- An edge contact or leaf (1 / 3 / 3). v2: `R_EDGE NOT clk`. Candidate: 1.3's equal twin,
  `rt(CLK := a); out := en AND rt.Q;`, with `rt` a Volt-numbered instance like a wire.
- The `???` instance (4, all in one POU excluded from build). v2: `??? : TYPE(…)`, added so that POU can be pushed
  back; this design takes push away from it.
- An edge on a pin, an edge or negation on a box output or EN (0 / 6 / 0). v2: `TON(NOT IN := v …)`.
- The negated coil and the edge coil (0 / 5 / 3) run the same as `x := NOT a;` / `x := a;`, but a rebuild loses the
  coil's own flag (RebuildLoss), where v2 spells it (`NOT x := a;`, `R_EDGE x := a;`).

**For the owner** (grammar edge cases, not doc content):
- Brackets carry meaning in an operator chain (`a AND b AND c` one box, `(a AND b) AND c` two). An ST formatter that
  drops them changes the stored tree, not what runs.
- The stored-member list widens today's RebuildLoss by six rows.
- `%EXECUTE` / `%END_EXECUTE` is the only `%` pair; `%WIRES` is the only `%` line that names code.
- How often a wire is read decides its node: twice or more a Demux, once the box itself. It follows CODESYS (no
  archive split is read once), but a Demux read once (0 of 139) has no spelling, and `w1 := <tree>;` read once is
  refused.
- A disabled network's label is not a label of the body (CODESYS: "No such label"), so the LSP's jump resolution
  skips `%DISABLED` networks.

**Migration:** none here. 2.1 writes this form behind `NetworkTextSwitch`, and v2 stays until 3.2 deletes it.

## 2.1–2.2 As built: what the writer and the reader settled

The revision's rules, as `StNetworkWriter` / `StNetworkReader` (`Volt.Engine/Format/Network`) apply them. Three points
the revision left open were settled by the corpus; each is listed with why.

- **Contact or drawn box** is the stored `OutputParam.Names` (1.3: a contact stores none, a drawn AND/OR one unnamed
  output), not the body's language: 1.3 found a contact OR in an FBD-view body (pro2193 `SetAlarm`), so "FBD is calls
  only" would rebuild it as a box. A model with no stored names (a text read of v2, the accept cases) is contacts in LD
  and boxes in FBD. The reader states the element it read (`OutputParam.Names` `[]` for infix, `['']` for the call), so
  a pulled text pulled again is the same text (`CodesysNwlCompletenessOracleTests`).
- **An enabled box read by its VALUE** (CODESYS's 40 enabled comparisons, which store no ENO, 1.3) cannot be the call's
  return, which is ENO. It is a call statement whose `OUT =>` defines a wire, the call standing where the wire is read:
  `GT_EN(EN := w1, i, j, OUT => w2); MOVE_EN(EN := w2, j, OUT => x);`. Read that way the box shows no ENO; read by its
  return, or at the root, it shows ENO. The two stored members this made spellable are gone from the list: the
  "Assign over an enabled box without ENO" (now `MOVE_EN(…, OUT => w1); x := w1;`, read back exactly) and the NOT box over
  a leaf (`NOT(a)` against the negated contact `NOT a`).
- **Brackets carry meaning between contacts only**: an unbracketed chain of one contact operator is one box
  (`a AND b AND c`), `(a AND b) AND c` two; every other box is a call, so a call's brackets are its own. Infix outside
  the contacts (`i > 3`, `a + b`, `a XOR b`, `&`) is refused by name by the reader ("every box is a call"), and so is
  `NOT` before a call or a wire (the NOT box is `NOT(…)`). An operand holding an ST expression (the stored member) is
  read as ST, infix and all, only where it is that member (`StNetworkReader.ExpressionTree`).

**Wires are named across the body** (1.4's choice, which the first build missed: it named a wire `w<VarId>`, and VarIds
repeat from network to network): `w1`, `w2`, … in the order the text defines them, skipping every name the body's
operands, targets and instances use and every name in reach, so one name is one wire and the writer never refuses a
wire's name. The reader refuses a `%WIRES` name declared in reach or named by an earlier network, and `w2 := w1;` over a
box read once through `w1` (the box names `w2` itself: `GT_EN(…, OUT => w2)`), so one model has one text. The vendor's Demux
VarId is not spelled: a read numbers each network's Demux nodes 1, 2, … by where their definitions stand, and the
oracle compares Demux nodes by that position (a stored member of the model, kept by pairing on an unchanged network;
3.1 decides what a rebuild allocates).

**Oracle 1 (round trip), measured:** CODESYS corpora 388 networks: 294 identical, 83 stored members only, 11
`%UNSUPPORTED` (5 Parallels with a side effect on a branch, 4 `???` instances, 1 edge contact, 1 lone empty leaf), 0
gaps. TwinCAT archives 153: 140 identical, 8 stored members only, 5 `%UNSUPPORTED` (3 edge contacts, 1 Demux read before
its defining item: `Vn_fanout_two_wires`, 1 target `r`, which is no ST variable name), 0 gaps. Accept cases 129: 68
identical, 23 stored members, 38 `%UNSUPPORTED`, 0 gaps (each a 3.0 spelling). The v2 model oracle, run on the corpus
bodies now pulled as plain ST, reads all 392 networks; the 2 it cannot rebuild are lenze-mid's 1c boxes (IDB_WSM,
IDB_Dryer: a plain call read through its own ENO), which v2 has no spelling for and plain ST has.

**2.1 measured** (CODESYS 3.5.21.40, fixture copy): a CTU whose RESET pin is unconnected (Leaf `""`) runs equal to the
call with RESET left out and different from `RESET := FALSE`, so the writer leaves an unconnected pin out.

## 2.3 As built: the LSP reads a network body as ST

- **Form dispatch, not a grammar.** A body whose first line is `%NETWORK` is plain-ST network text
  (`frontend/syntax/format/network-form.ts`); the `%` lines are trivia, the statements go to the ST parser. No network
  lexer or keyword list: the one token step (`frontend/syntax/network/plain-st.ts`) makes a box call whose head is an
  ST keyword (`AND(`, `GT(`, `MOVE(`, `NOT(`) an identifier, turns `%EXECUTE … %END_EXECUTE` into a call statement, and
  leaves a `%DISABLED` network out of the compiled tokens (its label is then no jump target, as in CODESYS).
- **Wires are network-scoped VAR_TEMP symbols** (`frontend/symbols/network-scope.ts`), typed by the call that defines
  them (`types/infer/network-call.ts`); `<name>_EN` and `EXECUTE` are network boxes returning BOOL.
- **The ST parser learned three bracketed forms** CODESYS accepts in any ST body (`(x S= v)`, `(x R= v)`,
  `(a := b := v)`): recorded as grammar fixtures (`expr_inline_assign_chain/set/reset`), not network-only syntax.
- **One subset check**, `network-plain-st` (`analysis/checks/network/_plain-st.ts`), refuses what a network may not hold,
  by name, on the same case set the C# reader refuses (`test/fixtures/network-text-st/{accept,refuse}`: 121 accept, 33
  refuse; C# and LSP agree on every case).
- The transpiler refuses a plain-ST network body by name (`graphical-body`); the formatter keeps it verbatim.

## 2.4 As built: the exec oracle

Each corpus body has an exec twin: the CODESYS ST that runs as the network (`test/support/network-twin.ts`: contacts
infix, `<name>_EN` an IF with ENO, an FB's output wire read as `inst.Q`, `%EXECUTE` an IF, a disabled network dropped).
`scripts/record-network-twins.ts` pushes every twin into the corpus project's own IDE (a copy) and builds it;
`test/corpus/corpus-twins.test.ts` holds the build to the project's recorded one. Measured: lenze-mid 40 bodies,
pro2193 2, awa-palletizer 1, bakon-nano 1, 44 bodies, 0 errors beyond the recorded builds. The 2 TwinCAT bodies are not
compiled live: TwinCAT has no route that changes a body's language in place (DIALECT N24). Behaviour: the exec cases'
traces, NWL against the twin, are equal on every spelled case (N24 20/20, 1.4 6/6, 1c 6/6) (a scratch run, not committed; the twin's rules are pinned by `test/support/network-twin.test.ts`); the Parallels with a side
effect stay `%UNSUPPORTED` (3.0).

**For the owner — edge cases this step met (each a grammar question, not doc content):**
- an enabled box read by its value has no ENO, so it is a call statement with `OUT => w` rather than a return;
- brackets carry meaning between contacts only (`(a AND b) AND c` is two boxes);
- `s`/`r` are no ST variable names: a target so named is `%UNSUPPORTED`;
- an empty LD body (no network) still goes through the v2 reader until 3.2.

## 3.0 As built: the shapes 2.x left `%UNSUPPORTED`

Each element the IDE stores and the read-only text could not spell, with the measurement its spelling rests on:

| Stored | Plain ST | Measured |
|---|---|---|
| LD parallel branch (both modes, fed or at the rail) | `BRANCH(FEED := f, b1, b2)`, `BRANCH_SHORTCIRCUIT(…)`; no `FEED` at the rail | 1.4 (12 shapes): a box branch runs unless the feed and a box-free branch are both TRUE; the twin writes that guard, the FB statements a branch reads inside it |
| edge on a contact or a box output | `R_EDGE(x)`, `F_EDGE(NOT x)`, `R_EDGE(x AND y)` | 1.3: `R_TRIG` on the value, called every scan |
| `???` instance | the box called by its FB type: `Axis(xEnable := go)` (the scope says it is a block type) | the IDE's own build error for `???`; the 4 corpus boxes sit in a POU excluded from build |
| box showing ENO, no EN | `f_ENO(IN := a)`, its return the ENO | recorded `rcc_network_eno_function_without_en` (builds) |
| empty item (CODESYS's empty operand; the rail a stored member) | `;` | 1.2: `lbl: ;` builds |
| Demux read once, never, or before its definition | `w1 := …;` and `w1` anywhere in its network | twins declare wires as `VAR`, so a read before the definition is the previous scan's |
| several unnamed outputs; `ENO =>` a variable on an enabled function | `MOVE(0, OUT => a, OUT => b)`, `MOVE_EN(EN := c, 7, ENO => lamp, OUT => x)` | each `OUT` the next free slot, as the reader numbers them |
| an edge on a pin or EN | the edge on its value (a stored member, as the negation) | |
| a box type stored in lower case (`and`) | `and(a, b)` | |

Oracle 1 now: CODESYS corpora 388 networks, 301 identical, 87 stored members, **0 `%UNSUPPORTED`**; TwinCAT archives 153:
143 / 8 / 2; accept cases 129: 97 / 23 / 9; 0 gaps. Twin builds (oracle 3) re-recorded live for lenze-mid (40 bodies) and
pro2193 (2): 0 errors. The six v2 accept cases that used `s`/`r` as incidental names (CODESYS ST takes neither for a name,
1.2) were renamed (`go`, `u`, `p`, `re`); the v2 unnamed-instance case states its block type (`fb Axis`).

**Niche, accepted loss:** TwinCAT's `Vn_fanout_two_wires` archive stores one Demux defined twice and the other never (0 in
the corpora).

**Decided by the owner (2026-10-28), to build in 3.0:**
- (a) a jump that shares its value with coils, or sits in a tree: the jump is a function on its value, `JMP(label,
  value)`, an item like a coil (`lamp := c; JMP(done, c);` on one value). Measure in CODESYS that the twin runs as the
  network.
- (b) an enabled box with EN and no ENO: `X_ENONLY(EN := c, …)`, returning its VALUE. `X_EN` stays the box with EN and
  ENO (returns ENO), `X_ENO` the box with ENO and no EN. This retires the context rule "an enabled box read by its value
  has no ENO".
- (c) a name ST cannot write (`Then`, a backtick name, TwinCAT's coil `r`): niche, accepted loss, refused by name
  (CODESYS ST refuses those names too).
- (d) an FB instance no declaration holds: written as `???` is, a call of its stored FB type.
- Also: an unconnected pin on a FUNCTION box (`MUL(m, , 6)`), measured like the FB pin in 2.1; if it runs as the pin left
  out, that is its spelling and the deleted e2e case (`real-project-shapes` "a box with an unconnected input") comes back.

**Built (2026-10-28), each measured live** (CODESYS 3.5.21.40, `test/e2e/graphical/st-spellings-run.test.ts`: the network
and the LSP's twin run side by side on a 16-scan stimulus, every output equal on every scan):
- (b) the suffix names the EN and ENO a box shows, and its return follows: `X_EN` / `X_ENO` return ENO, `X_ENONLY`
  returns the value (`lamp := GT_ENONLY(EN := c, i, 3)`, `MOVE_ENONLY(EN := d, j, OUT => y)` at the root,
  `t1_ENONLY(EN := c, …, Q => w1)`). A box returning ENO is read by it: its value reaches a variable through `OUT =>`,
  never a wire. Measured: an enabled MOVE showing ENO, built read at its value slot, is held by CODESYS read by its ENO
  (its coil then does not build), so that shape has no spelling (`an enabled box read by its value showing ENO`, 0 in the
  corpora). The 40 enabled comparisons of the corpora now read `GT_ENONLY(…)` where they stand.
- (a) the jump and the return are functions on their value: `JMP(label, value)`, `RETURN(value)`, an item or a node in a
  tree, the value handed on; on the rail ST's own `JMP l;` / `RETURN;`. A network holds no `IF`. A coil and a jump on one
  value are one item per target, the coils first (a stored member; a value holding a box, a wire or an edge is not
  repeated: `a jump sharing a value that holds a box`, 0 in the corpora). Measured: a jump inside a tree
  (`x := JMP(l, c) AND d`) builds and runs as its twin (the jump taken before the tree's coil is written).
- (d) an instance no declaration holds is written as `???` is, its FB type called (a stored member; both do not build).
- (c) a name ST cannot write stays refused by name: `an operand named like an ST keyword`, `an operand that is no ST
  expression`, TwinCAT's coil `r` (niche, accepted loss).
- The unconnected pin on a FUNCTION box does not run as the pin left out: measured, CODESYS compiles it as `???`
  ("Identifier '???' not defined"), so no text runs as it. It stays refused by name (`an empty operand on a pin`, 0 in
  the corpora); the deleted e2e case does not come back.
- `JMP Done S= c` (a set or reset on a jump) stays refused by name: the IDE's jump element has no set or reset, a v2
  grammar shape (0 in the corpora). For the owner: whether to spell it at all.

Oracle 1 after 3.0: CODESYS corpora 388 networks: 301 identical, 87 stored members, 0 `%UNSUPPORTED`; TwinCAT archives
153: 143 / 8 / 2 (the fan-out archive, the coil `r`); accept cases 129: 100 / 26 / 3 (`Then`, a backtick name, the set
jump). Twin builds re-recorded live for lenze-mid: 0 errors.

**Was open for the owner (the decisions above answer each):**
- a jump among coils or jumps on one value, a jump with `S=`, a jump nested in a tree (4 accept cases): ST has a jump only
  as a statement;
- an enabled box without ENO at the root or read by an FB output's name (2 cases): `X_EN` returns ENO. Proposal: a suffix
  per stored EN/ENO pair, the EN-only box returning its value, which would also retire the context rule "an enabled box
  read by its value has no ENO";
- an operand ST cannot name: an ST keyword (`Then`), a backtick (`a``b`), and TwinCAT's coil `r` (1 archive);
- an FB instance the declarations do not hold (1 case): its type is in no text.

## 3.1 As built: the push reads plain ST

The push validates a body through `StNetworkGate` (read, derive, write back canonical); `NetworkPairing`, `PushedText` and
the drivers' change gates compare plain-ST models. A network's comment is its `//` lines before the code, its label the
first code line. Wires are numbered `w1, w2, …` across the body. Measured live: CODESYS 3.5.21.40 e2e 557 pass / 0 fail;
TwinCAT 4024 e2e 541 pass and one fail fixed (an Execute box without EN was built showing EN over no EN pin;
`TcArchiveBuilder` shows EN only where the box has one, pinned offline), its three Execute suites re-run green.
Deleted e2e case: `real-project-shapes` "a box with an unconnected input" — an empty operand on a FUNCTION's pin has no
spelling (the writer refuses it by name, unmeasured); the FB form stays (`t1();`). `stored-shapes` #9–#14 (jumps among
coils, negated/edge coils) left the push suite: the first wait on the owner (3.0), the others are stored members.

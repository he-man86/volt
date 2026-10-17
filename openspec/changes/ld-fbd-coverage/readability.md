# Network text readability pass — proposal (owner, 2026-10-16)

**One rule: a box is always its NAME. `:=`, `S=`, `R=` are coils only. ST's operator symbols never mean a box.**
The name is what CODESYS writes on the box in the drawing. The model stays v2: one statement per NWL item, no invented
names, every text exactly one tree.

**Simplified 2026-10-16 (owner, "yes put it in"):** brackets are two rules (B5 / P4), one call-form rule (P5), one
open-line rule for `ENO` (P3, which also spells two ENOs into one box), the split's differing type is lost on rebuild
(B6), old spellings are not grammar (P12), each fact stated once; the parallel is `feed BRANCH (a, b)` at every depth
(B8 — no `BRANCH` lines, no `BRANCHES`, no `INTO`). P1–P16 became P1–P13.

## A real network, before and after

Lenze `MainDrive`, network 2. **Today** (with the 2.3 pragma):

```
NETWORK TITLE: "DONE NETWORK 2: Activating main drive"
  VAR_TEMP g174, g175, g176, g177 : BOOL; END_VAR
  g174 := TRUE;
  MOVE(EN := g174, 0, => tInt);
  Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper R= (g174 AND NOT HMI_Var.Test_Prod);
  g175 := (g174 AND Mach1.GenFlags.EnableMainDrive AND Mach1.GenFlags.ConditionsReadyForOperation AND NOT Mach1.GenFlags.StopDriveDirect AND Mach1_AuxData.AllDrivesInLock);
  g176 := (g175 AND Mach1.GenFlags.RunAuto);
  tMainDriveRun :=
  oMainDriveRun :=
  Mach1_Safety.Control.RequestAutoSpeed := g176;
  MOVE(EN := (PARALLEL(MODE := Sequential, IN := g176, NOT Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper, LE(EN := Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper, Mach1_Data.AUTOSPEED, 40)) AND NOT HMI_Var.Btn_Cleaning), Mach1_Data.AUTOSPEED, => tInt);
  MOVE(EN := (GT(EN := (g176 AND Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper), Mach1_Data.AUTOSPEED, 40) AND NOT HMI_Var.Btn_Cleaning), 30, => tInt);
  MOVE(EN := (g176 AND HMI_Var.Btn_Cleaning), 6, => tInt);
  g177 := (g175 AND Mach1.GenFlags.RunMan);
  tMainDriveJog :=
  oMainDriveJog :=
  Mach1_Safety.Control.RequestManSpeed := g177;
  MOVE(EN := g177, Mach1_Data.MANUALSPEED, => tInt);
  RPM_To_DriveSpeed(iEN := g174, iRPM := tInt, oDriveSpeed => Mach1_Data.Drives.MainDrive_VM.Control.DriveMasterSpeed){OutputParam.Types := ['INT']};
END_NETWORK
```

**Proposed:**

```
NETWORK TITLE: "DONE NETWORK 2: Activating main drive"
  split174 := TRUE;
  MOVE 0 => tInt EN split174;
  Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper R= split174 AND NOT HMI_Var.Test_Prod;
  split175 := split174 AND Mach1.GenFlags.EnableMainDrive AND Mach1.GenFlags.ConditionsReadyForOperation AND
              NOT Mach1.GenFlags.StopDriveDirect AND Mach1_AuxData.AllDrivesInLock;
  split176 := split175 AND Mach1.GenFlags.RunAuto;
  tMainDriveRun := oMainDriveRun := Mach1_Safety.Control.RequestAutoSpeed := split176;
  MOVE Mach1_Data.AUTOSPEED => tInt EN (split176 BRANCH (NOT Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper,
                                        (Mach1_Data.AUTOSPEED LE 40 EN Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper))) AND
       NOT HMI_Var.Btn_Cleaning;
  MOVE 30 => tInt EN (Mach1_Data.AUTOSPEED GT 40 EN split176 AND Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper) AND
       NOT HMI_Var.Btn_Cleaning;
  MOVE 6 => tInt EN split176 AND HMI_Var.Btn_Cleaning;
  split177 := split175 AND Mach1.GenFlags.RunMan;
  tMainDriveJog := oMainDriveJog := Mach1_Safety.Control.RequestManSpeed := split177;
  MOVE Mach1_Data.MANUALSPEED => tInt EN split177;
  RPM_To_DriveSpeed(iEN := split174, iRPM := tInt, oDriveSpeed => Mach1_Data.Drives.MainDrive_VM.Control.DriveMasterSpeed);
END_NETWORK
```

## The rules

### B1 — operator boxes are words, infix

```
x := (a + b);                    // today
x := a ADD b;                    // proposed: an ADD box, then a coil

out := GT(a, 40);                // today (or (a > 40))
out := a GT 40;                  // proposed
```
Words: `AND OR XOR ADD SUB MUL DIV MOD GT GE EQ NE LE LT`. One word = one box with n inputs; brackets separate boxes (B5):
```
x := a ADD b ADD c;              // one ADD box, 3 inputs
x := a ADD (b ADD c);            // two ADD boxes
x := a SUB b SUB c;              // refused: SUB takes 2 inputs (same for DIV, MOD and the comparisons — C3)
```
The symbols `+ - * / > < >= <= = <>` are not network text (P12).

### B2 — MOVE: a word, its target an output pin `=>` like every box

```
MOVE(b, => a);                   // today
MOVE b => a;                     // proposed: a MOVE box writing a

a := MOVE(b);                    // today
a := MOVE b;                     // proposed: a MOVE box, then a coil

a := b;                          // a coil, no box (unchanged)
```

### B3 — the enable input is `EN`, after the box

`EN` / `ENO` are IEC's own pin names — what CODESYS writes on the box (a POU variable named `EN`/`ENO` exists — Lenze `Dryer`, `WSM`, 65 library FBs — and is backticked, P1 below)
(`ENABLE` was dropped: 30 distinct corpus FBs have an `ENABLE` input — MC_Power, BLINK, … — 80 declarations across the
five CODESYS corpora, plus an enum value and variables; in the NWL archives one box wires it, lenze-mid's `BLINK`).
```
MOVE(EN := c, b, => a);              // today
MOVE b => a EN c;                    // proposed

ADD(EN := c, x, 5, => x);            // today
x ADD 5 => x EN c;                   // proposed

GT(EN := c, a, 40)                   // today, inside a condition
(a GT 40 EN c)                       // proposed — an enabled comparison is always bracketed (B5)

LIMIT(EN := c, 0, v, 100, => y);     // today
LIMIT(0, v, 100, => y) EN c;         // proposed — a CALL keeps its output pins inside its brackets

t1(EN := c, IN := go, PT := T#1S);   // today
t1(IN := go, PT := T#1S) EN c;       // proposed

MUL(EN := , iRPM, 6, => oDrive);     // today — the empty enable (13 boxes in Lenze)
iRPM MUL 6 => oDrive EN;             // proposed: `EN` with nothing after it

EXECUTE(EN := c) … END_EXECUTE;      // today
EXECUTE EN c … END_EXECUTE;          // proposed
```
Which box an `EN` enables, and where its tail ends: P4.

### B4 — `ENO` reads an open line; `;` ends the item

**One `;` = one NWL item. A line WITHOUT `;` is open: its box's ENO goes to a later line of the item. Each `ENO` takes
the oldest open line above it not yet taken — top to bottom, and left to right within a line.** No `THEN`, no `.ENO`:
```
// ENO → next box (Lenze AHWF; today 4 nested MOVE(EN := …).ENO)
MOVE 175  => VelUnit EN split329 AND TRUE
MOVE 2000 => DecUnit EN ENO
MOVE 750  => AccUnit EN ENO
MOVE 100  => TorqueLimit EN ENO;

// ENO → coil (today: StartAuto := MOVE(EN := split20, 860, => AutoSpeed).ENO;)
MOVE 860 => AutoSpeed EN split20
StartAuto := ENO;

// ENO mixed with contacts (Lenze AHWF N2)
IDB_WSM(iGenflags := Mach1.GenFlags, …) EN
PneumValveTerminalSMC.Pos1B := ENO AND EnablePneumPressurised AND AllDoorsActuallyClosed AND tSprayingValve;

// ENO plus extra logic on the next EN
MOVE 1 => A EN c
MOVE 2 => B EN ENO AND x;

// two ENOs into one box (2R.5: stores and runs): the first ENO takes A, the second B
MOVE 1 => A EN c
MOVE 2 => B EN d
x := ENO AND ENO;

// ENO feeding a parallel (B8)
ioActNumberOfRows MUL iRowHeight => tInt EN split2 AND stDecendTray
tInt ADD iInitialDescentValue => tInt EN ENO
stDecendTray R= ENO BRANCH ((stActHeightElevator GE tInt EN), iPsElevatorDown) SHORTCIRCUIT;

// ENO used twice: CODESYS stores a split point there, so it is a split wire
MOVE 860 => AutoSpeed EN split20
split21 := ENO;

// a jump at the end of a chain
MOVE 1 => x EN c
JMP Done := ENO;

// two items: the box on its own, then B read by StartAuto
MOVE 1 => A EN c;
MOVE 2 => B EN d
StartAuto := ENO;
```
**An enabled box is the root of its line; its value leaves only through `=>` or `ENO`** (CODESYS hands a coil after an
enabled box its ENO, N21): `a := MOVE b EN c;` and `x := a ADD b EN c;` are no text — write `MOVE b => a EN c`, or the
box on its own line and `coil := ENO;`. Moving a whole item (up to its `;`) only reorders items, like moving a rung;
moving one line out of a chain is refused, never silent (P3).

### B4b — jumps and returns are coils; no IF

A jump sits where a coil sits — the rung drives it — so it is written like one:
```
IF a AND b THEN JMP Done; END_IF;     // today
JMP Done := a AND b;                  // proposed

JMP Done;                             // unconditional — unchanged
RETURN := NOT xReady;                 // conditional return
```
With IF gone the text has no ST control statement at all; the words are `EN ENO BRANCH SHORTCIRCUIT JMP RETURN EXECUTE
END_EXECUTE`, the box words, and `:= S= R=`. SEL, LIMIT and every function or FB are calls (P5): `y := SEL(g, a, b);`,
`SEL(g, a, b, => y) EN c;`.

### B5 — brackets: exactly three things, everywhere

A bracket level, and each slot (coil value, EN tail, pin, call argument, split definition, branch), holds ONE box.
Brackets mark exactly:
```
x := a ADD (b ADD c);                 // 1. a word box (or a parallel) that is an operand of another word
MOVE (a ADD b) => x;                  //    — MOVE and BRANCH are words: a word-box feed is bracketed too
(split1 AND bSync) BRANCH (a, b)
x := (a GT b EN c);                   // 2. an enabled comparison, as a value, in every slot
y := (x := v);                        // 3. a nested assignment  (y := x := v;  is two coils)
```
Nothing else — never a slot's whole value:
```
g176 := (g175 AND RunAuto);           // today
split176 := split175 AND RunAuto;     // proposed
t1(IN := (a AND b), PT := T#1S);      // today (28 networks)
t1(IN := a AND b, PT := T#1S);        // proposed: `,` and `)` already end a pin
x := a ADD b MUL c;                   // refused: two boxes on one level
```

### B6 — split points: the name is the VarId, no `VAR_TEMP`

A split point is NWL's `BoxTreeDemux`: one definition node (holding the feeder) and reference nodes elsewhere, linked
by `VarId`. The Demux holds NO type — the type is the feeder's (a box's stored `OutputParam.Types`, a leaf's variable).
```
VAR_TEMP g176 : BOOL; END_VAR          // today: a block, `g` reads as a global, clashes with Lenze's enum G01
g176 := (g175 AND RunAuto);

split176 := split175 AND RunAuto;      // proposed: the definition declares it; 176 IS the VarId (no leading zeros)
split12  := a ADD b;                   // no type is ever written
```
A stored split type that differs from the feeder's is a B7 L member (0 in the corpora; the build ignores it, N25).

### B7 — hidden members: derived; written only where the stored value differs

**The bridge derives every stored member from the text and the declarations (as the editor does). A member is
written only where the stored value differs from that derivation, and then in a natural spelling — never a
`{Member := …}` pragma:**
```
t1(IN := go, PT := T#1S){OutputParam.Types := ['BOOL', 'TIME']};   // today (2.3)
t1(IN := go, PT := T#1S);                                           // proposed: derived
NETWORK TITLE: "Calc "                                              // differs: the exact title, in its quotes
lamp := start BRANCH (a, b) SHORTCIRCUIT;                           // differs: the parallel's Mode (B8)
```
A member that differs and has no natural spelling is **lost on rebuild, not refused** (owner, 2R.2 Open item 5;
design.md "2R.2 Readability", code L): an unchanged network is never rebuilt and keeps it byte for byte; an edited one
is built with the derivation, and the P13 code lens names each value the rebuild drops. They are a bare `a AND b` drawn
by the editor (a stored output slot `['']`: 17 bit-operator boxes in 8 networks — 15 CODESYS in 7, 2 TwinCAT in 1), the
function result name `'   '` (105 of the 113 function boxes, 82 networks), a split's differing type (B6, 0), and
`Fixed`, `Boolean`, the `Address` sentinel (C4). 2R.4 runs each against its drawn original; a member whose loss changes
behaviour makes its networks refused on rebuild.

### B8 — the drawn parallel branch: `feed BRANCH (a, b, …)`

NWL's `BoxTreeParallel { Input, Branches[], Mode }` — what the LD editor draws for a parallel branch, and NOT an OR
box. **The feed, the word `BRANCH`, then the branches as a bracketed comma list in stored order** — as drawn and as
stored (feed, then branches). The feed is NOT an `AND` (that broke every infix try: 7 of 12 real Parallel networks read
two ways): `BRANCH` names it.
```
start ──┬── a ──────────────────┬──( lamp )
        ├── b ──[ speed <= 40 ]─┤
        └── c ──────────────────┘

lamp := PARALLEL(IN := start, a, (b AND (speed <= 40)), c);    // today

lamp := start BRANCH (a,                                       // proposed — one branch per line is layout (P2)
                      b AND (speed LE 40),
                      c);
lamp := start BRANCH (a, b, c) SHORTCIRCUIT;                   // Mode: only the non-default (old) short-circuit
lamp7 := start BRANCH (a, c BRANCH (b, go));                   // nested: the same form, a branch is a slot (B5)
lamp := BRANCH (a, b);                                         // unfed (5 of 17): nothing before BRANCH
```
**Mode — derived, written only where it differs (B7):** the editor creates `Sequential`, so nothing is written for it;
an old short-circuit one says `SHORTCIRCUIT` after its list (Lenze: 16 of 17). Lenze `fc_CamC_CC_Base`:
```
o_xCamControl := PARALLEL(IN := i_xEnable, LE(EN := GE(EN := LT(EN := , …), …), …), PARALLEL(IN := GT(EN := , …), GE(EN := , …), LE(EN := , …)));   // today

o_xCamControl := i_xEnable BRANCH ((Pos LE Stop EN (Pos GE Start EN (Start LT Stop EN))),
                                   (Start GT Stop EN) BRANCH ((Pos GE Start EN), (Pos LE Stop EN)) SHORTCIRCUIT) SHORTCIRCUIT;
```
Refused (P6): one branch `start BRANCH (a)` (C0023 — it stores, does not compile), no branch, the empty-terminator
feed, a flag on the parallel (N20). An empty branch is nothing between its commas, `start BRANCH (a, , c)` (2R.5).

### Small ones

```
NOT x                         // the negated contact (a flag) — unchanged
NOT(IN := a)                  // the NOT box (0 in the corpora); bare NOT(a) negates a bracket (P5)
sName := `'Recipes'`;  →  sName := 'Recipes';
NETWORK TITLE: "x" DISABLED   →  NETWORK DISABLED TITLE: "x"      (LSP fades the body)
LET                           →  no longer reserved
```

### Unchanged

```
a := b S= c R= value;    NOT x    R_EDGE(x)    F_EDGE(x)    f(NOT IN := v)
EXECUTE … END_EXECUTE;   ??? : TON(…)
fb(…).name   F => dst   ``   ???   UNSUPPORTED "<shape>";
```

## Precise rules (four adversarial reviews, 2026-10-16: model, grammar, every corpus + fixture network, editing; simplified the same day)

Corpus + fixture conversion: 392 of 394 real networks clean, 0 unspellable (counted under the rules before the
simplification, which refuses no tree they spelled; 2R.3's re-pull re-counts).

```
P1  WORDS (case-insensitive): EN ENO BRANCH SHORTCIRCUIT JMP RETURN EXECUTE END_EXECUTE NOT R_EDGE F_EDGE NETWORK
    END_NETWORK UNSUPPORTED, every box word (AND OR XOR ADD SUB MUL DIV MOD GT GE EQ NE LE LT MOVE) and the pattern
    split<digits>. A variable, pin, FB, global or enum value with such a name is backticked — a reference NEVER falls
    back to a variable:   y := `ENO`;   `EN` := c;   x := `split5`;   f(`execute` := a, `branch` := b)
    IF THEN END_IF LET VAR_TEMP FEED PARALLEL INTO BRANCHES are not words.

P2  LINES. At bracket depth 0 a line break ends the line (like Go's semicolons) unless the line ends with a word that
    cannot end it: an infix box word, BRANCH, `=>`, `:=`, `S=`, `R=`. Inside brackets line breaks are layout (one
    branch per line is the writer's layout, not part of the tree). So `EN` at the end of a line is always the empty
    enable, and the writer wraps AFTER `AND`, never before. A line ends with `;` (the item ends) or without (open, P3).

P3  OPEN LINES. A line without `;` is OPEN. Each `ENO` takes the oldest open line above it not yet taken: top to bottom,
    the ENOs of one line left to right (inside its brackets too). Every open line is taken exactly once.
        MOVE 1 => A EN c              MOVE 175  => V EN c
        MOVE 2 => B EN d              MOVE 2000 => D EN ENO        // takes V's line
        x := ENO AND ENO;  // A, B    MOVE 100  => T EN ENO;       // takes D's line: the chain, as before
    An enabled box is the ROOT of its line (B4): its value leaves only through `=>` or `ENO`; `x := a ADD b EN c;`
    is no text. Refused: an open line nothing takes; `ENO` with no open line; an open line whose root has no ENO
    (a coil, a split definition, a jump, a leaf, a parallel, a box without EN):
        x := a ADD b               // refused: the root is a coil
        MOVE 1 => A                // refused: no EN, so no ENO (N21)
    The order is forced, so one tree has one text: the `;` line's ENOs are the last open lines, in its order; the
    lines those read come before them, in theirs; and so on, a level at a time. A chain and one two-ENO box read as
    written; a mix reads by level (0 in the corpora):
        MOVE 1 => R EN c           // read by Q
        MOVE 2 => P EN d           // read by x
        MOVE 3 => Q EN ENO         // takes R
        x := ENO AND ENO;          // takes P, then Q
    A consumed box carries no modifier; its NOT/R_EDGE is written at the ENO token (`x := NOT ENO;`).

P4  LEVELS AND BRACKETS (B5). A bracket level and each slot — coil value, EN tail, pin value, call argument, split
    definition, branch — holds ONE box: a word with its n inputs, or a single call when no word is there. Its `=>`
    and `EN` belong to that box (`x ADD f(b) EN c` enables the ADD); `=>` comes before EN (`MOVE b EN c => a`
    refused); EN's tail runs to `;`, `)`, `,` or the line end. Bracketed, and nothing else: (1) a word box or a
    parallel that is an operand of another word (MOVE and BRANCH included, so a word-box feed is bracketed);
    (2) an enabled comparison used as a value; (3) a nested assignment. A call and `NOT (…)` (P5) carry their own
    brackets; a redundant bracket is refused.
    (2) is the one enabled VALUE: a comparison read by its result, built as the editor draws it (EN, no ENO; 2R.5).
    Read through its ENO a comparison is any enabled box, on an open line (`a GT 5 => x EN c` / `lamp := ENO;`).

P5  WORD OR CALL. A box is its WORD (B1, B2) when every input is a plain positional value, there are at least the
    word's minimum (2; MOVE 1), its formals are the defaults, its stored type is upper-case and its outputs are the
    default `=>`. Otherwise it is a CALL, `WORD(…)`, written like a function — and the call form where the word fits
    is refused. A pin's modifier stands before its formal, `R_EDGE IN1 := c`; an operator with fewer than two inputs
    is refused (both IDEs store it and refuse the build, 2R.5). A call keeps its output pins inside its brackets:
        AND(a, NOT IN2 := b)   AND(R_EDGE IN1 := c, one)   MUL(, m, 6)   and(a, b)   MOVE()   MOVE(a, b) EN c   MOVE(IN := , => x)
        Mach1_MIDS() EN split16;   SideCorrection(=> ???) EN;   MOVE(0, ENO => lamp) EN c;
    NOT's call names its pin: `NOT (` + `IN :=` is the NOT box, `NOT (` + anything else negates that bracket (a
    variable named IN there is backticked). The named ENO pin and a coil on ENO (`MOVE 0 => x EN c⏎ lamp := ENO;`)
    are two STORED trees, two texts; whether the IDE treats them as one is measured in 2R.3 (0 in the corpora).

P6  THE PARALLEL (B8). `[feed] BRANCH (b1, b2, …) [SHORTCIRCUIT]`. `BRANCH (` is the only head of a bracketed comma
    list: every other comma is inside a call, which has a name before its bracket (a callee named BRANCH is
    backticked, P1). A branch is a slot (P4): a nested parallel needs no brackets, a parallel as a word's operand
    does. An empty branch is nothing between its commas, `(a, , b)` (2R.5: it stores, builds and runs as a shorted
    branch). Refused: one branch (C0023 — stores, does not compile), no branch, the empty-terminator feed, a flag on the
    parallel (N20 — `NOT (s BRANCH (a, b))`; `NOT s BRANCH (a, b)` negates the feed).

P7  JMP / RETURN are coils: alone on the rail `JMP l;` / `RETURN;` (C11); `JMP l := ;` and `RETURN := ;` refused (one
    spelling); `RETURN := TRUE` (a leaf) is not `RETURN;`. As coils they stand beside other coils, take S=/R= and a
    modifier, and nest (2R.5): `x1 := JMP l := c;`, `JMP l1 := JMP l2 := c;`, `JMP l S= c;`, `y := (JMP l := c);`.
    A coil's modifier stands before it: `NOT x := c;`, `R_EDGE x := c;` (`NOT x S=` is `x R=`, refused).

P8  EXECUTE is a box whose operand is its raw body lines: `EXECUTE [EN [c]]`, the raw lines, `END_EXECUTE` — then `;`,
    or none when it is an open line (P3). Never a value; the body is never read for words.

P9  SPLITS: `split<n>`, n = the VarId, no leading zeros; defined once per network where NWL holds it — its own item or
    nested, `x := (split1 := a AND b);` — and referenced anywhere in the network (above its definition: the previous
    scan; 2R.5); never a coil target, `=>` target or call head; defined with `:=` only; no type (B6). LSP: warn when two networks of one
    body define the same split<n> (pasted or agent-written networks), with a renumber quick fix.

P10 Header: `NETWORK [LABEL: x] [DISABLED] [TITLE: "…"]` in that order; `TITLE: ""` refused (no TITLE = empty).
    Comment `//` lines only between header and body; a trailing CR LF in the stored comment = a final bare `//`
    line, trailing spaces kept after `// `, a bare LF refused.

P11 Body-level members (`BranchCounter`, `NetworkListComment`, `ValidIds`) have no network to refuse: derived on push;
    a stored value that differs and cannot be derived → the body is `IMPLEMENTATION LD|FBD UNSUPPORTED`.

P12 OLD SPELLINGS are not grammar (no users, no aliases): `.ENO`, `IF … THEN`, `+ - * / > < >= <= <> =`, `PARALLEL(…)`,
    `MODE :=`, `EN :=` on a box, `VAR_TEMP`, `g<n>` wires, `{Member := …}`, backticked literals each fail as whatever
    they are (no parse, an unknown POU `PARALLEL`, an undeclared `g176`), and that error's message names the new
    spelling ("write ADD", "write feed BRANCH (a, b)"). Literals: `-1` (minus touching the digit), `'Recipes'`;
    `- 1`, `-x`, `+1` refused. A coil with an empty source is unchanged: `FirstCycle R= ;` (LSP hint: "coil on the rail").

P13 LSP: hover ENO → the line it takes (line N); hover BRANCH → its branches (count, stored order) and Mode; hover
    split<n> → feeder, type, reference count; bare `EN` hint "EN shown, nothing wired"; a code lens on a changed
    network listing what the rebuild drops (B7 members); every push refusal above is also an LSP error while
    typing; the VS Code extension sets files.trimTrailingWhitespace false for network text (comments and EXECUTE
    bodies are stored verbatim).
```

## Open

- ~~The two members B7 cannot drop without losing a fact~~ — **decided (owner, 2R.2 Open item 5): lost on rebuild, not
  refused** (B7 above). A bare `x := a AND b;` is two CODESYS networks (editor-drawn: a stored output slot, 17 boxes in
  8 networks; plain: none), and 105 of 113 function boxes (82 networks) store a result name `'   '` Volt cannot build.
  2R.4's run comparison per member can still turn one into "refused on rebuild".
- **From the 2026-10-16 simplification, for the owner:** (a) P3's mixes read by level, not by chain (example in P3; 0
  in the corpora — the alternative, "an ENO takes the nearest open line", reverses the two-ENO box); (b) the MOVE call
  now keeps its output inside its brackets, `MOVE(IN := , => x)` (was `MOVE(IN := ) => x`, the one exception to P5;
  0 in the corpora); (c) an empty branch `(a, , b)` — decided by 2R.5's measurement: CODESYS stores, builds and runs it
  (a shorted branch), so it is spelled.


## Checks before building (live CODESYS + corpus)

| | Question | Decides |
|---|---|---|
| C1 | Does CODESYS refill `OutputParam.Types`/`.Names` itself (open the LD editor, build) after a push writes them empty? | B7 |
| C2 | Adversarial: two NWL trees that print the same text under B1–B8, or a text that reads to two trees (every corpus network + the probes). | all |
| C3 | Does any IDE store a 3-input SUB/DIV/MOD/comparison box? | B1 guard |
| C4 | Per member, how many corpus networks go `UNSUPPORTED` under B7 (1b.2 reach: `Fixed` 1914, `Boolean` 2347, `Address` sentinel 258, `BranchCounter` 23 bodies)? More than a handful → STOP for the owner. Also: how many corpus splits store a type that differs from their feeder's (B6). | B6, B7 |
| C5 | Corpus reach of each rule, and the line count of the six corpora before/after. | all |

## Cost

One pass over writer, reader, LSP parser and goldens — the same files 2.3 was rewriting. The model, the drivers and push
pairing do not change.

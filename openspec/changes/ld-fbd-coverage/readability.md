# Network text readability pass — proposal (owner, 2026-10-16)

**One rule: a box is always its NAME. `:=`, `S=`, `R=` are coils only. ST's operator symbols never mean a box.**
The name is what CODESYS writes on the box in the drawing. The model stays v2: one statement per NWL item, no invented
names, every text exactly one tree.

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
  split175 := split174 AND Mach1.GenFlags.EnableMainDrive AND Mach1.GenFlags.ConditionsReadyForOperation
              AND NOT Mach1.GenFlags.StopDriveDirect AND Mach1_AuxData.AllDrivesInLock;
  split176 := split175 AND Mach1.GenFlags.RunAuto;
  tMainDriveRun := oMainDriveRun := Mach1_Safety.Control.RequestAutoSpeed := split176;
  BRANCH NOT Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper
  BRANCH (Mach1_Data.AUTOSPEED LE 40 EN Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper)
  MOVE Mach1_Data.AUTOSPEED => tInt EN (split176 INTO BRANCHES) AND
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
Words: `AND OR XOR ADD SUB MUL DIV MOD GT GE EQ NE LE LT`. One word = one box; brackets separate boxes:
```
x := a ADD b ADD c;              // one ADD box, 3 inputs
x := a ADD (b ADD c);            // two ADD boxes
x := a SUB b SUB c;              // refused: SUB takes 2 inputs (same for DIV, MOD and the comparisons)
x := a ADD b MUL c;              // refused: one word kind per bracket level
```
The symbols `+ - * / > < >= <= = <>` are not network text at all: refused with "write ADD / GT / …".

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
(`ENABLE` was dropped: about 60 corpus FBs have an `ENABLE` input — MC_Power, BLINK — plus an enum value and variables).
```
MOVE(EN := c, b, => a);              // today
MOVE b => a EN c;                    // proposed

ADD(EN := c, x, 5, => x);            // today
x ADD 5 => x EN c;                   // proposed

GT(EN := c, a, 40)                   // today, inside a condition
(a GT 40 EN c)                       // proposed

LIMIT(EN := c, 0, v, 100, => y);     // today
LIMIT(0, v, 100, => y) EN c;         // proposed — a CALL keeps its output pins inside its brackets

t1(EN := c, IN := go, PT := T#1S);   // today
t1(IN := go, PT := T#1S) EN c;       // proposed

MUL(EN := , iRPM, 6, => oDrive);     // today — the empty enable (13 boxes in Lenze)
iRPM MUL 6 => oDrive EN;             // proposed: `EN` with nothing after it

EXECUTE(EN := c) … END_EXECUTE;      // today
EXECUTE EN c … END_EXECUTE;          // proposed
```
`EN` takes the condition up to `;`, `)` or the line end (P2, P4).

**Which box:** `EN`, `=>` and `ENO` belong to the box of their own bracket level; any other box is bracketed (the
writer always brackets it):
```
x := a AND (b GT 40 EN c);           // the GT is enabled — only a COMPARISON is a bracketed enabled value
x := a ADD (f(b) EN c);              // refused: an enabled MOVE/ADD/call is read through its ENO (P5) —
                                     //   write `f(b) EN c` then, on the next line, `x := a ADD ENO;`
```

### B4 — `ENO` is the enable output of the line above; `;` ends the item

**One `;` = one NWL item (P2 says where a line ends). A line WITHOUT `;` hands its box's ENO to the next line, where the word `ENO` reads it
(exactly once); the item ends at the line with `;`.** No `THEN`, no `.ENO`:
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

// ENO feeding a parallel branch (B8)
ioActNumberOfRows MUL iRowHeight => tInt EN split2 AND stDecendTray
tInt ADD iInitialDescentValue => tInt EN ENO
BRANCH (stActHeightElevator GE tInt EN)
BRANCH iPsElevatorDown
stDecendTray R= ENO INTO BRANCHES SHORTCIRCUIT;

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
Moving a whole item (up to its `;`) only reorders items, like moving a rung. Moving one line out of a chain is
refused, never silent: a line without `;` must be followed by a line that reads `ENO`, and `ENO` only reads a line
without `;`. A comparison has no ENO: an enabled comparison whose result is used stays a bracketed value,
`(a GT 40 EN c)`. `a := MOVE b EN c;` is refused: it reads "a gets b", but CODESYS hands a coil after an enabled box its
ENO (N21) — write `MOVE b => a EN c` then `coil := ENO;`.

### B4b — jumps and returns are coils; no IF

A jump sits where a coil sits — the rung drives it — so it is written like one:
```
IF a AND b THEN JMP Done; END_IF;     // today
JMP Done := a AND b;                  // proposed

JMP Done;                             // unconditional — unchanged
RETURN := NOT xReady;                 // conditional return
```
With IF gone the text has no ST control statement at all; the words are `EN ENO BRANCH BRANCHES INTO SHORTCIRCUIT
JMP RETURN EXECUTE END_EXECUTE`, the box words, and `:= S= R=`. Functions with 3+ inputs stay calls: `y := SEL(g, a, b);`,
`SEL(g, a, b, => y) EN c;`.

### B5 — values without outer brackets

```
g176 := (g175 AND RunAuto);      // today
split176 := split175 AND RunAuto;      // proposed
```

### B6 — split points: the name is the VarId, no `VAR_TEMP`

A split point is NWL's `BoxTreeDemux`: one definition node (holding the feeder) and reference nodes elsewhere, linked
by `VarId`. The Demux holds NO type — the type is the feeder's (a box's stored `OutputParam.Types`, a leaf's variable).
```
VAR_TEMP g176 : BOOL; END_VAR          // today: a block, `g` reads as a global, clashes with Lenze's enum G01
g176 := (g175 AND RunAuto);

split176 := split175 AND RunAuto;      // proposed: the definition declares it; 176 IS the VarId (no leading zeros)
split12  := a ADD b;                   // type derived from the feeder (INT) — nothing written
split1 : INT := a;                     // the stored type differs from the feeder's (a is BOOL): written inline
```
No `VAR_TEMP` block. The common case shows no type: an editor-drawn network stores the feeder's own type.

### B7 — hidden members: derived; written only where the stored value differs

**The bridge derives every stored member from the text and the declarations (as the editor does). A member is
written only where the stored value differs from that derivation, and then in a natural spelling — never a
`{Member := …}` pragma:**
```
t1(IN := go, PT := T#1S){OutputParam.Types := ['BOOL', 'TIME']};   // today (2.3)
t1(IN := go, PT := T#1S);                                           // proposed: derived
split1 : INT := a;                                                  // differs: the split's type, inline (B6)
NETWORK TITLE: "Calc "                                              // differs: the exact title, in its quotes
```
A member that differs and has no natural spelling (candidates: a bare `a AND b` drawn by the editor — a stored
output slot — and the function result name `'   '` on 97 of 97 function boxes) is counted by C4: rare → that
network `UNSUPPORTED`; common → STOP for the owner.

### B8 — the drawn parallel branch: `BRANCH` lines, combined by `BRANCHES`

NWL's `BoxTreeParallel { Input, Branches[], Mode }` — what the LD editor draws for a parallel branch, and NOT an OR
box. Same mechanism as `ENO`: lines without `;` belong to the item. **Each `BRANCH …` line is one branch, top to
bottom (the stored order); the word `BRANCHES` in a later line of the item combines the consecutive `BRANCH` lines
directly above it; `feed INTO BRANCHES` gives its feed.**
```
start ──┬── a ──────────────────┬──( lamp )
        ├── b ──[ speed <= 40 ]─┤
        └── c ──────────────────┘

lamp := PARALLEL(IN := start, a, (b AND (speed <= 40)), c);    // today

BRANCH a                                                       // proposed
BRANCH b AND (speed LE 40)
BRANCH c
lamp := start INTO BRANCHES;

lamp := BRANCHES;                                              // unfed (5 of 17)
```
The feed is NOT an `AND` (that broke every infix try: 7 of 12 real Parallel networks read two ways): `INTO` names it,
in rung order, feed first — as drawn and as stored (feed, then branches).

**Mode — derived, written only where it differs (B7):** the editor creates `Sequential`, so nothing is written for it;
an old short-circuit one says so: `lamp := start INTO BRANCHES SHORTCIRCUIT;` (Lenze: 16 of 17).

**A parallel INSIDE a branch is written inline** — `(feed INTO (BRANCH a BRANCH b))` — because a second level of
`BRANCH` lines would need depth markers. Position decides the form, so one tree has one text: the outermost parallel
of an item is always the line form (inline is refused there); inside a `BRANCH` line only the inline form exists.
Lenze `fc_CamC_CC_Base`:
```
o_xCamControl := PARALLEL(IN := i_xEnable, LE(EN := GE(EN := LT(EN := , …), …), …), PARALLEL(IN := GT(EN := , …), GE(EN := , …), LE(EN := , …)));   // today

BRANCH (Pos LE Stop EN (Pos GE Start EN (Start LT Stop EN)))
BRANCH (Start GT Stop EN) INTO (BRANCH (Pos GE Start EN) BRANCH (Pos LE Stop EN)) SHORTCIRCUIT
o_xCamControl := i_xEnable INTO BRANCHES SHORTCIRCUIT;
```
Refused: one branch (C0023 — pushes, does not compile), no branch, a `BRANCH` line not followed by more `BRANCH`
lines or a `BRANCHES`, `BRANCHES` with no `BRANCH` lines directly above, a feed that is the empty terminator, a flag on
the parallel (N20).

### Small ones

```
NOT x                         // the negated contact (a flag) — unchanged
NOT(IN := a)                  // the NOT box (0 in the corpora); bare NOT(a) refused
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

## Precise rules (four adversarial reviews, 2026-10-16: model, grammar, every corpus + fixture network, editing)

```
P1  Reserved (case-insensitive): EN ENO BRANCH BRANCHES INTO SHORTCIRCUIT JMP RETURN EXECUTE END_EXECUTE NOT
    R_EDGE F_EDGE NETWORK END_NETWORK UNSUPPORTED, every box word (AND OR XOR ADD SUB MUL DIV MOD GT GE EQ NE LE LT
    MOVE) and the pattern split<digits>. A variable, pin, FB, global or enum value with such a name is backticked —
    a reference NEVER falls back to a variable:   y := `ENO`;   `EN` := c;   x := `split5`;
    IF THEN END_IF LET VAR_TEMP FEED PARALLEL leave the word list.

P2  LINES. At bracket depth 0 a line break ends the line (like Go's semicolons) unless the line ends with a word that
    cannot end it: an infix box word, INTO, `=>`, `:=`, `S=`, `R=`, `,` or `(`. Inside brackets line breaks are
    layout. So `EN` at the end of a line is always the empty enable, and the writer wraps AFTER `AND`, never before.
    A line ends with `;` (the item ends) or without (it hands its box's ENO, or its BRANCH, to a later line).

P3  ENO = the ENO of the box at the ROOT of the nearest line above that has no `;` and is not a BRANCH line
    (so a feed chain, then its BRANCH lines, then `ENO INTO BRANCHES` — feed first, as stored). Refused: a line without `;`
    that nothing below reads; ENO after a line with `;`; ENO twice in a line; a root that is not a box with an ENO
    (a coil, a split definition, a jump, a leaf, BRANCHES, a comparison, an operator box without EN):
        x := a ADD b               // refused: the root is a coil
        MOVE 1 => A                // refused: no EN, so no ENO (N21)
    A consumed box carries no modifier; its NOT/R_EDGE is written at the ENO token (`x := NOT ENO;`). A box
    consuming TWO ENOs has no text: UNSUPPORTED "a box consuming two ENO outputs" (0 in the corpora).

P4  EN belongs to the box of its bracket level (its word box, or its single call when the level holds nothing else)
    and takes everything up to `;`, `)` or the line end: `x ADD f(b) EN c` enables the ADD. `=>` comes before EN
    (`MOVE b EN c => a` refused). An EN tail whose value has its own tail keeps its brackets.

P5  N21, general: a coil, pin or split whose value is an ENABLED box with an ENO reads that ENO, not the data — so it
    is refused for every box and call, not only MOVE:
        x := a ADD b EN c;         // refused → a ADD b => x EN c;   or   a ADD b => t EN c⏎ x := ENO;
    Only a comparison (no ENO) is an enabled VALUE: (a GT 40 EN c). That shape does not compile when Volt builds it
    (N21): it pulls and round-trips, and the LSP marks its network "can't be rebuilt from text — any edit is
    refused" (also for `fb(…).name` and symbol-comment networks). MainDrive N2 is such a network.

P6  MOVE takes ONE operand (a leaf, a call or a bracket); MOVE inside another word's level is refused. An empty input:
    MOVE(IN := ) => x   (the one MOVE call form). A pin value holding a word box keeps its brackets (28 networks).

P7  Brackets that are never dropped: a nested assignment (S2) — `y := (x := v);` is not `y := x := v;` (two coils) —
    in a coil value, an EN tail and a split definition; a pin value holding a word box (P6).

P8  JMP / RETURN: `JMP l;` / `RETURN;` is the rail (C11); `JMP l := ;` and `RETURN := ;` refused (one spelling);
    `RETURN := TRUE` (a leaf) is not `RETURN;`. Refused by name: `JMP l S= c`, `RETURN S= c`, two jumps on one
    rung, a jump plus a coil, a nested jump.

P9  EXECUTE: `EXECUTE [EN [c]]` ends at its line; body = raw lines; `END_EXECUTE` + `;`, or no `;` when its ENO feeds
    the next line. Never a value.

P10 Calls keep their brackets: `Mach1_MIDS() EN split16;`, `SideCorrection(=> ???) EN;`. Operator call form only where
    the word form cannot carry the tree (one input, an empty input, a negated pin, non-default formals, a lowercase
    type — the one case-carrying form): `AND(a, NOT IN2 := b)`, `ADD(a)`, `and(a, b)`. `NOT (` + `IN :=` is the NOT
    box; `NOT (` + anything else negates that bracket; a variable named IN there is backticked.

P11 Splits: `split<n>`, n = the VarId, no leading zeros; defined once per network, before its references; never a
    coil target, `=>` target or call head; defined with `:=` only. An inline type only where it differs from the
    feeder's (a redundant one is refused) — and only on pull: a NEW or changed network with a contradicting type is
    refused (N25, the build ignores it). LSP: warn when two networks of one body define the same split<n> (pasted
    or agent-written networks), with a renumber quick fix.

P12 Header: `NETWORK [LABEL: x] [DISABLED] [TITLE: "…"]` in that order; `TITLE: ""` refused (no TITLE = empty).
    Comment `//` lines only between header and body; a trailing CR LF in the stored comment = a final bare `//`
    line, trailing spaces kept after `// `, a bare LF refused.

P13 Body-level members (`BranchCounter`, `NetworkListComment`, `ValidIds`) have no network to refuse: derived on push;
    a stored value that differs and cannot be derived → the body is `IMPLEMENTATION LD|FBD UNSUPPORTED`.

P14 Old spellings are refused with a pointer to the new one (no aliases): `.ENO`, `IF … THEN`, `+ - * / > < >= <= <>
    =`, `MOVE(…)`, `PARALLEL(…)`, `MODE :=`, `EN :=` on a box, `VAR_TEMP`, `g<n>` wires, `{Member := …}`, backticked
    literals. Literals: `-1` (minus touching the digit), `'Recipes'`; `- 1`, `-x`, `+1` refused.
    A coil with an empty source is unchanged: `FirstCycle R= ;` (LSP hint: "coil on the rail").

P15 LSP: hover ENO → its box (line N); hover split<n> → feeder, type, reference count; hover BRANCHES → its branch
    lines; bare `EN` hint "EN shown, nothing wired"; a code lens on a changed network listing what the rebuild
    drops (B7 members); every push refusal above is also an LSP error while typing; the VS Code extension sets
    files.trimTrailingWhitespace false for network text (comments and EXECUTE bodies are stored verbatim).
```

## Open

- The two members B7 cannot drop without losing a fact — decided by C4, owner's call if it is more than a handful:
  a bare `x := a AND b;` is two CODESYS networks (editor-drawn: a stored output slot; plain: none), and 97 of 97 function
  boxes store a result name `'   '` Volt cannot build.

## Checks before building (live CODESYS + corpus)

| | Question | Decides |
|---|---|---|
| C1 | Does CODESYS refill `OutputParam.Types`/`.Names` itself (open the LD editor, build) after a push writes them empty? | B7 |
| C2 | Adversarial: two NWL trees that print the same text under B1–B8, or a text that reads to two trees (every corpus network + the probes). | all |
| C3 | Does any IDE store a 3-input SUB/DIV/MOD/comparison box? | B1 guard |
| C4 | Per member, how many corpus networks go `UNSUPPORTED` under B7 (1b.2 reach: `Fixed` 1914, `Boolean` 2347, `Address` sentinel 258, `BranchCounter` 23 bodies)? More than a handful → STOP for the owner. Also: how many corpus splits store a type that differs from their feeder's (B6 inline types). | B6, B7 |
| C5 | Corpus reach of each rule, and the line count of the six corpora before/after. | all |

## Cost

One pass over writer, reader, LSP parser and goldens — the same files 2.3 was rewriting. The model, the drivers and push
pairing do not change.

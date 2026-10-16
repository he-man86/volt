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
  VAR_TEMP split174, split175, split176, split177 : BOOL; END_VAR
  split174 := TRUE;
  MOVE 0 => tInt EN split174;
  Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper R= split174 AND NOT HMI_Var.Test_Prod;
  split175 := split174 AND Mach1.GenFlags.EnableMainDrive AND Mach1.GenFlags.ConditionsReadyForOperation
              AND NOT Mach1.GenFlags.StopDriveDirect AND Mach1_AuxData.AllDrivesInLock;
  split176 := split175 AND Mach1.GenFlags.RunAuto;
  tMainDriveRun := oMainDriveRun := Mach1_Safety.Control.RequestAutoSpeed := split176;
  MOVE Mach1_Data.AUTOSPEED => tInt EN
       PARALLEL(MODE := Sequential, IN := split176,
         NOT Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper,
         (Mach1_Data.AUTOSPEED LE 40 EN Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper))
       AND NOT HMI_Var.Btn_Cleaning;
  MOVE 30 => tInt EN
       (Mach1_Data.AUTOSPEED GT 40 EN split176 AND Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper)
       AND NOT HMI_Var.Btn_Cleaning;
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

`EN` / `ENO` are IEC's own reserved pin names — what CODESYS writes on the box, and no variable can be called that
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
`EN` takes the condition up to `;`, `)`, `,` or `THEN`.

**Which box:** `EN`, `=>` and `ENO` belong to the box of their own bracket level; any other box is bracketed (the
writer always brackets it):
```
x := a ADD (f(b) EN c);              // f is enabled
x := (a ADD f(b)) EN c;              // refused: a value box with EN is a statement or bracketed, see B4
```
`IF x THEN JMP l; END_IF;` keeps its `THEN`: inside an IF condition, `THEN` is always the IF's.

### B4 — the ENO is `THEN … ENO`

**`box THEN next`: in `next`, the word `ENO` is that box's ENO, used exactly once.** One rule for every consumer —
`.ENO` is gone:
```
// ENO → next box (Lenze AHWF; today 4 nested MOVE(EN := …).ENO)
MOVE 175  => VelUnit EN split329 AND TRUE
THEN MOVE 2000 => DecUnit EN ENO
THEN MOVE 750  => AccUnit EN ENO
THEN MOVE 100  => TorqueLimit EN ENO;

// ENO → coil (today: StartAuto := MOVE(EN := split20, 860, => AutoSpeed).ENO;)
MOVE 860 => AutoSpeed EN split20
THEN StartAuto := ENO;

// ENO mixed with contacts (Lenze AHWF N2)
IDB_WSM(iGenflags := Mach1.GenFlags, …) EN
THEN PneumValveTerminalSMC.Pos1B := ENO AND EnablePneumPressurised AND AllDoorsActuallyClosed AND tSprayingValve;

// ENO plus extra logic on the next EN
MOVE 1 => A EN c
THEN MOVE 2 => B EN ENO AND x;

// ENO feeding a PARALLEL
ioActNumberOfRows MUL iRowHeight => tInt EN split2 AND stDecendTray
THEN tInt ADD iInitialDescentValue => tInt EN ENO
THEN stDecendTray R= iPsElevatorDown PARALLEL (stActHeightElevator GE tInt EN) FEED ENO;

// ENO used twice: CODESYS stores a split point there, so it is a split wire
MOVE 860 => AutoSpeed EN split20
THEN split21 := ENO;
```
Refused: no `ENO` after `THEN`, or `ENO` twice. Still ONE statement (one `;`), so still one NWL item. A comparison has
no ENO: an enabled comparison whose result is used stays a bracketed value, `(a GT 40 EN c)`.
`a := MOVE b EN c;` is refused: it reads "a gets b", but CODESYS hands a coil after an enabled box its ENO (N21) —
write `MOVE b => a EN c THEN coil := ENO;`.

### B5 — values without outer brackets

```
g176 := (g175 AND RunAuto);      // today
split176 := split175 AND RunAuto;      // proposed
```

### B6 — split wires are named as splits

```
VAR_TEMP g176 : BOOL; END_VAR          // today: reads as a global; clashes with Lenze's enum G01
VAR_TEMP split176 : BOOL; END_VAR      // proposed; the number stays (it is CODESYS's VarId); no leading zeros
```

### B7 — no member pragmas in the text

```
t1(IN := go, PT := T#1S){OutputParam.Types := ['BOOL', 'TIME']};   // today (2.3)
t1(IN := go, PT := T#1S);                                           // proposed
```
The bridge fills them from the declaration on push, like the editor does, or drops them if CODESYS recomputes them (C1).
A member that can be neither → that network `UNSUPPORTED` (C6 counts how many).

### B8 — PARALLEL is a word too; its feed is a `FEED` tail

The drawn parallel branch is a box like the others, so it gets the same treatment as `a OR b`. Its feed (the rung
before the branch) is NOT an `AND` box, so it is never spelled with `AND` (that is what broke the earlier infix try:
7 of 12 real Parallel networks read two ways). It is a tail inside the Parallel's own brackets, like `EN`:
```
lamp := PARALLEL(IN := start, a, b);                     // today
lamp := a PARALLEL b FEED start;                         // proposed

lamp := PARALLEL(a, b, c);                               // today, unfed
lamp := a PARALLEL b PARALLEL c;                         // proposed

lamp := PARALLEL(MODE := Sequential, IN := start, a, b); // today
lamp := a PARALLEL b FEED start SEQUENTIAL;              // proposed: mode last, only off the default
```
The cases that broke the `start AND (…)` form, each one text now:
```
x := s AND (a PARALLEL b);              // an AND box holding an unfed Parallel
x := (a PARALLEL b FEED s);             // a Parallel fed by s
x := a PARALLEL (b PARALLEL c FEED e);  // a fed Parallel inside a branch
x := a PARALLEL b FEED (x PARALLEL y);  // a Parallel fed by a Parallel
```
Lenze `MainDrive` (the one Sequential Parallel):
```
MOVE Mach1_Data.AUTOSPEED => tInt EN
     (NOT Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper
      PARALLEL (Mach1_Data.AUTOSPEED LE 40 EN Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper)
      FEED split176 SEQUENTIAL)
     AND NOT HMI_Var.Btn_Cleaning;
```
One branch per line when it does not fit. A one-branch Parallel (pushes, does not compile, C0023) is refused.

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
JMP l;   RETURN;   IF c THEN JMP l; END_IF;   EXECUTE … END_EXECUTE;   ??? : TON(…)
fb(…).name   F => dst   ``   ???   UNSUPPORTED "<shape>";
```

## Open

- Negative numbers: `-1` lexes as a literal (no backticks), `a SUB 1` is the box.
- The two members B7 cannot drop without losing a fact — decided by C4, owner's call if it is more than a handful:
  a bare `x := a AND b;` is two CODESYS networks (editor-drawn: a stored output slot; plain: none), and 97 of 97 function
  boxes store a result name `'   '` Volt cannot build.

## Checks before building (live CODESYS + corpus)

| | Question | Decides |
|---|---|---|
| C1 | Does CODESYS refill `OutputParam.Types`/`.Names` itself (open the LD editor, build) after a push writes them empty? | B7 |
| C2 | Adversarial: two NWL trees that print the same text under B1–B8, or a text that reads to two trees (every corpus network + the probes). | all |
| C3 | Does any IDE store a 3-input SUB/DIV/MOD/comparison box? | B1 guard |
| C4 | Per member, how many corpus networks go `UNSUPPORTED` under B7 (1b.2 reach: `Fixed` 1914, `Boolean` 2347, `Address` sentinel 258, `BranchCounter` 23 bodies)? More than a handful → STOP for the owner. | B7 |
| C5 | Corpus reach of each rule, and the line count of the six corpora before/after. | all |

## Cost

One pass over writer, reader, LSP parser and goldens — the same files 2.3 was rewriting. The model, the drivers and push
pairing do not change.

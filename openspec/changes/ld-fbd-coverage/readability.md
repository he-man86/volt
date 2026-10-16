# Network text readability pass — proposal (owner review)

Test for every construct: **would an engineer write this line by hand to describe the rung?**
Yes → it stays in the text. No → the bridge derives it, the LSP explains it, or the network is `UNSUPPORTED`.
The model stays v2: one statement per NWL item, no invented names, every text exactly one tree.

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

**Proposed** (R1–R8 below; the `ENABLE` lines are option R4b):

```
NETWORK TITLE: "DONE NETWORK 2: Activating main drive"
  VAR_TEMP split174, split175, split176, split177 : BOOL; END_VAR
  split174 := TRUE;
  IF split174 THEN tInt := MOVE 0; END_IF;
  Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper R= split174 AND NOT HMI_Var.Test_Prod;
  split175 := split174 AND Mach1.GenFlags.EnableMainDrive AND Mach1.GenFlags.ConditionsReadyForOperation
              AND NOT Mach1.GenFlags.StopDriveDirect AND Mach1_AuxData.AllDrivesInLock;
  split176 := split175 AND Mach1.GenFlags.RunAuto;
  tMainDriveRun := oMainDriveRun := Mach1_Safety.Control.RequestAutoSpeed := split176;
  IF PARALLEL(MODE := Sequential, IN := split176,
       NOT Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper,
       Mach1_Data.AUTOSPEED <= 40 ENABLE Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper)
     AND NOT HMI_Var.Btn_Cleaning
  THEN tInt := MOVE Mach1_Data.AUTOSPEED; END_IF;
  IF (Mach1_Data.AUTOSPEED > 40 ENABLE split176 AND Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper)
     AND NOT HMI_Var.Btn_Cleaning
  THEN tInt := MOVE 30; END_IF;
  IF split176 AND HMI_Var.Btn_Cleaning THEN tInt := MOVE 6; END_IF;
  split177 := split175 AND Mach1.GenFlags.RunMan;
  tMainDriveJog := oMainDriveJog := Mach1_Safety.Control.RequestManSpeed := split177;
  IF split177 THEN tInt := MOVE Mach1_Data.MANUALSPEED; END_IF;
  RPM_To_DriveSpeed(iEN := split174, iRPM := tInt, oDriveSpeed => Mach1_Data.Drives.MainDrive_VM.Control.DriveMasterSpeed);
END_NETWORK
```

## The rules

### R1 — no outer brackets around a whole value

```
g176 := (g175 AND RunAuto);                 // today
g176 := g175 AND RunAuto;                   // proposed
```
Inner brackets still mean one box each — unchanged:
```
x := a AND (b AND c);                       // two AND boxes
x := a AND b AND c;                         // one AND box, 3 inputs
```
Guards, shipped with it:
```
x := ( - 1 - a);                            // a slot is empty → keeps its brackets
x := a - b - c;                             // refused: SUB takes 2 inputs (today: one 3-input box!)
x := a = b = c;                             // refused, same
```

### R2 — an enabled box at statement level is an IF

```
MOVE(EN := c, src, => dst);                 // today
IF c THEN dst := MOVE src; END_IF;          // proposed

ADD(EN := c, x, 5, => x);                   // today
IF c THEN x := x + 5; END_IF;               // proposed

LIMIT(EN := c, 0, v, 100, => y);            // today
IF c THEN y := LIMIT(0, v, 100); END_IF;    // proposed
```
The statement's top operator IS the enabled box, and a MOVE box is always spelled `MOVE` — never implied. Inside the
IF, `x :=` is the box's output pin (a coil after an enabled box would read its ENO, N21):
```
IF c THEN x := a + b; END_IF;               // ADD(EN := c, a, b, => x)
IF c THEN x := MOVE (a + b); END_IF;        // MOVE(EN := c, (a + b), => x)
IF c THEN x := MOVE y; END_IF;              // MOVE(EN := c, y, => x)
IF c THEN x := y; END_IF;                   // refused: no box to enable
```
Only what one box can be — anything else is refused, by the LSP while typing:
```
IF c THEN a := 1; ELSE a := 2; END_IF;      // refused: ELSE has no LD drawing
IF c THEN a := b + 1; d := 2; END_IF;       // allowed only as an ENO chain, R3
```

### R3 — an ENO chain at statement level is an IF with several statements

Lenze `AHWF`, today:
```
MOVE(EN := MOVE(EN := MOVE(EN := MOVE(EN := (g329 AND TRUE), 175, => VelUnit).ENO, 2000, => DecUnit).ENO, 750, => AccUnit).ENO, 100, => TorqueLimit);
```
Proposed — statement N is the box enabled by statement N-1's ENO:
```
IF split329 AND TRUE THEN
  VelUnit := MOVE 175;
  DecUnit := MOVE 2000;
  AccUnit := MOVE 750;
  TorqueLimit := MOVE 100;
END_IF;
```
Distinct from four boxes sharing one wire, which stays four IFs:
```
IF split329 THEN VelUnit := MOVE 175; END_IF;
IF split329 THEN DecUnit := MOVE 2000; END_IF;
```
A chain whose last ENO is CONSUMED (feeds a coil or a Parallel) keeps `.ENO`, laid out one box per line:
```
stDecendTray R= PARALLEL(
  IN := ADD(EN := MUL(EN := split2 AND stDecendTray,
                      ioActNumberOfRows, iRowHeight, => tInt).ENO,
            tInt, iInitialDescentValue, => tInt).ENO,
  GE(EN := , stActHeightElevator, tInt),
  iPsElevatorDown);
```

### R4 — an enabled comparison INSIDE a condition

```
GT(EN := split176 AND MemLower, AUTOSPEED, 40)          // R4a: keep the call
(AUTOSPEED > 40 ENABLE split176 AND MemLower)             // R4b: infix + ENABLE tail
```
40 occurrences (all Lenze). R4b is one new keyword; the owner picks.

### R5 — split wires are named as splits

```
VAR_TEMP g176 : BOOL; END_VAR   g176 := …;              // today: reads as a global; clashes with enum G01
VAR_TEMP split176 : BOOL; END_VAR   split176 := …;      // proposed; the number stays (it is CODESYS's VarId)
```

### R6 — no member pragmas in the text

```
t1(IN := go, PT := T#1S){OutputParam.Types := ['BOOL', 'TIME']};   // today (2.3)
t1(IN := go, PT := T#1S);                                           // proposed
```
The bridge fills `OutputParam.Types` / `.Names` from the declaration on push, like the editor does — or drops them if
CODESYS recomputes them (check C1). A member that can be neither derived nor dropped → that network `UNSUPPORTED`.

### R7 — PARALLEL one branch per line

```
lamp := PARALLEL(IN := start, a, (b AND (speed <= 40)));            // today
lamp := PARALLEL(IN := start,                                       // proposed
          a,
          b AND speed <= 40);
```

### R8 — MOVE is a prefix operator, always written

The same move as `a OR b` / `PARALLEL`: an operator for the box, not a function call. `MOVE` is a standard function
name, so it can never be a variable.
```
a := b;                      // an assign, no box
a := MOVE b;                 // a MOVE box, then the assign        (today: a := MOVE(b);)
MOVE b => a;                 // a MOVE box writing its output pin  (today: MOVE(b, => a);)
IF c THEN a := MOVE b; END_IF;   // the enabled MOVE, R2           (today: MOVE(EN := c, b, => a);)
```

### Small ones

```
NOT(a)                       →  refused; write NOT a (flag) or NOT(IN := a) (box)
sName := `'Recipes'`;        →  sName := 'Recipes';
NETWORK TITLE: "x" DISABLED  →  NETWORK DISABLED TITLE: "x"      (LSP fades the body)
LET                          →  no longer reserved
```

### Unchanged

```
a := b S= c R= value;        PARALLEL(…)          NOT x     R_EDGE(x)    F_EDGE(x)
JMP l;   RETURN;   IF c THEN JMP l; END_IF;   EXECUTE … END_EXECUTE;   ??? : TON(…)
f(…).ENO  (consumed)   F => dst   EN := ,   `` (empty operand)   UNSUPPORTED "<shape>";
```

## Checks before building (live CODESYS + corpus)

| | Question | Decides |
|---|---|---|
| C1 | Does CODESYS refill `OutputParam.Types`/`.Names` itself (open the LD editor, build) after a push writes them empty? | R6 |
| C2 | Is ENO = EN for every box in a statement-level chain (MOVE, operators, functions)? A chain of FBs with their own ENO logic keeps `.ENO`. | R3 |
| C3 | Does any corpus network hold an IF-shaped text that R2/R3 would read two ways? (census of every enabled box at statement level) | R2, R3 |
| C4 | Does any IDE store a 3-input SUB/EQ box? | R1 guard |
| C6 | R6 relaxes one-to-one: the TEXT plus the project's declarations give the NWL tree, not the text alone. Per member, how many corpus networks would go `UNSUPPORTED` because the bridge cannot derive the stored value (1b.2 reach: `Fixed` 1914, `Boolean` 2347, `Address` sentinel 258, `BranchCounter` 23 bodies)? If that is more than a handful, STOP for the owner — R6 then needs another answer. | R6 |
| C5 | Corpus count of each rule's reach, and the line count of the six corpora before/after | all |

## Cost

One pass over writer, reader, LSP parser and goldens — the same files 2.3 is rewriting, so it replaces the rest of 2.3's
text work rather than adding to it. The model, the drivers and push pairing do not change.

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
  tInt MOVE 0 ENABLE split174;
  Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper R= split174 AND NOT HMI_Var.Test_Prod;
  split175 := split174 AND Mach1.GenFlags.EnableMainDrive AND Mach1.GenFlags.ConditionsReadyForOperation
              AND NOT Mach1.GenFlags.StopDriveDirect AND Mach1_AuxData.AllDrivesInLock;
  split176 := split175 AND Mach1.GenFlags.RunAuto;
  tMainDriveRun := oMainDriveRun := Mach1_Safety.Control.RequestAutoSpeed := split176;
  tInt MOVE Mach1_Data.AUTOSPEED ENABLE
       PARALLEL(MODE := Sequential, IN := split176,
         NOT Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper,
         (Mach1_Data.AUTOSPEED LE 40 ENABLE Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper))
       AND NOT HMI_Var.Btn_Cleaning;
  tInt MOVE 30 ENABLE
       (Mach1_Data.AUTOSPEED GT 40 ENABLE split176 AND Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper)
       AND NOT HMI_Var.Btn_Cleaning;
  tInt MOVE 6 ENABLE split176 AND HMI_Var.Btn_Cleaning;
  split177 := split175 AND Mach1.GenFlags.RunMan;
  tMainDriveJog := oMainDriveJog := Mach1_Safety.Control.RequestManSpeed := split177;
  tInt MOVE Mach1_Data.MANUALSPEED ENABLE split177;
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

### B2 — MOVE: target first, no `:=`

```
MOVE(b, => a);                   // today
a MOVE b;                        // proposed: a MOVE box writing a

a := MOVE(b);                    // today
a := MOVE b;                     // proposed: a MOVE box, then a coil

a := b;                          // a coil, no box (unchanged)
```

### B3 — the enable input is `ENABLE`, after the box

```
MOVE(EN := c, b, => a);          // today
a MOVE b ENABLE c;               // proposed

ADD(EN := c, x, 5, => x);        // today
x ADD 5 => x ENABLE c;           // proposed — `=> x` is the box's output pin, as today

GT(EN := c, a, 40)               // today, inside a condition
(a GT 40 ENABLE c)               // proposed — nested: its own brackets

LIMIT(EN := c, 0, v, 100, => y); // today — 3+ inputs keep the call form
LIMIT(0, v, 100) => y ENABLE c;  // proposed

t1(EN := c, IN := go, PT := T#1S);     // today — an FB keeps its call
t1(IN := go, PT := T#1S) ENABLE c;     // proposed
```
`ENABLE` takes the rest of the value up to `;`, `)`, `THEN` — the order is always `box [=> pins] ENABLE condition`.

### B4 — an ENO chain is `THEN`

```
MOVE(EN := MOVE(EN := MOVE(EN := MOVE(EN := (g329 AND TRUE), 175, => VelUnit).ENO, 2000, => DecUnit).ENO, 750, => AccUnit).ENO, 100, => TorqueLimit);   // today (Lenze AHWF)

VelUnit     MOVE 175  ENABLE split329 AND TRUE    // proposed: THEN = this box's ENO enables the next box
THEN DecUnit     MOVE 2000
THEN AccUnit     MOVE 750
THEN TorqueLimit MOVE 100;
```
A coil reading a box's ENO says so — never a bare `a := MOVE b ENABLE c` (CODESYS hands that coil ENO, N21):
```
coil := (a MOVE b ENABLE c).ENO;
```

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
7 of 12 real Parallel networks read two ways). It is a tail inside the Parallel's own brackets, like `ENABLE`:
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
tInt MOVE Mach1_Data.AUTOSPEED ENABLE
     (NOT Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper
      PARALLEL (Mach1_Data.AUTOSPEED LE 40 ENABLE Mach1_AuxData.MemLowerSpeedBecauseOfNoWrapper)
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

- **An empty enable** (`EN := ,` today, 13 in Lenze): `ENABLE ,`? It must stay distinct from no EN and from `ENABLE TRUE`.
- **An operator box with an output pin and no EN** (`ADD(a, b, => x)` today): `x ADD? …` has no form — proposed
  `a ADD b => x;`, as in B3 without the ENABLE.

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

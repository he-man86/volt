## Why

Joint review by Volt and Sim-Assist, 2026-10-31, at the owner's request ("see where we made a similar design mistake").
It looked for the class of mistake found in `network-rail-and-pin-negation`:
- a stored property spelled on the wrong node's side;
- two stored models sharing one text;
- one model having two texts.

Everything below is new; the rail/mark/jump findings stay in `network-rail-and-pin-negation`. Paths are under
`packages/volt-cli/src`, and `NW/` is `Volt.Engine/Format/Network/`.

## Findings (ranked)

### Lossy or a changed meaning

1. **A TwinCAT unwired pin is read as the rail** (`Volt.Ide.Twincat/Ide/TcNetworkReader.cs` `IsUnwiredPin`).
   `Vn_ton_unwired` pulls as `t1(IN := TRUE, PT := TRUE)`: a TIME pin gets TRUE, and an edited push changes behaviour.
   Read it as the pin left out, as CODESYS does. Only a stored Terminator is the rail. **A live bug: fix first.**
2. **An operand that holds an ST expression is written as boxes** (`NW/StNetworkWriter.cs:562`, reader `:160`).
   `Leaf("a.Speed*10")` becomes `MUL(…)`; 20 Lenze networks are affected. Write the operand's own text. Only the subset
   that collides (calls, AND/OR/NOT) needs a rule; size it with a census.
3. **A root box's main output is lost** (reader `:1092`, writer `:688`). Allow `.NAME` at a root. Measure whether a
   rebuild can set the index (N21).
4. **An extra `???` output slot is dropped** (writer `:780`). Write `OUT => ???`.
5. **An undeclared FB instance collapses to `TON(…)`, the `???` box** (writer `:814-835`). Refuse it by name.
6. **A mid-rung coil that is not the first operand of an AND chain** (Sim-Assist). `a AND (x := b) AND c` and
   `(x := a AND b) AND c` draw as one rung. The reader accepts a nested assignment anywhere (`:937`). Allow it only as
   the first AND operand or as a whole pin/EN value, and refuse it elsewhere. The same goes for jump targets.
7. **Marked coils in a chain**: an ST chain passes the assigned value on, while an IEC coil passes the power flow on.
   `y := NOT x := a` reads as y = NOT a, but the model stores y = a. Measure `a--(/)x--( )y`, then state the rule.

### Ambiguous

8. **Wires are declared `VAR_TEMP` but keep their value across scans** (N41). Declare wires as `VAR … END_VAR`.
   Measure the FUNCTION case and the two-instance case. This interacts with dropping `ANY`.
9. **The meaning depends on what is declared in reach.** `X(EN := c, …)`, `.ENO`, `ENO =>`, `OUT =>` and `T(…)` mean
   either a box flag or the callee's own pin, chosen by the declarations (reader `:1016-1091`). The reader must refuse
   them against an unstated callee, as the writer does.
10. **A box's first pin is drawn as a contact or as a value according to its declared type** (Sim-Assist). Capture
    `x := ADD(i, j)` and `RS(SET := a, RESET1 := b)` in LD.
11. **Infix AND/OR and a call AND/OR give two models with one FBD picture.** Census of FBD AND/OR boxes with empty
    output names. If there are 0, refuse infix AND/OR in FBD.

### A second spelling

12. **Positional and named pins** (`NW/NetworkDerivation.cs` `WithCallee`, `NetworkSpelling.cs:68`). A callee with
    named inputs is always called by name; an operator box is always positional. Refuse the other form. Fix the
    doc's `f(a, b)` example.
13. **The Execute box's ENO is an exception** (forced on, `.ENO` refused). Measure whether EN/ENO can be switched off.
14. **Wire names**: the reader renumbers wires per network, while the writer numbers them body-wide. Accept only the
    writer's numbering.
15. **`(a AND b) AND c` vs `a AND b AND c`**: capture both. If they draw alike, keep one.
16. **Titles and comments**: `%NETWORK ""`, `$'`/`$L`, and `$N` in `//` lines. Accept only what the writer writes.

## Checked and clean

`NOT (a)` = `NOT(a)` (decided by position, not spacing); BRANCH vs infix OR and FEED; network lines; S=/R= with a
negated value; literal spelling; case; labels; trailing comments; cross-network wire reads; `=> x` vs `.Q`;
EN/ENO shown or hidden.

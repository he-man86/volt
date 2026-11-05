# Design: nwl-box-storage-map

## Method

CODESYS 3.5.21.40 64-bit, English UI. Paths are under `packages/volt-cli`.

- **DLL.** `NWLObject.plugin.dll` and `NWLEditor.plugin.dll` decompiled: `BoxTreeBox`, `Common`, both generators, `InsertBox`, `SignatureAnalyzer`, `BoxTreePainter`, `POUObject`.
- **The generator the compiler uses.** `POUObject` hands the compiler `GetStructuredImplementationSnippet`, and uses `GetImplementationSnippet` only when an aspect has no structured form (`POUObject.cs`, DLL read). So "code" below is the structured generator's text. The older generator's `{error 'ENO must be the only output.'}` raises no build error, and that is why: the compiler never reads it.
- **Reference forms.** The real editor: `new InsertBox(editor).ByArguments(...)` on an open view, the call its insert commands make.
- **States.** Each state is one PROGRAM holding one network. The box comes from `InsertBox`, then the object manager sets its members, every new object with its own Id. Before the commit the structured generator is called on the checked-out object. If it throws, the state is rolled back and filed as a fault, so it never reaches the IDE's own compile.
- **Each state:** stored members, the structured code, clean + build with the PROGRAM called from `PLC_PRG` (a syntax error stops the compile before typing, so builds repeat with those states taken out), a simulation run reading `x y z k m`, the pull over the pipe.
- **Picture.** Compared by the editor's own cell tree (class, bounds, text of every `GfxCell`), hashed. It holds no focus or selection colour, and no mark drawn without a cell of its own: a negation circle or an edge triangle does not show in it. The output lists differ in cells. One sheet of FB bitmaps was read by eye to say what the cells draw.
- **Reopen.** The 362 `live` states were authored by `scripts/author-box-states-fixture.py`, saved, closed and reopened: every output list came back as recorded, 0 of 362 changed between building and not building, and every run read before read the same. The recording holds the reopened facts for those rows.
- The one dialog came in the first FUNCTION batch, with no guard yet in place (below). After it, a dialog watch would have stopped a batch at once, and the generator guard held every faulting state back: the watch never fired.

Recording: `test/fixtures/nwl-schema/box-states.3.5.21.40.json`, 1098 rows, 16 filed faults. FBD and LD were both measured for the output lists (592 states). LD and FBD gave the same pull, build and run on every one. Layout partitions match too, except that LD draws the AND/OR operator-form lists alike where FBD draws them apart. EN/ENO flags and the member rows were measured in FBD.

## The editor's own forms (`InsertBox`, LD and FBD alike unless stated)

Inputs are `''` (FB, FUNCTION, PROGRAM) or `'???'` (operator, EN). `Instance` is null except an FB's.

| kind | CallType | EN ENO | output names | stored list |
|---|---|---|---|---|
| FUNCTION | Function | F F | `['   ']` | `[null,null]` |
| FUNCTION with q1,q2 | Function | F F | `['   ',q1,q2]` | `[null,null,'','']` |
| FUNCTION, insert with EN/ENO | Function | T T | `[ENO,'   ']` | `[null,'???',null]` |
| FUNCTION with q1,q2, EN/ENO | Function | T T | `[ENO,'   ',q1,q2]` | `[null,'???',null,'','']` |
| FB q1,q2 | FunctionBlock | F F | `[q1,q2]` | `[null,'']` |
| FB q1,q2, EN/ENO | FunctionBlock | T T | `[ENO,q1,q2]` | `[null,'???','']` |
| FB q1 / no output | FunctionBlock | F F | `[q1]` / `[]` | `[null]` / `[]` |
| FB q1 / no output, EN/ENO | FunctionBlock | T T | `[ENO,q1]` / `[ENO]` | `[null,'???']` / `[null]` |
| PROGRAM q1,q2 | Program | F F | `[q1,q2]` | `[null,null,'']` |
| PROGRAM q1,q2, EN/ENO | Program | T T | `[ENO,q1,q2]` | `[null,'???',null,'']` |
| PROGRAM q1 | Program | F F | `[q1]` | `[null,null]` |
| PROGRAM no output | Program | F F | `[]` | `[null]` |
| PROGRAM no output, EN/ENO | Program | T T | `[ENO]` | `[null,null]` |
| AND OR NOT ADD SEL LIMIT conversion, FBD plain | own | F F | `['']` | `[null]` |
| the same, LD plain or EN/ENO | own | T T | `[ENO,'']` | `[null,'???']` |
| GT, LD plain | Gt | T F | `['']` | `[null]` |
| GT, FBD plain | Gt | F F | `['']` | `[null]` |
| MOVE, always | Move | T T | `[ENO,'']` | `[null,'???']` |
| Execute | None | T T | `[ENO]` | `[null]` |

The second null on a FUNCTION and a PROGRAM comes from the insert itself: `ProcessAll` appends a null, `ProcessOutputs` appends one for the first output (DLL). It sits one slot off the names: the slot past the names is never drawn (`BoxTreePainter`: `j < names.Length`), and a null inside the names is drawn as a main-output line.

## Output lists, measured

`x`, `k`, `y`, `z`, `m` start FALSE or 0; `a`, `go` TRUE, `i` 5, q1 := a, q2 := n + 1. A pull today is after the fixes below.

### FB `t2 : bmFB2`, EN off, names `[q1,q2]`

| list | draws | root: run, pull | consumed by a coil: build, run, pull |
|---|---|---|---|
| `[]` | no output pin | nothing written, `t2(a := a, n := i);` | **no build** "The assignment source is incorrect.", refused |
| `['','']` | two empty operand boxes | as above | **no build**, refused |
| `[null,'']` (editor's) | line, box | as above | `x=TRUE`, `x := t2(…).q1;` |
| `['',null]` | box, line | `t2(…).q2;` | `k=6`, `k := t2(…).q2;` |
| `[null,null]` | two lines | as `[null,'']` | `x=TRUE`, as `[null,'']` |
| `[null,'k']` | line, k | `k=6`, `t2(…, q2 => k);` | `k=6 x=TRUE`, `x := t2(…, q2 => k).q1;` |
| `['x',null]` | x, line | `x=TRUE`, `t2(…, q1 => x).q2;` | `k=6 x=TRUE`, `k := t2(…, q1 => x).q2;` |
| `['x','k']` | x, k | `k=6 x=TRUE`, `t2(…, q1 => x, q2 => k);` | **no build**, refused |
| `[null,'','']`, `[null,null,'']`, `['',null,'']` | as without the last slot: a slot past the names is not drawn | as without it | as without it |

### FB, EN+ENO, names `[ENO,q1,q2]`

| list | root | consumed |
|---|---|---|
| `[null,'','']`, `[null,null,'']`, `[null,'',null]`, `[null]` | all build, code alike, draw apart, one pull `.ENO` | `y=TRUE`, one pull `.ENO` |
| `[]`, `['','','']` | as above, one pull | **no build**, refused |
| `['z','','']` (`ENO => z`) | builds, z never written, `ENO => z` kept | **no build**, refused |
| `['z',null,'']`, `['z','',null]`, `['',null,'']`, `['','',null]` | **no build** "ENO output is not used as main output", refused (`a box showing ENO read by another output`) | same |
| `[null,'???','']` | **no build** C0007, `q1 => ???` kept | same |
| `[null,'x','k']` | `k=6 x=TRUE` | `k=6 x=TRUE y=TRUE` |
| `['z','x','k']` | `k=6 x=TRUE`, z never written | **no build**, refused |

### PROGRAM `bmP2`, names `[q1,q2]`

Behaves as an FB with the POU name as its instance: the code is `bmP2(…); x := bmP2.q1;`.

| list | root | consumed |
|---|---|---|
| `[null,null,'']` (editor's), `[null,null]` | line, line; one drawing | `x=TRUE`, `x := bmP2(…).q1;` |
| `[null,'']` | line, box | `x=TRUE`, same pull |
| `['',null]`, `['',null,'']` | `.q2` | `k=6`, `k := bmP2(…).q2;` |
| `[]`, `['','']`, `['x','k']` | builds | **no build**, refused |
| `[null,'k']` | `k=6`, `q2 => k` | `k=6 x=TRUE` |
| `[null,null,'k']` | k past the names: not written, not drawn; refused | same |
| EN+ENO `[null,'',null,'']` | builds | `y=TRUE`, as FB |
| EN+ENO `[]`, `['z','','']` | builds | **no build**, refused |
| no output, `[null]`, `[]`, `[null,null]`, `['']` | one drawing, builds | **no build**, refused (`a box read by an unstated slot`) |

### FUNCTION `bmF2`, names `['   ',q1,q2]`

| list | root | consumed |
|---|---|---|
| `[null,null,'','']` (editor's), `[null,null,'']` | one drawing, builds | `k=5`, `k := bmF2(…).OUT;` |
| `[null,'','']` | q1 a box, not a line | `k=5`, same pull |
| `['','','']` | builds | reads the value: no null is not an error on a FUNCTION |
| `['',null,'']`, `['','',null]` | `.q1`, `.q2` | `k=6`, `y=TRUE` |
| `['k',null,'']` | `k=5`, `OUT => k` and `.q1` | `k=6` |
| `[null,'m','x']` | `m=6 x=TRUE` | `k=5 m=6 x=TRUE` |
| shorter than the names | **the IDE faults on it**, below | |
| EN+ENO `[null,'k','','']` | `k=5` | `k=5 y=TRUE` |
| EN+ENO `[null,'k',null,'','']` | as the row above, another drawing | |
| EN+ENO `['z','k','','']` | k **not** written with z on the ENO slot, `ENO => z, OUT => k` | no build by type here |
| EN+ENO `[null,null,'','']` | **the IDE faults on it**: the generator throws, a null on the result slot | |

### Operators

| list | AND, GT, ADD, MOVE, no ENO | |
|---|---|---|
| `[null]`, `[]` | run alike; root and consumed one drawing | plain pull |
| `['']` | **no build** "The assignment target is not specified." | refused, was the plain pull |
| `[null,null]` | root **no build** C0046 on the implicit variable, also after a reopen; consumed as `[null]` | refused, was the plain pull |
| `['y']` | root `y` written, `OUT => y`; consumed reads the value | consumed refused (`an unnamed output by an unspellable slot`) |
| `['k','m']` (MOVE) | only `k` written, `m` never, by both a drawn and a pushed box | `MOVE(i, OUT => k, OUT => m);` |

With EN+ENO, names `[ENO,'']`: `[null,'k']` runs and is the only form that consumed builds. `[null,'']`, `[null,'???']` are **no build** "assignment target not specified"; `[null]`, `[]`, `[null,null]` build at a root and answer C0046 or C0032 consumed. `['z','k']` runs, z never written. Contact form (names `[]`, EN and ENO null): `[]` and `[null]` run alike, draw apart in FBD, one pull `a AND b`.

## The members

| member | what can be stored | changes | text today | TwinCAT |
|---|---|---|---|---|
| `Id` | any long, minted by the IDE; two sharing -1 pop an internal error (earlier run) | nothing | none, derived | import mints |
| `BoxType` | any string, as typed | case changes the drawing, not the code | as stored (`bmf0(…)`) | archive `BoxType` |
| `Instance` | null, `''`, `' '`, name | below | call head | archive; unset is empty |
| `OutputItems` | null, operand, any length; `AppendOutputItem(null)` throws, `InsertOutputItem` takes it | above | `NAME => v`, `.NAME`, `.ENO` | forms below |
| `Flags` | Negation, Set, Jump, Return, Rtrig, Ftrig, Fixed, Extensible | below | below | archive; edge order unmeasured |
| `InputFlags` | null (default, the getter answers fresh flags), a list | below | `NOT a :=`, `RISING a :=` | N4 |
| `InputItems` | operand, tree | | pins | |
| `InputParam` | names, types | below | pin names | |
| `OutputParam` | names, types | names draw the pins; types nothing measured | names through `NAME =>`, types no text | |
| `CallType` | every `Operator` member | below | none | archive |
| `EN`, `ENO` | true, false, null | below | `EN :=`, `.ENO` | N13 |
| `STSnippet`, `ProvidesSTSnippet` | below | | the string | fixture `execute-box` |
| `ContainsExtensibleInputs` | true, false | below | refused | unmeasured |

### EN, ENO against their slots

`Common.GetEnByPropertyOrParam`: a stated flag decides; null falls to the slot's name (DLL, and measured: null over a slot named EN runs as shown).

| slots | EN ENO | result | pull |
|---|---|---|---|
| `[EN]`, `[ENO]` both | T T | shown | `EN :=`, `.ENO` |
| `[EN]`, `[]` | T F or T null | EN only: `IF EN THEN … END_IF`; FB consumed reads its output inside the IF | `t2(EN := go, …);` |
| EN slot | null, any | runs as EN shown | refused, `a pin named EN its callee does not declare` |
| EN slot | F, any | callee has no EN: no build (`'EN' is no input`); an operator's EN pin becomes an operand: `y := ((go AND a) AND b)` | refused |
| `[ENO]` over EN off | F T or null T | FB root builds; consumed no build; operator "An inconsistent element" | `.ENO` kept |
| ENO slot | any but T, callee declares none | root may build, read as shown or as a data output | refused, `an ENO output on a box showing no ENO` |
| no slots | T any | the first data pin is taken as EN: `EN := a; t2(n := i)` | refused, `a box showing EN or ENO with no slot of that name` |
| no slots | null null | as F F | plain |

### `Flags` on a box

| bit | effect | pull |
|---|---|---|
| Negation | `NOT(…)` on the value handed on; the circle is the gate's measure (#2), not visible to the cell tree | `NOT t2(…)` |
| Rtrig, Ftrig | `R_TRIG` on the value; a root AND's CLK wired by the generator to its last input | `RISING(…)`, `FALLING(…)` |
| Rtrig+Ftrig | Rtrig wins, one rising edge | refused |
| Set, Negation+Set, Jump, Return | no code change, no drawing change | refused, `a coil flag on a box` |
| Extensible | none on a box | lost, inert: no code, no drawing, one layout |
| Fixed | set by the setters | not read; ledger row |

### `CallType`

The editor writes it from the callee (`SignatureAnalyzer`, `Common.GetOperator`); no command writes another. A wrong one is stored only through the object model, and the reader, having no callee, cannot compare. A push leaves FB boxes on the fresh `None` and they run alike. A PROGRAM's does not: below, "Text against the run".

| stored | result |
|---|---|
| AND with any of None, Or, Function, FunctionBlock, Program, Action, Method | builds and runs as AND, consumed `y=TRUE`; the printed model of some reads `(ERROR AND ERROR)()`, which the run does not follow |
| FUNCTION with None, FunctionBlock, Program, And, Action | root runs; consumed **no build** "Cannot convert type 'Unknown type: 'bmF0…'" |
| FUNCTION, PROGRAM with Method | **no build** C0409 |
| FB with Method, Action | **no build** C0035 |
| FB with None, Function, Program, And | builds and runs as drawn |
| PROGRAM with None, Function, FunctionBlock, And, Action | builds and runs as drawn |

### `Instance`

| stored | result | pull |
|---|---|---|
| null on an operator, FUNCTION, PROGRAM | the drawn form | plain |
| `''`, `' '`, `'???'`, a name on an operator | runs as null, one drawing | plain, lost, inert |
| `''` on FUNCTION, PROGRAM | runs as null; another drawing | plain |
| `' '`, `'???'` on FUNCTION, PROGRAM | C0007 | refused; `' '` pulled plain live, an offline double refuses: unexplained, see the end |
| another name on FUNCTION, PROGRAM, FB | not an instance of the callee: error | refused |
| null, `''` on an FB | C0080 "must be instantiated" | `bmFB2(…)`, the unnamed-instance form |
| `'???'` on an FB | C0007 | `bmFB2(…)`, the unnamed-instance form, its own text |
| `' '` on an FB | C0007 | refused |

### Inputs

| stored | result | pull |
|---|---|---|
| `InputFlags` null, or a list as long as the items | alike | plain |
| longer by one | builds, the extra is inert | refused, `a flag on a box input pin` |
| shorter by one | **the IDE faults on it**: the generator throws | |
| names `[]` or short on a resolved call | the pin past the names is not passed: `t2(a := a)`, `t2()`, `bmP2()`; a FUNCTION answers C0040 | refused, `a call box input past its pin names` |
| names swapped | as the names say | as stored |
| names on an operator (`IN1`, `G`) | another drawing, same code | as stored |
| `ContainsExtensibleInputs` | the generator leaves the names out: FUNCTION runs, FB and PROGRAM answer C0044 | refused, `a box storing extensible inputs` |

### Execute

`ProvidesSTSnippet` has two getters: the public one is `BoxType` equals `execute` (the reader reads it), the interface one is the stored flag or a snippet being there (the generators read it).

| stored | result | pull |
|---|---|---|
| EN+ENO `[null]`, `[null,'']` | `m=1`, consumed `y=TRUE` | `EXECUTE(EN := go, '…').ENO` |
| `[]` | root as above; consumed `m=1 y=TRUE`; draws no ENO pin | same pull, picture lost |
| `['z']` | builds, z never written | refused, `an Execute box with pins` |
| T F, slots kept | `m=1` under EN; consumed no build | `EXECUTE(EN := go, '…');` |
| F T or F F, no EN slot | runs every scan; consumed no build | `.ENO` or plain, kept |
| F or null flags over a slot named EN | runs as the flags say, by the name where null | refused, `an Execute box with pins` |
| `BoxType` `execute`, lower case | runs | as EXECUTE |
| another `BoxType` with a snippet | runs the snippet | refused |
| no snippet, flag false | root C0046 on `EXECUTE`; consumed passes the ENO, no code | refused, `an Execute box whose ST cannot be read` |
| a data pin past EN | **the IDE faults on it** | |

## Silently lost today

Fixed in this change means the pull now refuses by name.

| state | what was lost | now |
|---|---|---|
| consumed FB or PROGRAM with no null, EN off or EN+ENO | stored: no build. Pull showed `y := t2(…).q1;`. Pushed unchanged it stays as it is; on any edit, or in a new POU, it builds and assigns `y` | fixed |
| operator with an empty value slot, with or without ENO | stored: no build. Pull showed the plain box | fixed |
| operator, no ENO, second null | root stored: no build. Pull showed the plain box | fixed |
| `ContainsExtensibleInputs` | FB, PROGRAM stored: no build. Pull showed the named call | fixed |
| an input past a resolved call's names | the pin is not passed; the pull showed it, and a push of `t2(a := a, i)` answers C0037 | fixed |
| a slot named ENO with ENO off or null, callee declares none | pull showed the plain box | fixed |
| **pictures**: `box-states.picture-losses.txt`, one line per text | the same text for lists the editor draws apart: empty box against line against no pin. `[null,'']` against `[null,null]`, `[]`, `['','']` at an FB's root; `[null]` against `[]` on Execute | **still lost**, for the owner. Nothing there builds or runs apart |
| `Flags.Extensible` on a box | stored, inert | still lost; `Flags.Fixed` likewise, its ledger row |
| `En`/`Eno` null against false on a box with no slot | builds, code and drawing alike | still lost, inert |
| `OutputParam.Types`, a slot past the names | inert: same code, same drawing | still lost, inert |
| a wrong `CallType` | above; only the object model stores one | still lost, excluded by name from the test |

The first row corrects an earlier reading of this state, "the coil is not assigned": the old generator's text and the structured text both print `;`, but the IDE refuses to build it. It is one more non-building state a pull hid, not a running program a pull changed. The push-back measured: unchanged keeps the stored form and its error; edited (`a := a` to `a := b`) and a new POU store `[null,'']` and run `y=TRUE`.

The same run on EN+ENO with a later null, whose old-generator text carries `{error 'ENO must be the only output.'}`: it builds, and runs `y=TRUE` as `[null,'','']` does. The pragma is the older generator's, and the compiler does not read it.

## Stored, changes the program, no text

| state | what it does | today |
|---|---|---|
| no null, consumed | no build | refused |
| ENO slot holding a variable, consumed | no build on FB and PROGRAM | refused, `a variable on the ENO pin` |
| ENO slot holding a variable on a FUNCTION | the data output is not written: `['z','k','','']` writes no `k` | refused, `a variable on the ENO pin` |
| operator with `OUT => k, OUT => m` | `m` never written | refused, `one output wired to two targets` |
| FB, PROGRAM, FUNCTION positional text `t2(a, i);` | FB and PROGRAM store names `[]`: `t2()`, the pins are not passed, and it builds. FUNCTION is given its names | refused, `a pin by position on an FB or a program` |
| a shown ENO over a main output past it | no build | refused |
| EN only, consumed | `IF EN THEN … x := q1 END_IF`; x keeps its value when EN is false | spelled, not run with `go` false here |

## Inert, refused by name

Set, Reset, Jump and Return on a box; a rising and falling edge on one box (the rising one wins); a longer `InputFlags`; a slot past the names holding a variable where the slot is reached positionally.

## The IDE faults on it

Stored by the object model. The evidence is the dialog, or the generator's throw on the checked-out object before any commit.

| state | evidence |
|---|---|
| FUNCTION, EN+ENO, names `[ENO,'   ']`, list `[null]`, shorter than its names | dialog at the first batch: "Internal error while object '…' is providing language model information: Index was outside the bounds of the array." Lists shorter than a FUNCTION's names were then kept out, per the coordinator |
| FUNCTION, EN+ENO, `[null,null,'','']`, a null on the result slot | generator throws, rolled back |
| `InputFlags` shorter than the items | generator throws, rolled back |
| MOVE with no slots, EN true | generator throws, rolled back |
| Execute with a data pin past EN | generator throws, rolled back |

## Editor's forms against what a push stores

Same run, the push's text on each kind, FBD; LD gave the same. Runs are alike unless a row says so.

| kind | push stores | editor stores | difference |
|---|---|---|---|
| FUNCTION | `['   ']` `[null]`, types `''` | `[null,null]`, types stated | length, types; same drawing, same run |
| FUNCTION q1,q2 | `['   ',q1,q2]` `[null,'','']` | `[null,null,'','']` | q1 draws a box, not a line |
| FUNCTION EN+ENO | `[ENO]` `[null]`; with outputs `[ENO,q1,q2]` `[null,'','']` | `[ENO,'   ',…]` `[null,'???',null,…]` | no result name, no second null, no `???`. The `???` does not build, so it is no target to match |
| FB, root | names, `[null,'']` (F3) | same | CallType `None`, types `''` |
| FB, consumed `.q1` | names, `[null,'']` | same | as above |
| FB EN+ENO, root | `[ENO,q1,q2]` `[null,'','']` | `[null,'???','']` | the `???` |
| FB EN+ENO, consumed | `[ENO]` `[null]` | `[ENO,q1,q2]` list | **no pins q1,q2 drawn**: `WithRootOutputs` is root-only |
| FB no output | `[]` | same | none |
| PROGRAM, EN off | names, `[null,null,'']`, after the fix below | same | none, once a push stores CallType `Program` |
| PROGRAM EN+ENO | `[ENO,q1,q2]` `[null,'',null,'']`, after the fix | `[null,'???',null,'']` | the `???` |
| PROGRAM no output | `[null]`, `[ENO]` `[null,null]`, after the fix | same, EN null against false on the plain one | |
| AND, OR call form | `['']` `[null]` | same | types `''` |
| `a AND b` contact | `[]` `[]`, EN ENO null | an LD contact: same | none |
| NOT | `[]` `[]` | `['']` `[null]` | length; same run |
| MOVE, ADD, GT with `OUT => v` | `[ENO,'']` `[null,'v']` | same once wired | none |
| MOVE, no EN | `['']`, `[null]` or `['k']` | the editor always shows EN and ENO | no editor form |
| GT `.ENO` with no target | `[ENO,'']` `[null,'']`, **no build** | `[null,'???']`, no build | the pull now refuses what this push lands |
| AND `.ENO` with no target, consumed | `[ENO]` `[null]`, **no build** C0046 | as above | the text has no building form without `OUT =>` |
| conversion, SEL | `['']` `[null]` | `['']` `[null]` | none |
| Execute | `[ENO]` `[null]` | same | T F and F F are no editor forms |

**PROGRAM (F3 left this open).** `WithRootOutputs` gave a PROGRAM no list "because nothing was measured". Measured: a consumed one pushed with no list does not build. Fixed test-first: `NetworkDerivation.WithProgramOutputs`, the insert's list, and a read past the first output builds on CODESYS (TwinCAT keeps the refusal). Run: `x=TRUE`, `k=6`, `y=TRUE`, as the editor's box. The corpus ledger's output-list rows closed 8 nodes and gained one name row.

**A push's Execute box did not run.** An `EXECUTE` written by one push stores its ST, builds clean and never runs: the structured model hands the compiler an empty snippet until the object is committed again (`{p -1}`), and a second commit makes it run. `execute-runs.test.ts` could not see it because `expectRoundTrip` pushes the bytes twice. This also corrects `network-text-one-to-one` 4.2, "did not reproduce through Volt's push". Fixed test-first: `WriteGraph` commits again when the body holds an Execute box.

## TwinCAT

No XAE was started. What the committed `.TcPOU` fixtures hold (walked once):

| box | EN ENO | names | list |
|---|---|---|---|
| FB | absent | one | `['']` (the importer's), root |
| FB | F F | none | `[null]` root |
| FB | F F | `[ENO,N]` | `[null,var]` root |
| FB | F F | `[N,N]` | `[null,var]` root, `[null,'']` consumed |
| Execute | T T | `[ENO]` | `[null]` root |
| operator | absent or F F | `['']` or none | `[]`, `['']`, `[null]` |

Every other row of this map is unmeasured on TwinCAT. Two reader differences stand: `TcNetworkReader.ConnectedSlot` answers no slot over two nulls, where CODESYS reads the first, so an editor-form PROGRAM box would refuse there if XAE draws one. The refusals of this change are in the CODESYS reader, and the shared writer rule (`an ENO output on a box showing no ENO`) applies to both.

## What the text must carry per output slot, and `.NAME`

From the measurements alone, no spelling proposed.

Per output slot the IDE stores one of: absent, null, empty operand, a variable, `???`.

| fact | changes | carried today |
|---|---|---|
| the variable in a named slot | the run | `NAME => v` |
| which slot holds the first null, consumed | what the consumer reads | `.NAME`, or nothing where one output |
| whether any null exists, consumed | build on FB and PROGRAM; a FUNCTION reads its value | refused |
| a variable on the ENO slot | build when consumed, and a FUNCTION's data output | `ENO => v` at a root |
| empty against null on an operator's value slot | build | refused |
| `???` | build | `OUT => ???`, `NAME => ???` |
| a later null, an empty operand, or no slot, on any other slot | the drawing only: line, box, no pin | nothing |
| a slot past the names | nothing | nothing |

**Can `.NAME` state every state that changes the program?** For the slot a consumer reads, yes wherever a building state exists: the first null is one position among the declared outputs, on all of FB, PROGRAM and FUNCTION. Every state with no such position does not build (no null consumed, a shown ENO with a null past it), so it has nothing to state, and is refused. `.NAME` states one slot. A later null is a second stored position it does not reach: that changes only the drawing, and any per-slot form would have to state it to keep the picture. A root's main slot is stated the same way, and at a root it changes the drawing, not the run.

## Text against the run

A form whose text claims what its run does not do. CODESYS 3.5.21.40 64-bit, FBD, every row pushed, pulled, built and run in simulation through the shipped bridge, one PROGRAM per form, read from the holder's own variables; LD gave the same on the rows marked LD. `a b go` TRUE, `gf` FALSE, `i` 5, `j` 3; `F0(n)` returns `n + 1`; `F1(n)` the same with `q` TRUE and `q3 := n + 2`; `F2(p1, p2)` returns `p1 * 10 + p2`; `t2` and `P2` as above; `c1(in)` counts the scans `in` is TRUE in `n`. A count of about 140 is every scan of the run.

| text | build, run | refusal |
|---|---|---|
| `MOVE(i, OUT => k, OUT => m);`, LD | `k=5`, m never | `the call MOVE wires OUT => twice` |
| `ADD(i, j, OUT => k, OUT => m);` | `k=8`, m never | same |
| `AND(a, b, OUT => x, OUT => y);` | `x=TRUE`, y never | same |
| `F0(n := i, OUT => k, OUT => m);` | neither | same |
| `y := MOVE(EN := go, i, OUT => k, OUT => m).ENO;` | `y=TRUE k=5`, m never | same |
| `k := MOVE(i, OUT => m);`, `k := ADD(i, j, OUT => m);`, `x := GT(i, j, OUT => z);`, `x := AND(a, b, OUT => z);`, `k := F0(n := i, OUT => m);`, `x := GT(EN := go, i, j, OUT => z);`, `k := MOVE(EN := go, i, OUT => m);` | the reader written, the target never | `the box … is read by its value and wires OUT =>` |
| `t2(a, i);` | builds, `t2()` | `the call t2 passes a pin by position` |
| `t2(a, i, q2 => k);`, LD | `k=1`: n not passed | same |
| `P2(a, i, q2 => k);` | `k=1` | same |
| `t2(a, n := i);`, `P2(a, n := i);`, `F2(p1 := i, j);` | **no build** "'' is no input". FB and PROGRAM refused; the FUNCTION left to the build | same, FB and PROGRAM |
| `F1(EN := go, n := i, ENO => z, OUT => k).ENO;`, `F0(…)` alike | builds, z and k never | `the IDE never writes a variable on the ENO pin` |
| `F1(EN := go, n := i, ENO => z, q => x).ENO;` | `x=TRUE`, z never | same |
| `MOVE(EN := go, i, ENO => z, OUT => k).ENO;`, LD; `y := …` the same | `k=5`, y as ENO, z never | same |
| `t2(EN := go, a := a, n := i, ENO => z, q1 => x, q2 => k).ENO;` | `x=TRUE k=6`, z never | same |
| `P2(EN := go, a := a, n := i, ENO => z, q1 => x).ENO;` | **no build** "ENO output is not used as main output"; pull refused | same |
| `y := GT(EN := go, i, j).ENO;`, LD; `ADD`, `MOVE`, `LIMIT`, `SEL`, `INT_TO_WORD` alike | **no build** "The assignment target is not specified." | `the operator box … wires its value nowhere` |
| `y := AND(EN := go, a, b).ENO;`, `NOT`, `XOR` alike | **no build** "'__…__ImpVar' not defined" | same |
| `GT(EN := go, i, j).ENO;`, `MOVE`, `ADD` alike | **no build**, the same message | same |
| `AND(EN := go, a, b).ENO;`, `OR` alike | builds, does nothing | same: one rule, and a value wired nowhere has nothing to run for |
| `y := F0(n := i).ENO;`, also with `z := TRUE` above it | runs, the coil written FALSE every scan | `is read through .ENO and shows no EN` |
| `y := GT(i, j).ENO;`, `y := MOVE(i, OUT => k).ENO;` | **no build** "Missing EN pin" | operator rule, or the row above |
| `y := t2(a := a, n := i).ENO;`, `y := P2(…).ENO;` | **no build** "'ENO' is no component" | row above |
| `F0(n := i, OUT => k);`, `F1(…)`, `F2(p2 := i, p1 := j, OUT => k);` | builds, k never | `the function box … wires OUT => at a root` |
| `F1(n := i, OUT => k, q3 => m);`, no output read | `m=7`, k never | same. Closed by `.q` it writes k: below |
| `F0(EN := go, n := i, OUT => k);` | **the IDE faults on it**: dialog "Internal error while object … is providing language model information: Value cannot be null. Parameter name: expRValue" | same |
| `P2(a := a, n := i, OUT => k);` | lands as `q1 => k`; **no build** by type | `declares no output OUT` |
| `t2(a := a, n := i, OUT => k);` | the driver refused it, no output OUT | same, at the gate |
| `RISING y := a;`, with a counter on y | `k` every scan: a plain coil | `an edge mark on the coil` |
| `FALLING y := a;` | the same | same |
| `RISING y := x := a;` | the same, x written | same |
| `RISING y S= a;` | y set, no counter read | same |
| `RISING JMP.l := a;`, `FALLING JMP.l := a;` | jumps every scan | `an edge mark on the jump` |
| `RISING RETURN := a;`, `FALLING RETURN := a;` | returns every scan | `an edge mark on the return` |
| `t2(a := a, n := i, RISING q1 => x);`, `FALLING` alike; `MOVE(a, RISING OUT => x);` | the level, `x=TRUE` | `an edge mark on the output` |
| `k := c1(RISING NOT in := gf).n;`, `FALLING NOT`; `AND(a, RISING NOT := gf)`; `ADD(RISING NOT EN := gf, k, 1, OUT => k);`; `RISING NOT y := gf;` | the NOT every scan, no edge | `RISING NOT before one receiver` |
| `y := RISING NOT := a;` | NOT of the edge, 45/15 with `a` changing. This row used to read it as the NOT alone, from `gf` constant FALSE, where the two agree | same, reason corrected; below |
| `k := SUB(IN2 := i, IN1 := j);` | `k=2`: `i - j` | `names its pin IN1 out of place` |
| `x := GT(IN2 := j, IN1 := i);` | `x=FALSE`: `j > i` | same |
| `k := LIMIT(MX := 3, IN := i, MN := 0);` | `k=0`: MN 3, MX 0 | same |
| `k := SEL(IN1 := j, G := go, IN0 := i);` | **no build** by type: by position | same |

The editor's own form of each of these is under "Marks as the editor draws them", below. A pull refuses each stored state by the writer's name: `one output wired to two targets`, `a box read by its value with a target on it`, `a pin by position on an FB or a program`, `a variable on the ENO pin`, `an operator box closed by ENO with its value wired nowhere`, `a box read through ENO with no EN`, `a function value wired at a root with no ENO`, `a variable on an output no declaration names`, `an edge mark on a coil`, `an edge mark on a jump or a return`, `an edge mark on an output`, `an edge stacked on a negation`, `an operator pin named out of place`. Pushed back unchanged it stays as the IDE holds it. None of them is in the six corpora, except that the TwinCAT archives hold `In1`-numbered SEL and MUX pins, which is why a number states an order and not a place.

**A push's PROGRAM box was not called where something read it.** On the fresh CallType `None`: `x := P2(a := a, n := i).q1;` `x=FALSE`, `y := P2(EN := go, a := a, n := i, q2 => k).ENO;` `y=TRUE k=0`, all building. A root box runs either way, which is what hid it. The editor's insert stores `Program`. Fixed test-first: the push stores it, and every row then runs as it reads, `x=TRUE`, `y=TRUE k=6`. TwinCAT's archive is unmeasured.

**An enabled comparison's target, EN false.** Showing no ENO it is written FALSE: `z := TRUE;` then `GT(EN := gf, i, j, OUT => z);`, `z=FALSE`, and `x := GT(EN := gf, i, j);`, `x=FALSE`. Showing ENO it holds: `… OUT => z).ENO;`, at a root and read, `z=TRUE`. Any other operator holds in both. Lowering and the twin wrote FALSE in both; fixed.

### Marks as the editor draws them

Each command is the editor's own: `TriggerCommand` (Edge Detection), `NegateCommand`, `SetResetCommand`, `SetFBDOutputCommand`, its `Enabled` read on the focused cell, then its handler with its own selection arguments. 266 states, LD and FBD, built and run from a driver PROGRAM over 60 scans with `a` high 2 scans of 4, read as `scans TRUE / of them with a high`: level 30/30, NOT 30/0, rising 15/15, falling 15/0, NOT of rising 45/15, NOT of falling 45/30. LD and FBD agree on every row; a few FBD reads lost the window focus and answered disabled with nothing done, and the same form was read enabled on another state.

| place, cell | Edge Detection | Negation | Set/Reset | stored | run | text today |
|---|---|---|---|---|---|---|
| contact or value operand | offered | offered | no | `BoxTreeOperand.Flags` | as marked | `RISING(a)`, `NOT a` |
| main connector (the line into the coil, or from a box to it) | offered | offered | no | `BoxTreeAssign.Flags` | as marked | `y := RISING := a`, `y := NOT := a` |
| the same, on a set or reset coil, a jump, the return | offered | offered | no | the same | as marked: S, R, the jump and the return fire once | `y S= RISING := a`, `JMP.l := RISING := a`, `RETURN := RISING := a` |
| coil, S and R coil | **disabled** | offered | offered | the target operand: `Negation`, `Set`, both for R | NOT, S, R as marked | `NOT y := a`, `y S= a`, `y R= a` |
| jump, return (`NWLExecutionControlCell`) | **disabled** | offered | no | the target operand | NOT as marked | `NOT JMP.l := a` |
| box input pin, BOOL | offered | offered | no | `InputFlags[i]` | as marked | `t(RISING in := a)`, `AND(a, RISING := b)` |
| box input pin, not known BOOL (INT, MOVE's value) | **disabled** | offered | no | | | |
| EN | offered | offered | no | `InputFlags[0]` | as marked | `RISING EN := go` |
| box main output, consumed | **disabled** | offered | no | `Box.Flags` | NOT as marked | `y := NOT t(…).q` |
| box output with a variable | **disabled** | offered | **offered** | the output operand | NOT as marked; S holds, R clears | `NOT q2 => x`; S and R refused, `a coil flag on a pin` |

The disabled handler on a coil, a jump, the return or an output throws (`Trigger` finds no flag set on an operand) and stores nothing. `RISING(t(…).q)`, on a box's own flags, has no command; it runs as it reads consumed, and has no effect at a root.

**The picture.** A coil holding `Rtrig` draws `P` in LD and nothing in FBD, and runs as a plain coil: the structured generator reads only the target's `Negation2`. `27de989f3f`'s writer stored the edge there, an object the editor never produces. An edge on an output draws nothing in either: `BoxTreePainter` copies only `Negation` and `Set` to that connector. The reference notes' claim that the command applies to a coil and a box output (`15-ld-elements.md`, corrected) was the help page's wording; its "box output" is the main connector.

**Two marks.** `Negate` clears the edge on a value and a pin, and `Trigger` clears the negation (`Reset = false` clears both low bits), so in either order the editor stores the last one alone. The one place it holds both is the main connector, edge first then Negation: `Negate` does not clear it there. Two places hold one each, and the run stacks them, inner first.

| drawn | text | run |
|---|---|---|
| main R then N (coil, S, R, jump, return, a box) | **refused**, `an edge stacked on a negation` | NOT of the edge, 45/15; on a jump `z` 15/15. Both marks drawn |
| main N then R | `y := RISING := a` | the edge: R cleared the NOT |
| value N, main R | `y := RISING := NOT a` | 15/0 |
| value R, main N | `y := NOT := RISING(a)` | 45/15: the run of the main stack, another picture |
| value R, main R | `y := RISING := RISING(a)` | 15/15 |
| coil N, main R or value R | `NOT y := RISING := a`, `NOT y := RISING(a)` | 45/15 |
| value R, pin N | `t(NOT in := RISING(a))` | 45/15 |
| value N, pin R | `t(RISING in := NOT a)` | 15/0 |
| value R, pin R | `t(RISING in := RISING(a))` | 15/15 |
| value N, pin N | `t(NOT in := NOT a)` | 30/30 |

**Place against place.** The same mark on the pin, the value, the item or the coil runs alike alone (15/15 rising, 30/0 NOT) and draws apart: the triangle or circle sits on another connector, or `P`, `N`, `/` in the contact. The runs differ once two stack, per the table. So both a value and a receiver spelling state something the IDE holds: dropping either loses a picture, and a stack.

**What a push stores.** Each state's pull pushed as a new POU, 112 forms (the push test hit its limit at 12 s a push on 300 POUs, so the FBD forms past the jump were not pushed, their LD twins were): the same pull and the same counts on all 112, none refused. Stored marks are the editor's. Two differences, neither in the run: an item holding a jump or a return also holds that bit on `BoxTreeAssign.Flags` (C13's cache; the editor stores it on the target only), and an enabled operator's input names are `['EN','','']` where the editor has `['EN']`.

**Set Output** (`AllowSetOutput`: a non-main output with no EN shown; a PROGRAM offers none, its second slot holding the insert's null). `Common.ChangeBoxMainOutputIndex` moves the operand to the first null and a null to the slot.

| drawn | stored | run | text |
|---|---|---|---|
| FUNCTION q,q3, Set Output on q3, k in the result slot | `['k',null,null,'']` | `k=6`, consumed `y=q=TRUE`: the first null is q, not the slot the command was given | `F(n := i, OUT => k).q;`, `y := F(n := i, OUT => k).q;` |
| FB q1,q2, on q2 | `['x',null]` | `x=TRUE` | `t2(a := a, n := i, q1 => x).q2;` |

**Each refusal against the editor.** "Cannot draw" is the command's `Enabled` or the absent cell, measured on that kind.

| refused form | the editor |
|---|---|
| `RISING y := a`, S, R; `RISING JMP.l := a`; `RISING RETURN := a`; `RISING q => x`, `RISING OUT => x` | cannot draw. Kept. Its edge is the main connector, `y := RISING := a`, which runs once |
| `y := RISING NOT := a`, jump and return alike | **draws it, and it runs NOT of the edge.** Kept as a text, its reason corrected: `RISING NOT` would read as the edge of NOT a, which is 15/0. Needs a spelling, for the owner |
| `t1(RISING NOT IN := a)`, `AND(a, RISING NOT := b)`, `RISING NOT EN := c`, `RISING NOT y := a` | cannot draw: each command clears the other. Kept; the generator takes the NOT alone |
| an S or R on a box output | **draws it, and it holds or clears.** Pull refused, `a coil flag on a pin`. Needs a spelling, for the owner |
| `F0(n := i, OUT => k);`, a function with no VAR_OUTPUT | cannot draw: no output cell, the insert's two nulls. The drawn form is `k := F0(n := i);`. Kept |
| `F1(n := i, OUT => k, q3 => m);`, no output read | cannot draw: every list holds a null. Kept. Closed by `.q` it is the Set Output form above, which a push **refused until this measurement**, `a function box read by a VAR_OUTPUT has no measured build`. Lifted on CODESYS: pushed, built, run, `k=6 m=7 y=TRUE`, `e2e function-output-read` |
| `F0(EN := go, n := i, OUT => k);` | cannot draw: EN and ENO come together, the `AddEN` toggle off without an OEM setting. Kept |
| `y := f(n := i).ENO`, no EN | cannot draw, as above. Kept |
| `k := ADD(i, j, OUT => m)`, `x := GT(…, OUT => z)`, `k := MOVE(i, OUT => m)` | cannot draw: a plain operator holds `[null]`, no output cell, and an assignment over it is `k := ADD(i, j)`. MOVE always shows ENO. Kept |
| `P2(…, OUT => k)`, `t2(…, OUT => k)` | cannot draw: its pins are the declared names. Kept |
| `SUB(IN2 := i, IN1 := j)`, a pin out of place | cannot draw: an operator stores no pin names, `InputParams []`, EN alone where shown. Kept |
| `ENO => z` | cannot draw: ENO's connector holds the null, `AllowSetOutput` false with EN shown. Kept |
| `AND(EN := go, a, b).ENO;`, `y := GT(EN := go, i, j).ENO` | cannot draw: `OUT => ???` comes with the insert and an operator's output has `CanDelete` false; `???` does not build. Kept |
| `t2(a, i);` | cannot draw: an FB's names come with the insert. Kept |

### What works

| wanted | form | ran |
|---|---|---|
| ENO and the value | `y := GT(EN := go, i, j, OUT => z).ENO;` | `y=TRUE z=TRUE`; EN false: y FALSE, z held |
| | `y := AND(EN := go, a, b, OUT => z).ENO;` | `y=TRUE z=TRUE`; EN false: z held |
| | `y := MOVE(EN := go, i, OUT => k).ENO;` | `y=TRUE k=5` |
| | `y := ADD(EN := go, i, j, OUT => k).ENO;` | `y=TRUE k=8`; EN false: k held |
| | `y := F0(EN := go, n := i, OUT => k).ENO;` | `y=TRUE k=6`; EN false: k held |
| | `y := LIMIT(EN := go, 0, i, 3, OUT => k).ENO;`, `y := LEN(EN := go, 'abc', OUT => k).ENO;`, `y := NOT(EN := go, gf, OUT => z).ENO;` | as they read |
| ENO alone, a FUNCTION | `y := F0(EN := go, n := i).ENO;` | `y=TRUE` |
| two targets | `k := m := MOVE(i);`, `k := m := ADD(i, j);`, `k := m := F0(n := i);`, `x := y := GT(EN := go, i, j);` | both written |
| | a wire, `w1 := MOVE(i); k := w1; m := w1;` | both written |
| ENO on two coils | `z := y := MOVE(EN := go, i, OUT => k).ENO;` | all three |
| ENO's variable and the value | `z := F1(EN := go, n := i, OUT => k).ENO;` | `z=TRUE k=6` |
| | with a named output, `z := F1(EN := go, n := i, OUT => k, q3 => m).ENO;` | `z=TRUE k=6 m=7`. `q => x` before `OUT =>` is refused by the CODESYS driver: "a slot another pin already holds" |
| a FUNCTION's value and its outputs | `k := F1(n := i, q => x, q3 => m).OUT;` | `x=TRUE k=6 m=7` |
| FB pins | `t2(a := a, n := i, q2 => k);`, in any order of the names | as named |
| an edge, on a coil | `y := RISING(a);` or `y := RISING := a;` | once |
| on a jump, a return | `JMP.l := RISING(a);`, `JMP.l := RISING := a;`, `RETURN := RISING(a);`, `RETURN := RISING := a;` | once |
| on an output | `x := RISING := t2(a := a, n := i).q1;`, the editor's; `x := RISING(t2(a := a, n := i).q1);` | once |
| a function's value and the output read | `y := F1(n := i, OUT => k, q3 => m).q;`, `F1(n := i, OUT => k).q;` | `k=6 m=7 y=TRUE` |
| on a negated value | `RISING(NOT gf)`, `RISING(NOT t2(…).q1)` | once |

### Checked, runs as it reads

Measured, one form each unless a count is given: `NOT` on a contact, a pin, an unnamed pin, a coil, a jump, the return, EN, an output, `OUT =>`, a box read, the item; `RISING` and `FALLING` as `RISING(x)`, on a pin, an unnamed pin, EN, the item, a box read; `S=`, `R=` and their chains; `RAIL()` on a coil, a pin, EN; a mid-rung coil; `JMP.l :=` on a value, `RAIL()`, beside a coil, in a tree; `RETURN :=` on a value, `RAIL()`, beside a coil; `BRANCH` fed, unfed, on the rail, with a box (it runs); `BRANCH_SHORTCIRCUIT` (the box skipped under a TRUE free branch, run otherwise); an operand holding ST; `TRUE`; `COMMENT` on a value, a coil, a pin, an output, under NOT; a value alone; a root box under NOT or an edge (the marks of no effect, the box run); `.NAME` at a root and read; a wire; `%DISABLED`; `EXECUTE` with and without EN and ENO; `x := GT(EN := gf, i, j);` FALSE and any other enabled box read by a coil held; `t2(EN := gf, …)` not called; `t2(…).ENO;` and `P2(…).ENO;` at a root with no EN, which run as the plain call. `TON(IN := a);`, `x := ??? AND a;`, `q2 => ???` do not build, and a build that refuses them is what they read as.

Not measured here: `F(EN := go, …, OUT => k);` past the first dialog, since the batch stopped there (`F1`, `LEN`), so those rows are refused by the rule, not by a run of their own; `OUT => ???` on a program declaring no output is the corpus's form and stays, measured only on a program with outputs, where it lands as `q1 => ???` and does not build; LD beyond the rows marked; TwinCAT.

## Not measured

- A real extensible callee. The compiler's marker is `VarFlag.ImplicitParamsStruct`, and `PARAMS OF INT` parsed to a pin of type `ERROR`, so `ContainsExtensibleInputs` was set by hand only. The editor's own path through `SignatureAnalyzer` is read, not run.
- Editor commands other than the insert, Edge Detection, Negation, Set/Reset and Set Output (Update parameters, Remove unused pins, a pin's delete): read in the DLL, not driven. The EN/ENO toggle is off without an OEM setting, its `Enabled` read false.
- A METHOD or ACTION box: only as a wrong `CallType`.
- A run with `go` false: EN gating is read from the structured code.
- LD for the EN/ENO and member rows.
- TwinCAT, beyond the table above.
- Why `Instance = ' '` on a FUNCTION or PROGRAM pulled plain live while the offline double refuses it (6 rows, no IDE path: the editor writes `' '` only for a method).

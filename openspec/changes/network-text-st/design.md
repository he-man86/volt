# network-text-st — design

## 1.1 Census: NWL nodes in the corpora, and their plain-ST spelling

**Target.** Every node kind and flag the IDE stores, counted on the models (`NetworkModel`). Each one gets its plain-ST
spelling per 1.2, or the marker *ST cannot carry it*, which sends it to 1.3/1.4.

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
| NOT box | 3 / 2 / 3 | `NOT a`. **ST cannot carry it** apart from the next two rows: 1.2 measured `NOT(a)` and `NOT a` as one AST |
| negated contact or leaf | 359 / 10 / 2 | `NOT a` |
| negated input pin | 6 / 3 / 0 | `NOT a` |
| LD Parallel (BoxShortCircuit 16, Sequential 1; 3 branches 1; no feed 5) vs LD OR box (180) | 17 / 16 / 0 | `a OR b` for both. **ST cannot carry it** (Parallel vs box, and Mode). 1.3: 178 of the 180 are contacts (the OR box with no output item), 1 a drawn OR box, 1 TwinCAT's; run time identical. BoxShortCircuit measured on one shape only (an enabled FB on a branch, 0 in the corpus); the corpus shapes are measured in 1.4 |
| · TwinCAT: a hand-drawn LD parallel is stored as an OR box | – / – / 5 | the archives' 5 LD parallels (`Vn_ld_parallel2`, `…3`, `…_series`, `…_then_series`, `Vn_ld_series_parallel`) each hold one `BoxType "OR"` box and no `BoxTreeParallel`: TwinCAT has no Parallel-vs-OR distinction in LD (a measured vendor asymmetry, counted in the 25 archive OR boxes above). 1.3 |
| function box, Execute excluded (corpus: incl. 14 enabled PROGRAM calls, lenze-mid: the model has no program kind) | 227 / 60 / 43 | a call |
| · MOVE (stored as a function call) | 102 / 47 / 3 | `x := MOVE(v);` positional (1.2: a built-in takes no formals), only for a MOVE an Assign consumes (corpus: 1). The other 101 corpus MOVE boxes have their result pin wired to a variable: see the result-pin row |
| · other built-ins (TO_STRING; in archives MAX, MIN, MUX, SEL, LIMIT, SHL…ROR, trig, conversions, ADR, SIZEOF) | 1 / 2 / 35 | positional |
| · library or user POU (incl. CONCAT, LEN, DELETE, REPLACE; and the 14 PROGRAM calls) | 124 / 11 / 5 | formals as stored (`f(IN := a, o => y)`), 1.2 clean |
| box with outputs wired (`=>`) · with a named output (boxes; corpus: 87 named output pins on the 43; 177 = 130 result-pin boxes + 43 named-output boxes + 4 `=> ???`) | 177 · 43 / 54 · 5 / 0 · 0 | `o => y` in a formal call |
| · keyword operator or built-in whose result pin is wired to a variable (`v MUL 10 => x`): ADD 17, SUB 5, MUL 5, DIV 2 (every corpus arithmetic box), MOVE 101 (15 of them on an EN-chain continuation) | 130 / – / – | **ST cannot carry it**: `x := MOVE(v);` / `x := i * j;` read back as an Assign root over the box, not a box with a wired result pin, and an operator has no call form (1.2). 1.3/1.4 |
| · output slot wired to `???` (Mach1_MIDS ×3, AHWF ×1) | 4 / – / – | **ST cannot carry it**: `=> ???` names no variable. 1.3: builds (compiled, 0 errors); 1 is a BOOL function's result slot, 3 the extra unnamed slot of an enabled call (2 PROGRAMs, 1 FUNCTION with no type; `RebuildLoss.ExtraOutputSlots`), all `CallType Function`. Not result pins. 1.4 |
| FB box | 157 / 14 / 19 | `t1(IN := a, PT := p);` |
| · output read by name | 93 / 7 / 0 | `x := t1.Q;` after the call |
| · instance `???` | 4 / 1 / 0 | **ST cannot carry it**: `???(…)` is no call. v2 spells it today (`??? : TYPE(…)`, added so the Lenze POU can be pushed back). 1.3/1.4 |
| box at a tree's root (no Assign) | 184 / 33 / 20 | a call statement `f(…);` / `t1(…);`. 1.3: a root function box without EN whose result slot holds a variable builds and never writes it (0 in the corpus) |
| EN | 226 / 63 / 2 | **ST cannot carry it**: CODESYS ST has no EN/ENO (1.2). 1.4 decides between `IF en THEN … END_IF` and a `%` line |
| · on a keyword operator · function or built-in · FB | 69 · 132 · 25 / 10 · 50 · 3 / 1 · 1 · 0 | as above |
| · EN unwired | 37 / 3 / 0 | as above |
| · EN without ENO (in the corpus: all 40 are comparisons) | 40 / 11 / 2 | as above |
| ENO | 187 / 59 / 0 | as above |
| · ENO is the connected output (an EN chain) | 58 / 37 / 0 | as above |
| Execute box | 12 / 9 / 0 | the snippet is already ST. **ST cannot carry it** (where the box starts and ends): 1.4 |
| coil (Assign at a tree's root) | 483 / 142 / 131 | `x := v;` |
| · set · reset | 118 · 128 / 5 · 5 / 2 · 2 | `x S= v;` `x R= v;` |
| · several targets | 40 / 7 / 7 | `a := b := v;`, a chained assignment (1.2 clean). No wire |
| · fed by the bare rail (Terminator value, no jump) | 4 / 2 / 0 | **ST cannot carry it** apart from a `TRUE` leaf: `x := TRUE;` is a different tree. 1.3/1.4 |
| · negated coil | 0 / 2 / 3 | **ST cannot carry it**; v2 spells it (`NOT x := a;`). 1.3/1.4 |
| · edge coil (rising, falling) | 0 / 3 / 0 | **ST cannot carry it**; v2 spells it (`R_EDGE x := a;`). 1.3/1.4 |
| mid-rung coil (Assign nested in a tree) | 6 / 2 / 0 | **ST cannot carry it** as an expression. 1.3: runs as `out := a; out2 := a AND b;` |
| Demux: definitions · references | 140 · 436 / 11 · 14 / 4 · 10 | a wire variable `w := …;` then `w`. Name and declaration: 1.4 |
| · definition fed by the bare rail (Terminator input: `split2 := ;` ×4, GeneralProgramFlags) | 4 / – / – | **ST cannot carry it**: `w := ;` is no ST, `w := TRUE;` reads back as a Leaf. 1.3/1.4, with the rail-fed coil |
| edge contact or leaf (rising, falling) | 1 / 3 / 3 | **ST cannot carry it**: ST has no edge operator, and `R_TRIG` needs an instance. v2 spells it (`R_EDGE NOT clk`). 1.3/1.4 |
| edge on a pin, or edge/negation on a box output or EN (negated input pins: the row above) | 0 / 6 / 0 | **ST cannot carry it**; v2 spells it (`TON(NOT IN := v …)`). 1.3/1.4 |
| unwired input pin | 7 / 5 / 2 | the pin left out of the call. Whether an omitted pin reads back as unwired is Volt-side: 2.2 |
| jump · return | 0 · 1 / 7 · 4 / 2 · 2 | `IF c THEN JMP l; END_IF` / `IF c THEN RETURN; END_IF` (unconditional: `JMP l;` / `RETURN;`) |
| a tree that is a lone leaf with no operand | 1 / 0 / 0 | **ST cannot carry it**: `;` is no node. Niche, accepted loss (1) |
| network: title · comment · label · disabled | 260 · 20 · 2 · 3 / 5 · 3 · 9 · 2 / 0 · 0 · 0 · 0 | `%NETWORK "…"`, `//` lines, `%LABEL l`, `%DISABLED` |
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

**Open, for 1.3 → 1.4 (the owner's list):**
- NOT box vs negation;
- Parallel vs OR box, and its Mode;
- EN/ENO and an unwired EN;
- the Execute boundary;
- the mid-rung coil;
- the rail-fed coil and the rail-fed wire definition;
- a keyword operator or built-in whose result pin is wired to a variable (`v MUL 10 => x`, 130), and an output wired to
  `???` (4);
- shapes v2 spells today that ST has no form for: the `???` instance, the negated coil, edge coils, edge contacts and
  leaves, edges and negations on a pin, an output or EN. The proposal names the negated coil and the edge contacts as
  the design's real work, and the owner's rule is that every stored shape gets a spelling, so none of these is an
  accepted loss;
- whether an omitted pin reads back as unwired (Volt-side, not measured by 1.3: 2.2).

**Niche, accepted loss:** the empty lone leaf (1).

**Migration:** none in this step. The corpus stays v2 text until 2.1 re-pulls it through the plain-ST writer.

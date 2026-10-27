# network-text-st — design

## 1.1 Census: NWL nodes in the corpora, and their plain-ST spelling

**Target.** Every node kind and flag the IDE stores, counted on the models (`NetworkModel`). Each one gets its plain-ST
spelling per 1.2, or the marker *ST cannot carry it*, which sends it to 1.3/1.4. **Choice:** the corpus as models,
read by today's reader with the push's scope. The corpus is 46 bodies and 394 networks, which matches
`ModelRoundTripOracleTests`, so the read is lossless. The reader ran on a scratch copy with `IMPLEMENTATION` spelled
`%LANGUAGE`, because language-line is mid-build. The scratch test was deleted. Rejected: text greps (they count
spellings, not nodes); a live IDE walk (it adds nothing over a corpus the oracle round-trips 1:1). Counts are
corpus / fixtures (`test/fixtures/network-text/accept` 121 + `tc-native-corpus` 106; 3 tc-native texts no longer read).
Bodies LD 36 / FBD 10. Networks LD 356 / FBD 38.

| Node (count) | Plain ST |
|---|---|
| keyword-operator box: AND 648, OR 184, EQ/GE/GT/LT/LE/NE 45, ADD/SUB/MUL/DIV 29 (/ 149) | infix only (1.2). An n-input box is one chain `a AND b AND c`. A nested box is bracketed `(a OR b) AND c` |
| NOT box 3 (/ 5) · negated contact/leaf 359 (/ 10) · negated input pin 6 (/ 3) | `NOT a` for all three. **ST cannot carry it**: 1.2 shows `NOT(a)` and `NOT a` give one AST |
| LD Parallel 17 (BoxShortCircuit 16, Sequential 1, no feed 5) vs LD OR box 180 | `a OR b` for both. **ST cannot carry it** (Parallel vs box, Mode): 1.3 measures whether the 180 LD ORs are contacts |
| function / built-in box 227 (/ 101); result output 134, named output 87 | `x := LIMIT(0, v, 9);` positional for built-ins. Library/user functions keep the stored formals (`o => y`) |
| FB box 157 (/ 33), output read by name 93 | `t1(IN := a, PT := p); x := t1.Q;` |
| FB with instance `???` 4 (/ 1) | **ST cannot carry it**: `???(…)` is no call. Niche, accepted loss (4) |
| EN 226 (EN unwired 37), ENO 187; EN-only comparisons 40 | **ST cannot carry it**: CODESYS ST has no EN/ENO (1.2). 1.3 measures ENO at run time, and 1.4 decides between `IF en THEN … END_IF` and a `%` line |
| Execute box 12 (/ 9) | the snippet is already ST. **ST cannot carry it** (where the box starts and ends): 1.4 |
| top-level box, no Assign, 184 (/ 52) | a call statement `f(…);` / `t1(…);` (1.3 checks a discarded function result) |
| coil (Assign) 483; set 118, reset 128; negated coil 0 (/ 2) | `x := v;` `x S= v;` `x R= v;`. Negated coil: **ST cannot carry it**, niche (0) |
| several targets 40 (/ 10) | `a := b := v;`, a chained assignment that 1.2 measured clean. No wire is needed |
| mid-rung coil (nested Assign) 6 (/ 2) | **ST cannot carry it** as an expression. 1.3 measures it |
| Demux: 140 definitions, 436 references (/ 18, 29) | a wire variable `w := …;` then `w`. Its name and declaration are open point 1.4 |
| edge contact, pin or coil: rising 1, falling 0 (/ 10) | **ST cannot carry it**: no edge operator, and `R_TRIG` needs an instance. Niche (1) |
| jump 0 (/ 10), return 1 (/ 6), unconditional (Terminator value) 4 (/ 6) | `IF c THEN JMP l; END_IF` / `IF c THEN RETURN; END_IF` / `JMP l;` / `RETURN;` |
| network: title 260, comment 20, label 2, disabled 3, empty 22, unsupported 0 (/ 1) | `%NETWORK "…"`, `//` lines, `%LABEL l`, `%DISABLED`, an empty `%NETWORK`, `%UNSUPPORTED "<shape>" #hash` |

**Still refused by name (unchanged, below the text):** an unmeasured Parallel mode, a flag on a Demux, Parallel or
Assign item, a null input slot, a missing pin-flag list, and an unreadable Execute snippet (`BoxRefusals`,
`UnheldFlags`).

**Open, for 1.3 → 1.4 (the owner's list):** NOT box vs negation; Parallel vs OR box, and its Mode; EN/ENO and unwired
EN; the Execute boundary; a mid-rung coil. Niche, accepted loss: `???` instance (4), negated coil (0), edge leaf (1).

**Migration:** none in this step. The corpus stays v2 text until 2.1 re-pulls it through the plain-ST writer.

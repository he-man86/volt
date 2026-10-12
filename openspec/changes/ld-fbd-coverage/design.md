## 1.1 Design — a spelling per census shape

**Target.** The 12 UNSUPPORTED bodies of tasks 0.1 pull as network text on both vendors, except S4, which stays refused
by name. Every addition is a text that is refused or unwritten today, so no existing text changes meaning.

| # | nets | spelling / rule | rejected (one line each) |
|---|---|---|---|
| S1 bit operator, stored slot | 7 | **If the probe shows the stored slot carries no meaning** (`nwl-bitop-stored-slot`: the stored form and the plain form build and run the same, and a pushed plain box builds): both READERS drop a bit operator's stored slot and output list at read, in the same place on both vendors (precedent: `WithoutStoredTypes`, N23's editor caches), and it is written as today's `(a AND b)` / `NOT(a)`. If the probe finds a difference, it **stays refused by name** and goes back to the owner | call form `AND(a,b)` meaning "has a slot": `NOT(a)` is already the NOT box with no slot, and call and group are one model (reader L639) · a new slot suffix: the output's name is `""`, so ST has nothing to write after the dot |
| S2 assign below top level | 6 | ExST assignment as an expression, in its own pair: `MOVE(EN := (Mach1_AuxData.ADS_StopOnZeroPulse := (w188 AND …)), 750, => Cor_numerator);` and the same with `S=` / `R=`. Grammar: `core += "(" , lvalue , op , { lvalue , op } , value , ")"`. A pair holding `:=`/`S=`/`R=` at its own depth is the third pair kind. Today it is "neither", so it is refused | a wire at the split: adds a Demux the vendor does not store (v2: names only at vendor Demux) · IF form: v1, retired |
| S3a leaf-fed wire, untyped | 2 | The wire takes the leaf's **declared** type, which the text carries by name and the scope resolves from the same declarations on both sides (`NetworkScope` gains variable types: own, owner's, GVLs). A leaf with no plain declaration (array element, member path of an untyped holder) stays refused by name | (i) the callee's pin type: `TON`/`R_TRIG` are library FBs, and Volt.Engine has no library signatures · (ii) `InputParam.Types`: Volt's own push writes it empty, so it is an IDE cache (as N23) and cannot be read back from text |
| S3b rail-fed wire | 4 | Already spelled: `g2 := ;` (a lone wire target fed by the empty Terminator, as `coil := ;`). Only the type rule is new: in **LD** a Terminator-fed wire is BOOL (the left rail). In FBD it stays refused by name | `g2 := TRUE;`: TRUE pulls as a Leaf, a different node |
| S6 pin flag | 1 | On the formal, which forces the named form: `L_FirstErrCaptureErrorAccess(NOT xEnable := xStructError)`. An operator box's unnamed pin is written with its default formal (`AND(NOT IN1 := a, b)`). Negation only (census 1.13: 6 of 6 pins). An edge on a pin stays refused by name | `f(xEnable := NOT x)`: that puts the flag on the value, a different node (the docs table already distinguishes the two) |
| S5 `SUPER^` call | 1 | `` `SUPER^`(…) ``. The scope maps `SUPER^` to the POU's `EXTENDS` type (the declaration is already in scope) | marker kept: the fix is cheap, so the triage rule says fix it |
| S4 main output ≠ slot 0 | 1 | **Stays refused by name:** "niche: accepted loss (1 occurrence in the corpora)". `MainOutputIndex` is read-only on a constructed `BoxTreeBox` (N21), so no push can build it. To name the slot (`.xErrorActive`), the reader would also need the library FB's output order | — |

**Also stays refused by name** (0 in the corpora, as tasks 0.1 measured): an edge on a pin, rising and falling together,
a terminator-fed FBD wire, a flag on a Parallel or Demux, and every other writer refusal the per-tree scan never hit.

**Build order (by corpus count).** S1, then S2, S3, S6, S5. The S1 probe runs first because its answer decides between
the two outcomes in the table. Each shape is built test-first (2.1): a fixture on both vendors, then writer, reader,
gate, LSP parser and checks.

**Code split (2.2).** In the LSP: `parser.ts` (1372 lines) splits into statement, value/group, call/pin and the
pair-kind decision. The lexer's `next` splits per token class. `network-analysis.ts` splits per check family, and
`network.test.ts` per service. These lists are then emptied: the shrink-only entries, and the dead exports `TokKind`,
`CONSTRUCT_WORDS`, `v1Refusal` and `resolveAnywhere`. In C#, the S2/S6 parsing goes into `NetworkTextReader` next to the
existing pair rule, and nothing else moves.

**Probe rows (2.3), both vendors:** `nwl-bitop-stored-slot`, `nwl-nested-assign`, `nwl-rail-fed-wire`,
`nwl-input-pin-flag`, `nwl-super-call`. They are **not** rows: `nwl-main-output-slot` (N21 already answers it),
`nwl-input-param-type` (S3a does not use it), and N23 and N25 (they stay as DIALECT records outside the table's
vocabulary, as `vendor-fact-probe` 4.2 left them).

**Migration.** A re-pull rewrites the 11 bodies that used to be UNSUPPORTED (S4's body keeps the marker). If S1 is
inert, its 5 bodies change no text that pulls today. `docs/network-text.html` gets S2's grammar line, S6's pin form, and
the S3/S5 type rules, and the "Marker on pull" row loses those entries.

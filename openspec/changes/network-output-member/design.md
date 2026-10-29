# network-output-member — design

## 1.2 The rule (counts: tasks.md 1.1/1a; CODESYS corpora unless a vendor is named)

**The call is the box.** Two members close a call, each stating one stored fact the push can write:

1. **`.ENO`** closes the call of every box that shows ENO, consumed or at a root. A box showing ENO hands on its ENO (N16;
   network-text-st 3.0 measured the IDE holding an enabled MOVE built read at its value read by its ENO), so for such a
   box "shows ENO" and "chains ENO" are one fact, written once.
2. **`.NAME`** closes the call of a CONSUMED box without ENO that has more than one data output, naming the one its
   consumer reads. Data outputs: a function's value, named `OUT`, then its `VAR_OUTPUT`s; an FB's declared outputs.

`EN :=` written = EN shown. Nothing else states EN or ENO; the four EN/ENO pairs are four spellings.

```
x    := GT(a, b);                                                     // no EN, no ENO, one output
x    := GT(EN := c, a, b);                                            // EN, no ENO: the value
y    := MOVE(EN := c, k);                                             // EN, no ENO: the value
done := MOVE(EN := MOVE(EN := c, 1, OUT => x).ENO, 2, OUT => y).ENO;  // EN and ENO, chained
x    := f(IN := a).ENO;                                               // ENO, no EN
x    := AND(R_TRIG(FB := r1, CLK := a), b);                           // FB, one output
x    := AND(TON(FB := t1, IN := a, PT := T#1S).Q, b);                 // FB, two outputs: Q chains
t    := TON(FB := t1, IN := a, PT := T#1S).ET;                        // a moved pin: ET chains
x    := TON(FB := t1, EN := c, IN := a, PT := T#1S).Q;                // FB with EN, no ENO
q    := g(a, Q => r).OUT;                                             // a function with a VAR_OUTPUT: its value chains
MOVE(EN := c, 1, OUT => y).ENO;                                       // a root showing EN and ENO
MOVE(EN := c, 7, ENO => lamp, OUT => x).ENO;                          // a root whose ENO is wired
TON(FB := t1, IN := a, PT := T#1S, Q => lamp);                        // a root FB
```

| box | n (CODESYS) | n (TwinCAT archives) |
|---|---|---|
| consumed, no member (one data output) | 1,018 (keyword 878, function 83, FB 56, MOVE 1) | 142 |
| consumed, `.ENO` | 56 (MOVE 32, keyword 13, FB 8, function 3) | 0 |
| consumed, `.NAME` | 43 (FB 37: 35 the first output — `WSM`, `Dryer` among them — 2 the second; `.OUT` 6, `RuntimeGuard`) | 2 (TON `.Q`) |
| root, `.ENO` | 117 (MOVE 69, FB 16, function 16, keyword 16) | 0 |
| root, no member | 55 (FB 38, function 17) | 20 |
| Execute, its own form (unchanged) | 11 | 1 |

- **Member names.** `OUT` for a function's value: a Volt name (NWL stores `''`, `'   '` or `'Out1'`, no box stores
  `OUT`), the same word its `OUT => v` target already uses; the declared name for an FB's or a function's `VAR_OUTPUT`;
  `ENO`. Other outputs stay `NAME => v`; several targets of the value `OUT => a, OUT => b`, as today.
- **An FB box** is a call of its TYPE, the instance its first pin `FB :=` (`FB := ???` for an unbuilt one, 4 roots), then
  `EN :=`, then its pins.
- **Declared vs shown EN/ENO.** EN and ENO are a box's implicit pins, as in IEC 61131-3: a callee that DECLARES `EN` or
  `ENO` has them as ordinary pins, and `EN :=` / `.ENO` / `ENO =>` on its box name those (`WSM(FB := w1, EN := TRUE,
  …).ENO` is WSM's own `EN` input and `ENO` output, read through rule 2; no flag shown). The names mean the flags only
  where the callee declares none, which is ST's own lookup. 2 boxes (lenze-mid, both in the `.NAME` row). The accept case
  `fb-call-read-through-declared-eno` follows the reader: flags false, the declared `ENO` its data output.
- **A callee no declaration in reach states** (no POU, GVL or library signature names it: the CLI's post-push check,
  which reads with the body's own declaration only — `PushedText.SameBody`, `declarationOf: _ => null`,
  `libraryFunction: _ => null`; a library without signatures at a push). Three readings need the callee's declaration:
  `EN :=` / `.ENO` / `ENO =>` as the shown flags or declared pins, `.NAME` required or refused, and a consumed FB's one
  output when no `.NAME` is written. The reader reads such a call AS WRITTEN — `EN :=` first the shown EN and `.ENO` the
  shown ENO (the reading of a callee that declares neither, 2a "As built"), any other `.X` the output named `X` — and
  decides nothing a declaration would. The PUSH refuses the box by name (`<callee>: no declaration in reach states its
  pins, so EN/ENO/.X cannot be told from a declared pin`), never a guess, as today's push refuses an FB whose outputs no
  declaration states (`NetworkPairing.NamedMainOutputs`). The POST-PUSH CHECK compares the two texts read as written in
  its one scope: the push resolved the pushed text against the project before writing it, the held text is the IDE's,
  and the same unresolved reading of both is one model when the written forms agree — it refuses nothing for an
  unresolved callee, so a push that landed is never reported as diverging for it. A refusal that needs the declaration
  (`.OUT` on a function without `VAR_OUTPUT`s, `.X` naming no output) fires only where the declaration is in reach. 2.1
  counts the corpus boxes whose callee a push meets out of reach.
- **The root.** A root box hands nothing on, so rule 2 has nothing to name; rule 1 states the ENO flag there as anywhere.
  `ENO => v` is a target of the shown ENO, so it comes with `.ENO`, never instead of it. A root box showing ENO is the
  statement `f(…).ENO;` — a call closed by `.ENO`. That is no ST statement, so network text's statement grammar names it:
  assignment, call, call closed by `.ENO`, `JMP`/`RETURN`, label (`StNetworkReader`, and the LSP's subset check, 2.2);
  `.X` other than `.ENO` closing a statement is refused. 117 roots (MOVE 69, FB 16, function 16, keyword 16).
- **Execute** (`%EXECUTE(EN := c, ENO => w)`, its ENO by type) is no call and keeps its form.

Refused by name (the IDE holds no such box, or Volt cannot write the fact):
- `.X` other than `.ENO` on a box showing ENO — the IDE holds it read by its ENO (measured, network-text-st 3.0: "an
  enabled box read by its value showing ENO", 0 in the corpora);
- `.X` on a box with one data output (including `.OUT` on a function without `VAR_OUTPUT`s), a consumed box with several
  and no `.X`, `.X` naming no data output of the box, `ENO => v` without `.ENO`;
- `.X` other than `.ENO` at a root: a root's main output is no connection, and `MainOutputIndex` is read-only on a push
  (N21). The one root that stores a moved pin (`L_FECA.L_GetErrorTextFromFileReadArray`, index 1) is spelled by no
  text and held by no model (`CodesysNetworkReader` keeps `ConnectedSlot`/`MainOutputName` on a consumed box only), so
  the round-trip oracle cannot see it: an unchanged network keeps it (the change gate), an edited one is rebuilt with
  the IDE's own index. Niche, accepted loss (1 occurrence in the corpora), COUNTED, not silent: `RebuildLoss` gains a
  `MainOutputIndex` candidate (CODESYS reads a root box's stored index, so a rebuild that does not give it back warns),
  and the CODESYS round-trip census lists the box as a known divergence "niche: accepted loss (1 occurrence in the
  corpora)" (2.1).
- A function that declares a `VAR_OUTPUT` named `OUT`: `.OUT` and `OUT => v` would name its value and that output
  both. Refused by name (`<f> declares VAR_OUTPUT OUT, which also names its value`). Niche: 0 occurrences in the six
  corpora (no FUNCTION there declares `OUT`), the refusal cheap.
- The push of `.NAME` on a FUNCTION naming a `VAR_OUTPUT` (0 in the corpora; every one of the 10 functions with
  `VAR_OUTPUT`s chains its value (6) or its ENO (1), or stands at a root (3)): the text spells it by rule 2, but no build route for a function's moved pin
  is measured — the null-slot route (`NetworkDerivation.WithOutputSlot`) is FB-only. The push refuses it by name, like
  an FB whose outputs no declaration states, until 2.5 measures it live.
- The suffixes `_EN`/`_ENO`/`_ENONLY` and the FB statement form `t1(…);` are unknown callees / an instance call the
  subset refuses — no compatibility (no users).

Rejected, one line each:
- ENO stated by `EN :=` alone, a comparison excepted (the earlier draft): an exception in the grammar, and it cannot
  state EN without ENO on a MOVE or ENO without EN (accept cases `move-enabled` and `enabled-value`, measured building
  and running in network-text-st 3.0 as `X_ENONLY`; `function-eno-without-en`, recorded building on both vendors) — it
  would refuse shapes the IDE stores.
- a function's `VAR_OUTPUT` that never chains (`.OUT` refused everywhere): an unmeasured claim made a grammar rule; the
  6 `RuntimeGuard` boxes pay `.OUT` instead.
- `.X` at a root too: it would state a fact the push cannot write (N21), on every two-output root FB.
- `t1(IN := a).Q` as an expression: ST has no FB call in an expression; the LSP and the twin would need a second call
  form. `TON(FB := t1, …)` is one call form for every box.
- `.Q` always on an FB: a name with no alternative states nothing (56 boxes).

**Behaviour: one run left to measure in the twin.** Every spelling translates to ST the twin already has:
`TON(FB := t1, …).Q` → `t1(…);` before the item and `t1.Q` in it (today's FB statement form, the evaluation order a
statement before its tree); `EN :=` → today's `IF`/hold translation of `X_EN`/`X_ENONLY`; `.ENO` → today's `X_EN`/`X_ENO`;
a root statement `f(…).ENO;` → the call statement `f(…);` under the same enable translation (nothing reads a root's ENO
but its own `ENO => v`, which stays on the call); `.OUT` → the call itself (a function call with `=>` outputs in an
expression is plain CODESYS ST). `.NAME` builds through today's null-slot route (CodesysNetworkWriter /
TcArchiveBuilder, `NamedMainOutputs`). Measured RUNNING (network-text-st 3.0, `st-spellings-run.test.ts`): the `X_EN`
and `X_ENONLY` shapes only. ENO without EN (today's `X_ENO`, `function-eno-without-en`) is recorded BUILDING, never run:
2.3 adds it to `st-spellings-run.test.ts` and runs it live before its translation is trusted. The other vendor fact left
open is the function moved pin above (2.5).

Migration: the writer respells the case set from the model; LSP conformance fixtures respelled and re-recorded (2.5).

## 2a Build (writer, reader, LSP, twin, doc)

**Target.** The text layer only. The model already holds every fact the rule spells (`Box.Enable`, `HasEnoOutput`,
`ConnectedSlot`, `MainOutputName`, `Instance`), so `NetworkModel`, the vendor readers/writers and `NetworkDerivation` stay;
`StNetworkWriter`/`StNetworkReader`, the LSP's network check + box typing, the twin and the doc change.

**Choice: one call form, decided by the callee's declaration in the scope, the as-written reading the same code path.**
- Writer: `Suffix()`, `Suffixed()`, `EnabledNameInReach` and the FB statement form go. A box writes `Type(` (an FB:
  `FB := inst` first) `EN := e` when `Enable` is set, pins, outputs `)`, then `.ENO` when `HasEnoOutput`, else `.NAME` when
  consumed and the declaration (`scope.Callee` / `BlockOutputs`) states more than one data output (`MainOutputName`, or
  `OUT` for slot 0 of a function). Callee unstated: `.NAME` written whenever `MainOutputName` is set — the as-written form.
  An FB box's head is its stored type and its instance the `FB :=` pin's text, so the reader takes neither from a
  declaration (an instance declared with another type is refused by name, as the writer refused it).
  A wire defined by an FB output is `w := TON(FB := t1, …).Q;` like any Demux; the "read once = the call statement" rule goes.
- Reader: the parser gains one postfix, `ACall.Member` (`.` is already a lexer symbol), and the statement form
  "call closed by `.ENO`"; any other member on a statement is refused. `BoxOf` decides from `scope.Callee(type)`: `EN :=`
  first = `Enable` unless the callee declares an `EN` input; `.ENO` = `HasEnoOutput` (consumed: `ConnectedSlot` 0) unless it
  declares `ENO`; `.NAME` = `MainOutputName` (FB) / the slot (function `OUT`, a `VAR_OUTPUT`). Callee unstated: `EN :=`
  first the shown EN, `.ENO` the shown ENO, `.X` `MainOutputName` — writer and reader agree, so `SameBody` compares as
  written for free.
- Push refusal of an unstated callee: beside the existing `NamedMainOutputs` refusal in the three vendor writers, one
  shared refusal `NetworkPairing.RefuseUnbuildableBoxes(vendor, network, scope)` (callee unstated AND the box shows EN or
  ENO, has a pin `EN` / `ENO`, a `MainOutputName`, or is a consumed FB; and a function read through a `VAR_OUTPUT`) — the
  messages 1.2 names, `NETWORK_UNSUPPORTED`. Not in the reader: the reader then needs a "push scope" mode flag, and
  `SameBody` would need the other mode.
- The 1.2 refusals (member on one output, naming no output, other than `.ENO` with ENO/at a root, `VAR_OUTPUT OUT`,
  function `.NAME` on a `VAR_OUTPUT`) are reader errors with the line, in one `MemberOf(call, callee, consumed)`.
- LSP: the parser already reads `f(…).X` (postfix member) and `f(…).ENO;` (`expr_stmt`). `names.ts` drops the three
  suffix names; `network-call.ts` types a box call as its callee's own signature (FB type + `FB :=` the instance, `EN`
  an optional BOOL input where undeclared) and `.X` as the declared output's type (`.ENO` BOOL, `.OUT` the value);
  `_plain-st.ts` accepts `expr_stmt` only as a top-level call closed by `.ENO` and carries the same refusals, same wording.
- Twin: `TON(FB := t1, …).X` → `t1(…);` before the item, `t1.X` in it; `EN :=`/`.ENO` → today's `X_EN`/`X_ENONLY`/`X_ENO`
  translations keyed on the flags instead of the suffix; root `f(…).ENO;` → `f(…);` under the enable translation.
- Doc: the suffix table becomes one sentence + the 1.2 example block; FB rows follow; stale anchors fixed (2.4 list).

Rejected: keep the suffixes and add only `.X` (two ways to say EN/ENO); a model field "unresolved" set by the reader
(a model fact that is no IDE fact); refusing an unstated callee in the reader (a mode flag, two readings of one text).

**As built (2a), where reality forced a different choice than above:**
- *An unstated callee's `EN :=` and `.ENO` read as the shown flags, not as pins named `EN`/`ENO`.* Read as pins, every
  callee a scope cannot state loses its shown EN/ENO on a round trip of the vendor model — every library function and
  every program in the CLI's post-push scope, and all of TwinCAT's archive oracle, whose scope states no callee — while
  the flag reading loses only a callee that declares its own `EN`/`ENO` (2 boxes, both stated wherever the declarations
  are in reach). The push refuses an unstated callee by name either way, and both readings are one reading of one text,
  so `SameBody` is unaffected.
- *The scope states a callee's pins in one query*, `NetworkScope.Signature(type)` (`CalleeSignature`: a block's, a
  function's — its value then its `VAR_OUTPUT`s — or a program's, which has no value), beside `Callee` (the function
  derivation, unchanged) and `BlockOutputs`. `Callee` answers no program, and a program's box shows EN/ENO on 16 roots.
  A name-list scope (the case set, the TwinCAT archive oracle) states a callee only through an explicit signature line
  (`fb TON IN PT => Q ET`, `function g IN => Q`, `program p => …`).
- *Measured* (2a): the CODESYS round-trip oracle over the five corpora is identical 316 / stored 72 (was 301 / 87: the
  FB type the text now carries is no stored member), 0 unsupported, 0 gaps; TwinCAT 143 / 8 and its two pinned niche
  categories, unchanged. Corpus boxes a push meets with a callee out of reach (against the push's scope: declarations
  and every library signature): 0 of the five CODESYS corpora, 0 of twincat-project14. The root moved pin is pinned as an
  `ExpectRed` known divergence (`StNetworkOracleCodesysTests`) and `RebuildLoss.RootMainOutput` names it on a rebuild.

**Review of 2a (gate), where the build was corrected:**
- *Every IEC operator states its pins, not only the 14 keywords, MOVE and NOT.* LIMIT, SEL, MAX, MIN, MUX, the shifts,
  ABS, SQRT, TRUNC, the `*_TO_*` conversions (`NetworkSpelling.IsIecOperator`, the list `NetworkMembers` already held) have
  one value and no EN/ENO of their own, where no declaration in reach names them — as the LSP reads every builtin. Without
  it a push refused an edited `LIMIT(EN := c, …).ENO`, which built before 2a, and the reader read `.OUT` on it as an
  unstated callee's output where the LSP refused it.
- *A program box read by a data output is spelled as a function's*, its outputs its `VAR_OUTPUT`s (no value): nothing
  where it has one, `.NAME` where several. Read through its first output it builds as before 2a; through a later one the
  push refuses it by name, as a function's moved pin (`NetworkPairing`, no measured build). 0 in the corpora.
- *An enabled box other than a comparison is read by its value or a data output only as a coil's value*, whatever closes
  its call but `.ENO`: `MUL(g(EN := c, a).OUT, 2)` is refused by the reader and the LSP as the writer refuses its model.
- *`FB :=` stands only on an FB box*: the call of an operator, a function or a program, or an instance that is a declared
  non-FB variable, is refused by name on both sides.
- *The writer refuses a model its text would read back as another box* when the callee is unstated: its own first pin
  `EN`, or a read through its own output `ENO`.
- *The exec twin keeps the evaluation order of network-text-st's text*: an FB box is called before the item that reads it
  on every scan, whatever enabled box reads it; what an enabled FB's pins evaluate runs under its EN. Which order CODESYS
  runs is measured in 2.3, not decided here.

Migration (no compat, no users): the case files' `=== model` blocks are the truth; their `=== text` is respelled by the
new writer from the model (one-shot scratch run, deleted), diffs reviewed; only `fb-call-read-through-declared-eno`'s
model changes (flags false, read by name `ENO`, its scope declaring `Dryer`'s outputs). LSP conformance fixtures and
`st-spellings-run.test.ts` respelled by hand, re-recorded in one batch per vendor (2.3/2.5). Corpus count of boxes a
push meets with an unstated callee: from the round-trip oracle in 2.1.

## FB boxes: the instance is the call head (owner, 2026-10-28: "that looks clean yes")

Overrides `TYPE(FB := inst, …)`. An FB box is a call ON ITS INSTANCE, plain ST: the instance's type is in the POU's VAR
section, where the IDE stores it. Each output wired to a variable is `X => v` in the call; the ONE output that chains
to the next element is `.X` on the call. Only a box with no usable instance (`???`, an undeclared instance) has its
TYPE as the call head. No network VAR section: the POU declares the instance; `%WIRES` names the network's wires.

```
t1(IN := a, PT := T#1S, Q => x);                              // nothing chains
x  := AND(t1(IN := a, PT := T#1S).Q, b);                       // Q chains
ok := t1(EN := c, IN := a, PT := T#1S, Q => x).ENO;           // enabled: ENO chains, Q to x
y  := t1(EN := c, IN := a, PT := T#1S).Q;                     // moved pin: Q chains
```

`x := t1.Q;` on its own line is a different stored element (a read of the instance's variable), written only where the
IDE stores that.

**As built (2.7, 2026-10-29).** A call head that is an FB instance in reach (`NetworkScope.InstanceType`: a name, a path, an
element of an array of FBs, `SUPER^`) is the FB box of the instance's declared type; a head that is an FB type in reach is the
box with no instance (`???`); any other head is the box of that type (`StNetworkReader.Callee`, the LSP's
`network-box.ts` `instanceOf`). `FB :=` is no word of the text any more: `FB` is an ordinary pin name. The writer heads a box
with its instance where a declaration in reach holds it, else with its FB type, refusing by name an FB type no declaration
states as a block (`an FB box with no instance whose type is no FB type in reach`).
- *Measured, a tally shift the design brings, not a defect to fix here:* the CODESYS round-trip oracle goes from identical
  316 / stored 72 back to **301 / 87** (unsupported 0, gaps 0): the 24 lenze-mid boxes whose stored type is spelled otherwise
  than their instance's declaration (`R_TRIG` declared `R_trig`, `TON` declared `Standard.TON`) read back as the declaration
  spells it — one type (`StDeclaration.SameType`), a stored member (`an FB type spelled as its declaration`), and the
  completeness ledger's `BoxTreeBox.BoxType — changed` (24) is a known loss again, as in network-text-st 3.2. The text has
  no place for the stored spelling without a second FB spelling (an exception the grammar should not have). TwinCAT
  archives unchanged (143 / 8). An instance no declaration in reach holds is written as the call of its type (a stored
  member, network-text-st 3.0's rule, `an FB instance no declaration holds as the unnamed instance`): 0 in the corpora.
- Refusals that pinned the `FB :=` pin go with it: `FB :=` on an operator, a function or a program; an instance pin that is
  no variable or names a non-FB variable; an FB box of another type than its instance's (no text can state it now — the
  writer still refuses such a model by name); an instance called; an FB type called without `FB := ???` (now the `???`
  spelling).

## The Execute box is a call: `EXECUTE(…) … END_EXECUTE` (owner, 2026-10-28: "we need a execute(en) function that has the ST inside")

Replaces `%EXECUTE` / `%END_EXECUTE`. The Execute box is a box like every other: a call, `EN :=` when the box shows EN,
its ENO the return value when ENO chains on; its ST stands between the call and `END_EXECUTE;` and is free ST (the LSP's
own statement parser). The exec twin writes it as `IF en THEN … END_IF`.

```
EXECUTE(EN := go)
    IF start THEN count := count + 1; END_IF
END_EXECUTE;
ok := EXECUTE(EN := go)
    count := count + 1;
END_EXECUTE;
```

### Revised: the code is a string input (owner, 2026-10-28: "just have the code as a string in the input")

Overrides the `EXECUTE(…) … END_EXECUTE` block above: no keyword pair. The Execute box is a plain call,
`EXECUTE(EN := go, CODE := '<ST>')`, its ENO the return when it chains on. The string holds the box's ST with real line
breaks (readable); a quote is `$'`, a `$` is `$$`. Measure in 2.6 whether CODESYS takes a line break inside a string
literal; if not, the raw line break is Volt's one deviation from an IEC literal. The LSP parses the string's content as
ST; the exec twin writes `IF en THEN <ST> END_IF`.

```
EXECUTE(EN := go, CODE := 'IF start THEN
    count := count + 1;
END_IF');
ok := EXECUTE(EN := go, CODE := 'count := count + 1;');
```

**As built (2.6, 2026-10-29).** Counted on the corpus text the vendor readers write (`test-corpus`, the pulls of the five
CODESYS corpora and twincat-project14; the same 11 + 1 boxes tasks.md 1.1 counted on the models): Execute boxes 12 (CODESYS
11: bakon-nano 2, lenze-mid 9; TwinCAT 1), **without EN 0**, **whose ENO chains on 0** — every one stands at a root showing EN
(`EN := TRUE` 8, a wire or a contact chain 4). The case set holds the other shapes: without EN 3 (`execute-top-level`,
`-verbatim`, `-empty`), read through its ENO 5 (`execute-read-through-eno`, `-in-a-chain`,
`-as-operand` ×2, `-through-a-wire`). So the read-once rule of the `%EXECUTE` form (a box read once through `ENO => w`,
standing directly before its reader) had 0 corpus uses; it goes with the form, and an Execute box nests where it is read
like every box (`x := EXECUTE(…) AND d;`), a wire over it is `w1 := EXECUTE(…);`.
- *The one string that spans lines is the one right after `CODE :=`*, a `'…'` string, in a network body: the bridge's
  `StNetworkReader.Lex` (which reads one body); in the LSP the file lexer ends every string at its line, as in every ST
  body, and `network/execute-code.ts` rejoins the `CODE :=` string of an open `EXECUTE(` call from the body's own tokens,
  bound by the body — one not closed is "an unclosed string" at the body's end on both sides (2.6 review: a lexer-level
  rule changed plain ST POUs, and an unclosed CODE string ran on into the units after it). A string spanning lines anywhere else, and a `CODE :=` string of
  another call, is refused by name ("a string across a line: only the Execute box's CODE spans lines"). The reader's line
  loops (the network split, the `%WIRES` prepass, the `%`/`//` line checks) skip the lines inside it.
- *The code's escapes are `$'` and `$$` only* (`NetworkSpelling.EscapeCode`/`UnescapeCode`; the LSP's `codeTokens`); any
  other `$` is refused by name, not read as IEC's `$N`, so the code has one spelling. A CR LF in the stored ST is written as
  the line break (the file's layout, as the old form wrote it); a lone CR is refused.
- *Its one output is its ENO, by type*: no member closes its call (`.ENO` on it refused by name). `EN :=` first where it
  shows EN, then `CODE :=` last, nothing else — refused by name otherwise.
- *`EXECUTE` is the text's own word*, under the one rule of the text's own words (`BRANCH`, `R_EDGE`, …): ANYTHING declared
  in reach under that name — a POU, an instance, a variable — is refused by name on both sides (`InReach`, the LSP's
  `lookup`), and a box of type `EXECUTE` that is no Execute box has no spelling (writer). A variable cannot be called, so
  the rule refuses more than an ambiguity needs; it is kept because it is the one rule every word of the text follows
  (2.6 review: narrowing it for `EXECUTE` alone would make the words two rules). Counted (2.6 review): LD/FBD bodies with an
  `Execute` in reach 0 (the corpus oracle meets no unspellable Execute box); elsewhere, project POUs declaring an `Execute`
  variable 15 and a `METHOD Execute` 24, none an LD/FBD body's scope, the methods called through their instance
  (`x.Execute(…)`). Pinned by the refuse case `execute-beside-a-variable-named-execute`.
- *The LSP reads the code as ST where it stands*: `plain-st.ts` makes `CODE := '…'` trivia, decodes and lexes the string's
  content and places those tokens after the Execute box's statement (its `;`), each span mapped through the escapes to its
  place in the string — so every ST check and the type engine read the box's ST as before, at its true position.
- *The exec twin* writes a root box `IF en THEN <ST> END_IF;` (unchanged) and a box read where it stands
  `eno := en; IF eno THEN <ST> END_IF;` before the tree, `eno` in it (its ENO is its EN).
- *Not measured (blocker)*: whether CODESYS takes a raw line break inside a string literal. The question is one
  `record:language` fixture (`s := 'a` LF `b';` in an FB body); `ide.ps1 up -Instance network-output-member` refuses while
  a CODESYS it did not start runs (pid 35692, SP21 Patch 4, hand-started 2026-10-28 15:36). The spelling does not depend on
  the answer (the CODE string is Volt's text, never compiled as ST); the answer decides only whether it is an IEC literal
  or Volt's one deviation from one.

## Wires: `VAR_TEMP w1 : ANY; END_VAR` at the network start (owner, 2026-10-28: "what about var section with ANY type … it should be VAR_TEMP actually")

Replaces `%WIRES w1, w2`. A network's wires are declared at its start in a `VAR_TEMP … END_VAR` block, each `: ANY`: the
type is the definition's, which the LSP infers (Volt states no type NWL does not store). One block per network, after
the network's `%` lines and before its comment and label. A name also declared in reach is refused by name, as today.
The exec twin declares each wire in `VAR_TEMP` with its inferred type. After this and 2.6, a network's only Volt lines
are `%NETWORK` and `%DISABLED`.

```
%NETWORK "Start"
VAR_TEMP w1 : ANY; END_VAR
w1 := AND(a, b);
x := w1;
y := OR(w1, c);
```

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
  output when no `.NAME` is written. The reader reads such a call AS WRITTEN — `EN :=` a pin named `EN`, `.X` the member
  named `X` — and decides none of them. The PUSH refuses the box by name (`<callee>: no declaration in reach states its
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

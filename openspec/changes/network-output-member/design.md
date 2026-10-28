# network-output-member — design

## 1.2 The rule (counts: tasks.md 1.1/1a; CODESYS corpora unless a vendor is named)

**The call is the box. A consumed box writes `.X` exactly when more than one of its outputs can chain; `.X` names the one
that does.** Outputs that can chain: a function's value, each declared FB output, and ENO where the box shows it. A box
showing ENO chains ENO (N16, N21), so its `.X` is always `.ENO` — and `.ENO` is how a consumed box states ENO.

| box | written | n |
|---|---|---|
| function / keyword / MOVE, no ENO | `x := GT(a, b);` `x := GT(EN := c, a, b);` — no `.X`; `.OUT` refused | 968 |
| any box showing ENO | `done := MOVE(EN := c, 1, OUT => y).ENO;` | 56 |
| FB, one declared output | `x := AND(R_TRIG(FB := r1, CLK := a), b);` — `.Q` refused | 56 |
| FB, 2+ declared outputs | `TON(FB := t1, IN := a, PT := T#1S).Q`, a moved pin `.ET` (null-slot build, as today) | 37 (+2 TC) |
| at a root | `TON(FB := t1, IN := a, Q => lamp);` `MOVE(EN := c, 1, OUT => y);` — no `.X` | 183 |

- Member names: `OUT` for a function's value (a Volt name: NWL stores `''`, `'   '` or `'Out1'`, none `OUT`), the
  declared name for an FB output, `ENO`. Other outputs stay `NAME => v`; a function's VAR_OUTPUT never chains (0 of 10
  in the corpora do; `RuntimeGuard` ×6 chain their value, so need no `.X`).
- EN shown = `EN :=` written. A box showing EN shows ENO too, except a comparison, whose enabled box has one output
  (N16; corpora: 184/184 non-comparisons with EN show ENO, 40/40 comparisons do not). ENO without EN: `.ENO` or `ENO => v`.
- An FB box is a call of its TYPE, the instance its first pin `FB :=` (`FB := ???` for an unbuilt one); then `EN :=`.
- A pin the callee DECLARES is that pin: `WSM(FB := IDB_WSM, EN := TRUE, …).ENO` is WSM's own `EN` input and `ENO`
  output, no flag shown; the names mean the flags only where the callee declares none (scope's block inputs/outputs;
  2 boxes, lenze-mid). The accept case `fb-call-read-through-declared-eno` follows the reader (flags false).

Rejected, one line each:
- an ENO-shown box counted as ONE chainable output (1a): `.ENO` refused, so ENO on a consumed box has no spelling
  (1.1 conflict (b)).
- `t1(IN := a).Q` as an expression: ST has no FB call in an expression; the LSP and the twin would need a second call
  form. `TON(FB := t1, …)` is one call form for every box.
- `.Q` always on an FB: a name with no alternative states nothing (56 boxes).

Refused by name (niche: accepted loss, N occurrences in the corpora):
- a root box showing EN without ENO (non-comparison) or an unwired ENO without EN — no `.X` to state it (0; accept cases
  `move-enabled`, `execute-enabled`, `function-eno-without-en` move to refuse);
- a root FB box's stored moved pin (`MainOutputIndex` 1 with no consumer): kept as a stored member, as today (1);
- a function chaining a VAR_OUTPUT (0); `.OUT` anywhere; `.X` on a box with one chainable output.
The suffixes `_EN`/`_ENO`/`_ENONLY` and the FB statement form `t1(…);` are unknown callees / an instance call the
subset refuses — no compatibility (no users).

No choice above rests on a new behaviour: `.X` builds through today's null-slot route (CodesysNetworkWriter /
TcArchiveBuilder `NamedMainOutputs`), and the twin translates `TON(FB := t1, …).Q` to `t1(…);` before the tree and
`t1.Q` in it, which is the FB statement form it runs now. 2.3's live twin runs confirm it.

Migration: the writer respells the case set from the model; LSP conformance fixtures respelled and re-recorded (2.5).

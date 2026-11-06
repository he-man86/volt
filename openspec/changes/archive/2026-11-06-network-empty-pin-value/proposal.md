> DRAFT, written from Sim-Assist (change `network-spellings`, 2026-10-31). Measured, not started.
> Checked on dev 3bf209901e (2026-11-03): still real. The LSP network check is silent on `IN := ,` and `EN := ,`; `lowerSource` lowers the first and throws a TypeError on the second.

## Why

`network-rail-and-pin-negation` measured that `IN := ,` is ST for "the input is not passed", not the rail, and kept the
rail as `RAIL()`: an unconnected pin is left out. The bridge reader refuses the empty value in a network
(`NETWORK_PARSE` "an operand at …", measured in that change's joint review, together with `y := ;` and `EN := ,`).

The LSP does not. Measured with Sim-Assist's bundle of volt dev `a292dd0f66` (`parseDocument` + `plainStText` +
`computeDiagnostics`, LD body):

| text | LSP network check | bridge reader |
|---|---|---|
| `t1(IN := , PT := T#1S);` | nothing (read as ST's unpassed input) | refused, `NETWORK_PARSE` |

So a text the push refuses gets no diagnostic while typing, against the doc's "The language server gives the same
refusals while typing". Sim-Assist's model follows volt: it draws IN unconnected, which is what ST means but is no text
the network form has.

## What Changes

- The network check refuses an empty pin value in a network body (`IN := ,`, `EN := ,`) by name, and both readers use the
  same words (the bridge says only `an operand at ', PT := T#1S);`): an unconnected pin is left out, the rail is `RAIL()`.
  An empty positional `f(a, , b)` is already a parse error on both sides ("Expression expected"; `an operand at`).
- The lowering no longer throws on `MOVE(EN := , 1, OUT => n)` (`undefined is not an object (evaluating 'e.kind')`).
- `network-text.html` "Errors" lists it.

## Impact

- `analysis/checks/network/_plain-st*.ts`, `StNetworkReader.cs` (its message), a refuse case in
  `volt-cli/test/fixtures/network-text-st/refuse`, which both suites read; the doc's Errors table.
- Sim-Assist: the network then shows unreadable with volt's message (its model already treats volt's network refusals so).

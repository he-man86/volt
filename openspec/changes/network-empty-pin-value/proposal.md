> DRAFT, written from Sim-Assist (change `network-spellings`, 2026-10-31). Measured, not started.

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

- The network check refuses an empty pin value in a network body (`IN := ,`, `EN := ,`, an empty positional `f(a, , b)`)
  by name, with the bridge's words: an unconnected pin is left out, the rail is `RAIL()`.
- `network-text.html` "Errors" lists it.

## Impact

- `analysis/checks/network/_plain-st*.ts`; the doc's Errors table.
- Sim-Assist: the network then shows unreadable with volt's message (its model already treats volt's network refusals so).

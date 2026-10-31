> DRAFT, written from Sim-Assist (change `plc-workspace-ide`, 2026-10-31). Measured, not started.

## Why

Since `network-text-lowering` (dev 2e45aa4098) LD/FBD bodies run, and Sim-Assist now starts them. A function box
written with its formal pins is refused, although CODESYS compiles the same FBD/LD box: the box shows its pin names
(`MN`, `IN`, `MX`), and the network text spells them as named arguments. Sim-Assist's FBD toolbox writes `LIMIT` that
way, and the LookFBD reference network "Function with formals" (captured from CODESYS) is exactly this text, so a
program built from the toolbox cannot start.

Measured with Sim-Assist's bundle of volt `2e45aa4098` (`parseDocument` + `buildSymbolTable` + `computeDiagnostics` +
`lowerSource(main, "Main", [Standard…], "Main.pou")`), a `PROGRAM Main` with `y, v, a, b : INT; g : BOOL;`:

| Body | Measured | Expected |
|---|---|---|
| FBD `y := LIMIT(MN := 0, IN := v, MX := 100);` | `call-named-args` "LIMIT with named or output arguments" at 7:6 | lowers as `LIMIT(0, v, 100)` |
| FBD `y := LIMIT(0, v, 100);` | lowers | lowers |
| FBD `y := SEL(G := g, IN0 := a, IN1 := b);` | `call-named-args` "SEL with named or output arguments" | lowers as `SEL(g, a, b)` |
| ST `y := LIMIT(MN := 0, IN := v, MX := 100);` | `call-named-args` | unchanged: `call-named-args` (`rk_builtin_named_args`, CODESYS refuses it in ST) |

A second, smaller finding on the same run: an FBD wire fed by `MOVE` of an array
(`VAR_TEMP w1 : ANY; END_VAR` / `w1 := MOVE(arr);` / `out := w1;`, `arr, out : ARRAY[0..1] OF INT`) is refused as
`network-box` "the wire w1 has no type lowering can declare" at 1:1, the start of the file, not at the wire. `w1 :=
arr;` instead gives `network-wire-type` at the wire. Whether CODESYS compiles an array-typed wire is not measured here.

## What Changes

- In a network body, a function box of the Standard operators and functions (`LIMIT`, `SEL`, `MUX`, `MIN`, `MAX`, …)
  called with its formal input names lowers as the positional call in the declaration's pin order, as the box runs in
  CODESYS. An unknown pin name, a pin given twice, or a missing pin is refused by name, as today for a positional call
  of the wrong arity. ST keeps `call-named-args` (CODESYS refuses named arguments to a built-in in ST).
- A wire whose type lowering cannot infer is refused at the wire's span (its `VAR_TEMP` declaration or its definition),
  not at 1:1; `MOVE(x)` gives its wire `x`'s type, so an array wire reaches the same `network-wire-type` refusal as
  `w1 := arr;` until CODESYS's behaviour is measured.

## Impact

- `src/transpile/lower/network/boxes.ts` (`boxValue` / `callOf` for a function box with formal pins),
  `src/transpile/lower/builtins/builtins.ts` (or a network-only path that reorders the pins before it),
  `src/transpile/lower/network/network.ts` (`hidden()`: the refusal's span; the wire's type through `MOVE`).
- Sim-Assist: no change beyond `npm run build:volt`; today it shows the refusal in its Messages window at the box.

> Owner, 2026-10-31 (in Sim-Assist), on `y := R_EDGE(a) AND GT(EN := c, i, j);`: "in this situation it is 100% a R_TRIG
> from ST" ... "that is really something that does not exist in st". Also 2026-10-31: a POU's language is not chosen
> at creation; a ST/LD/FBD dropdown switches it at any time.

DRAFT, written from Sim-Assist. FOR REVIEW (language question + request). Triage first: design, not a bug.

## Why

`network-text.html` calls the body "plain ST", but a network body uses forms that no ST compiler accepts:
`R_EDGE(a)` / `F_EDGE(a)` (hidden R_TRIG state), `x S= a` / `x R= a`, `y := x := a`, `y := (x := a) AND b`,
`BRANCH(FEED := ...)`, `BRANCH_SHORTCIRCUIT`, `JMP(l, a)`, `RETURN(a)`, `TON(IN := a)` (unnamed instance),
`GT(EN := c, ...)` / `.ENO`, `EXECUTE(...)`, `VAR_TEMP w : ANY`. Pasting a network body into an ST POU does not build.

Sim-Assist wants a ST/LD/FBD dropdown per POU (CODESYS has LD<->FBD only). LD<->FBD is the `%LANGUAGE` line. LD/FBD ->
ST needs exactly what the exec twin (`test/support/network-twin*.ts`) already writes: CODESYS ST that runs as the
network (R_EDGE as a declared R_TRIG, S= as IF, EN/ENO as IF, wires as VARs, ...). Sim-Assist must not re-implement
network semantics; volt is the maintainer.

## What changes (proposal)

1. Doc wording: "ST-shaped" (parsed by the ST front end) instead of "plain ST", with the list of network-only forms, so
   users do not expect a body to build as ST.
2. For each network-only form, review whether a real ST spelling exists that draws the same picture (owner rule:
   "whenever we can simplify parts of the language we should not neglect it"). `R_EDGE` has none today (an R_TRIG call
   needs a declared instance the IDE never had; archived `network-text-literal-nwl` 1.14). Owner 2026-10-31: "then lets keep R_EDGE but not decl" — R_EDGE stays, never with a declared instance (CODESYS keeps the edge memory hidden). The
   question is asked once for all of them.
3. Export the twin as a service (`networkToSt(text) -> { st, declarations }`): this argues for option (a) "twin as
   source" in `network-text-lowering`. Sim-Assist's dropdown calls it for LD/FBD -> ST. ST -> LD/FBD stays a parse:
   allowed only when every statement is already a network form.

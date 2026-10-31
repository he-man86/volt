> DRAFT, written from Sim-Assist (change `plc-workspace-ide`, 2026-10-31). Not started.

## 1. Measure

- [ ] 1.1 Confirm in CODESYS that the FBD and LD boxes `LIMIT(MN := 0, IN := v, MX := 100)` and
      `SEL(G := g, IN0 := a, IN1 := b)` compile and run as their positional calls (LookFBD "Function with formals" is
      the FBD case, captured from CODESYS).
- [ ] 1.2 Measure whether CODESYS compiles an array-typed FBD wire (`w1 := MOVE(arr); out := w1;`).

## 2. Lower

- [ ] 2.1 A function box with formal input names in a network body lowers as the positional call in the declaration's pin
      order; an unknown, repeated or missing pin is refused by name.
- [ ] 2.2 ST is unchanged: a built-in called with named arguments stays `call-named-args`.
- [ ] 2.3 A wire lowering cannot type is refused at the wire's span; `MOVE(x)` types its wire as `x`.

## 3. Test

- [ ] 3.1 `lower/network/network.test.ts`: LIMIT and SEL with formal pins lower and give the positional call's values;
      an unknown pin is refused by name; ST LIMIT with formals stays `call-named-args`.
- [ ] 3.2 The array wire's refusal carries the wire's span.

## 4. Consumers

- [ ] 4.1 Sim-Assist regenerates its bundle (`npm run build:volt`); its LookFBD fixture then runs as a `Main`.

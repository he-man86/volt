> Folded into `network-language` and built there (2026-11-06); closes with it. 1.1's LD half and 1.2 are not measured (no IDE in the build); the lowering takes the FBD measurement (F12) for LD too, and an array wire stays refused at its span.

## 1. Measure

- [ ] 1.1 Confirm in CODESYS that the LD boxes `LIMIT(MN := 0, IN := v, MX := 100)` and
      `SEL(G := g, IN0 := a, IN1 := b)` compile and run as their positional calls. The FBD boxes do: measured live,
      `network-text-one-to-one/design.md` F12 (`LIMIT` gives 5).
- [ ] 1.2 Measure whether CODESYS compiles an array-typed FBD wire (`w1 := MOVE(arr); ASSIGN(w1, Q => out);`).

## 2. Lower

- [x] 2.1 A function box with formal input names in a network body lowers as the positional call in the declaration's pin
      order; an unknown, repeated or missing pin is refused by name.
- [x] 2.2 ST is unchanged: a built-in called with named arguments stays `call-named-args`.
- [x] 2.3 A wire lowering cannot type is refused at the wire's span; `MOVE(x)` types its wire as `x`.

## 3. Test

- [x] 3.1 `lower/network/network.test.ts`: LIMIT and SEL with formal pins lower and give the positional call's values;
      an unknown pin is refused by name; ST LIMIT with formals stays `call-named-args`.
- [x] 3.2 The array wire's refusal carries the wire's span.

## 4. Consumers

- [ ] 4.1 Sim-Assist regenerates its bundle (`npm run build:volt`); its LookFBD fixture then runs as a `Main`.

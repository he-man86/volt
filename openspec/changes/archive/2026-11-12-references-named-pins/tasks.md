> DRAFT, written from Sim-Assist. Measured on dev `a29144ee50`; nothing built.

## 1. Declaration of a global

- [x] 1.1 `symbolDefinedAt` returns the innermost symbol whose span holds the offset (a GVL variable over its list)
- [x] 1.2 Test: references, rename and definition at `PE1` in `Scene.gvl` act on the global `PE1`

## 2. Named pins

- [x] 2.1 `findReferences` counts a call's named argument (`f(In := x, Out => y)`) as an occurrence of the callee's member, in ST and network bodies
- [x] 2.2 A marked output (`Q_INVERTED => y`, `Q1_SET => k`) counts with the range of its name part; rename keeps the mark
- [x] 2.3 Tests: rename of an input and of an output of an FB with calls in ST and in an LD network

## 3. Box outputs

- [x] 3.1 `findReferences` resolves a member whose base is a call through `boxMember` (as `resolveAt` does)
- [x] 3.2 Test: rename of `Q` renames `t1(IN := a).Q` in a network

## 4. Consumers

- [x] 4.1 Sim-Assist regenerates its bundle and drops its own walk for B and C (`walkedPins`) and its use-position lookup for A (its task, not Volt's; done in Sim-Assist change `model-io-refactor-review`, bundle from dev `03609354f4`)

> DRAFT, written from Sim-Assist. Measured on dev `95ead1202b`; nothing built.

## 1. Detail

- [x] 1.1 A `VAR CONSTANT` / `VAR_GLOBAL CONSTANT` variable's completion detail names `CONSTANT` with its section (`INT · VAR_GLOBAL CONSTANT`)
- [x] 1.2 Tests in `completion.test.ts` ("a member item names its type and section"): a GVL constant after `G.`, a local constant by name

## 2. Consumers

- [x] 2.1 Sim-Assist regenerates its bundle; its write filter then leaves constants out with no change (its task, not Volt's)

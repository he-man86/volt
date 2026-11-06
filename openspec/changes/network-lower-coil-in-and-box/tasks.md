> Folded into `network-language` (rule 3) and built there (2026-11-06); closes with it.

## 1. Measure

- [x] 1.1 Record on CODESYS 3.5.21.40 `ASSIGN(ASSIGN(a, Q => x) AND b, Q => y);` and `ASSIGN(a AND ASSIGN(b, Q => x) AND c, Q => y);` (LD and FBD) over a few scans: when `x` is written,
  what the AND box sees on its pin 2 — taken from the assign map's run (ide-model-mapping design.md "Several coils", 2026-11-06): a target list runs in list order, a coil hands on the value it receives, in all three shapes

## 2. Lower

- [x] 2.1 Interpreter: an ASSIGN as any operand of a contact AND or a box input lowers
- [x] 2.2 Rust emission of the same; twin parity on the recorded trace — the lowering writes ST statements both backends run (no network code of their own); `network.test.ts` "a coil inside a rung", the corpus twins (`corpus-network-lowering.test.ts`)

## 3. Consumers

- [ ] 3.1 Sim-Assist regenerates its bundle (`npm run build:volt`); it already draws the form as an AND box

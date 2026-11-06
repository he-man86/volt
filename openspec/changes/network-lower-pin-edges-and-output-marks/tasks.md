> Folded into `network-language` (rules 1–2) and built there (2026-11-06); closes with it. The spellings are the new ones: `IN := RISING(a)`, `EN := RISING(c)`, `Q_INVERTED => x`, `Q_SET => k`, `ASSIGN(RISING(a), Q => JMP.l)`.

## 1. Measure

- [x] 1.1 Record on CODESYS 3.5.21.40: `RISING IN :=` / `FALLING IN :=` on an FB pin and an operator pin, `RISING EN :=`, `RISING JMP.l :=`,
  and `NOT Q => x` / `RISING Q => x` on an FB output, each over a few scans (record-exec-network) — taken from the assign and box maps' runs (map.3.5.21.40.json; `a coil flag on a pin` assign-states#0153–0156, the stacked-mark rows): a pin's mark runs as its value's, an output's mark as a coil's, stacked marks innermost first; an edge on an output cannot be drawn

## 2. Lower

- [x] 2.1 Interpreter: lower pin edges and output marks as measured; the `network-box` refusals go
- [x] 2.2 Rust emission of the same; twin parity on the recorded traces — through the ST statements both backends run; `network.test.ts` "a mark on a box's output", `network-twin.test.ts` "a marked output"

## 3. Consumers

- [ ] 3.1 Sim-Assist regenerates its bundle (`npm run build:volt`); its editor already writes these forms

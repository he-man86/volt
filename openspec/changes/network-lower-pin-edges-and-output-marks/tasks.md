> DRAFT, written from Sim-Assist. Not started.

## 1. Measure

- [ ] 1.1 Record on CODESYS 3.5.21.40: `RISING IN :=` / `FALLING IN :=` on an FB pin and an operator pin, `RISING EN :=`, `RISING JMP.l :=`,
  and `NOT Q => x` / `RISING Q => x` on an FB output, each over a few scans (record-exec-network)

## 2. Lower

- [ ] 2.1 Interpreter: lower pin edges and output marks as measured; the `network-box` refusals go
- [ ] 2.2 Rust emission of the same; twin parity on the recorded traces

## 3. Consumers

- [ ] 3.1 Sim-Assist regenerates its bundle (`npm run build:volt`); its editor already writes these forms

## 1. Build

- [ ] 1.1 IR jump + label; interpreter runs them (ST `JMP`/labels first), red then green on recorded exec cases
- [ ] 1.2 Network targets `JMP.l := v`, `RETURN := v`, `y := JMP.l := v`, labels across networks; twin parity
- [ ] 1.3 Rust emission of the same IR; compiles and replays the recorded traces
- [ ] 1.4 Consumers: Sim-Assist regenerates its bundle and runs the owner's LD Main

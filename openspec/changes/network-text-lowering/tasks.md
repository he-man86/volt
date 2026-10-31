## 1. Read-only (owner: plan first)

- [x] 1.1 Census: how many corpus and fixture bodies are refused today with `graphical-body` because they are plain-ST
      network text (the fixture map's "not-lowered" count, split by reason)
- [x] 1.2 Measure open point 1: the size of a direct box lowering (b) against moving the twin into `src/` (a); list
      the layering rules either one touches (the twin imports `frontend/types` `infer/network-box.ts`, which `src/`
      may already use)
- [x] 1.3 Answer open points 2 and 3 (wire paths for `Runner.get`, scan-1 value of a wire read before its definition)
      against recordings
- [x] 1.4 Owner decides 1–3; write `design.md` with the decision and its measurements

## 2. Lowering

- [ ] 2.1 Lower plain-ST network bodies by the decided route; `graphical-body` keeps only no-slot and non-ST bodies
- [ ] 2.2 A twin refusal is a lowering refusal with the same reason, by name
- [ ] 2.3 Wires and ENO temps as hidden per-instance state; `%DISABLED` networks lower to nothing; labels/`JMP` across
      networks

## 3. Oracles

- [ ] 3.1 Every spelled exec case (N24, 1.4, 1c): the lowered network's traces equal the recorded ones
- [ ] 3.2 Every corpus body the twin writes: lowered network ≡ lowered twin, on the same scan inputs
- [ ] 3.3 Rust emission of the same bodies compiles; fixture map regenerated; full suite green
- [ ] 3.4 Consumers: Sim-Assist regenerates its bundle (`npm run build:volt`) and runs an LD seal-in rung and an FBD
      TON chain

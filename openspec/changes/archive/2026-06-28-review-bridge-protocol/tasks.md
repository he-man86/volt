## 1. Implementation (shipped)

- [x] 1.1 `Volt.Bridge.Core` + Codesys (net48 in-proc) + Beckhoff (net8 exe)
- [x] 1.2 The HTTP wire (`/refs`, `/fetch`, declarative `set`/`delete` push, `structureVersion`)

## 2. Review + capture

- [x] 2.1 Verify the name-identity + byte-parity invariants against `ARCHITECTURE.md` and the code
- [x] 2.2 Author `specs/bridge-protocol/spec.md` (incl. the negative "do not throw on duplicate names" requirement)
- [x] 2.3 `openspec validate review-bridge-protocol`

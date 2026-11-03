> Written from Sim-Assist; valid (reproduced: `no variable Prog2.a in Main`). Built 2026-11-03.

## 1. Runner paths

- [x] 1.1 `pathRoot` resolves a `section: "program"` global by its name, so `Prog2.a`, `Prog2.t1.Q` and `Prog2.__nw1_w1` read and write the called program's frame. Test (colocated): Main calling `Prog2`; `get("Prog2.a")` after a scan, `set("Prog2.a", true)` seen by `Prog2`'s next call.
- [x] 1.2 A called program's frame reads its initial values before its first call. Test: `get("Prog2.n")` with `n : INT := 5` before any scan.
- [x] 1.3 A bare name still never resolves to a program's member (`a` stays the entry program's `a`). Test.

Tests: `src/transpile/interp/runner-paths.test.ts`. The Rust harness (`rustAccess`) refuses a program path by name: the emitted `Globals` holds no PROGRAM instance. A program the entry program does not call has no frame and stays `no variable`.

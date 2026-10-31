## 1. Design

- [x] 1.1 Propose the spellings (rail coil, negated box pin, negated/edge coils, a shared non-repeatable value beside a
  jump) with the stored model each one builds; owner picks

## 2. Build

- [ ] 2.1 Writer + C# reader + LSP reader + exec twin, red then green on the drawn samples (pull, push, pull identical)
- [ ] 2.2 `network-text.html`: one row each
- [ ] 2.3 `network-text.html` "What it runs as": one row per network-only form (EN/ENO, wires, R_EDGE/F_EDGE, BRANCH,
  BRANCH_SHORTCIRCUIT, EXECUTE, JMP/RETURN targets, RAIL, NEGATED/RISING/FALLING, S=/R=//=/P=/N=, an FB box with no
  instance) → the exact plain ST it runs as. GENERATED from the lowering's rules and gated (DocDataTests style), each row
  pinned by a CODESYS exec recording (pin edges RISING/FALLING recorded first, unmeasured today). Standard boxes (AND,
  ADD, TON, …) need no row: IEC defines them, `AND(a, b)` ≡ `a AND b` (owner 2026-10-31: "define what they do tight")

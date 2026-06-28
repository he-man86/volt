## 1. Slim the prose docs

- [x] 1.1 `VOLT-DESIGN.md` → the one rule + pointers to `openspec/`
- [x] 1.2 `VOLT-PLAN.md` → status board → `openspec/changes/`
- [x] 1.3 Preserve D1–D13 rationale in this change's `design.md`
- [x] 1.4 Update `CLAUDE.md` links (`VOLT-DESIGN`/`VOLT-PLAN` → `openspec/`)

## 2. Make `openspec/` part of the fork surface

- [x] 2.1 Add `openspec/` to `ADDITIVE_PREFIXES` in `volt-scripts/check-divergence.ts`
- [x] 2.2 Note `openspec/` in the `CLAUDE.md` allowlist text

## 3. Verify

- [x] 3.1 `check-divergence` → `openspec/` clean, no new violations (self-test 23/23)
- [x] 3.2 No dangling references to the removed sections (grep clean)

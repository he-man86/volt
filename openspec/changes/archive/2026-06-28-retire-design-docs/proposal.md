## Why

Once the `review-*` changes have authored the capability specs, `VOLT-DESIGN.md` and
`VOLT-PLAN.md` are redundant: their invariants live in `openspec/specs/`, their roadmap in
`openspec/changes/`. Slim them so there's one source of truth — while preserving the D1–D13
rationale that OpenSpec's per-change model doesn't otherwise keep.

## What Changes

- Slim `VOLT-DESIGN.md` → the one rule + pointers to `openspec/specs/` and `openspec/changes/`.
- Slim `VOLT-PLAN.md` → a short status board pointing at `openspec/changes/` (or remove it).
- Preserve the decision log (D1–D13 with rejected alternatives) in this change's `design.md`.
- Update `CLAUDE.md` links that point at the removed sections.

## Capabilities

### Modified Capabilities
- (none — documentation cleanup; no spec-level behavior change.)

## Impact

Docs only. **Runs last** — depends on the `review-*` changes being archived so the specs exist
first.

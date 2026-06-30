## ADDED Requirements

### Requirement: Upstream sync runs daily and auto-merges when clean

The scheduled auto-sync SHALL run at least **daily** (not weekly), so each merge stays small against
opencode's high velocity (~35 commits/day). When the merge has **no conflicts** and `sync.ts` passes
**all** signals (`check-divergence` → `check-volt-integration` → `verify-lsp` → `verify-volt-tool`),
the sync SHALL be merged automatically (fast-forward onto the default branch) without manual review.
A **conflict or any failed signal** SHALL instead open a PR for a human and SHALL NOT auto-merge.

#### Scenario: A clean daily sync lands without manual review
- **WHEN** the daily job merges `upstream/dev` with no conflicts and `sync.ts` passes every signal
- **THEN** the result fast-forwards onto the default branch automatically — no PR, no human

#### Scenario: A conflict or failed signal pauses for a human
- **WHEN** the merge conflicts, or any `sync.ts` signal fails
- **THEN** the job opens a PR for manual resolution and does not auto-merge

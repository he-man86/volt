# upstream-sync Specification

## Purpose
TBD - created by archiving change review-upstream-sync. Update Purpose after archive.
## Requirements
### Requirement: The fork is purely additive

Volt SHALL NOT modify the contents of any upstream opencode file except the enumerated
integration seams. New Volt code SHALL live under `packages/volt-*/` or an allowlisted path
(`volt-scripts/`, `.claude/`, `_bmad/`, `.github/workflows/volt-*`, the `.opencode/{agent,themes,tool}`
+ `.opencode/opencode.json` additive set, `CLAUDE.md`, `NOTICE`, `VOLT-DESIGN.md`, `VOLT-PLAN.md`).
Integration SHALL use opencode's extension points — auto-discovered files and deep-merged
config — never edits to opencode source. A new capability SHALL attach at the highest additive
hook that fits; a tiny seam is used only where no hook exists (GUI logo / app-name / one GUI slot).

#### Scenario: A new file outside the allowlist fails the guard
- **WHEN** a file is added outside `packages/volt-*/` and the allowlist
- **THEN** `check-divergence` fails

#### Scenario: An upstream file edited outside the seams fails the guard
- **WHEN** an upstream file outside the enumerated seams is modified
- **THEN** `check-divergence` fails

#### Scenario: Config is added by deep-merge, not by editing upstream
- **WHEN** Volt registers an LSP / permission / model entry
- **THEN** it is added to `.opencode/opencode.json` and the upstream `.jsonc` is left untouched

### Requirement: The merge conflict surface is the enumerated seams

The entire divergence from upstream SHALL be exactly 12 modified upstream files, in four
clusters: config (4: `.gitignore`, `.husky/pre-push`, `.opencode/tui.json`, `bun.lock`),
branding (2: `packages/ui/src/components/logo.tsx`, `packages/desktop/electron-builder.config.ts`),
GUI panel (2: `packages/app/src/pages/session.tsx` — the "IDE" changes-source — and `packages/app/package.json`),
and desktop IPC (4: `packages/desktop/{package.json, electron.vite.config.ts, src/main/index.ts, src/preload/index.ts}`).
`check-divergence` SHALL pass only when no upstream file outside this set is modified or deleted.

#### Scenario: A clean fork enumerates exactly the seams
- **WHEN** `check-divergence` runs against `upstream/dev` at `HEAD`
- **THEN** it lists the seams and reports clean

### Requirement: Committed build/editor junk is rejected

`check-divergence` SHALL fail if backup or editor artifacts (`*.bak`, `*.orig`, `*.swp`,
`.DS_Store`, and similar) appear anywhere in the fork's files.

#### Scenario: A committed backup file fails the guard
- **WHEN** a `*.bak` (or `.DS_Store`, `*.orig`, …) is committed in the fork
- **THEN** `check-divergence` fails

### Requirement: Integration loading is verifiable

The Volt LSP and the `volt` tool SHALL be provably loaded inside opencode by non-interactive
checks that drive `opencode debug` — `verify-lsp` for the language server and `verify-volt-tool`
for the custom tool.

#### Scenario: The LSP is proven loaded
- **WHEN** `verify-lsp` plants a known-bad `.st` file and queries diagnostics
- **THEN** diagnostics with `source: "volt-lsp-codesys"` are returned

### Requirement: Upstream sync is one signal-flow command

Syncing upstream SHALL be native `git merge` plus a single signal flow (`sync.ts`) that runs
`check-divergence` → `check-volt-integration` → `verify-lsp` → `verify-volt-tool`, stopping at
the first failure. `merge-upstream.ts` SHALL wrap the whole flow (fetch → dated `sync/…` branch
→ merge → `sync.ts`) and stop cleanly on conflict, leaving resolution to the engineer.

#### Scenario: A clean merge passes every signal
- **WHEN** `merge-upstream.ts` runs and the merge has no conflicts
- **THEN** all four checks pass and it prints the fast-forward to land the sync

#### Scenario: A conflicting merge stops for the engineer
- **WHEN** `merge-upstream.ts` hits a merge conflict
- **THEN** it stops cleanly without moving or pushing the branch

### Requirement: The invariants are enforced in CI

The fork invariants SHALL be enforced by CI (`.github/workflows/volt-ci.yml`) on every push and
PR — not only by the bypassable pre-push hook — and a scheduled job SHALL merge `upstream/dev`
and open a PR when the result is clean.

#### Scenario: A surface violation fails CI
- **WHEN** a push or PR modifies an upstream file outside the 13 seams
- **THEN** the Volt CI check fails


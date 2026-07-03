# upstream-sync Specification

## Purpose
TBD - created by archiving change review-upstream-sync. Update Purpose after archive.
## Requirements
### Requirement: The fork is purely additive

Volt SHALL NOT modify the contents of any upstream opencode file except the enumerated
integration seams. New Volt code SHALL live under `packages/volt-*/` or an allowlisted path
(`volt-scripts/`, `.claude/`, `.github/workflows/volt-*`, `openspec/`, the `.opencode/{agent,themes,tool,plugins}`
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

The entire divergence from upstream SHALL be exactly 18 modified upstream files, in these
clusters: config (4: `bun.lock`, `.husky/pre-push`, `.gitignore`, `.opencode/tui.json`),
branding (5: `packages/ui/src/components/logo.tsx`, `packages/desktop/src/main/index.ts`,
`packages/desktop/electron-builder.config.ts`, `packages/desktop/src/renderer/index.html`,
`packages/app/index.html`), GUI panel (3: `packages/app/src/pages/session.tsx` — the one-line mount
of the self-owned "IDE" changes panel — `packages/app/package.json`, `packages/app/src/pages/layout/deep-links.ts`),
desktop IPC (3: `packages/desktop/{src/preload/index.ts, electron.vite.config.ts, package.json}`),
build channel (1: `packages/app/vite.js`), updater (1: `packages/opencode/src/installation/index.ts`),
and TUI worker env (1: `packages/opencode/src/cli/cmd/tui.ts`). `check-divergence` SHALL pass only
when no upstream file outside this set is modified or deleted.

#### Scenario: A clean fork enumerates exactly the seams
- **WHEN** `check-divergence` runs against `upstream/dev` at `HEAD`
- **THEN** it lists the 18 seams and reports clean

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
- **THEN** diagnostics with `source: "volt-lsp-iec"` are returned

### Requirement: Upstream sync is one signal-flow command

Syncing upstream SHALL target opencode's **latest release tag** (`vX.Y.Z`) — by default the newest
tag within the **current major** (a new major is opted into by naming the tag) — NOT the moving
`dev` trunk. It SHALL be native `git merge` plus a single signal flow (`sync.ts`) that runs
`check-divergence` → `check-volt-integration` → `verify-lsp` → `verify-volt-tool`, stopping at the
first failure. `merge-upstream.ts` SHALL wrap the whole flow (fetch tags → resolve the target tag →
dated `sync/…` branch → merge → `sync.ts`) and stop cleanly on conflict, leaving resolution to the
engineer. `check-volt-integration` SHALL additionally guard the release-merge regressions: the GUI
build-channel `define` (`VITE_OPENCODE_CHANNEL`) is intact, the TUI worker-env seam survives, and the
vendored `volt-config` agent-config dir is present (the `@opencode-ai/plugin` SDK is vendored into it
at dist time — there is no npm pin).

#### Scenario: The default target is the newest current-major release tag
- **WHEN** `merge-upstream.ts` runs with no argument
- **THEN** it resolves the newest `v<current-major>.*` release tag and merges it (a newer major is reported, not auto-taken)

#### Scenario: A clean merge passes every signal
- **WHEN** `merge-upstream.ts` runs and the merge has no conflicts
- **THEN** all four checks pass and it prints the fast-forward to land the sync

#### Scenario: A conflicting merge stops for the engineer
- **WHEN** `merge-upstream.ts` hits a merge conflict
- **THEN** it stops cleanly without moving or pushing the branch

### Requirement: The invariants are enforced in CI

The fork invariants SHALL be enforced by CI (`.github/workflows/volt-ci.yml`) on every push and
PR — not only by the bypassable pre-push hook — and a scheduled job (`volt-upstream-sync.yml`)
SHALL merge opencode's latest release tag and open a PR when the result is clean.

#### Scenario: A surface violation fails CI
- **WHEN** a push or PR modifies an upstream file outside the 18 seams
- **THEN** the Volt CI check fails

### Requirement: The scheduled upstream sync opens a PR, never auto-merges

The scheduled auto-sync (`volt-upstream-sync.yml`) SHALL run **weekly** (Mondays 06:00 UTC), resolve
opencode's newest current-major release tag, merge it onto a dated sync branch, and verify the
key-free surface (divergence vs the tag + typecheck). When the result is **clean** it SHALL **open a
PR** into the release branch for human review — it SHALL NOT fast-forward or auto-merge. A merge
**conflict** SHALL fail the run (GitHub notifies a human), landing nothing. The full runtime signal
flow (`sync.ts`, incl. the LSP/tool verifiers) is run locally when landing the PR.

#### Scenario: A clean weekly sync opens a PR
- **WHEN** the weekly job merges the latest release tag with no conflicts and the surface verifies
- **THEN** it opens a PR into the release branch — it does not auto-merge

#### Scenario: A conflict fails the run for a human
- **WHEN** the merge conflicts
- **THEN** the run fails and nothing is landed

### Requirement: Volt ships opencode's stable UI channel

Volt's desktop packaging SHALL build with `OPENCODE_CHANNEL=prod` so the released app defaults to
opencode's **stable** UI (currently the v1 legacy layout), not the in-progress v2 layout that an
unset or `beta` channel selects. Because opencode's own default rule is
`newLayoutDesigns = OPENCODE_CHANNEL !== "prod"`, a Volt `prod` build SHALL automatically adopt
whatever layout opencode promotes to its `prod` channel — including v2 once opencode releases it —
with no Volt code change. Volt MUST NOT hardcode the v1 layout or vendor a separate UI package; it
is one flag-gated `packages/app`.

#### Scenario: A Volt release ships the stable layout
- **WHEN** Volt packages the desktop app with `OPENCODE_CHANNEL=prod`
- **THEN** it defaults to opencode's stable (v1) layout, app name `Volt`, and prod icons

#### Scenario: Volt auto-follows when opencode promotes v2
- **WHEN** opencode makes v2 the default on its `prod` channel and Volt next syncs and rebuilds
- **THEN** Volt's `prod` build renders v2 with no Volt-side change

#### Scenario: A developer can still preview v2
- **WHEN** a developer runs an unset/`beta` build or sets `general.newLayoutDesigns` per-install
- **THEN** the in-progress v2 layout renders, without affecting released Volt builds


## Why
The opencode integration grew by reactive patches this session (the `<spinner>` chat crash, the desktop shipping opencode's unreleased **V2** layout, the `volt init` "Unexpected server error") — it felt shaky. Two audits (see `design.md`) show *why*: the integration is mostly sound, but its **quality is uneven** — most injections use opencode's clean hooks, one rides a runtime workaround, one edits opencode's hottest file. Rather than more one-off fixes, we rate **every** feature Volt injects into opencode's packages by how cleanly it integrates, then harden them **simplest-first**, rebuilding the installer after each step so we see exactly where the complexity becomes unmanageable — and whether that point is ours to fix or upstream's.

## What Changes
- A **rated inventory** of every opencode-package injection — Tier 1 (additive hook, no upstream edit) → Tier 5 (build/runtime workaround) — in `design.md`.
- Harden the shaky ones cleanest-first:
  - **Channel** → move from a gitignored `.env` to an **in-code prod default** in the files Volt owns (deterministic; the `.env` is a weak, secret-coupled, cwd-scoped guarantee).
  - **Plugin pin** → move from a runtime `bun/npm install` at init to a **vendored copy** shipped in the install (offline / no-package-manager safe — real for air-gapped PLC machines).
  - **Spinner** → keep (audited sound; the only tree-shake-vulnerable registration; a static-entry root fix is infeasible).
  - **session.tsx** → flagged as the irreducible hot seam; long-term needs an upstream change-source hook.
- Build + smoke `build-installer.ts` after each tier.

## Capabilities
### Modified Capabilities
- `upstream-sync`: each opencode injection SHALL use the cleanest available integration tier and be recorded in the rated inventory; build-time defaults (the UI channel) SHALL be set in code Volt owns, not in a gitignored env file.

## Impact
`packages/app/vite.js` (new 16th seam — 1 line), `packages/desktop/electron.vite.config.ts` (channel default), `volt-scripts/{dist,build-installer,check-divergence}.ts`, `packages/volt-git/src/opencode-config.ts` (plugin vendoring), docs (seam count / deep-links wording / dead pre-push line). No volt product-feature change.

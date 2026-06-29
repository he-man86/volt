## Why

Volt has to be **installable like opencode** — a `volt` CLI (npm / curl / brew) *and* a desktop app, plus
the IDE bridge — not just a desktop build. Today only hand-compiled binaries exist: no published CLI, no
clean install, no update path, and the desktop's updater feed still points at stock opencode (so it would
auto-update *back* to opencode). This blocks shipping Volt to users. (VOLT-PLAN phase **B ◐**.)

## What Changes

**Mirror opencode's distribution machinery** (`script/build.ts`, `script/publish.ts`, root `install`,
electron-updater, `opencode upgrade`), parameterized for Volt and pointed at **Volt's release repo**. The
whole Volt delta is small. See `design.md` for the full architecture.

- **`volt` is one self-contained binary** — our opencode build + the PLC dispatcher, run in-process,
  packaged exactly like `opencode-ai`. *(In-process binary validated.)*
- **CLI distribution** — mirror `publish.ts` (npm `volt` wrapper + per-platform binaries) and the `install`
  curl script. The **only** addition to opencode's recipe is one postinstall line registering the LSP.
- **Desktop** — opencode's electron app + branding (done); ⚠ **re-point the electron-updater feed to Volt's
  repo**; bundle + register the LSP for the embedded opencode.
- **Updates** — `volt upgrade` (reuse opencode's method-aware `installation/` logic) + electron-updater.
- **Bridge connector** — build the C# bridges + install them into the IDE.
- **Remove the `volt setup` CLI verb** — registration moves to postinstall (CLI) / startup (desktop).

## Capabilities

### Modified Capabilities
- (none — packaging / release infra; no spec-level requirement change.)

## Impact

Additive: `volt` is one binary built entirely from this repo (no external opencode). The **only new upstream
seam** beyond the existing branding/IPC ones is `electron-builder.config.ts` (re-point the updater feed).
Everything else reuses opencode's `build.ts` / `publish.ts` / `install` / electron-updater verbatim, renamed
for Volt — keeping the upstream merge easy.

Inputs needed: a Volt GitHub release repo, Windows signing certs.

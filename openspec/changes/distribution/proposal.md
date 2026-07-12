## Why

Volt has to be **installable like opencode** — a `volt` CLI (npm / curl / brew) *and* a desktop app, plus
the IDE bridge — not just a desktop build. Today only hand-compiled binaries exist: no published CLI, no
clean install, no update path, and the desktop's updater feed still points at stock opencode (so it would
auto-update *back* to opencode). This blocks shipping Volt to users. (VOLT-PLAN phase **B ◐**.)

## What Changes

> **⟲ FORWARD DIRECTION SUPERSEDED (2026-07-12) by `minimize-opencode-fork`.** The premise below — a single
> self-contained `volt` binary + *mirroring* opencode's CLI-distribution machinery + bundling opencode into the
> installer — is replaced by the **two-lane model**: opencode **self-installs** (chained online) and
> **self-updates on its own feed**; Volt's installer owns ONLY the Volt layer (branded Electron shell + config +
> LSP + connector + bridges + `volt` env-wrapper + extension) — **no custom binary, no mirroring of opencode's
> distribution.** The bundling installer built here (largely ✅ below) is the interim that proved every piece;
> the **connector + extension lifecycle tasks (2.13 / 2.15b / 2.15c) carry forward** with the refinements from
> the lifecycle audit (single-connector invariant, extension authority-per-path, quiesce-on-update). Superseded
> items: 2.3 (mirror `build.ts` → a custom binary) and the "self-contained binary / mirror `publish.ts`" bullets.
> See `minimize-opencode-fork/design.md` → "Target lifecycle & installer".

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

Additive: `volt` is one binary built entirely from this repo (no external opencode). **No new upstream
seams** — the updater re-point edits the *already-seamed* `electron-builder.config.ts`; the CLI/LSP/PLC
additions are all fork-owned (`packages/volt-*`). Everything else reuses opencode's `build.ts` / `publish.ts`
/ `install` / electron-updater verbatim, renamed for Volt — keeping the upstream merge easy.

Inputs needed: a Volt GitHub release repo, Windows signing certs.

## Why

Volt is a fork of opencode with **18 upstream-source seams** (enforced by `volt-scripts/check-divergence.ts`).
The costly ones edit opencode's **fast-moving GUI** (`packages/app`, `packages/ui`) and its **binary**
(`packages/opencode/src/**`) — they fight upstream on nearly every release. The conclusion reached after mapping
the whole runtime + the storage + a GUI mockup: **the fork buys almost nothing the user can see**, and the
maintenance tax is real and compounding.

The decisive realisation (see `design.md`): Volt's product value is already **additive** —
- the **LSP + `volt` tool + agent + theme** ship as the `OPENCODE_CONFIG_DIR` bundle (opencode loads it natively),
- the **bridge/connector + volt-git** are separate `volt-*` packages,
- and the one Volt GUI feature, the **IDE-changes panel**, can be served by the **connector** (which already
  watches the IDE and already has a window) instead of injected into opencode's GUI.

So the biggest seams don't need to exist. This change **removes the churny fork surface** and keeps only a thin,
near-static **branded desktop shell** — reusing opencode's core *and* GUI **pristine**.

## What Changes

Seam-by-seam (full fate table in `design.md`): **18 seams → ~9, all in the desktop shell + dev-config, with
ZERO edits to `packages/app`, `packages/ui`, or `packages/opencode/src`.**

- **Delete the GUI-content seams.** Move the IDE-changes panel out of `session.tsx` into the **connector**;
  revert `packages/app/{session.tsx,package.json,index.html,vite.js}`, `packages/app/.../deep-links.ts`, and
  `packages/ui/.../logo.tsx*` to pristine. (Channel pin → a build-env `OPENCODE_CHANNEL=prod`; `volt://` →
  shell-side protocol translation; in-GUI logo → optional single static seam, keep or drop.)
- **Delete the opencode-binary seams.** Drop `cli/cmd/tui.ts` (set `OPENCODE_CONFIG_DIR` **before** launch via an
  env-wrapper so Bun's worker snapshot carries it) and `installation/index.ts` (the whole install updates via our
  installer/electron-updater — no in-binary self-updater feed). → **ship stock opencode, no custom binary.**
- **Shrink the desktop-shell seams** (keep them — this is the deliberate branded shell): app name, installer
  config, window title, sidecar bundling. Drop the panel-IPC parts (`window.volt`/`volt-control`) now that the
  panel lives in the connector.
- **Tighten `check-divergence.ts`**: shrink `ALLOWED_MODIFICATIONS` to the ~9 survivors and add self-tests that
  the removed seams are now **violations** — so the "reuse pristine" discipline is enforced, not just intended.

## Impact

- **`packages/app` / `packages/ui` / `packages/opencode/src` → pristine.** The highest-churn merge conflicts
  disappear; upstream GUI/core improvements land for free.
- **The connector gains the IDE-changes surface** (Volt-owned, frontend-independent, no VS Code needed).
- **No custom `volt` binary** — bundle a pinned stock opencode; the CLI is a config-dir add-on.
- New ongoing cost: **compat-test the add-on against each opencode release** (a gate, not a merge).
- User-visible change: **≈none** (panel is beside the chat vs inside it; the future GUI-plugin closes even that).
- Related: `consolidate-app-runtime` (storage/updater), `distribution` (packaging).

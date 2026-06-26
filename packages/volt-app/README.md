# @opencode-ai/volt-app

Volt's **Solid components for the opencode desktop app** — the graphical "control the volt CLI"
experience (the `volt-vscode` UX), brought *into* the desktop GUI, plus the desktop **branding**
overrides. Holds **only** override/added components — **never** a copy of `packages/app` (which stays
a synced upstream dependency).

> **Status — Phase 2 done (mounted).** `VoltSidebar` (a Solid panel skeleton) is mounted in
> `packages/app`'s new layout and **bundles into the app build** (`bun run dev:desktop` to view).
> Pure renderer UI — **no `volt-control` import** (that's Node; it can't run in the browser
> renderer). **Next — Phase 3:** Electron IPC so the verbs call `volt-control` + live status.

```
 packages/app (agent GUI, synced)            @opencode-ai/volt-app (fork-owned)
   <Slot name="sidebar"/>   ◄── registerVoltPanel ── VoltPanel (status/push/pull/build/diag)
   @opencode-ai/ui/logo     ◄── build-alias ──────── VoltMark / VoltSplash
                                                      └─ uses @opencode-ai/volt-control (no UI)
```

## Phase 2 — the GUI `<Slot/>` (the one strategic seam, in `packages/app`)

`packages/app` has **no** extension point today (unlike the TUI). Add a minimal one:
1. A tiny **registry** (Solid context): components register by slot name.
2. A `<Slot name="…"/>` component that renders whatever's registered.
3. Place one mount — e.g. `<Slot name="sidebar"/>` — in `app`'s layout.
4. **Try to upstream this** to opencode (it helps every integrator). If accepted → 0 seams; if not,
   it's the single documented `packages/app` seam (add it to `check-divergence` ALLOWED_MODIFICATIONS).

Verify: a throwaway dummy component registers and renders in the desktop window.

## Phase 3 — the panel (`VoltPanel`)

1. Build `VoltPanel` (Solid) here: a status list, `push` / `pull` / `build` buttons, drift/diff view,
   diagnostics — mirroring `volt-vscode`'s SCM/history views.
2. It calls **`@opencode-ai/volt-control`** for all CLI/bridge work (no logic duplicated).
3. Export `registerVoltPanel(registry)` that mounts `VoltPanel` into the Phase-2 `<Slot name="sidebar">`.
4. Wire it in the **desktop** build so the registration runs at startup (a one-line import in the
   desktop entry, or via the desktop's vite config — fork-owned where possible).

Verify: open a `.st` workspace in the desktop app → the Volt panel drives the CLI (status/push/pull/
build) and shows diagnostics.

## Phase B — branding (desktop GUI)

Distinct from the **TUI** theme (`.opencode/themes/volt.json` brands the *terminal* UI only). The
**desktop GUI** is `packages/app` + `packages/ui`:
- **Logo:** add `VoltMark`/`VoltSplash` (Volt SVG) here; **alias** `@opencode-ai/ui/logo` → this in
  the desktop build (one seam). The art stays fork-owned; only the alias touches upstream.
- **Colors:** the GUI uses CSS variables (e.g. the logo's `--icon-base`). Provide a Volt CSS layer /
  theme override (additive where the app supports it; a small seam if not).
- **App name:** `packages/desktop/src/main/index.ts` `APP_NAMES` (one seam).
- **Hardcoded `opencode.ai` strings** (changelog URL, favicon, install URL): override via config/small
  seams as needed.

## Verify (track exit)

- Desktop app shows Volt branding (logo, name) and the Volt panel.
- `bun run volt-scripts/check-divergence.ts` reports only the intended seams (the `<Slot/>`, logo
  alias, app-name) — everything else additive/fork-owned.

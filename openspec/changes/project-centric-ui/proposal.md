## Why

The connector was rebuilt so the user picks a **detected project**, not a vendor — vendor is data, not a UI
branch (`connector-ux-redesign`). The layers above are still **vendor-first**: the desktop shell shows two fixed
buttons *"Initialize for CODESYS / TwinCAT"* (gated by per-vendor pipe liveness), and the VS Code extension does
the same via `viewsWelcome` + `volt.twincatLive`/`volt.codesysLive` context keys. Init is `volt init --vendor <v>`
where the vendor comes from *which button you clicked*.

There are **two places the UI needs "status from the IDEs"**: (A) the **bound workspace's live status** (is my
project connected/dirty, is an op running — `VoltStatus`, polled ~4s over the bound vendor's pipe), and (B) the
**detected-project list** (what can I init/connect — today `probeVendors` over both pipes → per-vendor liveness).
Both today are the UI re-probing the bridge pipes itself.

But the **connector is already the single aggregator of all of this**: its `ConnectionManager` continuously probes
every bridge's health *and* enumerates every project across vendors. Re-probing the pipes in `volt-control` means
two aggregators doing the same fan-out. The clean design is one aggregator (the connector) and a thin client (the
UI): **both use cases come from the connector's control plane, `GET http://127.0.0.1:8550/status`.** This is
orchestration/status, not the PLC data wire (that stays named pipes) — so it does not re-introduce the removed
bridge HTTP; it uses the connector's existing localhost control plane. The UI's dependency on the connector is
inherent, not added: the connector owns the bridge lifecycle (it spawns the TC worker; CODESYS activation is in
its tray), so "no connector" already means "no bridges."

## What Changes

**Connector (small enrichment) — one endpoint serves both use cases.** Extend `ConnectorView` so `GET /status`
carries the per-vendor live health alongside the project list:

```
ConnectorView {
  status,                                                    // aggregate word
  bridges:  [{ vendor, status, activeOp }],                  // per-vendor live health  → use case A
  projects: [{ id, displayName, vendor, dirty, connected }], // detected projects       → use case B
}
```

`activeOp` comes from the bridge `health` op (already on the wire; `HealthProbe.FromWire` gains it). No new
endpoint — the existing `/status` just returns more.

**volt-control — a thin control-plane client, the single source of IDE status for the UI:**
- `connectorStatus()` → `GET :8550/status` → the enriched `ConnectorView`. First-party Node/Electron fetch (no
  `Origin` → passes the connector's CSRF guard); localhost only.
- `detectedProjects()` = `connectorStatus().projects` (use case B) — replaces `probeVendors()`.
- `boundStatus(workspaceRoot)` = match the workspace's bound `(vendor, project)` (from `readBridgeVendor` + the
  git config) against `bridges[vendor]` + its `projects` entry (use case A) — replaces the UI's `probeHealth`
  polling.
- `connectProject(projectId)` → `POST :8550/connect`; `initFromProject(project, targetRoot, {force})` =
  `connectProject(project.id)` then `volt init --vendor project.vendor`. Vendor derived from the picked project.

**volt-desktop** — replace the two vendor buttons + `vendorsLive` gating (`shell.html`, `src/panel.ts`,
`src/commands.ts`) with the **detected-project list**: one button per project ("MyMachine · CODESYS"), clicking
inits the active folder (`shell.boundRoot`, unchanged) from the pick. Its bound-status polling reads
`connectorStatus()` instead of the pipe. Empty state → the guided "open a project / activate CODESYS in the tray".

**volt-vscode** — replace the per-vendor `viewsWelcome` + `volt.*Live` keys (`package.json`, `src/extension.ts`)
with the detected-project surface; the Sync/Bridge views read `connectorStatus()`.

**The guiding split: STATUS ← connector `:8550`; COMMANDS ← `volt` CLI.** All live IDE/bridge *connection* status
(detected projects, connected, dirty, activeOp) comes from the connector — the one always-on aggregator. All
git-native *workspace commands* (`init`, `pull`, `push`, `merge`, `build`) go through the `volt` CLI over the
pipe. `volt status` belongs to the CLI bucket: it is itself a git-native command that computes **git drift**
(incoming/outgoing/conflicts = local repo vs `volt/ide`), which needs the local git repo the connector knows
nothing about — so it stays on the CLI and keeps working headless (CI). The UI **composes both**: connection
status from `:8550`, git drift + actions from the CLI. `volt-control`'s `probeHealth` is retired from the UI path
(the connector covers connection status) but the CLI's own pipe access is untouched.

**The LSP dialect vendor stays separate.** `volt.iec.vendor` (codesys/twincat/auto) selects the language server's
ST dialect only — not init. On a project-centric init it MAY be set from the picked project's vendor.

## Design notes

- **One aggregator, one client.** The connector computes fleet status once (health + instances across vendors);
  the UI reads it once (`/status`). No duplicate pipe fan-out in `volt-control`.
- **Graceful when the connector/bridges are down.** `/status` unreachable or an empty `projects` list → the UI
  shows the existing guidance ("start Volt / open a project / activate CODESYS in the tray"). No hard-fail.
- **Same principle, one layer up.** After this, nowhere in the product does the user choose a *vendor* — they pick
  a project (connector, desktop, VS Code), vendor rides along as a badge.

## Impact

- **Connector** (`Volt.Cli.Connector`) — `ConnectorView`/`ProjectView` gain the `bridges[]` health block; the
  snapshot builder + `HealthProbe.FromWire` carry `activeOp`. Small, additive to the already-shipped `/status`.
- **volt-control** — new `src/bridge/connector.ts` (the `:8550` client + `detectedProjects`/`boundStatus`/
  `connectProject`) exported from `index.ts`; `bridge/actions.ts` gains `initFromProject`; the UI-facing status
  paths move from pipe to `connectorStatus()`. `probeHealth`/`probeVendors` remain only for the CLI path.
- **volt-desktop** — `shell.html`, `src/panel.ts`, `src/commands.ts`/`src/main.ts` (vendor buttons → project
  list; bound status from the connector; init IPC takes a projectId).
- **volt-vscode** — `package.json` (`viewsWelcome` + enablement), `src/extension.ts`, `src/panel.ts`.
- **Depends on** `connector-ux-redesign` (the `instances`/`select` ops + the `:8550` `ConnectorView`).

## Non-goals

- Not routing the CLI's `volt status` through `:8550` (it must run headless — stays on the pipe).
- Not changing the bridge data wire (named pipes) or `volt init` itself (still `--vendor <v>` under the hood).
- Not the LSP dialect setting (`volt.iec.vendor`); not adding a folder picker.

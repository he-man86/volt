Make the UI project-centric with one clean split: **connection STATUS ← the connector's `:8550` control plane;
git-native COMMANDS ← the `volt` CLI.** The init/connect surface becomes the list of DETECTED PROJECTS (from the
connector), vendor derived from the pick. Depends on `connector-ux-redesign` (the `instances`/`select` ops + the
`:8550` `ConnectorView`).

## 1. Connector — one endpoint serves both status use cases (small enrichment)
- [x] `ConnectorView`/`ProjectView` gain a `bridges[]` block: `{ vendor, status, activeOp }` (per-vendor live
      health), alongside the existing `projects[]`. `GET /status` returns both — no new endpoint.
- [x] `HealthProbe.FromWire` carries `activeOp` (already on the bridge `health` wire); the tray snapshot fills it.
- [x] Connector tests: the enriched `ConnectorView` serializes with `bridges` + `projects`.

## 2. volt-control — the `:8550` client (single source of IDE connection status)
- [x] `src/bridge/connector.ts`: `connectorStatus()` → `GET http://127.0.0.1:8550/status` (first-party fetch, no
      `Origin`, localhost) → the enriched `ConnectorView`. Unreachable → a well-typed "connector down" empty state.
- [x] `detectedProjects()` = `connectorStatus().projects` (use case B) — replaces `probeVendors`.
- [x] `boundStatus(workspaceRoot)` = match the bound `(vendor, project)` (from `readBridgeVendor`) against
      `bridges[vendor]` + its `projects` entry (use case A) — replaces the UI's `probeHealth` polling.
- [x] `connectProject(projectId)` → `POST :8550/connect`; `initFromProject(project, targetRoot, {force})` =
      `connectProject(project.id)` + `volt init --vendor project.vendor` (vendor derived from the project).
- [x] Export from `index.ts`. `VoltStatus` polls the connector (`boundStatus`) for connection status; git drift
      still comes from `volt status` (CLI). `probeHealth`/`probeVendors`/`pipeForVendor` DELETED — no consumers
      (the C# CLI has its own probe); `health.ts` keeps only the types + `readBridgeVendor`.
- [x] Unit-test `detectedProjects`/`boundStatus` parse + `initFromProject`, incl. connector-unreachable fallback.

## 3. volt-desktop — project list replaces the vendor buttons
- [x] `src/panel.ts`: snapshot carries `detectedProjects()` + `boundStatus()` (from the connector) instead of
      `vendorsLive` + pipe health.
- [x] `shell.html`: one button per detected project ("MyMachine · CODESYS", dirty `*`); empty → the guided
      "open a project / activate CODESYS in the tray" hint. Remove the two fixed vendor buttons.
- [x] `src/commands.ts` / `src/main.ts`: the init IPC takes a `projectId`; resolve it and call `initFromProject`
      against `shell.boundRoot` (unchanged target).

## 4. volt-vscode — project list replaces the per-vendor welcome
- [x] `src/extension.ts`: `refreshBridgeLive` → refresh from `connectorStatus()`; drop `volt.twincatLive`/
      `volt.codesysLive` (or repoint to "any project detected").
- [x] `package.json` `viewsWelcome`: show the detected projects (or the activation hint when none) instead of the
      per-vendor blocks; command `enablement` follows.
- [x] `src/panel.ts`: the Sync/Bridge views read `connectorStatus()`; picking a project runs `initFromProject`
      against the workspace folder (picker if >1, as today).

## 5. Cleanup + verify
- [x] Deleted `probeVendors`/`probeHealth`/`pipeForVendor` outright (no legacy) + renamed `VoltStatus`'s private
      poll to `pollConnection`. Fixed the stale volt-control README (`connector.ts` = the status source).
- [x] `volt.iec.vendor` (LSP dialect) stays orthogonal; on init MAY be set from the picked project's vendor.
- [x] `bun run typecheck` + `bun run lint`; `bun test` in volt-control.
- [x] Live: with TwinCAT + CODESYS projects open/activated, both shells list them and init from a pick — no vendor
      button anywhere; the connector `:8550` is the one status source (needs live IDEs + the connector).

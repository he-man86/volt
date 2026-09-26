# Tasks

## 0. The baseline, measured before anything changed

Production `plc-assist.com`, TcXaeShell 15.0 serving `TwinCAT Project14`, bridge
`PLCAssistBridge-TwinCAT-fbff1b8f.zip` downloaded from the app and run as shipped. Pipe
`volt.bridge.twincat.37640` (named for the XAE pid, not the bridge's).

| probe | as shipped | after `select` sent by hand |
|---|---|---|
| `health` row status | `idle`, polled every 5s for 60s | `healthy` |
| `refs` | `PLC_DISCONNECTED` | 12 items |
| `fetch PLC_PRG.prg` | — | 2,667 B, marker in place, `folder: ""` |
| `push` create `FB_VoltTcTest.fb` | — | accepted, `aa21e1c9dad41223` |
| `build` | — | `success: true`, `duration: 736`, diagnostics carry no `name`/`code` |
| `push deleteItem` | — | accepted, tree back to 12, zero diff |

- [x] Re-measure with NO manual `select`. Every row must read as the right-hand column. That is the acceptance
      test for the whole change. **2026-09-26**, `ide.ps1 up -Vendor twincat -Fixture 14`, nothing sent but reads:
      `health` → `healthy` (one `degraded` first, from the harness's first worker racing the XAE's ROT
      registration, cleared on the next probe), `refs` → the project's items. `fetch`/`push`/`build` were not
      re-driven live: nothing on their path changed, and the baseline shows them working once a project is bound.

## 1. The fix

- [x] `BeckhoffDriver.Connect(int xaePid)` — resolve after acquiring the DTE. Built as
      `_om.ConnectToPid(xaePid); _om.AttachFirstProject(); SnapshotHealth();`, NOT `SelectProject(null)` — see
      the two gaps below, which `SelectProject(null)` would have left open.
- [x] **Gap 1 — recovery.** `ReattachProject` (the op-level `Recover`) re-establishes only a SELECTION, and the soft
      attach set none — so a bridge nobody ever sends `select` (the relay's) would never recover from a DTE
      re-registration. The attach now takes its project up AS the standing selection (a named pick already standing is
      never replaced).
- [x] **Gap 2 — a project opened after the attach.** With the XAE started first, the attach finds nothing, and with no
      `select` coming the bridge stayed idle for good. The health poll (`EnsureAttached`) completes the attach while
      nothing is taken up — a system-manager resolve, never the PLC tree — and stops once one is.
- [x] `Program.cs:331` — the comment says *"No project is auto-bound (the user picks one via `select`)"*. It
      will no longer be true.
- [x] Check the startup console/log output reads sensibly (the attach logs `attach: serving '<name>', the first
      TwinCAT project of [...] — a select by name serves another`, and no `select:` line at startup): `SelectProject` logs `select: project=''` and
      `BindAndResolve` logs `select: bound '<name>' on instance serving [...]`. At startup that is the bridge
      attaching, not a user picking — make sure the wording does not imply otherwise.

## 2. Prove the vendors now agree

- [x] TwinCAT serves immediately after attach, with no `select` from anyone (`TcAttachTests`, offline doubles; red
      before the fix).
- [x] **CODESYS is unchanged** — no CODESYS or Core file is touched; its offline suite passes. Its `Connect()` is untouched and its `SelectProject` is already a no-op refresh
      of the one primary project. Same `refs`/`fetch`/`push`/`build` transcript before and after — prove it,
      do not assume it.
- [x] A named `select` still retargets to a different project in the same solution.
- [x] Recovery still works: `_wantProject` survives a dropped DTE and `ReattachProject` re-establishes it. The
      soft attach must not erase a standing named selection — `SelectProject` only assigns `_wantProject` for a
      non-empty name, which is the property this relies on.
- [x] A solution with two TwinCAT projects serves the first and logs the full list (and a non-TwinCAT project
      ahead of them is passed over).

## 3. What must not move

- [x] **Disconnect still means disconnect.** `BridgePipeHost` is untouched; the connector suite passes. Tray Disconnect sets `BridgePipeHost._paused`, independent of the
      attach; a paused bridge still refuses sync ops.
- [x] **The local pickers are untouched** — desktop and VS Code keep `init` / `connect` / `rebind` via
      `volt-control`'s `connectOptions` / `connectSurface`, and an explicit pick still beats the soft attach.
- [x] **One bridge still serves one XAE window.** Several windows remain several workers and several pipes.

## 4. Optional, separable: picking a project from a client with no local shell

Not required by anything above; the fix stands alone. Only worth doing if serving the first project turns out
to be the wrong one often enough to matter.

- [ ] `BridgePipeHost` — accept `select` while UNBOUND, refuse once serving. The guard belongs here, not in any
      caller, so a second consumer cannot forget it.
- [ ] Decide whether the relay's op allowlist opens for `select` or whether the bridge-side guard alone carries
      it, and write the reasoning down next to the `wire.ts` rule it qualifies.
- [ ] `volt-control/src/bridge/connector.ts` — a remote surface yields first-bind options only; `rebind` stays
      local, because that is the operation the safety rule is actually about.
- [ ] Consumer side: list the detected projects from `health` — no new op, the list and its per-row `status`
      are already on the wire.

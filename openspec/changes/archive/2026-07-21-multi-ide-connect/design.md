## Context

The bridge wire is one named pipe per vendor (`PipeNames.Codesys` / `PipeNames.Twincat`), keyed by vendor only.
CODESYS is an **InIdeLoad** bridge — the host runs *in-proc* inside each CODESYS process (`PipeHost.Start` loaded
by `start_pipe.py`); it can only ever represent the one process it lives in, and reports a hardcoded
`IdeInstance("codesys")`. TwinCAT is **ExternalAttach** — one supervised worker (`VoltBridgeTwincat.exe`) attaches
over COM and enumerates *all* running projects via the ROT (`RotInstances`), selecting one with `select`.

The bug: two CODESYS processes each pass their per-process `PipeHost.IsRunning` static and each open a
`NamedPipeServerStream(..., MaxAllowedServerInstances, ...)` on the *same* name — Windows accepts both, and clients
route non-deterministically. The connector (`ConnectionManager`) and CLI both assume one bridge per vendor.

User requirement: allow the script to run in **multiple CODESYS** and **multiple TwinCAT** projects simultaneously,
**all staying live**; list them all and **click to switch** the one active connection with no re-activation;
exactly **one** connected at a time; a **Disconnect** that deselects (leaves every host live).

## Goals / Non-Goals

**Goals:**
- Multiple live CODESYS hosts never collide → deterministic routing to the intended IDE, or a loud refusal.
- Multiple running projects (CODESYS + TwinCAT) are all discoverable and individually selectable.
- Exactly one connected project per vendor; clean Disconnect/switch from tray + desktop + VS Code.
- CLI (`pull/push/status/build`) always targets the bound project's bridge or fails — never the wrong IDE.
- Preserve the deliberate InIdeLoad (in-proc, per-process) vs ExternalAttach (one worker, ROT) asymmetry.

**Non-Goals:**
- Concurrent sync to more than one project at once (one connected is enough).
- Per-instance pipes for TwinCAT (its single worker already multiplexes via the ROT — leave it).
- A start-guard that refuses a second CODESYS host (explicitly rejected — multi-host is the supported workflow).
- Any change to sync/parsing/PLCopen/VG logic.

## Decisions

### 1. CODESYS pipe = `volt.bridge.codesys.<pid>`
`PipeNames` gains `CodesysInstance(pid)` = `Codesys + "." + pid`. `PipeHost.Start` computes it from
`Process.GetCurrentProcess().Id`, serves it, and reports it in the start message. `pid` is unique per process and
stable within a session; the pipe dies with the process (no stale entries). No cross-process guard — coexistence is
the point.

### 2. Discovery via the pipe filesystem
New `PipeDiscovery.List(prefix)` = `Directory.GetFiles(@"\\.\pipe\")` filtered to names starting with
`volt.bridge.codesys.` (strip the `\\.\pipe\` prefix; tolerate enumeration quirks). Self-cleaning, no registry, no
coordination file. TwinCAT discovery returns the single well-known `volt.bridge.twincat` if present.

### 3. Connector: a discovery-backed CODESYS source
The CODESYS `IProjectSource` becomes discovery-driven: on `EnumerateAsync` it lists live pipes, opens each, calls
`instances`/`health`, and emits one `DetectedProject` per live host. `DetectedProject.Attach` (or a new field)
carries the **pipe name** so `BindAsync`/health/sync target that exact pipe. TwinCAT source is unchanged (single
`PipeBridgeWire`, ROT-enumerated). `PipeBridgeWire` stays per-pipe; the CODESYS source constructs a wire per
discovered pipe on demand.

### 4. ONE active connection above the connector; hosts stay live
The abstraction above the bridge is vendor-neutral and single: `ConnectionManager` exposes one nullable
`Connected` (a `DetectedProject?`), replacing the per-vendor `_selected` dict. Every live bridge on every platform
is *listed* (Decision 3); **clicking any project makes it the one active connection** — CODESYS just records the
project + its pipe (the per-pid pipe already serves that one project); TwinCAT additionally `select`s the DTE on the
worker. **Disconnect = clear `Connected`** (deselect); it does NOT tear down any host — every activated CODESYS and
every running TwinCAT project stays live and re-clickable. This removes the `disconnect` wire op, `PipeHost.Stop`,
and `IIdeDriver.Disconnect` entirely — less lifecycle code, fewer failure modes. Switching is pure connector-side
state; nothing on the wire changes.

### 5. CLI resolves the bridge from the binding (connector-independent)
`Program.cs` pipe selection changes from "`VOLT_PIPE` ?? vendor" to a resolver:
- `VOLT_PIPE` set → use it (dev/tests, and the shells set it for `volt init` — see below).
- CODESYS → `PipeDiscovery.List`. **Exactly one live pipe → use it** (the common case, zero matching). Several →
  match the one whose `health.ProjectName` equals the binding's `project.projectName`; 0 matches → refuse
  ("open/activate the bound project"); >1 same-name → refuse ("two CODESYS have ‘X’ open — close one"). Never guess.
- TwinCAT → `volt.bridge.twincat`; if `instances` shows the bound project on a non-selected instance, `select` it
  first; existing `VerifyBinding` guards any residual mismatch.
- **`volt init`** has no binding yet, so the shells pass the picked project's pipe via `VOLT_PIPE` for the init
  subprocess (the `DetectedProject` carries its pipe). Pure-CLI init with one CODESYS live → discovery's single
  pipe; with several and no `VOLT_PIPE` → refuse ("set VOLT_PIPE or leave one CODESYS open").

### 6. UI (vendor-neutral, one active)
Tray `RebuildConnectMenu`: the flat project list is radio-style — the one `Connected` project is checked; clicking
another switches it. Add a **Disconnect** item (enabled when something is connected) = deselect. Labels gain the IDE
version when a vendor has >1 live instance (disambiguates same-named projects). Desktop `shell.html` + VS Code get a
**Disconnect** button mirroring the Reconnect button, wired through `volt-control` (`disconnect()` → `/disconnect`).

### 7. Connect from a second frontend = no conflict (per-workspace status)
The connector's single "active connection" is a display highlight, NOT a lock. Connecting from a second frontend
switches it (no block, no error). Crucially this never blocks parallel work: every host has its own pipe and each
workspace's CLI resolves ITS bound bridge, so two frontends bound to two projects both `pull`/`push` correctly at
once. To make that truthful in the UI, `boundStatus` is **per-workspace** — it reports whether THIS workspace's
bound project is live (present in the connector's project list), independent of the global active highlight. So two
windows on two projects each show "connected". (Chosen over a hard "already connected elsewhere" block — the
per-pid design makes such a lock unnecessary.)

## Risks / Trade-offs

- **Backward/wire compatibility**: the CODESYS pipe name changes — a mixed old-connector/new-host (or vice-versa)
  won't find each other. Mitigation: this ships in one installer (connector + host + CLI together); `VOLT_PIPE`
  covers dev overrides. Tests that hardcode `volt.bridge.codesys` are updated.
- **Same-name ambiguity**: two CODESYS with the *same* project name open can't be told apart by the CLI's
  name-match. Chosen behavior: **refuse** rather than guess (safe). The connector UI can still list both (pid
  differs) and let the user disconnect one.
- **Discovery latency**: the CLI does a health round-trip per live pipe only when >1 is live (single-pipe fast path
  skips it). Live-pipe count is tiny; negligible.
- **`Directory.GetFiles(@"\\.\pipe\")` quirks**: some pipe names throw on enumeration; wrap per-entry and skip. This
  is the one "off the beaten path" call — fallback is a per-instance registry file if it proves flaky.
- **Two workspaces, two vendors, one global `Connected`**: with a single active connection, the connector UI shows
  one connected project even if a user works a CODESYS repo and a TwinCAT repo in parallel. Accepted per the "1
  active is fine" decision. The **CLI is unaffected** — it resolves each repo's bridge from that repo's binding, so
  `pull`/`push` in either workspace stay correct regardless of which one the connector shows as connected.
- **Stale checkmark on host exit**: if the connected CODESYS closes, its pipe vanishes; the connector's 4s refresh
  drops it from the list and clears `Connected` (its project is no longer detected) — same path as today's stale
  selection cleanup.

## Why

**A TwinCAT bridge attaches to its XAE and then serves nothing.** Measured against production on 2026-09-26,
TcXaeShell 15.0 serving `TwinCAT Project14`, bridge downloaded from plc-assist.com and run as shipped:

| step | result |
|---|---|
| `VoltBridgeTwincat.exe` starts, finds the XAE | console names the project; pipe `volt.bridge.twincat.37640` opens |
| `health` | `{vendor: twincat, project: "TwinCAT Project14", status: "idle"}` — **polled 60s, never leaves `idle`** |
| `refs` | `PLC_DISCONNECTED — "Bridge is waiting for an IDE project"` |
| `connect {project: "TwinCAT Project14"}` sent by hand | `ok` → `status: healthy` |
| everything after | `refs` 12 items · `fetch` 2,667 B · `push` create accepted · `build` ok 736 ms · `deleteItem` accepted |

Nothing behind the attach is broken. The attach itself is incomplete, and the two drivers disagree about what
attaching means:

```csharp
// Volt.Ide.Codesys/Driver/CodesysDriver.cs
public void Connect() => SnapshotHealth();
public override bool IsConnected => _dispatcher != null && _hasProject && _om.HasObjectManager;

// Volt.Ide.Twincat/Driver/BeckhoffDriver.cs
public void Connect(int xaePid) { _om.ConnectToPid(xaePid); SnapshotHealth(); }
public override bool IsConnected => _om.IsConnected;      // _dte != null && _sysManager != null
```

CODESYS derives served-ness from the IDE's own state: a primary project is open, so the bridge serves it. There
is no binding step because there is nothing to bind.

TwinCAT's `ConnectToPid` acquires the DTE and stops. `_sysManager` is only set by `FindTwinCatProject`, which
`Connect` never calls — so `IsConnected` is false, the row reports `idle`, and `OpGuard` refuses every sync op.

**The resolve step already exists and is already used.** `SelectProject(null)` → `BindAndResolve(null)` →
`FindTwinCatProject(null)`, commented *"soft attach: resolve first so PLCs list"*, which takes the first project
in the solution (`want='(first)'`). The `probe-pou` path in `Program.cs:76-77` does exactly this:

```csharp
om.ConnectToPid(pids[0]);
om.SelectProject(null);          // whatever the window is serving
```

So the diagnostic path attaches correctly and the serving path does not. `Program.cs:331` records the intent —
*"No project is auto-bound (the user picks one via `select`)"* — and that was reasonable while every consumer
was a local client that sends `select` (the desktop app and VS Code, via `volt-control`'s
`connectOptions`/`connectSurface`). It stops being reasonable for a consumer that has no local client: the
relay deliberately does not carry `connect` (*"a remote party does not get to rebind which project an
engineer's IDE serves"*), and the zip the app ships contains the bridge exe and no tray app — while its own
README promises *"A console window opens and finds your TwinCAT XAE"* and *"The bridge serves the first one and
says so"*.

## What changes

### The attach resolves a project, on both vendors

`BeckhoffDriver.Connect(int xaePid)` performs the soft attach that already exists:

```csharp
public void Connect(int xaePid) { _om.ConnectToPid(xaePid); _om.SelectProject(null); SnapshotHealth(); }
```

That is the fix. It makes the TwinCAT attach mean what the CODESYS attach already means — *serve what this IDE
window has open* — using the resolve path the probe already relies on, with no new state, no heuristic and no
vendor-specific policy anywhere above the driver.

Consequences that follow for free rather than needing their own machinery:

- A bridge with one project serves it, which is the shipped README's promise and the overwhelmingly common case.
- A solution with several projects serves the first, which is also what the README promises and what the probe
  path has always done.
- An explicit `select` by name still overrides it. `SelectProject` persists `_wantProject` only for a non-empty
  name, so a later soft attach re-establishes the standing selection rather than erasing it — the recovery path
  depends on that and is unchanged.

### What the one line would have missed (found while building it)

`SelectProject(null)` resolves the first project and keeps nothing. Two paths depend on there being a SELECTION:

- **Recovery.** `ReattachProject` re-establishes `_wantProject` and does nothing without one — so a relay-served
  bridge, which never receives a `select`, would not recover from a DTE re-registration.
- **A project opened after the attach.** Start the XAE, then open the project: the attach found nothing, and with no
  `select` coming nothing ever resolved.

So the attach is `AttachFirstProject`: resolve the first TwinCAT project and take it up as the standing selection
(never replacing a named pick), and the health poll completes the attach while nothing is taken up.

### Optional, separable: let a remote client pick when there is more than one

Serving the first project is correct but not always what the engineer wants. The picking mechanism already
exists (`select` by name); what a browser-only client lacks is a way to reach it, because `connect` is not
relayable.

If this is wanted, the smallest honest version is: **relay `select` only while the bridge is unbound**, refused
once it is serving, enforced in `BridgePipeHost` rather than by any caller. The `wire.ts` rule exists to stop a
remote party retargeting a live IDE; choosing among projects on a bridge that has not yet resolved one is not
that.

The project list needs no new op — `health` already returns every detected project with a per-row `status`.

**This part is deliberately separate from the fix above, and the fix does not depend on it.** With the attach
corrected, a TwinCAT user is unblocked whether or not this ships.

## What this is not

**Not a change to how the connector, desktop app or VS Code extension bind.** They keep sending explicit
`select`, keep the `init`/`connect`/`rebind` surface, and an explicit pick still wins — the soft attach only
resolves what the window already has, and a named select replaces it.

**Not a way around Disconnect.** The tray's Disconnect sets `BridgePipeHost._paused`, which is independent of
whether a project is resolved. A paused bridge refuses sync ops regardless of the attach, exactly as today.

**Not an auto-bind heuristic.** An earlier draft of this proposal invented one — "bind when exactly one project
is detected" — in `DriverBase`. That was aimed at the wrong layer: it would have added a policy above the driver
to paper over a driver that skips a step, and it would have left the two vendors still meaning different things
by "attached". Nothing detects, counts or decides; the attach resolves, as it does on CODESYS.

**Not multi-project serving.** One bridge still serves one XAE window, and several windows are still several
bridges.

## Impact

- `Volt.Ide.Twincat/Driver/BeckhoffDriver.cs` — `Connect(int)` resolves; the one substantive line
- `Volt.Ide.Twincat/Program.cs` — the comment at :331 no longer describes the behaviour
- `Volt.Ide.Twincat/Ide/TcObjectModel.Session.cs` — no change expected; the soft-attach path is what is being
  called. Worth confirming the `select` log line at startup is not mistaken for a user action in the console
- Optional part only: `Volt.Engine.Host/BridgePipeHost.cs` (`select` while unbound),
  `volt-control/src/bridge/connector.ts` (a remote surface offers first-bind options only), and the consumer's
  op allowlist
- Tests: TwinCAT serves after attach with no `select`; a named `select` still retargets; a paused bridge still
  refuses; the recovery path still re-establishes `_wantProject`; CODESYS transcript unchanged

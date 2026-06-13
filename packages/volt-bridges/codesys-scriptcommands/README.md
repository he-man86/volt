# VoltBridge CODESYS Script Commands

The Volt CODESYS bridge runs **inside the live CODESYS IDE** as a Script Command
(a native CODESYS ScriptEngine feature — no plug-in, no package, no plug-in-key
startup dialog). The engineer starts it with one click from the CODESYS menu;
the Volt app then talks to that IDE session over `http://127.0.0.1:8556`.

## Pieces

| File | Role |
|------|------|
| `config.json` | Declares the menu items: **Start Volt Bridge** / **Stop Volt Bridge** |
| `start_bridge.py` | IronPython launcher — loads the C# DLL and calls `Host.Start(projects, system, online)` |
| `stop_bridge.py` | IronPython — `Host.Stop()` (falls back to `POST /shutdown`) |
| `VoltBridge.Codesys.dll` | The bridge itself (C#); all logic lives here. Built from `src/VoltBridge.Codesys` |

The Python is only a launcher; the bridge is a single C# codebase.

## Running it

`start_bridge.py` finds the DLL via the first path that exists:

1. `$VOLT_BRIDGE_DLL` — explicit override
2. next to the script itself — **production** (the installer ships the `.py` + DLL together)
3. `../src/VoltBridge.Codesys/bin/{Release,Debug}/net48/` — **dev**, when you
   run this repo copy of the script directly

**Dev (now):** build `src/VoltBridge.Codesys`, then in CODESYS use
**Tools → Scripting → Execute Script File…** and pick this repo's `start_bridge.py`.
It loads the freshly-built DLL from the build output — nothing to copy.

**Production (future, single installer):** the Volt installer bundles the opencode
fork + the TwinCAT bridge + this CODESYS bridge. For CODESYS it drops
`config.json`, the two `.py` files and `VoltBridge.Codesys.dll` into
`C:\ProgramData\CODESYS\Script Commands\`; CODESYS shows the menu items and the
DLL resolves next-to-script.

## Important: scripting objects are thread-affine

The CODESYS scripting objects (`projects` / `system` / `online`) may only be
touched on the IDE's main/scripting thread — model reads (`get_name`,
`get_children`, …) throw from background threads. The bridge therefore reads the
project on the script thread at start-up and serves a cached snapshot from the
HTTP handler. The full read/write adapter must marshal every scripting call back
to the main thread (`IEngine.InvokeInPrimaryThread`), the same way the Beckhoff
bridge marshals COM calls onto its STA thread.

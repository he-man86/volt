## Why

**The CODESYS bridge starts on a CODESYS we do not support, reports itself connected, and then fails every call
with an exception nobody can act on.**

Seen in PLCAssist on 2026-09-30, chat `896f798f`. A new user on **CODESYS 3.5.17**, on a Russian Windows.
- One download, started once. The CODESYS message window showed a normal start:

  ```
  Volt: loading C:\Users\ALEXBL~1\AppData\Local\Temp\volt\codesys-bridge\2320\Volt.Ide.Codesys.dll
  volt bridge started on pipe volt.bridge.codesys.2320 (connected to IDE)
  ```
- Then every `plcProject` / `plcRead` failed with:

  ```
  Метод не найден: "System.Text.Json.JsonElement Volt.Wire.PipeClient.Call(System.String, System.Object,
  System.Action`1[System.Text.Json.JsonElement], Int32)"
  ```
  That is a `MissingMethodException`, in the OS language.
- PLCAssist documents **CODESYS V3.5 SP21 or later**. Nothing checks it. The user saw "connected", and the model
  guessed a version mismatch and sent them off clearing caches.

**Nothing can check it today.** `CodesysDriver.IdeVersion` is hard-coded to `"3.5"`; the real CODESYS version is
never read, so neither the bridge nor a client knows which CODESYS it is in.

**A related case that the version does NOT explain.** 2026-09-28: a user on **3.5.21.50** (supported) failed every
call with `MissingFieldException: Volt.Contracts.WireJson.Write`. Both failures are a member whose signature
carries a `System.Text.Json` type (`JsonElement`, `JsonSerializerOptions`), which points at a second copy of a
Volt or System.Text.Json assembly bound in the CODESYS process. On .NET Framework, `Assembly.LoadFrom` (used by
`BridgeAssemblyResolver`) returns an assembly already loaded with the same identity, and every Volt build is
`1.0.0.0`, unsigned. Which copy won is not visible anywhere today.

**Measured 2026-09-30: an older CODESYS is NOT enough to break it.** Same bridge release (built 2026-09-27) on
**CODESYS 3.5.18.30 (SP18 Patch 3)**, which is below SP21, on a PLCAssist dev laptop: the bridge started, connected to
the relay, and `plcProject` + `plcRead` both worked (a fresh project: PLC_PRG, 24 libraries, MainTask; only
"Project Settings" unreadable). So neither failure above is explained by the version alone. Something in THOSE
installs supplies a second copy of an assembly: an add-on, or something SP17-specific. That makes the bound-assembly
log (3 below) the key part for DIAGNOSING those cases.

**The floor stays SP21 — owner decision (2026-09-30).** SP18 happening to work is not a promise: SP21 is what is
tested and documented, so it is the safe checkpoint. An older CODESYS is refused clearly even if it might work,
rather than served until it breaks in a way nobody can read.

One more fact from the installs on that laptop: CODESYS carries its own framework assemblies in
`CODESYS\LacBinaries\GAC_MSIL`. SP18 has `System.Memory` 4.0.1.1 only; SP21 has 4.0.1.1 and 4.0.1.2. Worth including
in the log.

## What Changes

1. **Read the real CODESYS version**: the full `3.5.x.y` of the running IDE. Report it in `IdeVersion` (health, the
   connector row) instead of `"3.5"`.
2. **Refuse to serve below the supported minimum (CODESYS 3.5 SP21), clearly.** At start, write one line to the CODESYS
   message window, e.g. `Volt: CODESYS 3.5.17 is not supported — PLC Assist needs CODESYS 3.5 SP21 or newer`. Do not
   report healthy/connected. The minimum lives in one place.

   **The contract clients build on (PLCAssist will not patch around this; it waits for it):**
   - a NEW error code **`IDE_UNSUPPORTED`** in `BridgeErrorCodes`, returned for every call while the IDE is below the
     minimum. Clients map by code, and a code that is not new would be misread as its old meaning.
   - its message names the found and the required version, in English, fixed wording (not the OS-localized exception
     text): `CODESYS 3.5.17.0 is not supported; PLC Assist needs CODESYS 3.5.21 (SP21) or newer.`
   - the full `IdeVersion` is also on the health/status frame the relay forwards, so a client can show it (e.g.
     "CODESYS 3.5.17 — not supported") before any call is made.
3. **Log what actually got bound**, once at start: the path and version of `Volt.Wire`, `Volt.Contracts` and
   `System.Text.Json` as loaded in the process. This settles the 3.5.21 case the next time it happens, and costs
   one line.
4. **Optionally, refuse when a Volt assembly from another build is already loaded** (the identity reuse above).
   Decide after 3 shows whether that is the cause.

## Impact

- `Volt.Ide.Codesys` (`CodesysDriver.IdeVersion`, `PipeHost.Start`), the health/connector row.
- The bridge's error vocabulary: `IDE_UNSUPPORTED` (clients map by code).
- Clients: PLCAssist adds `IDE_UNSUPPORTED` to its wire vocabulary with a row telling the model the IDE version is
  unsupported (do not retry), and shows `IdeVersion` in its bridge bar. It ships in the same deploy as the bridge
  that carries this change; PLCAssist deliberately has no interim patch.

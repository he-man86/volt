## 1. Version

- [x] 1.1 Find the reliable source of the UNDERLYING CODESYS PLATFORM version (3.5.x.y) — NOT the host executable's
      file version: OEM IDEs built on CODESYS (WAGO CODESYS V3.5 / e!COCKPIT, Lenze PLC Designer, Schneider Machine
      Expert, …) carry their OWN product version on the exe. Use what the framework itself reports (scripting API /
      the core framework assemblies' version / the profile), and record which source and why in DIALECT.md. Verify on
      the installs available (3.5.21.x; older if one can be installed); record the product name too where readable.

      **Result (DIALECT V1).** Source: the assembly version of the assembly that DEFINES
      `_3S.CoDeSys.Core.SystemInstances` (`SystemInstances.dll`). Measured on disk on both installs here:
      SP18 Patch 3 → `3.5.18.30`, SP21 Patch 4 → `3.5.21.40`, equal to `CODESYS.exe`, `VersionKey.ini` and the profile
      name. Rejected: `ComponentModel.dll`/`Engine.dll` (read `3.5.18.60` on SP18 Patch 3 — a framework build inside
      the patch), `Core.dll` (a frozen `3.5.16.1` facade that forwards `SystemInstances`/`ComponentManager`), the
      scripting API (`ScriptEngine*`, `ScriptDriverSystem` — reflected, exposes no platform version), the exe (OEM).
      Live on 3.5.21.40 through the bridge: `3.5.21.40`. Product name: `IEngine3.OEMCustomization.ProductName`
      (EngineWin.dll, present on SP18 and SP21); plain CODESYS 3.5.21.40 answers `"CODESYS"` (live). SP18 was NOT
      started (memory: SP18 is installed but unused) — read off its binaries only. **Unmeasured:** an OEM build's
      product name and its `SystemInstances.dll`; the start log prints the product name as stated, so the first OEM run
      records it.
- [x] 1.2 `CodesysDriver.IdeVersion` returns the platform version; the connector row and health show it. (An OEM
      build's product name is reported beside it, in its own fact — see the review fix below.)

      **Result.** `IdeVersion` = `3.5.21.40` — a pure platform version on every build.
      It rides on the row's `version` (the connector row) and, new, on `health` as the top-level `ideVersion`
      (`BridgePipeHost`, both vendors). Live on 3.5.21.40: `health` →
      `{"projects":[{"vendor":"codesys","version":"3.5.21.40",…,"status":"healthy"}],"networkText":true,"ideVersion":"3.5.21.40"}`.
      Tests: `CodesysCapabilityTests.An_older_platform_with_every_capability_is_served_and_reports_its_version`,
      `An_OEM_product_is_named_apart_from_a_pure_platform_version`.

      **Review fixes (gate, 2026-10-01).**
      - `IdeVersion` carried `<platform> (<product>)` on an OEM build (`3.5.18.30 (WAGO CODESYS V3.5)`): not a version a
        client can parse, against the spec's "the platform version, not the OEM product version", and wrapped in a
        second pair of parentheses by the tray label. Now it is the platform version alone; the product is
        `CodesysDriver.OemProduct`, in the start log and the message-window line (`… (connected to IDE, WAGO … on
        CODESYS 3.5.18.30)`). The test that pinned the mixed field was changed on the SPEC's grounds, not the code's:
        red (`Strings differ`) before, green after.
      - Reading the product name could abort driver construction (no bridge, no IDE_UNSUPPORTED): a throwing
        `OEMCustomization` getter, or a `ProductName` hidden by a derived class (`AmbiguousMatchException`). Now the
        property is found on the most-derived declaration, and a getter failure is kept by name as
        `ProductNameUnreadable` (start log: `product name as stated: (unreadable: …)`), never thrown. Tests
        `A_product_name_getter_that_throws_does_not_take_the_driver_down`,
        `A_product_name_hidden_by_a_derived_class_reads_the_derived_one` — both red on behaviour first
        (InvalidOperationException / AmbiguousMatchException out of the constructor).
      - The version source rests on two samples (finding, low): accepted as stated, not changed — no better
        in-process source is measured. DIALECT V1 now records the risk and the evidence: within one patch the
        framework assemblies do NOT share a number (SP18 Patch 3: 73 `Common\*.dll` at 3.5.18.30, 34 at 3.5.18.60);
        `SystemInstances.dll` is in the release-stamped group on both installs; a patch that does not rebuild it
        would report the previous patch's number. **Unmeasured:** any other patch, notably 3.5.21.50.

## 2. Refuse by capability, not by number (owner, 2026-10-01)

A fixed SP21 floor would lock out OEM IDEs on an older platform that work today (the WAGO PFC300 PLCAssist sessions of
2026-09-30 built and served normally). So the bridge refuses when what it NEEDS is missing, and states the version.

- [ ] 2.1 Measure what failed on 3.5.17 (the proposal's exception, chat 896f798f): which API/type/member the bridge
      binds that the old platform lacks. List every framework API the bridge needs at start in ONE place
      (the capability list), each with the platform version it is known on.

      **Done: the capability list** — `CodesysPlatform.All` (DIALECT V2): the core type `SystemInstances`, the
      primary-thread dispatcher `SystemInstances.Engine.InvokeInPrimaryThread(Delegate, object[], bool)`, the object
      manager `SystemInstances.ObjectMgr`; each known on 3.5.18.30 (PLCAssist, 2026-09-30) and 3.5.21.40 (here).
      Everything else the bridge reflects lives in lazily loaded plugins and is deliberately NOT checked at start.

      **Open — cannot be measured here.** No CODESYS 3.5.17 install and no field log from chat 896f798f. What the
      exception itself shows: the missing member, `Volt.Wire.PipeClient.Call(String, Object, Action`1[JsonElement],
      Int32)`, is VOLT's (unchanged since 2026-08-25, reached by the relay tunnel), not a CODESYS API — so no
      capability on the list explains it, and that 3.5.17 also started "connected to IDE" says the three capabilities
      were present. It has the shape of the 3.5.21.50 `MissingFieldException: WireJson.Write`: a second bound copy of a
      Volt or System.Text.Json assembly. Settles with the first `bound:` log (3.1) from such an install.
- [x] 2.2 At start the bridge checks the capability list. Missing → message-window line at start naming the platform
      version, the product, and what is missing; not healthy; every call refused with `IDE_UNSUPPORTED`, fixed English
      wording: `CODESYS <platform version> is not supported: it lacks <capability>.` No number floor anywhere.

      **Result.** `CodesysDriver` decides once at attach (`CodesysPlatform.Refusal`) and exposes it as
      `IIdeSession.Unsupported`; the POLICY is Core's, once for both vendors (`BridgePipeHost.Dispatch`): every op but
      `health` — connect and disconnect included — throws `IDE_UNSUPPORTED` with the driver's sentence; `health`
      answers with every row `idle`, `unsupported` = the sentence, `ideVersion`. New `BridgeErrorCodes.IdeUnsupported`,
      documented on every op (`docs/wire.html`, regenerated `volt-bridge.openrpc.json`/`data.js`). `PipeHost.Start`
      returns (→ message window) `Volt: [<product>: ]CODESYS <v> is not supported: it lacks <cap>. The bridge on pipe
      <pipe> refuses every call (IDE_UNSUPPORTED).` and logs it at Error. Before: a missing dispatcher printed "no IDE
      engine" and every op answered PLC_DISCONNECTED. TwinCAT: inherits `Unsupported => null` — no TwinCAT capability
      gap is measured; the refusal path it would take is the same shared one.
- [x] 2.3 Tests: a driver double lacking a capability is refused with that text (any version number); a double with every
      capability on an older version number is SERVED.

      **Result.** Red first (compile: `Unsupported`/`BoundAssemblies` did not exist), green after.
      `Volt.Ide.Codesys.Tests/CodesysCapabilityTests` (4: no dispatcher → refused naming version + `InvokeInPrimaryThread`;
      no object manager → refused naming `ObjectMgr`; every capability on platform 1.0.0.0 → served, `IdeVersion`
      1.0.0.0; OEM product named beside the version). `Volt.Cli.Tests/wire/IdeUnsupportedTests` (8, over the pipe:
      each of connect/disconnect/refs/fetch/push/build → `IDE_UNSUPPORTED` + the exact text; health answers idle with
      `ideVersion` + `unsupported`; version 3.5.16.0 with nothing missing → served, no `unsupported`).

      **Review fixes (gate, 2026-10-01).**
      - "Red first" above was a compile failure only, and `IdeUnsupportedTests` injects `Unsupported` into a FakeIde,
        so it could not fail if the CODESYS driver grew a version floor. New
        `Volt.Ide.Codesys.Tests/CodesysUnsupportedHostTests` (2) run the REAL `CodesysDriver` behind `BridgePipeHost`
        over the pipe on platform 1.0.0.0: every capability → `health` has `ideVersion`, no `unsupported`, and `refs`
        is not IDE_UNSUPPORTED; no object manager → `refs` IDE_UNSUPPORTED naming it. Proven to bite: with a
        temporary `< 3.5.21` floor added to the driver, the served case FAILED; the floor was removed.
      - **The connector dropped the refusal** (finding, medium). `WireProjects.Flatten` read only `health.projects`,
        so the tray, `/status`, volt-desktop and volt-vscode showed an ordinary idle project, and the reconciler sent
        `connect` every ~4 s cycle, each refused and logged "retried next cycle". Now `DetectedProject.Unsupported`
        and `ProjectView.unsupported` carry the bridge's sentence; the reconciler keeps the row WANTED but never binds
        it; the tray row reads `✕ IDE not supported` with the sentence as its tooltip. Tests
        `PerPipeProjectSourceTests.An_unsupported_bridges_reason_rides_onto_each_of_its_rows`,
        `A_supported_bridges_rows_carry_no_reason`, `ReconcilerTests.A_wanted_project_on_an_unsupported_ide_is_wanted_but_never_bound`
        — the two refusal ones red on behaviour first (`Strings differ`, `Collection was not empty`).
        **Open, outside this package:** `@volt/control` (volt-desktop, volt-vscode) does not read
        `ProjectView.unsupported` yet — the field is on `/status` and the session sync; rendering it is a
        volt-control change.
        **Done (2026-10-01).** `DetectedProject.unsupported` is read; `connectOptions` gives such a row a
        `refusal` (`{ caption: "IDE not supported", reason: <the bridge's sentence> }`) — the wording decided once in
        `@volt/control`. The IDE Connection view in both shells draws a refused row named, with the caption and the
        reason, and with NO action (vscode: no command, the reason as tooltip; desktop: a disabled button with the
        reason as text under it). The desktop's change-detection key covers `unsupported`. Red first:
        `connector.test.ts` (refusal on unbound and bound rows), vscode `panel.test.ts` (2), desktop `panel.test.ts`
        (2) and `shell-render.test.ts` (1). Found on the way, same renderer function: the desktop picker drew
        `p.displayName`, a field the rows no longer carry, so every project button read "undefined" — the apostrophe
        test passed only because the id embeds the name; it now asserts the label, red before the fix.
        Not covered: vscode's `volt.init` QuickPick (a command, not the view) still lists a refused project; picking it
        fails with the CLI's `IDE_UNSUPPORTED` message, which is the same sentence.
      - **The spec delta claimed the field failure was fixed** (finding, medium). Its scenario "CODESYS 3.5.17 lacks a
        needed API … instead of failing with a runtime exception" asserted what 2.1 shows was NOT built: that install
        had every capability and failed on Volt's own `PipeClient.Call`. The delta now states the refusal for a
        CODESYS of any version that lacks a listed capability, adds the connector scenario, and says in a note that
        the 3.5.17 failure is not settled by it.

## 3. Bound-assembly log

- [x] 3.1 At `PipeHost.Start`: log path + version of `Volt.Wire`, `Volt.Contracts`, `System.Text.Json` as bound.

      **Result.** `BoundAssemblies.Describe()` → `bound:` lines at Info: every loaded copy of each (the copy Volt's code
      uses marked `[bound]`, any other `[ALSO LOADED]`), plus `System.Memory`, plus the System.Text.Json that
      `PipeClient.Call` and `WireJson.Write` — the two members the field failures named — actually bind. Each line in
      its own lambda, so a binding failure becomes the line's text instead of killing the log. Tests:
      `BoundAssembliesTests` (4). Live on 3.5.21.40 (DIALECT V3): one copy each of Volt.Wire/Volt.Contracts 1.0.0.0 and
      System.Text.Json 10.0.0.12 from the staged bridge folder, both members bind it — and **System.Memory is loaded
      three times** (4.0.1.2 Windows GAC, 4.0.1.1 CODESYS LacBinaries, 4.0.5.0 bridge folder).
- [ ] 3.2 Decide on the "another Volt build already loaded" refusal once a field log shows the 3.5.21 case.

      **Open — needs a field log** from the 3.5.21.50 install (or the 3.5.17 one) carrying the `bound:` lines. Nothing
      here reproduces it: on this 3.5.21.40 every Volt assembly is bound once.

## 4. Verify

- [x] 4.1 Full suites; live start on 3.5.21 unchanged apart from the version and the new log lines.

      **Offline (2026-10-01), all green:** Volt.Engine.Tests 1836 (+1 skip), Volt.Cli.Tests 274, Volt.Ide.Codesys.Tests
      193, Volt.Contracts.Tests 19, Volt.Connector.Tests 110, Volt.Repo.Gates 54, Volt.Ide.Twincat.Tests 265,
      Volt.Relay.Tests 46; `bun test test/unit` 4; `bun run check` (DIALECT citations) green. Docs regenerated with
      `VOLT_WRITE_DOCS=1`.
      **Live on 3.5.21.40** (ide.ps1, fixture copy, own pid stopped by hand): start log `CODESYS platform 3.5.21.40;
      product name as stated: "CODESYS"`, the `bound:` lines, `CODESYS bridge ready … (connected to IDE)` as before;
      `refs` served; `health` healthy with `ideVersion`. `test:e2e:codesys` (VOLT_GRAPHICAL=1): 244 pass, 24 skip,
      0 fail (268 tests, 48 files, 177 s). TwinCAT live was not run: its driver is unchanged (`Unsupported` inherits
      null), and the shared host path is covered offline by `IdeUnsupportedTests`.

      **After the review fixes (gate, 2026-10-01), offline, all green:** `dotnet build Volt.sln -c Release`; Volt.Cli.Tests
      274, Volt.Engine.Tests 1836 (+1 skip), Volt.Ide.Codesys.Tests 197, Volt.Ide.Twincat.Tests 265,
      Volt.Connector.Tests 113, Volt.Contracts.Tests 19, Volt.Repo.Gates 54, Volt.Relay.Tests 46; `bun test test/unit`
      4; docs regenerated (`VOLT_WRITE_DOCS=1`); `openspec validate` valid. Not re-run live: the fixes are the product-name
      read, the `IdeVersion` string on OEM builds only (plain CODESYS answers the same `3.5.21.40`), and the connector.

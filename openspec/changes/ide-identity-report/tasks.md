## 0. Already built — do not redo (codesys-minimum-version, archived 2026-10-02)

The CODESYS platform version (`CodesysPlatform.ReadVersion`, DIALECT V1) as `IdeVersion` on `health.ideVersion` and
each row's `version`; the product name read (`CodesysDriver.ProductName` / `OemProduct`, log only); the capability
refusal `IDE_UNSUPPORTED` end to end; the `bound:` assembly log. Commits `5a27779448`, `14fe21dd70`, `e4652fdfc9`.
The former tasks 1.1 (plain-CODESYS source) and 1.2 (one generic source) are done there and are not repeated.

**Report only — nothing blocks on identity (owner, 2026-10-02).** No version, vendor or product value decides whether
the bridge serves: it is shown and logged, never gated on. What OEMs expose is learned from user logs after release
(no OEM IDE is installed here). The ONLY refusal stays the existing capability check (`IDE_UNSUPPORTED`, a missing API).

## 1. Measure

- [x] 1.1 OEM check of the existing source: on any OEM install at hand (e.g. WAGO, Lenze, Machine Expert), only that
      `SystemInstances.dll`'s version is the platform's, or the bridge is refused by capability — never a wrong value.
      Record the product name `OEMCustomization.ProductName` answers there. Update DIALECT V1's UNMEASURED line; an OEM
      not checked is not special-cased.
      *Checked 2026-10-03: no OEM IDE is installed here — none checked, none special-cased (DIALECT V1).* Only
      Lenze's PLC Designer INSTALLER (APInstaller customization 4.1.0.37739) and a GatewayPLC runtime are present; no
      `SystemInstances.dll` under any Lenze folder. That installer names the product exe `PlcDesigner\Common\PlcDesigner.exe`.
      Plain SP21 Patch 4 live: `OEMCustomization.ProductName` = `CODESYS`, `ProductPathComponent` = `CODESYS`.
- [x] 1.2 `productVersion`: ONE generic source of the running product's own version (e.g. the host process's file or
      product version), no per-vendor code; measure it on plain CODESYS and any OEM at hand; record it in DIALECT.
      *Measured 2026-10-03 (DIALECT V4, `scripts/probe-ide-identity.py`, live SP21 Patch 4 `--noUI`):* the host
      process's `MainModule.FileVersionInfo.ProductVersion` = `3.5.21.40` (ProductName `CODESYS`, FileVersion `3.5.21.40`);
      the entry assembly agrees (`CODESYS, Version=3.5.21.40`). No OEM at hand (1.1).
- [x] 1.3 TwinCAT: the TwinCAT build (`3.1.40xx.y`) as `ideVersion`, and the shell (TcXaeShell / Visual Studio and its
      version, today's `DTE.Version`) as product; record the sources.
      *Measured 2026-10-03 on TcXaeShell 15 / TwinCAT 3.1.4024.74 (DIALECT V5, `scripts/probe-tc-ide-identity.ps1`).*
      Product: `DTE.Name` `TcXaeShell`, `DTE.Version` `15.0`, exe version-info `TcXaeShell Application` `15.0.0.0`
      (`Beckhoff`). TwinCAT build, four sources all `3.1.4024.74` here: (a) `DTE.GetObject("TcRemoteManager").Version`
      (empty with no solution; `.Versions` = `3.1.4024.74, 3.1.4024.50`), (b) loaded `TwinCAT XAE Base.dll` file version
      (invisible to a 64-bit reader — 7 modules listed vs 171/216 from 32-bit; the worker is win-x64), (c) registry
      `TcVersion` (machine, not process), (d) `.tsproj` `TcVersion` (last saver). Source for `ideVersion`: (a), the only
      running-XAE answer reachable over COM; null when empty. Unmeasured: TcXaeShell 17, 4026, a project pinned to `.50`.
      *Product source settled (gate review, 2026-10-03; DIALECT V4/V5):* `productName` = `DTE.Name` (`TcXaeShell`),
      `productVersion` = `DTE.Version` (`15.0`) — the running shell's own answer and the form PLCAssist's pre-Volt
      history recorded (`TcXaeShell 15.0`), where the exe's `TcXaeShell Application` / `15.0.0.0` would split one install
      into two rows; `productVendor` = the XAE exe's `CompanyName` (`Beckhoff`), read through the XAE pid's `MainModule`
      (`--xae-pid`). NEVER `Process.GetCurrentProcess()` on TwinCAT: the worker is out of process and that reads
      `VoltBridgeTwincat.exe` (`1.0.0.0`, company `VoltBridgeTwincat` on the PLCAssist bundles). V4's current-process read
      is the CODESYS (in-proc) case only. Re-measured with the probe fixed (own shell = owner of `DTE.MainWindow.HWnd`,
      registry through both views explicitly): 32-bit reader 174 / 217 modules (`tc-ide-identity.log`), 64-bit reader 7 /
      7 (`tc-ide-identity-64.log`, `TwinCAT XAE Base.dll` absent), both read the exe version-info and `TcRemoteManager`
      alike; registry Registry32 `3.1.4024.74`, Registry64 key absent.
- [x] 1.4 Why PLCAssist sees `1.0.0.0`: an unstamped bundle (no `VOLT_VERSION` at `build-cli.ps1`) or the assembly
      version being read. Settle before choosing what health reports.
      *Settled 2026-10-03 — an UNSTAMPED bundle.* Health carries no bridge version today; the only bridge version a
      client receives is the relay `hello` frame's `volt` field (`RelayFrames.Hello`), fed by
      `typeof(PipeHost/BridgePipeHost).Assembly.GetName().Version` — the ASSEMBLY version. A stamped build moves the
      assembly version too (scratch SDK project, the same `/p:Version=… /p:FileVersion=…` `build-cli.ps1` passes, with
      `0.1.17258` from `scripts/version.ts`): AssemblyVersion `0.1.17258.0`, FileVersion `0.1.17258`, ProductVersion
      `0.1.17258`; unstamped: AssemblyVersion `1.0.0.0`, FileVersion `1.0.0.0`, ProductVersion `1.0.0`. So `1.0.0.0` on
      all 135 chats means the bundle PLCAssist runs was built without `VOLT_VERSION` (a local `build-cli.ps1`; the
      release path sets it — `release.yml` → `build-installer.ts` → `build-payload.ts`, which writes it back for
      `build-cli.ps1`). The two readings differ in FORM on a release (`0.1.17258.0` assembly vs `0.1.17258` file — the
      one `volt --version` reports), so 2.3 must use the FileVersion reading — of the bridge's OWN file: `ShippedVersion`
      reads `Environment.ProcessPath`, which inside CODESYS is `CODESYS.exe` (V4), so the in-proc bridge reads its
      assembly's `Location`. An unstamped repo build's ProductVersion
      carries the commit (`1.0.0+d2e6bdf36be2…`, measured on a staged dev `Volt.Ide.Codesys.dll`). Not measured: the
      DLLs inside a published installer (no Inno extractor here).
      *The PLCAssist bundles themselves (gate review, 2026-10-03):* six bridge bundles on this machine
      (`Downloads\PLCAssistBridge-*`, 3 CODESYS + 3 TwinCAT, 39 Volt binaries): EVERY file reads `FileVersion` `1.0.0.0`
      and AssemblyVersion `1.0.0.0` — unstamped, confirmed — and every file's `ProductVersion` is `1.0.0+<commit>` with
      the bundle's own commit: CODESYS-5b5834f4 `+3a59f06a58e4…` (2026-09-24), CODESYS-80b3e817 and TwinCAT-6277c2d7
      `+203657806a38…` (2026-09-27), CODESYS-99ec059a and TwinCAT-fbff1b8f `+a93e5d7619b5…` (2026-09-25),
      TwinCAT-6d4e0b88 `+1b5a160675de…` (2026-09-24) — 4 distinct builds. **Consequence for 2.3:** a bare `(dev)` for
      unstamped would give all six the same value, breaking 2.3's own "two different releases never report the same
      value" for the one client that motivated the change. The reading that tells them apart is the commit in the
      bridge file's own `ProductVersion`, so 2.3 (and the spec) now report `(dev) <commit>` for an unstamped build —
      verbatim from that suffix; a bare `(dev)` only when the `ProductVersion` states no commit.

- [x] 1.5 Owner (2026-10-02): the VENDOR must be visible (Lenze, WAGO, Schneider …), not only a product name. Measure ONE
      generic source of the product's manufacturer (e.g. the host executable's version-info CompanyName, or the
      product/profile metadata the IDE itself shows in Help → About) on plain CODESYS and on every OEM install at hand.
      What OEMs expose is unknown until measured: record per install what each source gives; a source that is not
      readable reports null (an intentional, counted fallback), never a name inferred from paths or file names.
      *Measured 2026-10-03 (DIALECT V4):* the one generic source is the host exe's version-info `CompanyName`
      (same read as 1.2 — in-proc only; on TwinCAT the XAE pid's exe, 1.3). Plain CODESYS SP21 Patch 4, live: `CODESYS Development GmbH`. **Not a vendor source:** the
      framework DLLs (`SystemInstances.dll`, `EngineWin.dll`: `CompanyName` `CODESYS Development GmbH` — they would name 3S
      inside an OEM), `SystemInstances.Engine` (no vendor/product property, and — re-run 2026-10-03 with the full method list, which the
      first dump cut off at `GetUserOptio` — none of its 47 methods is a version/product/vendor getter; a member scan at
      every visibility finds only `OEMCustomization`; 5 methods carry obfuscated empty names), `IOEMCustomization` (no vendor member;
      its key/value store is not enumerable). TwinCAT (V5): the shell exe's `CompanyName` = `Beckhoff`. **No OEM install
      at hand** (1.1): what an OEM exe states is unknown until a field log; an empty `CompanyName` reports null — never a
      name from the exe's file name or path.

- [x] 1.6 Gate 1 (2026-10-03): six review findings, all fixed — none skipped.
      (1) PLCAssist bundles measured, `(dev)` collision recorded, 2.3 + spec + proposal now `(dev) <commit>` (1.4).
      (2) DIALECT V4 limited to in-proc CODESYS; TwinCAT product settled as `DTE.Name`/`DTE.Version`, vendor from the
      XAE pid's exe (V5, 1.3). (3) `tc-ide-identity.log` re-recorded with both registry views read explicitly
      (Registry32 `3.1.4024.74`, Registry64 `<key absent>`) and the 64-bit module count committed
      (`tc-ide-identity-64.log`: 7 / 7 modules vs 174 / 217 from 32-bit). (4) the probe's own shell is the pid owning
      `DTE.MainWindow.HWnd` (`CallByName` — a late-bound `.HWnd` reads null), no process diff; no owner → stops by name,
      kills nothing. (5) the probe's header and (b) filter now name `TwinCAT XAE Base.dll` (log: `loaded TwinCAT XAE
      Base.dll: FileVersion='3.1.4024.74' Product='TwinCAT XAE' Company='Beckhoff Automation'`). (6) `ide-identity.log`
      re-recorded with the Engine's full method list (47 names, no version/product/vendor getter; member scan at every
      visibility: only `OEMCustomization`; 5 obfuscated empty names) — V4 / 1.5 updated.
      Numbers: typecheck 5/5 packages clean; `Volt.Repo.Gates` 92/92; `Volt.Engine.Tests` 1912 pass, 1 skip, 0 fail;
      volt-cli `test/unit` 4/4; `openspec validate` valid. No product code, fixture or LSP file changed in step 1, so
      the LSP suites, the fixture map and the recorders are not involved (no delta).

## 2. Report the identity

- [x] 2.1 `health` carries `productName` and `productVersion` (nullable) for both vendors beside the existing
      `ideVersion`; publish them in the wire contract and regenerate the wire docs (`VOLT_WRITE_DOCS=1`).
      *Done (design A1/B1/C1):* top-level `HealthResponse.ProductName/ProductVersion`, stamped once in
      `BridgePipeHost` (unsupported path included) from `IIdeSession`; CODESYS = `OEMCustomization.ProductName` + the
      in-proc exe's `ProductVersion` (`CodesysPlatform.ReadHostExe`), TwinCAT = `DTE.Name`/`DTE.Version` (`SwapDte`).
      `volt-bridge.openrpc.json`, `assets/data.js`, `assets/surfaces.js` regenerated; DIALECT V4/V5 name the readers.
- [x] 2.2 `ideVersion` is null when not readable — never derived from `productVersion`. On TwinCAT it moves from the
      shell version to the TwinCAT build (1.3).
      *Done (C5):* TwinCAT `ideVersion` = `TcRemoteManager.Version`, re-read with every snapshot (`OwnSolution`);
      empty or throwing → null (logged once per source+message). Each row's `version` follows (`15.0` → `3.1.4024.74`).
- [x] 2.3 `health` carries the bridge's release: the binary's stamped version (the reading `volt --version` uses, of
      the bridge's OWN file — 1.4), and when unstamped `(dev) <commit>` from that file's `ProductVersion` suffix
      (`1.0.0+<commit>`; a bare `(dev)` only when no commit is stated); two different builds never report the same value
      (1.4: the six PLCAssist bundles are four builds that would all read a bare `(dev)`).
      *Done (D3):* `Volt.Contracts.BridgeRelease` read once off `Volt.Engine.Host.dll` (`BridgePipeHost.Release`) →
      `health.bridgeVersion` AND the relay `hello.volt` (was the assembly version; `docs/relay-protocol.md` updated).
      The four PLCAssist commits give four distinct values, none `1.0.0.0` (`BridgeReleaseTests`); this repo's
      unstamped build reports `(dev) <its commit>`.
- [x] 2.4 The connector (`DetectedProject`, `/status`) and `@volt/control` carry the new fields.
      *Done:* `WireProjects.Flatten` stamps the four top-level fields on every row (like `Unsupported`);
      `ProjectView`, `TrayContext.Snapshot`, the control harness and `@volt/control.DetectedProject` carry them.

- [x] 2.5 `health` carries `productVendor` (nullable, from 1.5). @volt/control renders the identity as
      "<vendor> <product> <productVersion> — CODESYS 3.5 SP<n> Patch <p>", the SP/patch read from `ideVersion`
      (3.5.21.40 → SP21 Patch 4: CODESYS's own version scheme, formatting only); a null part is shown as unknown, not
      omitted silently. The SP is what decides compatibility, so it is shown whenever `ideVersion` is known.
      *Done (E3):* `productVendor` = CODESYS exe `CompanyName` / TwinCAT XAE exe `CompanyName` by the xae pid
      (`ReadXaeVendor`). `@volt/control` `view/identity.ts` `ideIdentity` (exhaustive `Record<Vendor, …>`; TwinCAT shows
      `TwinCAT <build>`, a non-SP CODESYS number verbatim) → `ConnectOption.identity`; VS Code picker description +
      panel tooltips (refused rows beside the reason), desktop picker note under each project, `detectedKey` covers it.
      Numbers: C# Volt.Cli.Tests 251, Volt.Engine.Tests 1912 + 1 skip, Volt.Contracts.Tests 31, Volt.Connector.Tests
      115, Volt.Ide.Twincat.Tests 316, Volt.Ide.Codesys.Tests 213, Volt.Relay.Tests 46, Volt.Repo.Gates 92 — 0 fail;
      TS @volt/control 132, volt-vscode 40, volt-desktop 31, volt-cli unit 4, control e2e (real harness) 8 — 0 fail;
      typecheck 5/5, `bun run check` green. New tests: BridgeReleaseTests (12), IdeIdentityTests (5),
      CodesysIdentityTests (6), TcIdentityTests (7), 2 Flatten, identity.test.ts (9), 1+2+3 shell tests. No LSP
      file, fixture or recording touched, so the LSP suites, the fixture map and the recorders have no delta.

- [x] 2.6 Gate 2 (2026-10-03): seven review findings, all fixed — none skipped; one of them uncovered a stale e2e tier.
      (1) `volt-vscode` `panel.test.ts`: the refused reconnect row's `description` "IDE not supported" assertion restored
      (the design changes only the tooltip). (2) TwinCAT field logs name the build again: `OwnSolution` logs
      `twincat build (TcRemoteManager.Version): <build>` at the first read and on every change (not every poll)
      (`TcIdentityTests.The_build_is_logged_at_the_first_read_and_on_change_only`). (3) The per-snapshot
      `GetObject("TcRemoteManager")` RCW is released every time (`ReleaseCom`, `Marshal.ReleaseComObject` in production)
      and counted: one read per snapshot (`Each_snapshot_reads_the_remote_manager_once_and_releases_it`). It stays on the
      probe's never-throws path on purpose — the liveness verdict is `ProbeIdeAlive`, which runs first in the same
      snapshot; a dead channel is answered there. Its cost on a live XAE is measured in 5.1. (4) `ideIdentity`: a row
      with no `bridgeVersion` is an older bridge (design A); on TwinCAT its `ideVersion` was `DTE.Version` (the shell's
      `15.0`), so it renders `TwinCAT build not reported (older bridge)`, never `TwinCAT 15.0`; CODESYS's `ideVersion`
      never changed meaning (`3.5`, then the platform) and still renders. The desktop identity fixture now states a
      `bridgeVersion` (a current bridge always does). (5) CODESYS: `ProductNameAsRead` keeps the unfiltered answer for
      the start log (`product name as stated: "  "` vs `(none)`) and for `OemProduct` as before; the wire keeps
      `Stated` (whitespace → null). The start line moved to `CodesysDriver.IdentityLine()` so it is testable
      (`A_whitespace_product_name_is_null_on_the_wire_and_verbatim_in_the_start_log`). (6) The `bridgeVersion` tests
      pin the D3 FORM, written out in the test off `Volt.Engine.Host.dll`'s own version-info, plus NotEqual the assembly
      version — the `Assembly.GetName().Version` mutation now fails both (`IdeIdentityTests`, `CodesysIdentityTests`).
      (7) control e2e: `GET /status carries each row's bridge identity and refusal under the wire names the client
      reads`, rows at the new meanings (CODESYS `3.5.21.40`, TwinCAT `3.1.4024.74`). Written first, it FAILED — and the
      cause was the suite, not the wire: it ran `bin/Debug/net8.0/VoltControlHarness.exe` (built 2026-09-09) while the
      harness targets net10.0, so every control-e2e run since the move proved a month-old C# wire (step 2.5's "control
      e2e 8 — 0 fail" included). The output folder now follows the csproj's own `<TargetFramework>` (fails loud when it
      states none); against the current harness all fields arrive.
      Numbers: C# Volt.Cli.Tests 251, Volt.Engine.Tests 1912 + 1 skip, Volt.Contracts.Tests 31, Volt.Connector.Tests
      115, Volt.Ide.Twincat.Tests 318 (+2), Volt.Ide.Codesys.Tests 214 (+1), Volt.Relay.Tests 46, Volt.Repo.Gates 92 —
      0 fail; `dotnet build Volt.sln -c Release` 0 errors; TS @volt/control 134 (132 at 2.5), volt-vscode 40, volt-desktop 31,
      volt-cli unit 4, `test/e2e` against the CURRENT harness 11 (two files) — 0 fail; typecheck 5/5, lint 0 errors,
      `bun run check` green, `openspec validate` valid. No LSP file, fixture or recording touched, so the LSP suites,
      the fixture map and the recorders have no delta.

## 3. Field failures moved from codesys-minimum-version (each needs a field log)

- [ ] 3.1 (was codesys-minimum-version 2.1) Measure what failed on 3.5.17 (the proposal's exception, chat 896f798f):
      which API/type/member the bridge binds that the old platform lacks. List every framework API the bridge needs at
      start in ONE place (the capability list), each with the platform version it is known on.
      *State at hand-over:* the capability list is DONE (`CodesysPlatform.All`, DIALECT V2). Open — no CODESYS 3.5.17
      install and no field log from chat 896f798f. The missing member, `Volt.Wire.PipeClient.Call(String, Object,
      Action`1[JsonElement], Int32)`, is VOLT's, not a CODESYS API, and that install printed "connected to IDE", so no
      capability on the list explains it; it has the shape of the 3.5.21.50 `MissingFieldException: WireJson.Write` (a
      second bound copy of a Volt or System.Text.Json assembly). Settles with the first `bound:` log from such an install.
      *Measured offline 2026-10-03 (`scripts/probe-bridge-bundles.cs` → `scripts/bridge-bundles.log`; 10 PLCAssist
      bundles in Downloads — 6 CODESYS, 4 TwinCAT, 7 distinct commits 2026-09-24…27 — plus this repo's net48 build at
      `0dca8a23fd`). Still OPEN — none of this is a field log, and no CODESYS below SP18 is installed (on disk: SP18.30,
      SP21.40; no OEM).* Numbers:
      (a) **The failing member is identical in every build.** All 11 define `PipeClient.Call(String, Object,
      Action<[System.Text.Json 10.0.0.0]JsonElement>, Int32)` and `WireJson.Write` as a FIELD of `[System.Text.Json
      10.0.0.0]JsonSerializerOptions`, compared by assembly identity; the caller of `Call` is `Volt.Relay` and the reader
      of `WireJson.Write` is `Volt.Wire` in all 11 (not `Volt.Ide.Codesys`). Self-check 0 unresolved Volt TYPE and member
      refs in every bundle (119–132 type refs + 283–334 member refs each). In the 11×11 cross matrix (one bundle's Volt assemblies bound to another's — every
      Volt build is `1.0.0.0`, unsigned, so the first copy loaded wins) **neither failing member is unresolved in any of
      the 121 pairs.** So a mix of two Volt builds — of everything shipped since 2026-09-24 — cannot raise either
      exception by name or signature. What can: the two sides' `JsonElement`/`JsonSerializerOptions` resolving to two
      DIFFERENT `System.Text.Json` instances — the shape the `bound:` lines name directly. Three ways to get there, none
      reproduced: a `System.Text.Json` from the GAC (d); a resolver registered before `BridgeAssemblyResolver`
      supplying its own copy; and the shipped `start_volt_codesys.py` deleting the live session's not-yet-loaded
      dependencies from its own staged folder so that the NEXT request falls through to whichever handler answers
      (3.2 fact 4).
      (b) **Why that is CODESYS-only.** Every netstandard2.0 Volt assembly (`Volt.Contracts`, `Volt.Wire`, `Volt.Relay`,
      `Volt.Engine.Host`) references `System.Text.Json 10.0.0.0`; the repo build's `Volt.Ide.Codesys` (net48) references
      `10.0.0.12` (below). The CODESYS bundles ship `10.0.0.12` (one file, MVID `480491c7…` in all 6 and the repo build), so on
      net48 that strong-named bind never succeeds by the CLR's own probing and every request goes to an `AssemblyResolve`
      handler (`BridgeAssemblyResolver`, by simple name — or any handler registered before it in the process). The
      TwinCAT bundles ship `10.0.0.0` exactly (net10, no resolver). The repo build's `Volt.Ide.Codesys` alone references
      `10.0.0.12` (added with `BoundAssemblies`), the 6 shipped ones do not reference STJ at all.
      (c) **Two API generations among the shipped bundles**, a real mixed-load hazard on OTHER members: commit
      `203657806a` (CODESYS-80b3e817, TwinCAT-6277c2d7, 2026-09-27) vs the other five commits — mixing them leaves 10
      (older consumer → newer provider) or 31/32 (newer → older) `Volt.Engine` type + member refs unresolved
      (network-text `Box`/`Demux`/`Parallel`/`Terminator` ctors, `NetworkTextWriter.Write`; types `BoxRefusals`,
      `NetworkScope`, `ParallelMode(s)`, `UnheldFlags`, `ProjectDeclarations`, `Body.BodyMarker`); against the repo
      build 20 / 10 / 51 / 82 (adds `Contracts.BridgeRelease`/`UnsupportedBody`, `Settings.ProjectSettings(Format)`,
      `ChildRefused*`, `PushedDeclarations`, `UnreadableObject`). A field `MissingMethodException`/`TypeLoadException`
      naming one of THOSE would be a two-Volt-builds load; one naming `PipeClient.Call` is not. *Gate 3:* the first census matched member refs only
      (a type used only by `isinst`/`castclass`/`typeof`/an attribute/a signature has no MemberReference) — so its
      cells (10, 25/26, 19/9/43/68) were lower bounds; the probe now also checks every TypeReference into a Volt
      assembly against the provider's TypeDefinitions. Same 11 inputs, same MVIDs; the two failing members still
      resolve in all 121 pairs.
      (d) **No foreign System.Text.Json on this machine's CODESYS**: neither install nor any `.package` in Downloads
      ships one (Automation Server Connector carries `Newtonsoft.Json` 13.0.0.0; Package Designer `System.Memory`
      4.0.1.1). Dev leftovers present, not shipped: `CODESYS 3.5.18.30\CODESYS\VoltBridge\PlugIns` (June HTTP bridge,
      Swashbuckle) and two `VoltBridge.plugin.dll` plugin folders in SP21.40 — none carries STJ. *The GAC (gate 3) —
      the CLR's FIRST probe for a strong-named reference, before any `AssemblyResolve` handler:*
      `C:\Windows\Microsoft.NETssembly\GAC_MSIL|GAC_32|GAC_64` and the legacy `C:\Windowsssembly\GAC_MSIL` hold NO
      `System.Text.Json`, `Microsoft.Bcl.AsyncInterfaces`, `System.Text.Encodings.Web` or `Volt.*`; they DO hold
      `System.Memory` `4.0.1.2` and `System.Runtime.CompilerServices.Unsafe` `4.0.4.1` — older than the `4.0.5.0` /
      `6.0.3.0` the CODESYS bundles ship, so (strong-name binds take the exact version) not bound in their place here.
      So the GAC is a live source of framework copies: a field machine whose GAC carries a `System.Text.Json 10.0.0.0`
      would serve the netstandard2.0 Volt assemblies' exact reference from the GAC — bypassing (b)'s resolver — while
      the net48 `Volt.Ide.Codesys`'s `10.0.0.12` reference resolves to the bundle's file: two STJ instances. A `bound:`
      line's location (`GAC_MSIL\…`) names that case directly.
      (e) Stale, not product code: `Directory.Packages.props`'s header still calls `System.Text.Json 8.0.5`
      load-bearing; the pin is `10.0.12` since `6d59429d33` (2026-09-09).
      What settles 3.1: a 3.5.17 start log's `bound:` lines — two `System.Text.Json` lines, or `PipeClient.Call binds`
      naming a copy other than `[bound]`, is the cause; one copy each refutes the hypothesis.
- [ ] 3.2 (was codesys-minimum-version 3.2) Decide on the "another Volt build already loaded" refusal once a field log
      shows the 3.5.21 case.
      *State at hand-over:* needs a field log from the 3.5.21.50 install (or the 3.5.17 one) carrying the `bound:`
      lines. Nothing here reproduces it: on 3.5.21.40 every Volt assembly is bound once (DIALECT V3).
      *Measured offline 2026-10-03 (same census as 3.1). Still OPEN — no decision without the field log.* Facts for the
      decision: (1) no refusal exists today — no "already loaded" check anywhere under `src/`; (2) a second Volt build in
      one CODESYS process cannot be told apart by assembly identity (all `1.0.0.0`, unsigned) but CAN by the file's
      `ProductVersion` commit (7 distinct `1.0.0+<commit>` across the 10 bundles, design D3); (3) of the shipped
      builds, only a mix across the `203657806a` boundary breaks member binding (3.1 c), and none breaks
      `WireJson.Write` (3.1 a) — so the 3.5.21.50 `MissingFieldException` is not explained by a Volt-vs-Volt mix of the
      bundles on hand; (4) `start_volt_codesys.py` stages per CODESYS pid (`%TEMP%\Volt\codesys-bridge\<pid>`) and
      reuses an existing staged DLL for that pid — but `_stage()` calls `_prune(root)` BEFORE that reuse check, and
      `_prune` runs `shutil.rmtree` on EVERY per-pid dir, the live session's own included. `rmtree` deletes every
      unlocked file and raises only at the first locked one (`_prune` swallows it): on net48 assemblies load lazily, so
      the dependencies the CLR has not loaded yet are unlocked and deleted — and `Microsoft.Bcl.AsyncInterfaces.dll`,
      `System.*.dll` and `Volt.Contracts.dll` sort before `Volt.Ide.Codesys.dll`. *Gate 3, measured (CPython 3.11,
      scratch): a dir of those six names with `Volt.Ide.Codesys.dll` held open (`CreateFileW` GENERIC_READ,
      FILE_SHARE_READ, as a mapped image) → `PermissionError`, left `['Volt.Ide.Codesys.dll', 'Volt.Wire.dll']`;
      CODESYS runs IronPython 2.7, whose `shutil.rmtree` is the same stdlib loop (not measured there).* So re-running
      the script in the same session, or starting a SECOND CODESYS (its `_prune` reaches the first session's dir),
      strips the live session's not-yet-loaded dependencies; `BridgeAssemblyResolver` then finds no file, returns null,
      and any other `AssemblyResolve` handler in the process supplies its copy — a second-loader path INSIDE the
      shipped script, not only "another folder's `Volt.Ide.Codesys`, or a resolver from another build registered
      first". Not fixed here (product code, outside this step; skipping only the own pid would not cover a second
      CODESYS): it belongs to the 3.2 decision and is named by a `bound:` line whose location is not the staged dir.

- [x] 3.3 Gate 3 (2026-10-03): four review findings on the offline census, all fixed — none skipped. 3.1 and 3.2 stay
      OPEN (each needs a field log; no decision is taken without one).
      (1) 3.2 fact (4) named only "another folder / a resolver registered first" as a mixed-load path; the shipped
      `start_volt_codesys.py` is one itself — `_prune` before the reuse check strips the live session's not-yet-loaded
      dependencies (measured in scratch: 4 of 6 files deleted before the first locked one). Fact (4) and the 3.1 (a)
      hypothesis space now name it; the script is not changed in this step. (2) the probe matched member refs only;
      it now checks every TypeReference into a Volt assembly too — self-checks 0 unresolved (119–132 type refs per
      bundle), cross-generation cells 10 / 31 / 32 (were 10 / 25 / 26), repo build 20 / 10 / 51 / 82 (were 19 / 9 / 43
      / 68), the failing members still resolve in all 121 pairs; `bridge-bundles.log` re-recorded (same MVIDs).
      (3) 3.1 (d) now states the GAC check: no `System.Text.Json`/`Bcl.AsyncInterfaces`/`Encodings.Web`/`Volt.*`;
      `System.Memory 4.0.1.2` + `Unsafe 4.0.4.1` present (older than shipped) — and what a GAC'd STJ would do.
      (4) 3.1 (b)'s blanket "every Volt assembly references 10.0.0.0" corrected: the netstandard2.0 four do; the
      repo build's `Volt.Ide.Codesys` references `10.0.0.12`.
      Numbers: C# Volt.Cli.Tests 251, Volt.Engine.Tests 1912 + 1 skip, Volt.Contracts.Tests 31, Volt.Connector.Tests
      115, Volt.Ide.Twincat.Tests 318, Volt.Ide.Codesys.Tests 214, Volt.Relay.Tests 46, Volt.Repo.Gates 92 — 0 fail;
      TS @volt/control 134, control e2e (current harness) 11, volt-vscode 40, volt-desktop 31, volt-cli unit 4 — 0
      fail; typecheck 5/5, lint 0 errors, `bun run check` 15/15, `openspec validate` valid. Delta vs gate 2: none in
      any suite (step 3 changed a probe script and this write-up only). No LSP file, fixture or recording touched by
      this change, so the LSP suites, the fixture map and the recorders have no delta.

## 4. Tests

- [ ] 4.1 Driver doubles: plain CODESYS (name, product version, platform version), an OEM with a readable platform,
      TwinCAT (shell as product, build as `ideVersion`); red before, green after.
- [ ] 4.2 Packaging test: the release in health matches the build that produced the bundle; an unstamped build says
      `(dev)`.

## 5. Verify

- [ ] 5.1 Live on CODESYS 3.5.21 and one OEM install if available, and on TwinCAT: health shows the expected fields.

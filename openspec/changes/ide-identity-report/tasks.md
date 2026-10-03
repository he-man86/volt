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

- [ ] 2.1 `health` carries `productName` and `productVersion` (nullable) for both vendors beside the existing
      `ideVersion`; publish them in the wire contract and regenerate the wire docs (`VOLT_WRITE_DOCS=1`).
- [ ] 2.2 `ideVersion` is null when not readable — never derived from `productVersion`. On TwinCAT it moves from the
      shell version to the TwinCAT build (1.3).
- [ ] 2.3 `health` carries the bridge's release: the binary's stamped version (the reading `volt --version` uses, of
      the bridge's OWN file — 1.4), and when unstamped `(dev) <commit>` from that file's `ProductVersion` suffix
      (`1.0.0+<commit>`; a bare `(dev)` only when no commit is stated); two different builds never report the same value
      (1.4: the six PLCAssist bundles are four builds that would all read a bare `(dev)`).
- [ ] 2.4 The connector (`DetectedProject`, `/status`) and `@volt/control` carry the new fields.

- [ ] 2.5 `health` carries `productVendor` (nullable, from 1.5). @volt/control renders the identity as
      "<vendor> <product> <productVersion> — CODESYS 3.5 SP<n> Patch <p>", the SP/patch read from `ideVersion`
      (3.5.21.40 → SP21 Patch 4: CODESYS's own version scheme, formatting only); a null part is shown as unknown, not
      omitted silently. The SP is what decides compatibility, so it is shown whenever `ideVersion` is known.

## 3. Field failures moved from codesys-minimum-version (each needs a field log)

- [ ] 3.1 (was codesys-minimum-version 2.1) Measure what failed on 3.5.17 (the proposal's exception, chat 896f798f):
      which API/type/member the bridge binds that the old platform lacks. List every framework API the bridge needs at
      start in ONE place (the capability list), each with the platform version it is known on.
      *State at hand-over:* the capability list is DONE (`CodesysPlatform.All`, DIALECT V2). Open — no CODESYS 3.5.17
      install and no field log from chat 896f798f. The missing member, `Volt.Wire.PipeClient.Call(String, Object,
      Action`1[JsonElement], Int32)`, is VOLT's, not a CODESYS API, and that install printed "connected to IDE", so no
      capability on the list explains it; it has the shape of the 3.5.21.50 `MissingFieldException: WireJson.Write` (a
      second bound copy of a Volt or System.Text.Json assembly). Settles with the first `bound:` log from such an install.
- [ ] 3.2 (was codesys-minimum-version 3.2) Decide on the "another Volt build already loaded" refusal once a field log
      shows the 3.5.21 case.
      *State at hand-over:* needs a field log from the 3.5.21.50 install (or the 3.5.17 one) carrying the `bound:`
      lines. Nothing here reproduces it: on 3.5.21.40 every Volt assembly is bound once (DIALECT V3).

## 4. Tests

- [ ] 4.1 Driver doubles: plain CODESYS (name, product version, platform version), an OEM with a readable platform,
      TwinCAT (shell as product, build as `ideVersion`); red before, green after.
- [ ] 4.2 Packaging test: the release in health matches the build that produced the bundle; an unstamped build says
      `(dev)`.

## 5. Verify

- [ ] 5.1 Live on CODESYS 3.5.21 and one OEM install if available, and on TwinCAT: health shows the expected fields.

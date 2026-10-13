## 0. Analyse (decides whether anything below happens)

- [x] 0.1 Check PLCAssist's dev-machine readings in the proposal against the volt dev machine (read-only): the
      `ProxyStubClsid32` of IVsSolution/IVsHierarchy/IEnumHierarchies, the two `CLSID\{E6D78900…}\InProcServer32`
      views, which MSI owns each (component roots `00:` / `20:`), and the `CoGetPSClsid` + `CoGetClassObject` fallback
      that gives 0x80040154 for a 32-bit-only IID in a 64-bit process.
      **Done 2026-10-13 (volt, read-only), all as PLCAssist read them:** the three IIDs' `ProxyStubClsid32` =
      `{E6D78900-BB40-4039-9C54-593A242B65DA}` in `/reg:64` and `/reg:32`; `/reg:64` InProcServer32 =
      `C:\Program Files\Common Files\Microsoft Shared\MSEnv\msenvp.dll` (15.0.28307.572), `/reg:32` =
      `C:\Program Files (x86)\Common Files\Microsoft Shared\MSEnv\msenvp.dll` (15.0.27825.0); no HKCU key;
      `Microsoft.VisualStudio.MinShell.Interop.x64.Msi,v17` = `vs_minshellinteropx64msi` 17.7.33905 whose only
      dependent is VS instance `{AEF703B8…}` (Uninstall: VS Community 2022 17.7.6 and that MSI both 2023-11-13);
      `vs_minshellinteropmsi` 15.8.27825 installed 2023-08-12. XAE's private
      `TcXaeShell\Common7\IDE\Automation\msenvp.dll.manifest` exists (x86, 193 proxy-stub entries, the three IIDs
      among them; its `msenvp.dll` 15.0.35826.109). The MSI component-root (`00:`/`20:`) reading and the 64-bit
      `CoGetPSClsid` fallback were not re-run; the owner records above are PLCAssist's. Facts in DIALECT C2t.
- [x] 0.2 Prove or kill the hypothesis on a machine WITHOUT an x64 Visual Studio. Pick one, cheapest first: the
      customer's two `reg query` lines (via PLCAssist), the x64/x86 `QueryService(SVsSolution)` probe, or a clean VM
      with TwinCAT 3.1.4024 only. Record per bitness: `CoGetPSClsid`, `CoGetClassObject`, `QueryService` HRESULTs;
      whether `vs_minshellinteropmsi` (x86) is installed; whether XAE's private `Automation\msenvp.dll.manifest`
      exists.
      **Done 2026-10-13, on this machine turned into the customer's state** (not a VM): the owner removed the 64-bit
      registration from an elevated prompt (`reg delete "HKLM\SOFTWARE\Classes\CLSID\{E6D78900-BB40-4039-9C54-593A242B65DA}" /reg:64 /f`;
      export kept at `C:\Users\marce\Github\volt-machine-backups\msenvp-64bit\msenvp-clsid-64.reg`), verified gone
      in `/reg:64`; the `/reg:32` view (x86 `msenvp.dll` 15.0.27825.0) and XAE's private
      `Automation\msenvp.dll.manifest` unchanged. By owner decision the machine stays this way. Same fixture
      (Project14 copy, TcXaeShell 15.0 / 3.1.4024.74), same registry, two workers:
      **pre-fix worker** (dev `ecd5feaf16`, win-x64 in-process read; temporary worktree, `ide.ps1 up -Instance tc-old`):
      `health` `status: degraded`, `bridgeVersion (dev) ecd5feaf16…`; `refs` answered, in 86 ms,
      `ITEM_UNVERIFIED: the Solution Explorer hierarchy is unreadable; Volt does not walk the TwinCAT tree without it
      (DIALECT C2i): QueryService(SVsSolution) failed (0x80040154)` — **the field error, byte for byte.**
      **This change's worker** (`6e2560ec13`, `ide.ps1 up -Instance tc-new`): `refs` green (18 items, 2818 ms cold —
      it starts the helper), read through `VoltTwincatExplorer.exe --serve --xae-pid <xae>` (x86/WOW64, child of
      the worker); full TwinCAT e2e (`VOLT_E2E_INSTANCE=tc-new bun run test:e2e:twincat`) **296 pass / 70 skip /
      0 fail** (366 tests, 60 files, 1302 s), latency `refs` 173 ms for 18 items, fetch 1 166 ms, fetch all 189 ms,
      empty push 410 ms. (A first run lost its XAE to an APPCRASH in `VCRUNTIME140_CLR0400.dll` `c0000005` during a
      `build` in `endpoints/fetch` — `build failed: RPC 0x800706BE`, the IDE's own compile, after the hierarchy reads
      had already answered; the rerun on a fresh instance was clean, 0 Application-1000 events.) Visual Studio
      Community 2022 17.7.6 still starts without the 64-bit registration (start window up and responding, no
      Application error events). Per-bitness `CoGetPSClsid`/`CoGetClassObject` HRESULTs not re-probed: the two
      workers' answers are the discriminating measurement.
- [ ] 0.3 Also record whether a fresh TwinCAT 4024 install writes the GLOBAL 32-bit msenvp registration, or only
      XAE's private manifest. That decides between an x86 client alone and an x86 client + `CreateActCtx`.
      **Open, and no longer decisive:** the fix activates XAE's own manifest on every read (proposal, Decision), so
      it does not depend on the global 32-bit registration. Proving that discriminatingly (an x86 reader with that
      registration absent) needs the same elevated change, or a fresh TwinCAT-only machine.
- [x] 0.4 Verdict in this file, with the evidence: CONFIRMED (missing 64-bit proxy), REFUTED (name the actual cause of
      0x80040154), or OUTSIDE VOLT (the customer's install is broken in a way a stock TwinCAT machine is not).
      **Stop condition:** refuted or outside volt → record it, tell PLCAssist, and stop here. Section 1 only runs on
      CONFIRMED.
      **CONFIRMED (2026-10-13, discriminating).** Removing ONLY the 64-bit `CLSID\{E6D78900…}` registration (Visual
      Studio's) turns the pre-fix worker's `refs` into the customer's exact error — `ITEM_UNVERIFIED …
      QueryService(SVsSolution) failed (0x80040154)` — on a fixture that read green with it present; the same
      registry with this change's worker (x86 helper, XAE's own manifest) reads the hierarchy and passes the full
      TwinCAT e2e, 296 / 70 / 0 (0.2). Cause: the shipped x64 worker depended on a 64-bit proxy only Visual Studio
      2019/2022 installs. (0.1's mechanism reading stands; the earlier "provisionally" is retired.)

## 1. Fix (only after 0.4 says CONFIRMED)

- [x] 1.1 Named error first, whichever fix follows. Add a `BeckhoffDriver` `Unsupported` override that checks the
      hierarchy proxy in the worker's own bitness (no XAE call), so `health` states it and every op answers
      `IDE_UNSUPPORTED` with one fixed English sentence naming the IDE and what is missing. `TcObjectModel.Explorer()`
      keeps `ITEM_UNVERIFIED` only for a hierarchy that was READ and cannot vouch for an item. Red test first, in the
      offline suite (`ReadExplorer` is already replaceable, `TcObjectModel.cs:255`).
      **Done:** `TcHierarchyUnreachableTests` (red first: 1 failed, 1 passed — the unsupported case answered
      `ITEM_UNVERIFIED`); `BeckhoffDriver.Unsupported` ← `TcObjectModel.Unsupported`, set by the start check
      (`Program.cs` → `CheckHierarchy` → `TcHierarchy.Missing`: `--check` in the READER's bitness, i.e. the x86
      helper for a 32-bit XAE — the worker's own bitness would test the wrong proxy) and by the first read that throws
      `HierarchyUnreachableException`. Wire census updated (`WireVocabularyTests`: IDE_UNSUPPORTED +1 site, the
      situation names the reader).
- [x] 1.2 Choose the fix, and record in the proposal why it was chosen and why the others were not: x86 worker / x86
      hierarchy helper (+ `CreateActCtx` on XAE's manifest if 0.3 says so), or the IDispatch `UIHierarchy` route
      (measure first: collapsed nodes, cost on 143+ nodes, caption suffix).
      **Done:** x86 .NET Framework helper (net472) + XAE's own manifest activated on every read, picked by the XAE
      process's bitness (proposal, "Decision").
- [x] 1.3 Build it. Then a DIALECT C2i row stating what the hierarchy read requires (bitness, proxy, where it comes
      from), with the measurement from 0.2.
      **Done:** `src/Volt.Ide.Twincat.Explorer` (`VoltTwincatExplorer.exe`), `Ide/TcHierarchy.cs`; packaged beside the
      worker (`build-cli.ps1` refuses a publish without it, `build-payload.ts` requires it, `test-install.ts` checks it
      stamped; `bun run build:installer` green, `VoltTwincatExplorer.exe` x86 in `connector\`). A helper per read failed
      the e2e latency gate (empty push 972 ms > 500), so the worker keeps one (`--serve`). Environment audit, same
      branch, red first: refused manifest activation → registered proxy, else IDE_UNSUPPORTED; net472; the 64-bit
      TcXaeShell64 found (ROT moniker, window diagnosis, `ide.ps1`); culture-invariant regexes/log dates; baseline-x64
      LSP; x64 Inno. DIALECT **C2t** (next to C2i), with this machine's measurements; 0.2's are still missing.
- [ ] 1.4 Verify on BOTH machines: the TwinCAT-only machine/VM (refs, fetch, push, build green; C2i guard still
      flags a bare-captioned POU), and the volt dev machine (no regression). Full C# suites green.
      **Dev machine done** (64-bit registration still present, so the helper path is what ran — XAE is 32-bit):
      TwinCAT e2e (`VOLT_E2E_INSTANCE=tc-x86`, Project14, through the helper) 296 pass / 70 skip / 0 fail; C# suites
      (after the rebase onto dev `ecd5feaf16`) Twincat 490, Engine 2525 (+1 skipped), Cli 267, Codesys 367, Connector 120, Relay 62, Contracts 35, Repo.Gates 162 — all green; `bun run check` 18/18. **TwinCAT-only state done** (0.2: 64-bit registration removed, e2e 296 / 70 / 0 through the helper). **Open:** a 64-bit XAE
      (TcXaeShell64, TwinCAT 4026) live, and `bun run test:install` — it refuses to start while any
      `VoltBridgeTwincat.exe` runs, and another session's worker (on its own fixture XAE) was running throughout.

## 2. Close

- [ ] 2.1 Tell PLCAssist: the verdict, the code and sentence a TwinCAT-only machine now gets (or that it now works),
      and the release build that carries it, so the customer can be asked to update.

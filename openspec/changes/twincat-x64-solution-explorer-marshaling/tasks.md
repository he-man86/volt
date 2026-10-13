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
- [ ] 0.2 Prove or kill the hypothesis on a machine WITHOUT an x64 Visual Studio. Pick one, cheapest first: the
      customer's two `reg query` lines (via PLCAssist), the x64/x86 `QueryService(SVsSolution)` probe, or a clean VM
      with TwinCAT 3.1.4024 only. Record per bitness: `CoGetPSClsid`, `CoGetClassObject`, `QueryService` HRESULTs;
      whether `vs_minshellinteropmsi` (x86) is installed; whether XAE's private `Automation\msenvp.dll.manifest`
      exists.
      **Open.** The owner approved turning this machine into the customer's state (delete the 64-bit
      `CLSID\{E6D78900…}` key, permanently; export taken first:
      `C:\Users\marce\Github\volt-machine-backups\msenvp-64bit\msenvp-clsid-64.reg`). The elevated delete was
      REFUSED by the agent session's permission controls, so the registry is unchanged, the shipped worker was never
      run without the 64-bit registration, and no before/after exists. What remains: run the delete elevated
      (`reg delete "HKLM\SOFTWARE\Classes\CLSID\{E6D78900-BB40-4039-9C54-593A242B65DA}" /reg:64 /f`), then `refs`
      on a fixture XAE with the pre-fix worker (expect `ITEM_UNVERIFIED … 0x80040154`) and with this change's worker
      (expect green), and the TwinCAT e2e suite. Or the customer's two `reg query` lines.
- [ ] 0.3 Also record whether a fresh TwinCAT 4024 install writes the GLOBAL 32-bit msenvp registration, or only
      XAE's private manifest. That decides between an x86 client alone and an x86 client + `CreateActCtx`.
      **Open, and no longer decisive:** the fix activates XAE's own manifest on every read (proposal, Decision), so
      it does not depend on the global 32-bit registration. Proving that discriminatingly (an x86 reader with that
      registration absent) needs the same elevated change, or a fresh TwinCAT-only machine.
- [ ] 0.4 Verdict in this file, with the evidence: CONFIRMED (missing 64-bit proxy), REFUTED (name the actual cause of
      0x80040154), or OUTSIDE VOLT (the customer's install is broken in a way a stock TwinCAT machine is not).
      **Stop condition:** refuted or outside volt → record it, tell PLCAssist, and stop here. Section 1 only runs on
      CONFIRMED.
      **Provisionally CONFIRMED by mechanism** (0.1: the only 64-bit proxy here is Visual Studio's; no TwinCAT
      component registers one; PLCAssist reproduced 0x80040154 for a 32-bit-only proxy in a 64-bit process), not by a
      run on a machine without it (0.2 open). Section 1 went ahead on the owner's requirement (a plain TwinCAT install
      must work) — the fix does not need the verdict to be right, only the named error does.

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
      **Done:** x86 net48 helper + `CreateActCtx` always (proposal, "Decision").
- [x] 1.3 Build it. Then a DIALECT C2i row stating what the hierarchy read requires (bitness, proxy, where it comes
      from), with the measurement from 0.2.
      **Done:** `src/Volt.Ide.Twincat.Explorer` (`VoltTwincatExplorer.exe`), `Ide/TcHierarchy.cs`; packaged beside the
      worker (`build-cli.ps1` refuses a publish without it, `build-payload.ts` requires it, `test-install.ts` checks it
      stamped). DIALECT **C2t** (next to C2i), with this machine's measurements; 0.2's are still missing.
- [ ] 1.4 Verify on BOTH machines: the TwinCAT-only machine/VM (refs, fetch, push, build green; C2i guard still
      flags a bare-captioned POU), and the volt dev machine (no regression). Full C# suites green.
      **Dev machine done** (64-bit registration still present, so the helper path is what ran — XAE is 32-bit):
      E2E_TASK. C# suites: Volt.Ide.Twincat.Tests 463, Volt.Engine.Tests 2456 (+1 skipped), Volt.Cli.Tests 266,
      Volt.Connector.Tests 119, Volt.Contracts.Tests 34, Volt.Repo.Gates 160 — all green. **Open:** the TwinCAT-only
      run (0.2).

## 2. Close

- [ ] 2.1 Tell PLCAssist: the verdict, the code and sentence a TwinCAT-only machine now gets (or that it now works),
      and the release build that carries it, so the customer can be asked to update.

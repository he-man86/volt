## 0. Analyse (decides whether anything below happens)

- [ ] 0.1 Check PLCAssist's dev-machine readings in the proposal against the volt dev machine (read-only): the
      `ProxyStubClsid32` of IVsSolution/IVsHierarchy/IEnumHierarchies, the two `CLSID\{E6D78900…}\InProcServer32`
      views, which MSI owns each (component roots `00:` / `20:`), and the `CoGetPSClsid` + `CoGetClassObject` fallback
      that gives 0x80040154 for a 32-bit-only IID in a 64-bit process.
- [ ] 0.2 Prove or kill the hypothesis on a machine WITHOUT an x64 Visual Studio. Pick one, cheapest first: the
      customer's two `reg query` lines (via PLCAssist), the x64/x86 `QueryService(SVsSolution)` probe, or a clean VM
      with TwinCAT 3.1.4024 only. Record per bitness: `CoGetPSClsid`, `CoGetClassObject`, `QueryService` HRESULTs;
      whether `vs_minshellinteropmsi` (x86) is installed; whether XAE's private `Automation\msenvp.dll.manifest`
      exists.
- [ ] 0.3 Also record whether a fresh TwinCAT 4024 install writes the GLOBAL 32-bit msenvp registration, or only
      XAE's private manifest. That decides between an x86 client alone and an x86 client + `CreateActCtx`.
- [ ] 0.4 Verdict in this file, with the evidence: CONFIRMED (missing 64-bit proxy), REFUTED (name the actual cause of
      0x80040154), or OUTSIDE VOLT (the customer's install is broken in a way a stock TwinCAT machine is not).
      **Stop condition:** refuted or outside volt → record it, tell PLCAssist, and stop here. Section 1 only runs on
      CONFIRMED.

## 1. Fix (only after 0.4 says CONFIRMED)

- [ ] 1.1 Named error first, whichever fix follows. Add a `BeckhoffDriver` `Unsupported` override that checks the
      hierarchy proxy in the worker's own bitness (no XAE call), so `health` states it and every op answers
      `IDE_UNSUPPORTED` with one fixed English sentence naming the IDE and what is missing. `TcObjectModel.Explorer()`
      keeps `ITEM_UNVERIFIED` only for a hierarchy that was READ and cannot vouch for an item. Red test first, in the
      offline suite (`ReadExplorer` is already replaceable, `TcObjectModel.cs:255`).
- [ ] 1.2 Choose the fix, and record in the proposal why it was chosen and why the others were not: x86 worker / x86
      hierarchy helper (+ `CreateActCtx` on XAE's manifest if 0.3 says so), or the IDispatch `UIHierarchy` route
      (measure first: collapsed nodes, cost on 143+ nodes, caption suffix).
- [ ] 1.3 Build it. Then a DIALECT C2i row stating what the hierarchy read requires (bitness, proxy, where it comes
      from), with the measurement from 0.2.
- [ ] 1.4 Verify on BOTH machines: the TwinCAT-only machine/VM (refs, fetch, push, build green; C2i guard still
      flags a bare-captioned POU), and the volt dev machine (no regression). Full C# suites green.

## 2. Close

- [ ] 2.1 Tell PLCAssist: the verdict, the code and sentence a TwinCAT-only machine now gets (or that it now works),
      and the release build that carries it, so the customer can be asked to update.

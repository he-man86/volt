## Analyse first: PLCAssist may have misread this

This is a request from PLCAssist (a client of the bridge) written from the OUTSIDE: what our logs observed, and our
reading of volt's code and of one Windows machine's registry to explain it. The observations are recorded facts. The
explanation is our interpretation and may be wrong: about the cause, about whether it is a volt gap at all, or about
the customer's machine being the odd one out.

Before any work: verify the observation, then confirm or refute our reading. If the cause is outside volt (the
customer's install, their IDE), record that here with the reason and stop. That answer is as useful to us as a fix.
Only a confirmed real gap goes on to the tasks.

## Why

**On a customer's TwinCAT machine every op except `health` fails, and nothing tells the user why.** The bridge
connects and `health` is OK. Then every `refs` answers `ITEM_UNVERIFIED` with
`QueryService(SVsSolution) failed (0x80040154)`. 0x80040154 is REGDB_E_CLASSNOTREG. This is the only TwinCAT customer
who has used a bridge that carries `TcSolutionExplorer`, so as far as we can see a TwinCAT bridge with it has never
worked anywhere except on the volt dev machine.

What PLCAssist saw (2026-10-13 06:51–07:18Z, bridge from the 2026-10-07 release = volt `0.1.17413`; `health`
reported TcXaeShell `15.0`, TwinCAT `3.1.4024.75`; Windows, customer in Russia, signed up the same morning):
- Four `refs` requests: `r-eb3acbc4` (272 ms), `r-344621da` (328 ms), `r-88a341c7` (78 ms) and `r-6b528402`
  (287 ms). All four answered `ITEM_UNVERIFIED` with the same text: "the Solution Explorer hierarchy is unreadable;
  Volt does not walk the TwinCAT tree without it (DIALECT C2i): QueryService(SVsSolution) failed (0x80040154)".
  One `refs` between them answered `PLC_DISCONNECTED` (`r-4a991e75`, no project open at that moment).
- The error came back across XAE restarts and across two separate bridge installs (setup codes `dbcf815b` 06:47Z and
  `cc352853` 07:13Z, two bridge tokens). It answers in 78–328 ms, so it fails fast. It is not a timeout.
- Field census (PLCAssist DB, every TwinCAT chat since the Volt migration on 2026-09-22): 28 chats. 25 of them,
  2026-09-26/27, read and wrote TwinCAT fine (`plcProject`/`plcRead`/`plcWrite`/`plcBuild` ok). They came from two
  accounts, our own and a partner's, both on unstamped `1.0.0.0` dev builds. All 25 predate `1fdbf131aa`
  (2026-10-02), the commit that added `TcSolutionExplorer`. The other 3 chats (`dbbe54c0`, `2cabb490`, `7409e663`)
  are this customer's, and every `refs` in them failed as above. Four other accounts downloaded the TwinCAT bridge
  since 2026-09-22 but never opened a TwinCAT chat. So we have no field success on a build that carries
  `TcSolutionExplorer`, and one failure.
- Same morning, CODESYS 3.5.17.20 users on the same release read fine (chats `53a4b148`, `e2dba9d3`). They are
  different accounts, so this does not show that the customer's machine is otherwise healthy.

## What PLCAssist measured (on the volt dev machine, read-only, 2026-10-13)

This is the machine every TwinCAT measurement in DIALECT was made on (V5 says "this machine's TcXaeShell 15 / TwinCAT
3.1.4024.74"). Visual Studio Community 2022 17.7 is also installed on it.

- **The shipped worker is x64 and XAE is x86.** `VoltBridgeTwincat.exe` PE machine 0x8664. `build-cli.ps1:78`
  publishes it `-r win-x64` and has done so since `5f3f679e52` (2026-07-18). `git log -S"win-x86"` finds nothing:
  the worker has never been x86. TcXaeShell 15 is 32-bit (DIALECT, `splice-graphical-body` tasks: "TcXaeShell is
  32-bit … never the net8/x64 worker").
- **IVsSolution, IVsHierarchy and IEnumHierarchies are proxied by msenvp.dll, not by the type library.**
  `HKLM\SOFTWARE\Classes\Interface\{7F7CD0DB-…}` (IVsSolution), `{59B2D1D0-…}` (IVsHierarchy) and `{BEC77711-…}`
  (IEnumHierarchies) each have `ProxyStubClsid32 = {E6D78900-BB40-4039-9C54-593A242B65DA}` (PSFactoryBuffer).
  The two registry views keep separate copies (`…\Classes\WOW6432Node\Interface` holds 27 672 keys, the 64-bit
  view 30 700).
  - 64-bit view: `CLSID\{E6D78900…}\InProcServer32` = `C:\Program Files\Common Files\Microsoft Shared\MSEnv\msenvp.dll`
    (x64, 15.0.28307.572).
  - 32-bit view: `CLSID\{E6D78900…}\InProcServer32` = `C:\Program Files (x86)\Common Files\Microsoft Shared\MSEnv\msenvp.dll`
    (x86, 15.0.27825.0).
- **Which installer wrote which view** (Windows Installer component registry `…\Installer\UserData\S-1-5-18\Components`,
  plus a read-only `OpenDatabase` of the cached MSIs):
  - The 64-bit msenvp.dll and its 64-bit `CLSID` and `Interface` keys (component root `20:` = HKCR 64-bit) belong to
    `vs_minshellinteropx64msi` 17.7.33905 (template `x64;1033`, cached `C:\WINDOWS\Installer\65ef58a.msi`). It was
    installed 2023-11-13 from
    `C:\ProgramData\Microsoft\VisualStudio\Packages\Microsoft.VisualStudio.MinShell.Interop.Msi,version=17.7.33906.96,productarch=x64`.
    Its only dependent is VS instance `{AEF703B8…}` (`HKLM\SOFTWARE\Classes\Installer\Dependencies\Microsoft.VisualStudio.MinShell.Interop.x64.Msi,v17\Dependents`).
    **So Visual Studio 2022 put it here.**
  - The 32-bit msenvp.dll and its 32-bit keys (component root `00:`) belong to `vs_minshellinteropmsi` 15.8.27825
    (template `Intel;1033`, so it cannot write the 64-bit view). It was installed 2023-08-12 from a bootstrapper's
    Temp folder, on the same day as TwinSAFE Editor, TF5210 and the TwinCAT 3 Type System. We infer that a TwinCAT
    setup chained it; the logs are gone, so this is not proven.
  - The `Beckhoff TwinCAT XAE Shell` 1.20.0.0 MSI (installed 2026-02-22) registers none of these keys (0 hits in its
    Registry table). It ships its own **x86-only** registration-free copy:
    `C:\Program Files (x86)\Beckhoff\TcXaeShell\Common7\IDE\Automation\msenvp.dll` (machine 0x014C, 15.0.35826.109)
    + `msenvp.dll.manifest` (`processorArchitecture="x86"`, `comInterfaceExternalProxyStub` for `{7F7CD0DB…}` →
    `{E6D78900…}`). That copy serves XAE's own process. An x64 client cannot load it.
  - **No TwinCAT component writes a 64-bit msenvp registration.**
- **The exact HRESULT, reproduced without touching the registry.** From a 64-bit process, `CoGetPSClsid` on an IID
  that exists only in the 32-bit `Interface` view (`ITcEnumEventLang {2ADF4980-280D-11D3-A04A-00E01890498A}`, proxy
  `{FEC7D800…}` registered only for 32-bit) still returns the 32-bit `ProxyStubClsid32`. COM falls back to the
  32-bit Interface key. `CoGetClassObject` on that CLSID, in-proc, then answers **0x80040154**. A made-up IID answers
  0x80040155 (IIDNOTREG). For IVsSolution on this machine the 64-bit class is found. So "IID registered for 32-bit
  only, proxy CLSID not registered for 64-bit" gives exactly the customer's HRESULT.
- **Why `health` and everything before the tree read work.** Every other cross-process call in
  `Volt.Ide.Twincat` is `dynamic`, which means IDispatch (`TcObjectModel.Session.cs:235-314`,
  `TcObjectModel.Build.cs:86-198`, `TcItemArchive.cs`). Its proxy is oleaut32's and ships with Windows in both
  bitnesses. The ROT (`RotInstances.cs:20,111,131`) and `CoRegisterMessageFilter` (`ComMessageFilter.cs:20-34`) are
  Windows'. `IServiceProvider {6D5140C1…}` is proxied by `{A6FF50C0…}` = `OneCoreCommonProxyStub.dll` in System32
  and in SysWOW64. That is why the `(IOleServiceProvider)dte` cast and the call itself succeed. Only the out-pointer
  `QueryService` hands back, an IVsSolution, needs msenvp.dll. `TcSolutionExplorer` is the only `[ComImport]` VS
  interface the worker marshals.

## Our reading of the code (volt `c99a646580`)

- `TcSolutionExplorer.ReadPlcProject` (`Volt.Ide.Twincat/Ide/TcSolutionExplorer.cs:176-185`) casts the DTE to
  `IOleServiceProvider` and calls `QueryService(SVsSolution {7f7cd0db…}, IID_IVsSolution)`. `Check` turns the
  HRESULT into a `COMException` "QueryService(SVsSolution) failed (0x…)" (`:262-265`). The class comment (`:153-159`)
  says "works out of process"; it does not say which bitness of proxy that relies on.
- `TcObjectModel.Explorer()` (`TcObjectModel.cs:287-298`) wraps any exception as `ITEM_UNVERIFIED` "the Solution
  Explorer hierarchy is unreadable". `BeckhoffDriver.WalkItems` (`BeckhoffDriver.Tree.cs:36-41`) reads it first, on
  purpose outside the per-node catches. `ChildAt`/`ChildCount` (`TcObjectModel.cs:186,203`) need it for every child.
  So on a machine where the read fails, **fetch, refs, push and build all fail**. It is not one folder. The whole
  TwinCAT bridge is down except `health`.
- `ITEM_UNVERIFIED` is a gate code for "a walk that cannot vouch for an item". A client reads it as "this item/folder
  could not be confirmed, do not recreate it". PLCAssist maps it to exactly that
  (`volt-error-map.ts:197`, "a folder could not be read"), which sent the customer to look for a missing folder. A
  machine that can never read the hierarchy is a different fact. `BridgeErrorCodes.IdeUnsupported` already exists for
  it: "The IDE this bridge runs in lacks something the bridge needs, so it serves nothing: every op but `health`
  answers with this code … `health` carries the same sentence as `unsupported`. Do not retry"
  (`Volt.Contracts/Vocabulary/BridgeErrorCodes.cs:42-48`). The hook is there too: `DriverBase.Unsupported`
  (`Volt.Engine/Ide/DriverBase.cs:116-118`), gated in `BridgePipeHost.cs:75-77,111`.
- History: `TcSolutionExplorer` arrived in `1fdbf131aa` (2026-10-02, push-without-header-check 5H), ported from
  `probe-tc-kind-source.ps1` (`git show b2496efb4b:…`). Every tagged release since `0.1.17248` (2026-10-03) carries it.
  Every C2h/C2i/V5 measurement and the 5Qa e2e ran on one machine, the one above with VS 2022. We find no row, note
  or doc that names msenvp.dll, a proxy/stub, or the worker's bitness as a requirement for this read. The pre-Volt
  PLCAssist Beckhoff bridge (x64) never used `SVsSolution`, so it never hit this.

## Hypothesis, and the test that proves or kills it

**Hypothesis.** The x64 worker can unmarshal IVsSolution/IVsHierarchy from the 32-bit XAE only when the **64-bit**
msenvp.dll PSFactoryBuffer `{E6D78900…}` is registered. TwinCAT 4024's own setup installs only the 32-bit one
(`vs_minshellinteropmsi`, `Intel` template) plus XAE's private x86 manifest. On a machine without an x64 Visual Studio
(2019/2022) that registered `vs_minshellinteropx64msi`, COM finds the IID through the 32-bit fallback and fails the
64-bit class lookup with 0x80040154, which is the customer's error.

**What would kill it:**
- the customer's 64-bit view does hold `CLSID\{E6D78900…}\InProcServer32` pointing at an x64 msenvp.dll that exists;
- or a clean TwinCAT-only machine reads the hierarchy from the shipped x64 worker.

**Proof, without touching the volt dev machine's registry**, cheapest first:
1. **Ask the customer for two read-only queries** (PLCAssist can relay them):
   `reg query "HKLM\SOFTWARE\Classes\CLSID\{E6D78900-BB40-4039-9C54-593A242B65DA}\InProcServer32" /reg:64` and the
   same with `/reg:32`. Also: is any Visual Studio installed. Prediction: `/reg:32` present, `/reg:64` "unable to
   find", no VS 2019/2022.
2. **A minimal probe, built twice (`-r win-x64` and `-r win-x86`).** Take the DTE from the ROT the way
   `RotInstances` does, cast it to `IOleServiceProvider`, call `QueryService(SVsSolution)`, print the HRESULT. Before
   that, print `CoGetPSClsid(IID_IVsSolution)` and `CoGetClassObject(that CLSID, INPROC)`. All read-only. Prediction
   on a TwinCAT-only machine: x64 → `CoGetClassObject` 0x80040154 and `QueryService` 0x80040154; x86 → S_OK both.
   On the volt dev machine, S_OK for both bitnesses (not a discriminating run, only a sanity check).
3. **A clean VM.** Windows Sandbox is not available on the dev machine (Windows 11 Home, no `WindowsSandbox.exe`).
   VirtualBox is installed (`C:\Program Files\Oracle\VirtualBox`). Use a fresh Windows VM with TwinCAT 3.1.4024 (XAE
   shell) only, no Visual Studio. Run the shipped bridge `refs` (expect the field error) and the probe in both
   bitnesses. Then install VS 2022 (any edition) and re-run: x64 should start to work. That would confirm both
   directions.

## What we ask

**The requirement (PLCAssist owner, 2026-10-13): the TwinCAT bridge works on a plain TwinCAT install** — TwinCAT XAE /
TcXaeShell as Beckhoff's setup leaves it, no Visual Studio, nothing extra registered. A named error (1.1) is the
minimum while that is being built, not an end state; "install Visual Studio 2022" is not an acceptable answer.

1. **Verify** on a TwinCAT-only machine (step 1, 2 or 3 above). If the hypothesis is wrong, record what the machine
   shows and stop. Then the 0x80040154 has another cause, and we would like it named.
2. **If confirmed, make the tree read work without an x64 Visual Studio.** Our ranking, which is yours to overrule:
   1. **Read the hierarchy from a 32-bit process.** Either the whole TwinCAT worker built `win-x86` (the connector
      stays x64; the pipe between them is not COM), or a small x86 helper only for the hierarchy read. An x86 client
      needs the 32-bit msenvp. **Caveat:** we only know that TwinCAT put the global 32-bit registration here
      (inferred, 2023 install). If a fresh 4024 install relies only on XAE's private manifest, an x86 client would
      fail too. In that case activate XAE's own manifest in the worker:
      `CreateActCtx(…\TcXaeShell\Common7\IDE\Automation\msenvp.dll.manifest)` with the assembly directory set, around
      the hierarchy read. That uses Beckhoff's shipped x86 file, so nothing is redistributed. It works only from x86.
      Check: worker size, .NET `win-x86` self-contained, and anything else in the worker that assumes x64. The
      DIALECT V5 module-list note shows one bitness difference already.
   2. **Read the same facts over IDispatch**, which marshals in any bitness: `DTE.ToolWindows.SolutionExplorer`
      (`UIHierarchy` → `UIHierarchyItems`, `.Name` is the drawn caption) plus `ProjectItem.FileNames` for the
      canonical name. This keeps x64. Unmeasured, and it must be measured: does a collapsed node list its children
      without expanding the UI, what does a cross-process walk of 143 nodes cost (the 2026-09-03 note says
      `DTE.Commands` enumeration hangs), and does the caption carry the `(PRG|FB|FUN)` suffix C2i depends on?
   3. **Not recommended, listed so they are not retried:**
      - Ship or register Microsoft's x64 msenvp.dll. It is VS payload, its redistribution rights are unclear, and
        registering it is a machine-wide change.
      - Read the `.plcproj`/`.TcPOU` on disk. That shows the saved text, not the IDE's parse state C2i guards.
      - The system manager alone. `ProduceXml` lists no children, and touching the item is the crash.
3. **In every case, the minimum: a coded, named error instead of a bare HRESULT under `ITEM_UNVERIFIED`.** When the
   hierarchy cannot be marshalled at all, report it as `IDE_UNSUPPORTED` through `DriverBase.Unsupported`.
   `health` then states it (today it says OK), and every op refuses with one fixed English sentence, for example:
   "TcXaeShell 15.0 (TwinCAT 3.1.4024.75): the 64-bit Visual Studio marshaling component (msenvp.dll,
   PSFactoryBuffer {E6D78900…}) is not registered, so the bridge cannot read XAE's Solution Explorer. Installing
   Visual Studio 2022 adds it." It can be checked without XAE: `CoGetPSClsid(IID_IVsSolution)` +
   `CoGetClassObject(INPROC)` in the worker's own bitness. Keep `ITEM_UNVERIFIED` for what it means, a walk that
   cannot vouch for an item. The "Installing VS 2022 adds it" workaround is inferred from this machine, not tested
   on a clean one.

## Impact

- `Volt.Ide.Twincat/Ide/TcSolutionExplorer.cs`, `TcObjectModel.cs` (`Explorer()`), `BeckhoffDriver` (an
  `Unsupported` override). Depending on the fix: `scripts/build-cli.ps1:78` (RID) or a new x86 helper. DIALECT C2i
  gains a row saying what the hierarchy read requires, with the measurement.
- Users: today a TwinCAT-only machine has a bridge that connects and then fails every op with a message about a
  folder. With only the named error, the user is told the real reason and a workaround at once, and `health` stops
  saying OK. With a fix, TwinCAT works on a stock TwinCAT install. That is, as far as we can tell, every TwinCAT
  customer who does not also have VS 2019/2022.
- PLCAssist: maps `IDE_UNSUPPORTED` (already in its vocabulary for CODESYS) and stops reading this case as "a folder
  could not be read". If you choose a different code or wording, we adapt.

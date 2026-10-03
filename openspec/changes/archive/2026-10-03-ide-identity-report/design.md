# ide-identity-report — design

## Step 2 — Report the identity

### Target

One `health` frame from either vendor tells a client four things about the bridge PROCESS, beside the existing
`ideVersion` and `unsupported`:

| field | meaning | CODESYS (in-proc) | TwinCAT (out-of-proc worker) |
|---|---|---|---|
| `productName` | what the user runs | `IEngine3.OEMCustomization.ProductName` (already read, `CodesysDriver.ProductName`) | `DTE.Name` |
| `productVersion` | that product's own version, verbatim | host exe `FileVersionInfo.ProductVersion` (current process = the IDE, V4) | `DTE.Version` |
| `productVendor` | manufacturer | host exe `FileVersionInfo.CompanyName` (V4) | the XAE pid's `MainModule.FileVersionInfo.CompanyName` (V5) |
| `ideVersion` | underlying platform | `SystemInstances` assembly version (unchanged, V1) | `DTE.GetObject("TcRemoteManager").Version` (V5 source a) — **moves off `DTE.Version`** |
| `bridgeVersion` | the bridge release | stamped `FileVersion` of the bridge's own file, else `(dev) <commit>` from its `ProductVersion` | same, same file |

Each field is null when its source does not answer (empty/whitespace reads null, a throwing getter reads null and the
start log names the exception) — never filled from another field, a path or a file name. Report only: no value here
decides whether the bridge serves (tasks §0). The connector carries all five onto every row it detects, and
`@volt/control` renders them as one identity line (2.5).

### What the recorded samples give (the measure every option below is held to)

The recordings are the step-1 probe logs and the PLCAssist bundles on this machine:

- **S1** `scripts/ide-identity.log`: plain CODESYS SP21 Patch 4, live.
- **S2** `scripts/tc-ide-identity.log` / `-64.log`: TcXaeShell 15, TwinCAT 3.1.4024.74, live, 32- and 64-bit readers.
- **S3** the six `Downloads\PLCAssistBridge-*` bundles (3 CODESYS, 3 TwinCAT), unstamped, 4 distinct commits.
  Re-read for this design (2026-10-03): `Volt.Engine.Host.dll` has the same `FileVersion` (`1.0.0.0`) and
  `ProductVersion` (`1.0.0+<commit>`) as the vendor's own file (`Volt.Ide.Codesys.dll` / `VoltBridgeTwincat.exe`) in
  each of the six: `3a59f06a…`, `20365780…` (×2), `a93e5d76…` (×2), `1b5a1606…`.
- **S4** the stamped scratch build (1.4): `/p:Version=0.1.17258 /p:FileVersion=0.1.17258` → FileVersion `0.1.17258`,
  AssemblyVersion `0.1.17258.0`.

### Options

**A. Where the identity lives on the wire.**

| option | S1 | S2 | verdict |
|---|---|---|---|
| A1 top-level fields on `HealthResponse`, beside `ideVersion`/`unsupported` | one value per frame | one value per frame | **chosen** — a process fact, like `networkText`/`unsupported`; the connector already reads top-level `unsupported` in `WireProjects.Flatten` and stamps it on every row |
| A2 per-row fields on `ProjectEntry` | the same value repeated on every row | the same value on each of the worker's projects | rejected — repeats a process fact per project, and a frame with zero rows (no project open, an `unsupported` IDE with nothing loaded) would carry no identity at all, which is exactly when a support case needs it |
| A3 one nested `identity` object | same values | same values | rejected — `ideVersion` already sits flat at top level and stays there (the spec keeps it the platform field), so a nested object would split one identity across two shapes |

Absent on the wire means null (`WireJson` writes `WhenWritingNull`, the convention `ideVersion` and `unsupported`
already follow). A new bridge always sends `bridgeVersion` (S3/S4: every file states a FileVersion), so a frame without
it is an older bridge, not an unknown one.

**B. CODESYS product sources** (one source per fact, no vendor list).

| option | S1 name / version / vendor | inside an OEM | verdict |
|---|---|---|---|
| B1 `OEMCustomization.ProductName` + exe `ProductVersion` + exe `CompanyName` | `CODESYS` / `3.5.21.40` / `CODESYS Development GmbH` | the OEM's branding hook for the name; the exe the OEM ships for version/vendor (V1: Lenze's is `PlcDesigner.exe`) | **chosen** |
| B2 all three from the exe version-info | `CODESYS` / `3.5.21.40` / `CODESYS Development GmbH` | identical on S1 | not chosen — agrees with B1 on the only sample; B1's name is the one the bridge already reads and logs, and it is the IDE's own customization answer rather than a file resource. The start log prints the exe `ProductName` beside it, so the first OEM log shows whether they part |
| B3 entry-assembly attributes | `CODESYS` / `3.5.21.40` (assembly version, not product version) / `CODESYS Development GmbH` | unknown | rejected — the same facts a second way; `AssemblyInformationalVersion` is absent on S1, so it has no verbatim product version |
| B4 framework DLLs (`SystemInstances.dll`, `EngineWin.dll`) | `CODESYS` / `3.5.21.40` / `CODESYS Development GmbH` | still 3S (V4) | rejected — names 3S inside every OEM |

What an OEM exe states is unmeasured (no OEM IDE here, V1/V4). B1 cannot give a WRONG value on plain CODESYS and gives
the OEM's own statement wherever the OEM made one; where an OEM kept 3S's version-info, the field shows 3S's — what
the binary says, never a corrected guess.

**C. TwinCAT product and build sources** (settled in 1.3, re-held to S2 here).

| option | S2 value | verdict |
|---|---|---|
| C1 product = `DTE.Name` / `DTE.Version` | `TcXaeShell` / `15.0` | **chosen** — the running shell's own answer, over the automation the worker already holds; equals PLCAssist's pre-Volt rows (`TcXaeShell 15.0`) |
| C2 product = XAE exe version-info | `TcXaeShell Application` / `15.0.0.0` | rejected — splits one install into two rows of PLCAssist history |
| C3 vendor = XAE pid's exe `CompanyName` (`--xae-pid`) | `Beckhoff` (32- and 64-bit readers alike) | **chosen** — the DTE has no vendor member |
| C4 vendor/product = `Process.GetCurrentProcess()` | `VoltBridgeTwincat` / `1.0.0+<commit>` (S3) | rejected — that is Volt's own worker |
| C5 build = `TcRemoteManager.Version` | `3.1.4024.74`; empty with no solution | **chosen** — the only running-XAE answer reachable over COM; the bridge serves only with a solution open; empty → null |
| C6 build = loaded `TwinCAT XAE Base.dll` | `3.1.4024.74` from 32-bit; **absent** from 64-bit (7 of 217 modules) | rejected — the worker is win-x64 |
| C7 build = registry `TcVersion` | `3.1.4024.74` (Registry32 only) | rejected — the machine's runtime, not the running XAE |
| C8 build = `.tsproj` `TcVersion` | `3.1.4024.74` | rejected — the build that last saved the project |

C5 is read on the STA thread with the snapshot (`OwnSolution`), not once at bind: the remote-manager version belongs
to the open SOLUTION, which can change inside one DTE. C1 and C3 are process facts read once at bind (`SwapDte`; the
xae pid is fixed for the worker's life).

**D. The bridge release** — counted over S3's six bundles (4 builds) and S4.

| option | S3: distinct values for 4 builds | S4 | verdict |
|---|---|---|---|
| D1 assembly version (today's relay `hello`) | 1 (`1.0.0.0` ×6) | `0.1.17258.0` | rejected — the value PLCAssist sees on all 135 chats |
| D2 FileVersion, `(dev)` when unstamped (`volt --version`'s reading) | 1 (`(dev)` ×6) | `0.1.17258` | rejected — collapses four builds into one |
| D3 FileVersion when stamped; else `(dev) <commit>` from the `ProductVersion` suffix after `+`; bare `(dev)` only when no `+` | **4** (`(dev) 3a59f06a…`, `(dev) 20365780…`, `(dev) a93e5d76…`, `(dev) 1b5a1606…`) | `0.1.17258` (= `volt --version`) | **chosen** |

Which file D3 reads:

| file | S3 | verdict |
|---|---|---|
| `typeof(BridgePipeHost).Assembly.Location` (`Volt.Engine.Host.dll`, Core) | equal to the vendor's file in all six bundles | **chosen** — one read, in the shared host, both vendors; stamped by the same `build-cli.ps1` `@VERARGS` as every binary |
| each host's own file (`Volt.Ide.Codesys.dll`, `VoltBridgeTwincat.exe`) | the same values | rejected — the same answer through two per-vendor code paths |
| `Environment.ProcessPath` | `CODESYS.exe` in-proc (V4) | rejected — the IDE's exe, not the bridge |

"Stamped" uses the sentinel `volt --version` uses: a FileVersion other than `1.0.0.0` / `0.0.0.0`. The commit is copied
verbatim (the full hash S3 states). An unreadable own file (`Location` empty, `GetVersionInfo` throws) reports null
and the start log names why. That is a packaging fault worth seeing, and it never stops the bridge serving.

**E. How `@volt/control` turns the fields into the identity line (2.5).**

| option | S1 | S2 | verdict |
|---|---|---|---|
| E1 the bridge sends a ready platform string (`CODESYS 3.5 SP21 Patch 4`) | ok | ok | rejected — a second wire field carrying the platform version, which the spec forbids |
| E2 control guesses the scheme from the number (a `3.5.x.y` looks like CODESYS) | ok | `3.1.4024.74` → not 3.5, falls through | rejected — infers a product from a number |
| E3 control picks the version scheme from the row's `vendor` (its identity field already), through an exhaustive `Record<Vendor, …>` with no default | `CODESYS Development GmbH CODESYS 3.5.21.40 — CODESYS 3.5 SP21 Patch 4` | `Beckhoff TcXaeShell 15.0 — TwinCAT 3.1.4024.74` | **chosen** |

E3 is the one vendor-aware piece of display in control, alongside the existing vendor-specific recovery instruction in
`outcomes.ts`. The rule that the UI does not label projects by vendor still holds, because the vendor stays out of the
label. What varies by vendor is only how a version number is read: the SP/patch scheme belongs to CODESYS and is not
displayed for a TwinCAT row. Because the table is exhaustive, adding a third vendor fails to compile until that vendor
gets its own scheme.

The CODESYS scheme is formatting only. `3.<5>.<sp>.<p>` with `p % 10 == 0` renders as `SP<sp> Patch <p/10>`
(`3.5.21.40` → SP21 Patch 4, `3.5.19.50` → SP19 Patch 5, `3.5.15.0` → SP15 Patch 0). Anything else (major.minor not
`3.5`, a non-zero last digit such as a hotfix build, or a non-numeric part) renders as `CODESYS <ideVersion>` verbatim:
no hotfix scheme has been measured, so none is invented. A null part renders as `unknown vendor` / `unknown product` /
`unknown version` / `CODESYS version unknown` in its place and is never dropped silently. The line sits on
`ConnectOption.identity`, so both shells render one string. `pickProject` in the VS Code extension uses
`ideIdentity(p)` for its description, which today is the bare `ideVersion`.

### The choice

A1 + B1 + C1/C3/C5 + D3 (read from `Volt.Engine.Host.dll`) + E3: four new top-level `health` fields filled from the
IDE's own statements, `ideVersion` moved to the TwinCAT build, and `bridgeVersion` that tells apart all four PLCAssist
builds where both of today's readings give one value. The connector stamps the fields on every row the way it already
stamps `unsupported`, and control renders them as one line, picking the version scheme from the row's vendor.

### Stays refused, by name

- **Per-vendor or per-OEM detection**: no vendor list, no special case, and no name taken from an exe's file name,
  path or install folder.
- **A `platformVersion` field**, or any second wire field carrying the platform version, including a preformatted
  platform string (E1).
- **`ideVersion` derived from `productVersion`**, on either vendor.
- **Gating on identity**: no version, vendor or product value refuses anything. The only refusal stays
  `IDE_UNSUPPORTED` (a missing capability).
- **The TwinCAT build from the registry, the `.tsproj` or a loaded DLL** (C6–C8). Likewise
  **`Process.GetCurrentProcess()` as a product source on TwinCAT** (C4).
- **The assembly version as the release** (D1), **a bare `(dev)` for a build whose `ProductVersion` states a commit**
  (D2), and `1.0.0.0` reported as a release.
- **SP/patch guessed for an unrecognised CODESYS number** (E). It is shown verbatim.
- **Out of this step, named so they are not mistaken for oversights.** The per-row `ProjectEntry.version` stays on
  the wire unchanged: it duplicates `ideVersion`, but external relay clients (PLCAssist) read `health` and removing a
  wire field is its own change. `volt --version` and `Updater.CurrentVersion` keep their `(dev)` form: the updater's
  dev-ness and the status window's sync column read it, and the CLI is not a bridge.

### Migration of existing code

- **`Volt.Contracts`**
  - `HealthResponse` gains `ProductName`, `ProductVersion`, `ProductVendor`, `BridgeVersion` (all `string?`).
  - The class summary changes from "ONE fact about the bridge process" to the list of process facts.
  - The `IdeVersion` doc says TwinCAT carries the build.
  - A new `BridgeRelease.Of(string path)` holds D3, so the health stamp and the relay `hello` share one reading.
- **`Volt.Engine`**
  - `IIdeSession` and `DriverBase` gain abstract `ProductName`, `ProductVersion` and `ProductVendor`, which are
    primitive state reads like `IdeVersion`.
  - `test/shared/FakeIde.cs` and the two doubles in `HonestHealthTests.cs` implement them.
- **`Volt.Engine.Host/BridgePipeHost`**
  - The health case stamps the three product fields beside `IdeVersion`, plus `BridgeVersion` from a static
    `Lazy` of `BridgeRelease.Of(typeof(BridgePipeHost).Assembly.Location)`.
  - All of it is stamped on the unsupported path too, because that is when a client needs it most.
- **`Volt.Ide.Codesys`**
  - `CodesysDriver` reads `ProductVersion` and `ProductVendor` once in the ctor, from
    `Process.GetCurrentProcess().MainModule.FileVersionInfo`. The current process is correct only because the driver
    is in-proc, so the comment says so.
  - `ProductName` stays as read. `OemProduct` stays, since the start line and the message window still use it.
  - The `PipeHost` start log prints all four identity values, the exe `ProductName` (B2's evidence) and
    `bridgeVersion`.
  - `StartTunnelIfConfigured` passes `BridgeRelease.Of(...)` in place of the assembly version.
- **`Volt.Ide.Twincat`**
  - `TcObjectModel.SwapDte` reads `DTE.Name` and `DTE.Version` as the product, and reads the vendor through
    `Process.GetProcessById(xaePid).MainModule`.
  - `_ideVersion` is now `TcRemoteManager.Version`, read in `OwnSolution` on the STA thread (empty → null).
  - `BeckhoffDriver` exposes the four values. The row `version` therefore changes from `15.0` to `3.1.4024.74`, and
    the tray's multi-instance label follows it.
  - `Program.cs` passes `BridgeRelease.Of(...)` to the relay in place of the assembly version.
- **`Volt.Relay`**: the `hello.volt` meaning is unchanged ("the bridge's own version"), but its value now follows D3.
  Update `docs/relay-protocol.md`, which shows `0.0.1.842` (still correct for a stamped build); add `(dev) <commit>`.
- **Connector**
  - `DetectedProject` and `ProjectView` gain the four fields.
  - `WireProjects.Flatten` reads them off the top level the way it reads `Unsupported`.
  - `ControlServer`'s `/status` mapping, the `Volt.Connector.ControlHarness` (`FileProjectSource`, `Program.cs`) and
    `TrayContext`'s `ProjectView` construction carry them through. The tray's own display is unchanged.
- **`@volt/control`**
  - `DetectedProject` gains `productName`, `productVersion`, `productVendor` and `bridgeVersion` (optional, null when
    absent, like `ideVersion`).
  - A new `src/view/identity.ts` holds `ideIdentity(p)` (E3, exhaustive over `Vendor`), with a colocated test.
  - `ConnectOption` gains `identity`, set in `connectOptions`.
  - The stale note in `health.ts` about where the IDE version lives is updated.
- **Shells**
  - VS Code: `pickProject` uses `ideIdentity`, and the panel's detected, reconnect and refused nodes carry
    `o.identity` as their tooltip line. A refused node shows it beside the reason.
  - Desktop: `panel.ts` carries `identity` on `LabeledProject` and renders it under the project name.
  - The `detectedKey` change key includes `identity`, so an identity that arrives later redraws the row.
- **Docs**
  - Regenerate `docs/wire.html`, `volt-bridge.openrpc.json` and `assets/data.js` with `VOLT_WRITE_DOCS=1`.
  - In `DocDataTests`, the `health` prose names the new fields.
  - DIALECT V4/V5 point at the code that now reads them.
- **Tests (§4)**
  - Driver doubles cover plain CODESYS, an OEM-shaped double (name, version and vendor differ from 3S, platform
    readable) and a TwinCAT double (shell as product, build as `ideVersion`, an empty remote manager reads null).
  - A wire test checks the five fields and that `ideVersion` is never copied from `productVersion`.
  - `BridgeRelease.Of` is tested on a stamped file, a `1.0.0+<commit>` file and a `1.0.0` file without a commit.
  - The connector's `Flatten` test carries the fields onto rows, and control's `ideIdentity` table includes the
    verbatim and unknown cases.

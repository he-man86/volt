## Why

**PLCAssist can no longer tell which IDE, which IDE version, or which bridge release a customer runs.** The pre-Volt
bridges reported all three; since the Volt bridge (2026-09-23) every chat records only the vendor.

Measured in PLCAssist production on 2026-10-01 (read-only query over `ai_chat`):

- **Pre-Volt bridges recorded the real IDE** — name and its own version — and that showed a large OEM population:

  | IDE (as reported) | Version(s) seen | Users |
  |---|---|---|
  | CODESYS | 3.5.15.0 … 3.5.22.30 | 77 |
  | Lenze Engineering | 4.0.1.33999, 4.1.0.37740, 4.2.0.41765 | 6 |
  | Machine Expert | "Version 2.1 (Commit Hash …)", "Version 2.2.1 (…)", "Version 2.3 (Sha: 113bfa7)" | 5 |
  | DIADesigner-AX | 1.10.0 | 2 |
  | Machine Expert Logic Builder | "Version 2.6 (Sha c2adc54)" | 1 |
  | InoProShop | 1.9.1.6 | 1 |
  | GM Programmer Pro | 3.5.17.60 | 1 |
  | XSOFT-CODESYS | 3.5.20.50-f036 | 1 |
  | TcXaeShell | 15.0, 17.0 | 35 |

  Of the plain-CODESYS users, 27 of 77 ran a platform below SP21.
- **For the OEM IDEs, the underlying CODESYS platform version was never known.** Lenze, Machine Expert,
  DIADesigner and InoProShop report only their own product version (`4.1.0.37740`, `Version 2.3`). Only OEMs that
  number like CODESYS (GM Programmer Pro, XSOFT) reveal their base. The old bridges' own attach events carry the
  same two fields and nothing more.
- **The Volt bridge reported less** (on all 135 Volt-era chats up to 2026-10-01): IDE version empty, IDE name only
  `CODESYS` / `TwinCAT` (an OEM IDE indistinguishable from plain CODESYS), and bridge version `1.0.0.0` on every one.

## What already exists — built by `codesys-minimum-version` (archived 2026-10-02)

This change builds on that one and does not redo it. Commits `5a27779448` (platform version, capability refusal,
connector), `14fe21dd70` (verification and review gate), `e4652fdfc9` (`@volt/control` shows the refusal).

- **The CODESYS platform version is read, from one generic framework source** — the assembly version of the assembly
  that defines `_3S.CoDeSys.Core.SystemInstances` (`CodesysPlatform.ReadVersion`,
  `src/Volt.Ide.Codesys/Ide/CodesysPlatform.cs`; DIALECT **V1**). No exe version, no vendor list, no parsing. Measured
  on SP18 Patch 3 (`3.5.18.30`, on disk) and SP21 Patch 4 (`3.5.21.40`, live). It is `CodesysDriver.IdeVersion`
  (`src/Volt.Ide.Codesys/Driver/CodesysDriver.cs`), a pure version, and it is on the wire twice already: each row's
  `version` and the top-level `health.ideVersion` (`src/Volt.Contracts/Wire/HealthResponse.cs`, both vendors via
  `BridgePipeHost`), read by the connector (`DetectedProject`) and `@volt/control` (`DetectedProject.ideVersion`).
- **The product name is read** — `IEngine3.OEMCustomization.ProductName` (`CodesysPlatform.ReadProductName`), as
  `CodesysDriver.ProductName`, with `OemProduct` = that name unless it is `"CODESYS"`, and a getter failure kept as
  `ProductNameUnreadable`. It reaches the start log and the message-window line only — **not the wire**.
- **The refusal is by capability, never by number** (`CodesysPlatform.All`, DIALECT **V2**): `IDE_UNSUPPORTED`,
  `health.unsupported`, the connector never binds such a row, and both shells draw "IDE not supported" with the reason.
  Because the version source IS the bridge's core type, a CODESYS whose version cannot be read is refused as lacking
  `SystemInstances` — by capability, named — never for an unknown version.
- **The bound-assembly log** (`src/Volt.Ide.Codesys/BoundAssemblies.cs`, DIALECT **V3**): `bound:` lines at start
  for every loaded copy of `Volt.Wire`, `Volt.Contracts`, `System.Text.Json`, `System.Memory`, and what
  `PipeClient.Call` / `WireJson.Write` actually bind.
- **Release stamping exists for binaries, not for health.** `scripts/build-cli.ps1` stamps `Version`/`FileVersion`
  from `VOLT_VERSION` into every binary of a release; an unstamped local build stays `1.0.0.0`, which `volt --version`
  (`ShippedVersion`, `src/Volt.Cli/Program.cs`) and the updater report as `(dev)`. The `1.0.0.0` PLCAssist sees means
  either its bridge bundle was built without `VOLT_VERSION` or it reads the assembly version — to be settled, not assumed.
- **TwinCAT** reports `IdeVersion` = the DTE's `Version` (`TcObjectModel.Session.cs`) — the SHELL's version
  (`15.0`, `17.0`), which is the product version, not the TwinCAT build.

## What Changes

1. **Check the existing platform-version source inside OEM IDEs.** DIALECT V1 marks an OEM build UNMEASURED. On any
   OEM install at hand, confirm `SystemInstances.dll`'s version is the platform's (or that the bridge is refused by
   capability) — never a wrong value. **No per-vendor detection, no vendor list, no special cases** (owner,
   2026-10-01). Record what was checked in DIALECT V1.
2. **Put the product on the wire**, both vendors, beside the existing `ideVersion`:
   - `productName` — what the user runs (`Lenze Engineering`, `Machine Expert`, `CODESYS`, `TcXaeShell`, `Visual Studio
     2022`). CODESYS: the `ProductName` already read (the raw name, `CODESYS` included).
   - `productVersion` — that product's own version, verbatim, from one generic source (to be measured: e.g. the host
     process's file/product version).
   - **`ideVersion` stays the platform version** — no second `platformVersion` field carrying the same value. On
     TwinCAT it becomes the TwinCAT build (`3.1.40xx.y`); the shell version it carries today moves to `productVersion`.
     It is null when it cannot be read, never derived from the product version.
3. **Report the bridge's release on health**: the binary's own stamped version (the same reading as `volt --version`),
   `(dev)` for an unstamped build — never the shared `1.0.0.0`.
4. **Settle the two field failures `codesys-minimum-version` could not** (moved here, each needs a field log the
   identity fields and the `bound:` lines will now produce): what failed on CODESYS 3.5.17, and whether to refuse when
   another Volt build is already loaded.

## Impact

- `Volt.Contracts` (`HealthResponse`: `productName`, `productVersion`, `bridgeVersion`), `BridgePipeHost`,
  `IIdeSession`/`DriverBase`, `CodesysDriver`, `BeckhoffDriver`/`TcObjectModel`; the generated wire docs
  (`docs/wire.html`, `volt-bridge.openrpc.json`, `VOLT_WRITE_DOCS=1`) and their gates.
- The connector (`DetectedProject`, `/status`) and `@volt/control` carry the new fields through.
- DIALECT.md V1 (OEM check), a TwinCAT entry for the build-version source.
- Clients: PLCAssist stores `productName`, `productVersion`, `ideVersion` and the bridge release per chat (it already
  has columns for name/version/bridge version) and shows `productName productVersion` in its bridge bar.

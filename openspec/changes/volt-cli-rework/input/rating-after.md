# LOC and quality rating AFTER (4.0, 4.0b) — commit 08167c8bfc, 2026-10-23

Measured offline, after steps 3–7 (the contract, the third vendor, the Engine and both hosts on it, the old contract
deleted) and step 8's documents. Same rules as `loc-baseline.md` (C# only, bin/obj excluded, a comment line starts
with `//`) and as `map-and-rating.md` ("How the counts were taken"). Nothing was run live for this page; the live
matrix is the separate gate.

## 4.0 LOC

Three columns, because the 1.0 baseline (`e2405e51bd`, 2026-10-20) predates features that landed before the rework's
code steps (grep, the large-solution refs fix, the frame cap). **pre-rework** is `3fab0d5266`, the commit before step 3:
the difference from it to **after** is the rework alone. Each cell is code / comment / blank.

| project | baseline 1.0 | pre-rework | after | rework Δ code |
|---|---|---|---|---|
| src/Volt.Engine | 9129 / 5187 / 1356 | 9393 / 5280 / 1397 | 10239 / 5202 / 1546 | **+846** |
| src/Volt.Engine.Host | 136 / 108 / 20 | 220 / 135 / 32 | 226 / 138 / 33 | +6 |
| src/Volt.Ide.Codesys | 3812 / 2246 / 484 | 3820 / 2250 / 485 | 3858 / 2251 / 494 | +38 |
| src/Volt.Ide.Twincat | 5597 / 3235 / 806 | 5794 / 3322 / 833 | 5824 / 3320 / 842 | +30 |
| src/Volt.Contracts | 573 / 693 / 172 | 631 / 735 / 194 | 632 / 737 / 194 | +1 |
| src/Volt.Wire | 520 / 204 / 79 | 529 / 210 / 80 | 529 / 210 / 80 | 0 |
| src/Volt.Cli | 2593 / 1274 / 361 | 2685 / 1292 / 367 | 2685 / 1292 / 367 | 0 |
| src/Volt.Connector(.Core), Relay | unchanged | | | 0 |
| test/shared | 2192 / 1045 / 348 | 2223 / 1053 / 353 | 2512 / 1089 / 401 | +289 |
| test/Volt.Engine.Tests | 19921 / 5542 / 3564 | 20511 / 5608 / 3710 | 20928 / 5622 / 3787 | +417 |
| test/Volt.Cli.Tests | 5827 / 1157 / 781 | 6150 / 1198 / 821 | 6404 / 1226 / 864 | +254 |
| test/Volt.Ide.Codesys.Tests | 6949 / 1839 / 1015 | 6977 / 1848 / 1020 | 6987 / 1852 / 1022 | +10 |
| test/Volt.Ide.Twincat.Tests | 7576 / 2113 / 1297 | 8296 / 2225 / 1412 | 8309 / 2226 / 1413 | +13 |
| test/Volt.Repo.Gates | 3208 / 880 / 417 | 3581 / 1017 / 470 | 3596 / 1029 / 472 | +15 |

The Engine grew: the contract (`Seam/`, about 800 lines with its four registries) and the conversions the CODESYS-family
hosts call over it (`IecFormat`, `FamilyContent`, `ItemKind.Nodes`, `ComposedSession`, `HostLink`, `TreeLookup`) are
larger than the old `Ide/` contract they replaced. Comment lines fell by 78. The test growth is the third vendor
(`test/shared/Fakeco`), the contract and catalog tests and the `FakeIde` on the new contract.

## 4.0b Quality rating — before (1.0a) → potential (1.2) → after

Counts (the 1.0a regexes, re-run on the 1.0a commit `62451aa676` and now; the re-run gives Engine 357 vendor lines and
82 history lines where 1.0a recorded 346 and 77, so compare the two re-runs with each other):

| project | vendor lines (code) | history comments | PLCopen | test facts (files) |
|---|---|---|---|---|
| Engine (+Host) | 357 (25) → 309 (25) | 82 → 83 | 7 → 7 | 1292 (153) → 1364 (161) |
| Engine `Seam/` | — → 2 (0) | — → 0 | — → 0 | |
| Ide.Codesys | 620 (420) → 623 (423) | 73 → 70 | 5 → 5 | 305 (49) → 307 (49) |
| Ide.Twincat | 768 (207) → 778 (214) | 83 → 84 | 17 → 17 | 422 (70) → 457 (77) |
| Contracts + Wire | 88 (14) → 89 (14) | 25 → 25 | 0 → 0 | 17 (5) → 17 (5) |

Ratchets (`test/Volt.Repo.Gates`): family codes in `Ide/I*.cs` and `Sync/` 38 → 1 (`PushedText`, the CLI's side of the
wire); new-vendor names 33 → 33; path-comparer sites 108 → 108; `Seam/` pinned at zero vendor, NWL and family-code
symbols.

| criterion | Engine (+Host) | Ide.Codesys | Ide.Twincat | Contracts + Wire |
|---|---|---|---|---|
| placement | 6 → 8 → **7**: E5/T1 fixed (no host references `Volt.Engine.Sync`); `Seam/` holds the contract and nothing else; E1 open (the host kit `InterfaceAccessorGuard`, `MeasuredNames`, `ExcludedFolder`, `BothVendorsRefusedNames` and `DIALECT.md` stay in `Ide/`); E3 open (NWL-shaped `Format/Network`, `NwlMembers`) | 7 → 8 → **8**: the contract facet (`CodesysDriver.Seam.cs`) states the host's declaration; C2, C3 open | 6 → 8 → **7**: T1 fixed; T2 open (4 production branches for the doubles' shape) | 6 → 8 → **6**: W1, W2 open |
| duplication | 6 → 8 → **6**: `IsAbstract` ×2 (`BodyFormatGuard.cs:255`, `AbstractMemberFold.cs:75`), `RejectAll` ×2 (`PushService.cs:119,135`), no single path comparer (108 pinned sites) — all 2.x, not done | 5 → 7 → **5**: C1 ×3 open; D1–D3 untouched (no family layer, owner) | 4 → 7 → **4**: T3, T4 open | 8 → 8 → **8** |
| vendor-neutrality above the contract | 3 → 7–8 → **6**: the contract is vendor-neutral (strings, languages, declared keys; E4 fixed), each process's catalog is its host's declaration (F3), family codes above it 38 → 1, the third vendor runs over the pipe; but 25 code lines still name NWL (E3) and the IEC code table (`ItemKind`) still lives in the Engine for the hosts | 9 → 9 → **9** | 8 → 9 → **9**: T1 fixed | 5 → 7–8 → **5**: `Vendors`, `PipeNames` per vendor (W1) |
| legacy | 6 → 8 → **6**: history comments 82 → 83 by the proxy (the step-5–7 narration removed in step 8, others untouched); 7 PLCopen; `IsVerbatimKind` untested | 6 → 8 → **6**: 73 → 70; C4 partly (`NwlInterop.Int`, `CodesysPlatform.All` deleted; `KnownOn` kept for the owner) | 5 → 8 → **5**: 83 → 84, 17 PLCopen; T6 forwarder deleted | 6 → 7 → **6**: W4 open |
| test strength | 7 → 8 → **8**: 1292 → 1364 facts; the contract suite (173 cases) and per-cell wire transcripts gate every step; a third vendor outside the CODESYS family passes the transport suite; `ExpectRed` marks 0; `FakeIde` implements the contract | 7 → 8 → **7**: the flaky rebuild-loss test fixed (non-parallel collection); C5 fallbacks still have no red test | 6 → 7 → **6.5**: 422 → 457 facts; T2 doubles still shape the product; T5 untested | 4 → 7–8 → **4**: 17 facts, none on `WireJson`/`PushOp` |
| public-API robustness | 5 → 7 → **7**: P1 fixed (`OpGuard.RequireBinding`: a write names its project), P2 and P5 fixed in 0.1.17931, the five contract-suite defects closed (four refusals now `BAD_REQUEST`, a quoted `ifVersion` on a missing item `ITEM_MISSING`); P3 open (`OpGuard.cs:55` compares the project name `Ordinal`), P4 open (no protocol on a request) | 6 → 7 → **6**: C5 open | 6 → 7 → **6**: T5 open | 5 → 7–8 → **6**: P2, P5 fixed; P4 open |
| size | 5 → 6–7 → **5**: 10,239 code (+846 over the rework); `PushService.cs` still the largest file | 6 → 6 → **6**: 3,858 | 5 → 5 → **5**: 5,824 | 6 → 6 → **6** |
| **overall** | 5 → ~8 → **6.5** | 6.5 → ~8 → **6.5** | 5.5 → ~7.5 → **6** | 6 → ~8 → **6** |

### Why "after" is below "potential"

The potential assumed the whole programme: steps 3–8 **and** the 2.x finds. What is done is the contract and both hosts
on it (the vendor-neutrality and placement levers), the public-API fixes and the documents. What is not, and moves the
remaining points:

- **2.x, offline, not run systematically**: the history sweep (the proxy still counts 83/70/84 lines), the Engine
  duplications (`IsAbstract`, `RejectAll`, one path comparer), C1, T3/T4, the `IsVerbatimKind` test-or-delete.
- **Needs a live IDE**: the silent fallbacks C5 and T5, T2 (the doubles gaining `ProduceXml`), `CarryLive`, the e2e
  redundant-read cut and `ide-restart`.
- **Owner decisions**: E3 / D1–D3 (an NWL family layer below the contract — no shared CODESYS-family package so far),
  `CodesysPlatform.Capability.KnownOn` (keep as the measurement record, or delete).
- **Wire, protocol 2** (deferred, coordinated with PLC Assist): W1/W2 (vendor table, kind vocabulary in Contracts), P4,
  `networkText` → `languages`; plus P3 and `Contracts.Tests` from the OpenRPC document.

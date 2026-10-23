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

## 4.0c Quality rating again — before (1.0a) → potential (1.2) → 4.0b → now

Measured offline at `a6f543b665` (2026-10-23: after 2.1–2.4, 3.1a, 3.1b, 3.3), with `rating-measure.sh` and
`rating-pins.sh` beside this page (the 1.0a regexes, mechanically). Run on 4.0b's commit `08167c8bfc` the scripts give
4.0b's numbers (Engine+Host 10,466 code, 309 vendor lines, 83 history, 1,364 facts), so the two columns compare.
Every row below is the scripts' output on the two commits except T4's file lengths (`wc -l`) and the named sites in parentheses. One 4.0b number was low: it counted 2
`IsAbstract` copies, but `08167c8bfc` had 3 definitions — `StReader.MemberHeaderIsAbstract` was the third, and the
survivor (the script's regex now matches any `static bool …IsAbstract(string`, so it is counted on both commits).
**Not yet after "the rest of 3.1"**: the Engine history lines, `FamilyContent.cs:104`'s refusal text and T4 are still
open (3.1, unticked); re-run both scripts when they land.

| count | 4.0b `08167c8bfc` | now `a6f543b665` |
|---|---|---|
| Engine+Host code / comment / blank | 10,466 / 5,340 / 1,578 | 10,393 / 5,284 / 1,575 |
| Ide.Codesys | 3,858 / 2,251 / 494 | 3,848 / 2,192 / 496 |
| Ide.Twincat | 5,824 / 3,320 / 842 | 5,827 / 3,240 / 841 |
| Contracts; Wire | 632 / 737 / 194; 529 / 210 / 80 | 664 / 717 / 197; 529 / 207 / 80 |
| vendor lines (code): Engine / Codesys / Twincat / Contracts+Wire | 309 (25) / 623 (423) / 778 (214) / 89 (14) | 308 (25) / 617 (424) / 766 (216) / 89 (14) |
| history comments: Engine / Codesys / Twincat / Contracts / Wire | 83 / 70 / 84 / 19 / 6 | **34 / 18 / 21 / 7 / 2** |
| PLCopen: Engine / Codesys / Twincat | 7 / 5 / 17 | 3 / 3 / 3 |
| test facts (files): Engine / Codesys / Twincat / Contracts | 1364 (161) / 307 (49) / 457 (77) / 17 (5) | 1354 (161) / 318 (51) / 463 (77) / 20 (6) |
| `IsAbstract` definitions; `"push-reject"` walks | 3 (`BodyFormatGuard`, `AbstractMemberFold`, `StReader.MemberHeaderIsAbstract`); 2 | 1 (`StReader.MemberHeaderIsAbstract`); 1 |
| path-comparer ratchet; exception→code ratchet | 108 (25 files); 15 (7) | **37 (19)**; 10 (6) |
| new-vendor ratchet: vendor symbols; family codes | 33 (8 files); 1 | 33 (8); 1 — unchanged |
| minter up-reach (a host calling `Versioning.PathOf`) | 1 | 1 (`BeckhoffDriver.Tree.cs:597`) |
| C1 `GetObjectToModify` code lines; T3 `Bits` | 6; 2 | 2 (one `Modify`); 1 |
| C2 `List<object>` lines; C3 `ParseLine/Column`; D1 `OutputSlots` definitions | 10; 4; 2 | 10; 4; 2 — unchanged (`CodesysNetworkWriter.cs:646`, `TcArchiveBuilder.cs:324`) |
| T4: `TcNetworkWriter` + `TcArchiveBuilder` + `TcArchiveWriter` lines | 1,160 + 502 + 217 | 1,099 + 487 + 217 |
| `?? ""` code lines: Engine / Codesys / Twincat | 55 / 30 / 37 | 55 / 29 / 37 |
| largest file | `PushService.cs` 2,113 | `PushService.cs` 2,143 |

**Correction to 4.0b.** 4.0b scored Engine placement and TwinCAT neutrality on "E5/T1 fixed (no host references
`Volt.Engine.Sync`)". That is not so: `MinterUpReachPins` holds 1 — `BeckhoffDriver.Tree.cs:597` calls
`Volt.Engine.Sync.Versioning.PathOf` — and 6 more host code lines name `Volt.Engine.Sync` (`HostLink.Of`,
`ComposedSession.RowStatus`/`DefaultProbeThrottleMs`, `WorkerStart.cs`'s `using`). Those six are the composition the
design puts in the engine (F5, `HostLink`); the `PathOf` call is the E5 up-reach, still open. The scores below carry it.

| criterion | Engine (+Host) | Ide.Codesys | Ide.Twincat | Contracts + Wire |
|---|---|---|---|---|
| placement | 6 → 8 → 7 → **7**: E1 (host kit in `Ide/`: `InterfaceAccessorGuard`, `MeasuredNames`, `ExcludedFolder`, `BothVendorsRefusedNames`, `DIALECT.md`), E3 and E5 (the 1 `PathOf` up-reach) open | 7 → 8 → 8 → **8**: C2, C3 open | 6 → 8 → 7 → **7.5**: T2 fixed (3.1b: no production branch for the doubles' shape; "offline doubles" 5 → 1 mention); T1 open (the `PathOf` call) | 6 → 8 → 6 → **6**: W1, W2 open |
| duplication | 6 → 8 → 6 → **7.5**: one `IsAbstract`, one `RejectAll` walk, ONE path comparer (`ItemPath.SameItem`/`SameSpelling`, ratchet 108 → 37, the rest compare no wire path), exception→code 15 → 10 | 5 → 7 → 5 → **6**: C1 fixed (one `Modify`); D1–D3 untouched (no family layer) | 4 → 7 → 4 → **5**: T3 fixed (one `Bits`); T4 open (two writers, 1,803 lines); D1–D3 | 8 → 8 → 8 → **8** |
| vendor-neutrality above the contract | 3 → 7–8 → 6 → **6**: unchanged — 25 code lines name NWL (E3), the new-vendor ratchet still 33 + 1, `ItemKind`'s IEC/TREEITEMTYPE table in the Engine (E2) | 9 → 9 → 9 → **9** | 8 → 9 → 9 → **8.5**: T1 is not fixed (correction above) | 5 → 7–8 → 5 → **5**: `Vendors` (11 pinned symbols), per-vendor `PipeNames` minters (W1) |
| legacy | 6 → 8 → 6 → **7**: history 83 → 34, PLCopen 7 → 3, ARCH FOLLOW-UP 1 → 0, the network-text v1 detector deleted, `IsVerbatimKind` pinned; 34 proxy lines and `FamilyContent.cs:104` left (the rest of 3.1) | 6 → 8 → 6 → **7.5**: history 70 → 18, PLCopen 5 → 3, `KnownOn` deleted; C3 scraper still there | 5 → 8 → 5 → **7**: history 84 → 21, PLCopen 17 → 3, `ImportedPinName` deleted | 6 → 7 → 6 → **7.5**: history 25 → 9 (W4 mostly done) |
| test strength | 7 → 8 → 8 → **8**: 1,354 facts (−10: the v1 tests went with the detector; `FallbackRefusalTests` added); contract suite, transcripts, vendor-parity cell | 7 → 8 → 7 → **8**: C5 each red-first (`CodesysLibraryRefReadTests`, `CodesysTaskCallListRefusalTests`, `CodesysContainerRefusalTests`, `CodesysLibrarySignatureVarsTests`); 318 facts | 6 → 7 → 6.5 → **7.5**: the doubles answer `ProduceXml` and no longer shape the product (T2); T5 measured live; 463 facts; `ide-restart` live | 4 → 7–8 → 4 → **5.5**: 20 facts in 6 files, `RequestNullTests` on the strict reader; still none on `PushOp` polymorphism/DTO shapes from the OpenRPC document |
| public-API robustness | 5 → 7 → 7 → **7.5**: 2.4's three root causes refused (schema null, a `to` of another kind, a path `refs` cannot publish); P3 (`OpGuard.cs:55`, `BridgePipeHost.cs:179` compare the project name `Ordinal`), P4 open | 6 → 7 → 6 → **7**: C5 refused by name (a library reference with no identity, a facet without `pous`, a folder with no object manager) | 6 → 7 → 6 → **7**: T5 (unparseable device XML refused; binder miss measured correct, D35); the untyped library pin refused; `servedDirty ?? false` recorded for protocol 2 | 5 → 7–8 → 6 → **6.5**: a null entry's refusal keeps its index (`$.ops[1].bogus`); P4 open |
| size | 5 → 6–7 → 5 → **5**: 10,393 code (−73 since 4.0b); `PushService.cs` 2,143 lines | 6 → 6 → 6 → **6**: 3,848 | 5 → 5 → 5 → **5**: 5,827 | 6 → 6 → 6 → **6** |
| **overall** (mean of the seven) | 5 → ~8 → 6.5 → **7** (6.9) | 6.5 → ~8 → 6.5 → **7.5** (7.4) | 5.5 → ~7.5 → 6 → **7** (6.8) | 6 → ~8 → 6 → **6.5** (6.4) |

### What still keeps "now" below "potential"

- **The rest of 3.1** (offline): 34 Engine history lines by the proxy, `FamilyContent.cs:104`'s refusal text, T4 (one
  TwinCAT network writer).
- **Not on any list yet**: E5/T1 — the one `Versioning.PathOf` up-reach (`BeckhoffDriver.Tree.cs:597`, pinned 1); E1
  (the host kit in `Engine/Ide/`); C2 (typed diagnostic record) and C3 (`ParseLine`/`ParseColumn` filed in
  `Libraries.cs`); 37 path-comparer and 10 exception→code sites still pinned; `PushService.cs` grew to 2,143 lines.
- **Owner decisions**: E3 / D1–D3 (an NWL family layer below the contract). The new-vendor ratchet cannot reach zero
  without it: 17 of its 33 symbols are `Format/Network` (`NwlMembers`, the `"NWL"` view word).
- **Wire, protocol 2**: W1/W2 (11 of the 33 symbols are `Vendors.cs`), P3, P4, the nullable `dirty`,
  `Contracts.Tests` from the OpenRPC document. The CLI's 5 symbols and `PushedText`'s family code are the
  front-of-wire phase.

# Quality rating AFTER wire-final-shape (task 5.0) — 2026-10-24

Same scripts, criteria and scale as the archived rework (`archive/2026-10-24-volt-cli-rework/input/rating-measure.sh`,
`rating-pins.sh`, `rating-after.md`), run offline on the tree of this change's last code step (`5be5efd372` plus steps
3.6b, 4.1 and 4.3b). "Before" is the rework's final column (7 / 7.5 / 7 / 6.5).

## Counts (scripts, before → after)

| count | rework `a6f543b665`/`7ca0a68a44` | now |
|---|---|---|
| Engine+Host code / comment / blank | 10,393 / 5,275 / 1,575 | 10,569 / 5,369 / 1,595 |
| Ide.Codesys | 3,848 / 2,192 / 496 | 3,898 / 2,243 / 502 |
| Ide.Twincat | 5,827 / 3,234 / 841 | 5,874 / 3,260 / 847 |
| Contracts; Wire | 664 / 717 / 197; 529 / 207 / 80 | 678 / 738 / 207; 555 / 222 / 86 |
| vendor lines (code): Engine / Codesys / Twincat / Contracts / Wire | 308 (25) / 617 (424) / 766 (216) / 89 (14) Contracts+Wire | 309 (25) / 624 (429) / 768 (216) / 45 (0) / 18 (0) |
| history comments: Engine / Codesys / Twincat / Contracts / Wire | 29 / 3 / 16 / 7 / 2 | 33 / 3 / 16 / 8 / 3 |
| test facts (files): Engine / Codesys / Twincat / Contracts / Repo.Gates | 1354 (161) / 318 (51) / 463 (77) / 20 (6) / — | 1388 (165) / 329 (53) / 473 (78) / 29 (5) / 130 (24) |
| new-vendor ratchet: vendor symbols; family codes | 33 (8 files); 1 | **17 (5 files)**; 1 |
| path comparer; exception→code | 37 (19); 10 (6) | 36 (19); 11 (8) |
| protocol seam pins | — | 3 (2 files) |
| `ParseLine`/`ParseColumn` (C3) | 4 | **0** (the CODESYS position scrape deleted, 3b) |
| uncoded `throw new` in `src/` (outside Contracts, CLI) | 151 (3c measure) | **0** (3c; every site coded, an invariant, or caught inside) |
| largest file | `PushService.cs` 2,143 | `PushService.cs` 2,245 |

## Scores (before → after, each move tied to its evidence)

| criterion | Engine (+Host) | Ide.Codesys | Ide.Twincat | Contracts + Wire |
|---|---|---|---|---|
| placement | 7 → **7**: the catalog (`languages`, `kinds`, vendors) is each host's declaration read through `Seam/`; E1, E3, E5 (the 1 `PathOf` up-reach) still open | 8 → **8** | 7.5 → **7.5**: T1 open | 6 → **8**: W1 fixed (`Vendors.cs` left Contracts; one `PipeNames.Instance` minter), W2 fixed (the schema's enums generated from the hosts' declarations, `DocDataTests`) |
| duplication | 7.5 → **7.5**: one placement rule for a build line (`IItemFormat.LineOf` over `StWriter.Lines`, pinned against the writer's own text) instead of a per-vendor guess; path comparer 37 → 36 | 6 → **6** | 5 → **5**: T4 open | 8 → **8** |
| vendor-neutrality above the contract | 6 → **6.5**: new-vendor symbols 33 → 17; a build line is placed by the format, not by a vendor rule; 25 NWL code lines (E3) remain | 9 → **9** | 8.5 → **8.5** | 5 → **8**: no vendor list in Contracts (45 vendor-word lines, 0 of them code), the vendor/kind/language enums come from the declarations |
| legacy | 7.5 → **7.5**: history 29 → 33 (domain words; the step-3 comments are present-tense) | 8 → **8** | 7.5 → **7.5** | 7.5 → **7.5**: history 9 → 11; `wire.html`'s history paragraphs and prose counts deleted (3.9) |
| test strength | 8 → **8**: 1,354 → 1,388 facts; `BuildDiagnosticLineTests`, `StWriterLinesTests`, `PushSourceTextBomTests`; the live suite migrated to the new shape (`landed`, `removed`, NOT_ATTEMPTED, the lease frame) and green on TwinCAT 3.1.4024 and CODESYS 3.5.21.40 | 8 → **8**: 318 → 329 | 7.5 → **8**: 463 → 473; the build line asserted live against the fetched text (`build-diagnostics.test.ts`) | 5.5 → **7**: 20 → 29 facts (`WireFinalShapeTests`, the strict envelope, the null frame), the OpenRPC contract suite (173 cases) green on both vendors against the new document |
| public-API robustness | 7.5 → **8.5**: INTERNAL_ERROR only for a Volt bug (151 uncoded throws → 0); every request states its protocol and is refused by name otherwise; a push receipt updates a baseline; one coordinate system for every line on the wire (3.6b); a BOM in `sourceText` refused BAD_REQUEST (4.3b) | 7 → **7.5**: binder failures coded IDE_UNSUPPORTED, a null name unwalks its folder (3c); no invented position (C3 deleted) | 7 → **7.5**: `dirty` absent when unanswered, severity from a declared table, the build line in the item's coordinates | 6.5 → **8.5**: P3 (name compared like a path) and P4 (protocol on every request, strict envelope) fixed; a frame that is no object is BAD_REQUEST |
| size | 5 → **5**: 10,569 code (+176); `PushService.cs` 2,245 | 6 → **6**: 3,898 | 5 → **5**: 5,874 | 6 → **6**: 1,233 |
| **overall** (mean of the seven) | 7 → **7** (7.1) | 7.5 → **7.5** (7.5) | 7 → **7** (7.0) | 6.5 → **7.5** (7.6) |

## What keeps it there

- **Engine / TwinCAT**: E1, E3 (NWL family layer, owner), E5/T1 (the `PathOf` up-reach), T4 (two TwinCAT network writers),
  `PushService.cs` growing (2,245 lines).
- **4.3b, open for the owner**: the item text's canonical layout (one blank line before a POU's END line, `\n` line ends)
  is Volt's and a pushed text without it comes back different — see tasks 4.3b.

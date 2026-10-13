## 0. Census

- [x] 0.1 Schema census per item kind, per vendor (runs BEFORE `ld-fbd-coverage`, owner 2026-10-12: the item frame and
      contract are the foundation the LD/FBD build sits on; NWL members inside a body are out of scope here). CODESYS: every
      class the six corpora hold (POU classes incl. check functions, method/property/accessor classes, DUT and text-list
      enum, GVL/NVL/persistent/parameter list, task, library-manager item, device, text list, visualization) — every
      serialized member and every object-level property (build properties, comment, flags). TwinCAT: every attribute and
      element of `.TcPOU/.TcDUT/.TcGVL/.TcIO/.TcTTO` and the `.plcproj` per-item entries (ExcludeFromBuild, LinkAlways,
      SubType, SpecialFunc). Each member's value distribution over the corpora. A measure, not a probe script.

      **Measured 2026-10-13** — method, every table and 16 findings in design.md §0.1. CODESYS SP21 Patch 4: a scratch
      runscript (own `--noUI` CODESYS, project COPIES, not kept) read the vendor's own archive
      (`SerializableValueNames` / `GetSerializableValue` of every `IMetaObject`, its `IObjectProperty`s and the object)
      of every object in the five CODESYS corpora's project files, plus the class list of every loaded `IObject` /
      `IObjectProperty` with its `[DefaultSerialization]` members (0-occurrence classes decided too). TwinCAT: the
      XML of Project14 (the `twincat-project14` corpus; Project13 and the tc-pou fixtures as a supplement), offline.

      | | CTP | bak | awa | pro | len | total |
      |---|---|---|---|---|---|---|
      | CODESYS objects (`GetAllObjects`) | 16 | 214 | 118 | 3363 | 371 | **4082** |
      | object classes seen / loaded | | | | | | **37 / 104** |
      | property classes seen / loaded | | | | | | **13 / 37** |

      Headline counts (proposal findings, now measured): **`ExcludeFromBuild = true` on 11 source objects** (pro 3 POUs,
      7 methods, 1 check function; len 1 POU) **+ 4 folders** (pro); **`LinkAlways = true` on 3 GVLs**;
      `MemoryReserveForOnlineChange = 200` on 15 POUs; `External` / `EnableSystemCall` true 0. **Folded classes**:
      `POUObjectCheckFunction` 15 (10 distinct checks), `TextListEnumerationObject` 3, `NVLObject` 1, a sender
      `GVLObject` with `NetVarProperties` 1, `VarPersistentObject` 4, `AbstractPOUMethodObject` 10; parameter list,
      task-local GVL, `TransitionObject`: 0. **Accessor `IsGet`** is an archived member (340 + 112 accessors).
      **Tasks** 13: 0 event / 0 external-event tasks, 3 disabled watchdogs with values behind the flag (`3200` µs ×2),
      19 call entries all with an empty comment, 1 Task-Configuration system event (len) no item carries. **Object
      properties beyond the proposal's list**: `POUImageProperty` 2 (449 KB each), `FileLink` 1 (a GVL linked to an
      external file); `DocumentationProperty` (object comment) and `ObjectAccessProperty` exist with 0 occurrences.
      Library items (all 264 walked): `SystemLibrary` true 142 / false 122, `LinkAllContent` 5, `QualifiedOnly` 1 — not
      in the manifest. SFC: no SFC body in the four real corpora; the fixture's one transition is embedded in its body.
      **TwinCAT corpus (the 13 files the `.plcproj`s compile): `SpecialFunc="None"` on 8/8 POUs, `<ObjectProperties>` on
      3 objects — an `XmlArchive` with one `SFCProperty` (the class CODESYS archives too) on 1 POU + 1 action, empty on
      1 task —, `.plcproj` per-item entries carry only `SubType Code` (13/13) — 0 ExcludeFromBuild / LinkAlways, no
      `.TcIO`**: the TwinCAT object-property carrier has a witness (the SFC property); the special class and the build
      properties have none and need fixtures and probe rows (1.3, 2.2).

      **Review fixes (gate step 0, 2026-10-13)** — all six findings held; none skipped. A census correction has no
      failing test to write first (it changes measurements, not code); each was re-measured instead:
      1. TwinCAT `<ObjectProperties>` re-walked with its `XmlArchive` (finding 13 + a carrier table): `SFCProperty` on
         `VltFixtureSfc` (15 flags, `UseDefaults false`) and `VltFixtureMembers.SfcRun` (14 flags, `UseDefaults true`),
         `Version 3.4.2.0` / `Namespace ""` against CODESYS `4.4.0.0` / `'IecSfc'`; empty only on `Untitled1/PlcTask.TcTTO`.
      2. A third CODESYS run (own `--noUI` CODESYS, project copies, 105 s) walks EVERY list element: library items
         105 → **264** (`SystemLibrary` 76/29 → **142/122**, `LinkAllContent` 2 → **5**, `QualifiedOnly` 1), the four
         library constants hold over 264/264, `PlaceholderRedirectionTable` 64 → 193, `SFCProperty.Flags` 12 → 15/15.
         Every CODESYS source-class table in design.md is regenerated from it; no row is a sample.
      3. §0.2 finding 8 gains the CODESYS fallbacks: library `Namespace ?? ""` / `SystemLibrary` missing → false /
         resolution `?? ""` / `Name ?? ""` (`CodesysObjectModel.Libraries.cs:94/104/105/110`) and every task field via
         `Str(o) ?? ""` (`CodesysObjectModel.Descriptors.cs:191`, used at `:171`, `:182-185`).
      4. TwinCAT counts over LOADED files only: 13 PLC files (8 POU, 2 DUT, 1 GVL, 2 task); the orphans
         `Untitled1/POUs/PLC_PRG.TcPOU`, `Untitled2/POU_PBD.TcPOU`, `Untitled2/POUs/ladder.TcPOU` listed and not
         counted (`SpecialFunc` 11/11 → 8/8, `LineIds` 6 → 5 in 4 files, 9 → 8 entries); `Untitled1` compiles only
         its task; the corpus snapshot lacks `VltFixtureMembers` (the only action/method rows) — stated.
      5. The text-list enum walked at full depth: `Interface` (`VarDeclObject`, the declaration Volt spells) and a
         `TextListObject` of **109 rows** (`TextID` = enumerator, `TextDefault` = initializer, `""` on 71; 0 language
         texts, 0 languages) + 3 GUIDs — what a plain-DUT create discards (finding 3).
      6. Headline numbers reconciled: `Device` is 159 `DeviceObject`s (`DeviceProperty` 186 = 159 + 27 slots;
         `Disable true` 2 of 159); `BuildProperty` 56 = POU 28 + method 8 + folder 5 + image pool 5 + GVL 3 + DUT 2 +
         Application 2 + check 1 + property 1 + **the pro `Device` 1** (`ExcludeFromBuild false`) — the missing one.

      Gate (docs-only step: no fixture or transpiler change, fixture map untouched): typecheck green (5 packages),
      `openspec validate` valid, full LSP suite with `VOLT_REQUIRE_FULL=1` and `VOLT_FIXTURES` unset **10146 pass, 0
      fail** (34 skip, 428 todo, 360 files, 770 s), C# `Volt.Repo.Gates` 160/160, `Volt.Engine.Tests` 2371 pass, 0 fail
      (1 skip).
- [x] 0.2 The read/write inventory (the 2026-10-12 audit, proposal) as file:line in design.md, completed by 0.1.

      design.md §0.2: the seam vocabulary's gaps (`ItemContent`, `Member`, `Accessor`, the task format, the library
      manifest, the stub manifest), proposal findings 1-9 each to its read and write sites (line numbers re-verified
      at `01e4910c48`; two of the proposal's moved: `ARCHITECTURE.md` exclude-from-build is `:153-156`, the TwinCAT
      stub manifest `BeckhoffDriver.Content.cs:811-812`), the ten things the census adds that the audit did not see
      (member build properties, online-change reserve, POU images, file-linked GVL, sender-GVL net-var properties,
      system events, embedded files, library `LinkAllContent` / `QualifiedOnly`, device `Disable`, the 0-occurrence
      comment / access-rights properties), and the docs that contradict the code (for 4.1).

## 1. Design

- [x] 1.1 design.md: the disposition table — every member → spelled (its text form) / editor cache (its measurement) /
      refused by name; default SPELLED; 0-occurrence members decided too. The new `%`-line forms listed for the owner's
      close report.

      design.md §1.1 (2026-10-13): every census member decided per group — every object, object properties,
      classes (`%CLASS`), source-class members, tasks, library manager, non-items/stubs, TwinCAT files; 0-occurrence
      classes and properties refused by name ("niche: accepted loss (0 occurrences)"); the new forms and three owner
      decisions with a named default (object GUID, folder sibling order, CODESYS member order: not spelled) listed
      for the close report.
- [x] 1.2 The contract: an `ObjectProperties` carrier on `ItemContent` and `Member`; the `%`-line grammar (St reader,
      writer and the LSP's format layer); task `External event:` and call comments; transition member blocks.

      design.md §1.2: the `ObjectProperties` record (fields, required on `ItemContent` / `Member`), the `%`-line EBNF
      shared by St reader/writer and the LSP format layer (order, placement, refusals), migration (`format: 2`), task
      labels (`External event:`, `Watchdog: off …`, `Calls: A // comment`, off-default members), transitions —
      standalone ones refused by name instead of member blocks (0 in the corpora, recorded niche) — and re-type/rename.
- [x] 1.3 The measurements as `vendor-facts` rows, both vendors: `tc-special-classes`, `tc-dut-create-reload`,
      `tc-itf-accessor-decl`, `create-each-class`, `member-order`, `trailing-newline-cache`, `folder-order`,
      `watchdog-off-values`, `abstract-member-equivalence`; DIALECT rows updated.

      Recorded 2026-10-13 on instance `bridge-one-to-one` (SP21 Patch 4; TcXaeShell 15.0), a second run each agreed
      fact for fact: the nine rows + `editor-caches` (the design's cache rows) + `tc-library-system`; 211 CODESYS and
      229 TwinCAT snapshot lines added, none changed. Table vocabulary: a script `create` may name `factory` /
      `vendorClass` + `init` (CODESYS only, validated, unit-tested); the TwinCAT core reads an XML attribute's value.
      DIALECT: C2r, C2s, C34-C37 new; C2e, D21 marker + finding. Results and decisions: design.md §1.3.

      **Review fixes (gate step 1, 2026-10-13)** — all eleven findings held; none skipped. Seven are design decisions
      (no code yet, so no failing test to write first); four needed a measurement, re-recorded on instance
      `bridge-one-to-one` (CODESYS SP21 Patch 4, TcXaeShell 15.0) and re-run without `--write`: agreed fact for fact.
      The one table-vocabulary change (`dataType` on a property create) got its failing unit test first.
      1. `%`-lines vs direct addresses: only `%` + a closed key (ending at a space or the line's end) is a property
         line; any other `%…` line is code (the corpora's 4 `%QB1 := …` lines, bakon-nano `OutputControl.pou:50-54`);
         the unknown-key and lower-case-key refusals deleted (§1.2).
      2. Watchdog: ONE spelling, `[off ]<time> <unit> (sensitivity <n>)`, `''` for an empty member, bare `off`
         TwinCAT-only. Measured (`watchdog-off-values` extended): unit `µs` set before disabling is kept @disabled and
         @reloaded; the fixture task as found is the empty-time case (`''`, `ms`, `1`, disabled).
      3. TwinCAT and the object-property lines: no measured member, so a push carrying any key is refused by name and
         a pull of an item with a `.plcproj` build entry other than `SubType` (or a non-SFC `<ObjectProperties>`) is
         refused by name, until a probe row measures it (§1.1).
      4. TwinCAT `%CLASS CHECK`: refused only on a create or a class change; the pull refuses any `SpecialFunc` but
         `None` by name (vocabulary unmeasured) — §1.1, §1.3, DIALECT C2s.
      5. Text-list rows (new row `textlist-enum-edit`): both columns of every row read; a push removing `Green` drops
         its row, renaming `Blue` → `Cyan` rewrites its ID, the same 3 rows after reload, `RemovedTextListEntries`
         count 0 throughout — the cache decision holds; DIALECT C2r.
      6. `tc-library-system` re-read on each of `Tc2_Standard`, `Tc2_System`, `Tc3_Module` (subtrees whole, element
         and attribute xpaths on each): no system member on any; `.plcproj`s checked offline; the VSProperties
         `HideReference` / `PublishAll` / `QualifiedlAccessOnly` / `Optional` and `Tc2_System`'s parameter list newly
         seen and decided (refused off `False` until 3.3 measures a write); DIALECT C37.
      7. TwinCAT interface accessor `PUBLIC`/`VAR`/`END_VAR`: a measured constant (no write/read path, D21) spelled as
         the empty declaration CODESYS holds (D41) — wire parity; any other stored text refused by name; D21.
      8. `AbstractMemberFold` narrowed to a null/EMPTY body; a whitespace-only body is spelled verbatim (§1.1).
      9. Persistent list create: one decision — through the factory only if oracle 2.1 reproduces it, else refused.
      10. `%NETVAR`: sender members without `%CLASS NVL`, receiver members under it; `ReferenceGuidGVL` /
          `GuidTaskSlot` unspelled (vendor-minted GUIDs).
      11. `member-order` TwinCAT: the property now created with its type (`dataType: "INT"`, validator + unit test);
          TwinCAT reads `PROPERTY PUBLIC Beta : INT`, makes no accessors (CODESYS makes GET/SET); the driver's 611 vInfo
          quirk (`TcObjectModel.cs:405`) recorded for 3.3; DIALECT C34.

      Snapshots: CODESYS +1 row (`textlist-enum-edit`), `watchdog-off-values` +7 keys (52 lines differ); TwinCAT
      `member-order.fetched` (`: ST` → `: INT`) and `tc-library-system` +12 keys (16 differ). Gate (docs + probe step:
      no fixture or transpiler change, fixture map untouched): typecheck green (5 packages), `openspec validate` valid,
      full LSP suite with `VOLT_REQUIRE_FULL=1` and `VOLT_FIXTURES` unset **10146 pass, 0 fail** (34 skip, 428 todo,
      360 files, 798 s), volt-cli `test/unit` 80/80, C# `Volt.Repo.Gates` 160/160, `Volt.Engine.Tests` 2371 pass,
      0 fail (1 skip).

## 2. Oracles, red first

- [ ] 2.1 A completeness oracle per item kind: vendor object → text → push into a blank copy → re-read reproduces every
      non-cache member; a member the table does not list fails by name.
- [ ] 2.2 Red tests, one per audit finding (proposal 1-8), on FakeIde and on live e2e fixtures (CheckBounds, NVL, persistent
      list, text-list enum, abstract member rename, excluded POU, ExternalEvent task, call comment, transition).
- [ ] 2.3 A wire-parity gate: the same declaration gives byte-identical text on both vendors (stub manifests, library
      SYSTEM, interface accessors).

## 3. Build (refactor freely — owner)

- [ ] 3.1 The contract and the text format (engine, St reader/writer, the LSP format layer).
- [ ] 3.2 CODESYS driver: read and write every spelled member; classes kept on create, or refused by name.
- [ ] 3.3 TwinCAT driver: the same; TaskDef members; library SYSTEM read; interface accessor declarations.
- [ ] 3.4 Push: member re-type/rename keeps the object where the vendor allows, else refused by name.
- [ ] 3.5 Every fallback of proposal (8) deleted — refused or spelled.

## 4. Close

- [ ] 4.1 Docs regenerated (`VOLT_WRITE_DOCS=1`) and the prose of `items.html`, `driver.html`, `wire.html` rewritten;
      ARCHITECTURE.md (142-148, 220, 225, 396) and DIALECT current.
- [ ] 4.2 Re-pull the six corpora on both vendors and diff: exactly the new spellings appear; e2e on both vendors (SP21 +
      TwinCAT together, so the parity suite runs); engine/driver/CLI suites and the full LSP suite cold green.
- [ ] 4.3 The close report lists every new text form for the owner; archive.

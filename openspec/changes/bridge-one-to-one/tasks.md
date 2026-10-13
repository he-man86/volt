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

- [x] 2.1 A completeness oracle per item kind: vendor object → text → push into a blank copy → re-read reproduces every
      non-cache member; a member the table does not list fails by name.

      `scripts/completeness.ts` + `disposition.table.ts` (§1.1 as data) + `completeness.known.ts`; the cores gained
      `archive` and `objects` reads (design §2.R). Run 2026-10-13 on instance `bridge-one-to-one`, each vendor twice (write,
      then verify: 0 unexpected, 0 stale): CODESYS 28 subjects (CodesysTestProject + Pro2193 copies) → **120 failing
      members over 18 classes** (60 lost by a create — build properties on items and members, the call comment, the
      external event, the text list —, 4 classes lost, 16 folded trailing newlines, 20 held-but-not-refused, 18 unmeasured
      caches, 1 update that MOVES an external event into `Event`); TwinCAT 12 subjects (Project14) → **4**. Offline logic
      `test/unit/completeness.test.ts` (18). Not exercised: NVL, sender GVL, FileLink, parameter list (no committed
      fixture holds them).

      **Review fixes (gate step 2, 2026-10-13)** — all seven findings held; none skipped; each got its failing test
      first (`test/unit/completeness.test.ts` 18 → 32 tests, `ExpectRedTests` 4 → 5). Details: design.md §2.R.
      1. Stale judged per SUBJECT: `completeness.known.ts` entries list the subjects (`<project>/<wire>`) that fail
         them; an `--only` run judges no other subject's entry, whatever its kind (live: `codesys --only
         VltOto_ExtTask.task` → 3 expected, 0 stale, exit 0).
      2. A refusal's kind keeps its markers (`[partiallyApplied]` / `[remains]` / `[renamedTo]`); a refused create
         that leaves the item behind is adopted and judged (`refusedCreateFindings`).
      3. TwinCAT archive byte-exact: no end-of-line normalization (`XmlTextReader.Normalization = false`), UTF-8 only,
         `$file#bom` / `$file#declaration` / `$file#comments` decided (spelled).
      4. `--write-known` rewrites only the subjects the run ran (`mergeKnown`).
      5. No silent empty read: `$names` / `meta.$names` / `$children` = `$unreadable` (CODESYS `_snames` / `_children`
         / `meta.Properties` by reflection that fails loud), checked before undecided; the `objects` read fails loud
         on both vendors (TwinCAT `ObjectsRead` lost its `catch { $null }`).
      6. The dead compare of a clean refused create removed; a judged-kind wire item no known class maps to is
         `UNCOVERED` and fails the run.
      7. `ExpectRed.Until<TRed>(task, finding, because, body)`: the named exception is the red only when its message
         holds the reason (the 8 descriptor-label marks name `'<label>' is not a task field`).

      Re-run on instance `bridge-one-to-one` (`--write-known` from an empty list, then a verify run each): CODESYS 28
      subjects → **127 keys / 226 subject pairs**, TwinCAT 12 → **5 keys / 8 pairs** — the previous 130 + 8 keys
      exactly, with the subject moved out of the four refused-create kinds; 0 unexpected, 0 stale, 0 uncovered, no
      unreadable value, no partial create, no new TwinCAT finding from the byte-exact read.
      Gate (oracle/test-tool step: no fixture or transpiler change, fixture map untouched): typecheck green (5
      packages), `openspec validate` valid, full LSP suite with `VOLT_REQUIRE_FULL=1` and `VOLT_FIXTURES` unset
      **10146 pass, 0 fail** (34 skip, 428 todo, 360 files, 786 s), volt-cli `test/unit` 112/112, C# `Volt.Engine.Tests`
      2456 pass, 0 fail (1 skip), `Volt.Ide.Codesys.Tests` 334, `Volt.Ide.Twincat.Tests` 461, `Volt.Cli.Tests` 266,
      `Volt.Connector.Tests` 119, `Volt.Contracts.Tests` 34, `Volt.Repo.Gates` 160 — all green.
- [x] 2.2 Red tests, one per audit finding (proposal 1-8), on FakeIde and on live e2e fixtures (CheckBounds, NVL, persistent
      list, text-list enum, abstract member rename, excluded POU, ExternalEvent task, call comment, transition).

      `ObjectProperties` record + `FakeIde.Item.Properties` + `ExpectRed` (test/shared). Engine
      `test/Volt.Engine.Tests/one-to-one`: 76 red + 4 green guards; drivers: CODESYS 11 red, TwinCAT 4 red; live
      `test/e2e/one-to-one`: CODESYS 10 `.failing`, TwinCAT 2 — all verified red live. Fixture objects authored by
      `scripts/author-one-to-one-fixture.py` into a copy of CodesysTestProject committed as `test/fixtures/CodesysOneToOne.project`
      (never CodesysTestProject itself: the LSP recorders' host and the vendor-facts rows' fixture — design §2.R review fixes; build clean; the check function is `CheckDivDInt`, no
      persistent list — design §2.R says why). (6) closed by measurement: no test.
- [x] 2.3 A wire-parity gate: the same declaration gives byte-identical text on both vendors (stub manifests, library
      SYSTEM, interface accessors).

      `test/shared/WireParityCases.cs` asserted by both drivers' doubles (stub manifests TwinCAT red ×2, library SYSTEM
      red on both, interface GET green on both); live `vendor-parity.test.ts`: library SYSTEM `.failing`, interface GET
      green, stub manifests skipped (no witness in either fixture). Decision for the owner: `SYSTEM` spelled only when
      true (design §2.R).

## 3. Build (refactor freely — owner)

- [x] 3.1 The contract and the text format (engine, St reader/writer, the LSP format layer).
- [x] 3.2 CODESYS driver: read and write every spelled member; classes kept on create, or refused by name.
- [x] 3.3 TwinCAT driver: the same; TaskDef members; library SYSTEM read; interface accessor declarations.
- [x] 3.4 Push: member re-type/rename keeps the object where the vendor allows, else refused by name.
- [x] 3.5 Every fallback of proposal (8) deleted — refused or spelled.

      Built as design.md §3 decides: `ObjectProperties` required on `ItemContent` / `Member`, the `%`-lines in the St
      reader/writer (`PropertyLines.cs`) and the LSP format layer (`frontend/syntax/format/object-properties.ts`, which
      replaces `folder.ts`), both drivers' reads and writes, classes made at the create (`CreateChild(…, ObjectClass?)`),
      the 1:1 member rename, the fallbacks of (8) refused or spelled. Every engine/driver `ExpectRed` mark (40 sites) and
      every live `it.failing` (14) removed. First review of step 3: findings 1-11 fixed, 10b skipped with its reason
      (design.md §3).

      **Second review (gate step 3, 2026-10-13)** — all five findings held; none skipped; each got its failing test
      first (design.md §3):
      1. An excluded folder is named with a known kind and its objects named one by one with their kind — the walk stays
         `Complete`, nothing beside the folder is blinded, a known object in it is kept, an op on one refused by name
         (`CodesysContainerRefusalTests`, +1).
      2. `RenamePairs` compares each accessor's `IMPLEMENTATION NONE` too: an abstract property (slotless GET) renamed
         into one whose GET has code is a delete and a create (`MemberRetypeRenameTests`, +1).
      3. A TwinCAT interface accessor storing an EMPTY declaration (vendor-saved `ITF1.TcIO`, 3.1.4024.16) pulls as the
         empty declaration (`TcObjectPropertiesTests`, +1).
      4. Only `ExcludeFromBuild` leaves a folder's objects unwalked; `LinkAlways` / defines list it and walk it (+1).
      5. `%CLASS PERSISTENT` / `%CLASS NVL` creates refused in the pre-flight (`ValidateProperties`), all-or-nothing
         (`CodesysObjectPropertiesTests`, +2; `WireVocabularyTests` census `CodesysDriver.Content.cs` UNSUPPORTED 3 → 4).

      Gate fixes the full suite found (all from step 3's own LSP work): `object-properties.ts` exported six names nobody
      imports (`dead-exports`), `format.test.ts` crossed the 600-line limit (its last five tests moved to
      `print.test.ts`), and `call-parameters.test.ts` timed out on bun's 5s default under suite load (5.1 s, 5.7 s;
      the same at the pre-step-3 commit `c99a646580`) — given a budget proportional to the work as `map.test.ts` /
      `source-map.test.ts` have, after profiling it linear (lowering 2.6 s, assembling 0.8 s over 5850 fixtures).
      Note: commit `2b538cc583` (another session) carried this step's deletion of `folder.ts` without its replacement,
      so HEAD did not load the LSP; this commit adds `object-properties.ts` back beside it.

      Gate (no fixture or transpiler change, fixture map untouched): typecheck green (5 packages), lint green, `openspec
      validate` valid, full LSP suite with `VOLT_REQUIRE_FULL=1` and `VOLT_FIXTURES` unset **10149 pass, 0 fail** (34 skip, 428 todo, 360 files, 957 s), volt-cli
      `test/unit` 112/112, C# `Volt.Engine.Tests` 2521 pass, 0 fail (1 skip), `Volt.Ide.Codesys.Tests` 367,
      `Volt.Ide.Twincat.Tests` 478, `Volt.Cli.Tests` 267, `Volt.Connector.Tests` 119, `Volt.Contracts.Tests` 34,
      `Volt.Repo.Gates` 160 — all green. Live e2e and the completeness oracle are not re-run here (4.2 runs them on both
      vendors).

## 4. Close

- [x] 4.1 Docs regenerated (`VOLT_WRITE_DOCS=1`) and the prose of `items.html`, `driver.html`, `wire.html` rewritten;
      ARCHITECTURE.md (142-148, 220, 225, 396) and DIALECT current.

      **Done 2026-10-13 (step 4a).** Regenerated: the doc data had not drifted (the gate was green before), so the
      `%`-lines became GENERATED facts — `DocDataTests.BuildObjectProperties` writes `objectProperties` into
      `docs/assets/data.js` (each key with the line `PropertyLines.Write` emits for a fully populated record, never a
      hand-typed spelling, and a one-sentence meaning naming the vendor member), rendered by `doc.js`
      `object-properties`; test first: `Every_object_property_key_is_on_the_items_page_in_the_writers_spelling` (red:
      no generator, no page anchor; green after; `DocDataTests` 20 → 21). Prose: `items.html` — new "Object
      properties: the `%`-lines" section (the generated table, what a property line is, order, placement, absence, a
      member no key names, per-vendor, migration `format: 2`, classes at the create and the 1:1 rename), the POU END
      line (the `END_FUNCTION_BLOCK` fallback replaced by the by-name refusal), the DUT / text-list enum class, the
      parity sentence (gated by `WireParityCases` + `vendor-parity.test.ts`, refusals by name), the one-sided table
      (task members, `%`-lines, `%CLASS` creates, library `SYSTEM`, member/sibling order), the CODESYS classification
      rows (check / NVL / persistent / sender / parameter list, `IsGetAccessor`, standalone transitions refused) and the
      stub manifest; `wire.html` — the lede, a note on the text carrying `%`-lines (class at create, class change and
      member re-type refused, 1:1 rename), `UNSUPPORTED` and `INVALID_ST` rows; `driver.html` — six seam types
      (`ObjectProperties` row, `Properties` on `ItemContent` / `Member`), the class at the create
      (`CreateChild(…, ObjectClass?)`, `ValidateProperties`), the vendor table (TwinCAT's create door is `CreateChild`,
      not `PlcOpenImport` — stale before this change; object-properties row; library signatures: the surface exists,
      C2c). ARCHITECTURE.md: the name invariant (142-148: FULL on the wire, bare below the seam — it said the
      opposite), exclude-from-build (now spelled; excluded folders named), a new "one to one" invariant
      (`ObjectProperties`, `PropertyLines`, class at create, rename, `format: 2`), trailing newlines no longer an
      exception (C35), the accessor bullet (`IsGetAccessor`, interface accessor declarations per vendor, D21/D41),
      "Round-trips are lossless" (225) replaced by what round-trips and what is refused (completeness oracle, known
      divergences, wire-parity gate), lesson 12 (wire names carry no folder) and lesson 13 (396: `RefinePou` is gone;
      the walk guards each child, so a classifier refuses by name), and the `Item/` / `Format/St/` layer rows.
      DIALECT: every "today" in the step-1 rows made current — C2b (a created DUT's reload measured, C2e), C2r (the
      fold is history; which classes are created and which refused as a create, `AbstractMemberFold` null/empty only),
      C2s (`SpecialFunc` now read), D21 (built: the `.TcIO` read, the empty `ITF1.TcIO`, unsaved accessor refused),
      C34 (the 611 vInfo quirk kept, 10b), C35 (the trim is deleted), C36, C37 (`SYSTEM false` deleted, spelled where
      true). LSP docs: `architecture.md` (the format layer's `%`-lines), `behavior.md` (the formatter preserves every
      `%`-line).

      DOWNSTREAM (every consumer suite re-run once): C# `Volt.Engine.Tests` 2522 pass, 0 fail (1 skip; +1 the new doc
      test), `Volt.Ide.Codesys.Tests` 367, `Volt.Ide.Twincat.Tests` 478, `Volt.Cli.Tests` 267, `Volt.Connector.Tests`
      119, `Volt.Contracts.Tests` 34, `Volt.Repo.Gates` 160; volt-cli `test/unit` 112, volt-control 122, volt-vscode 38,
      volt-desktop 30; `bun run check` 18/18, typecheck (5 packages) and lint green; `openspec validate` valid. LSP:
      `test/frontend` 25 pass; `rate:fixtures` exit 0 with no change to `map.generated.ts`; `test/conformance` 6965
      pass, 1 FAIL — `fold-agreement.test.ts` timed out (5.57s in the suite, 5.08s alone; 34 disagree, 34 known: the
      verdict itself unchanged). Not a change of this step (docs only, no LSP source touched) and not a recording
      change: a regression of the suite's budget — the test lowers every fixture on bun's 5s default. Profiled
      first (scratch copy, deleted): linear (half the fixtures 2.9s of 5.0s; lowering 2.8s, assembling 0.9s, parse
      0.7s, bind 0.4s), the same profile `call-parameters.test.ts` had at gate 3, so it got the same fix — a budget
      proportional to the work (`Math.max(30_000, ALL_TESTS.length * 3)`, ~3x the measured cost); re-run green. No
      recording-decided improvement appeared (no consumer output changed).

      **Gate review of step 4a (2026-10-13)** — four findings fixed (each red first), one skipped with its reason:
      1. `items.html` said CODESYS "reads and writes every key"; the write refuses a `%NETVAR` / `%PARAMETER_LIST` /
         `%FILE_LINK` change by name (`RefuseUnwritablePropertyChange`). The Vendors bullet now says CODESYS reads every
         key and writes the build keys and `%COMMENT`, those three refused by name; the classes paragraph no longer says
         "an update of an existing one is written" of them. Test first:
         `The_items_page_names_every_property_change_the_codesys_push_refuses` (reads the refused keys from the driver
         source, requires each on `<li id="properties-vendors">` and no "writes every key"; red: no such item).
      2. SKIPPED — the finding is wrong. `FileLink.Linkage` IS the vendor member on SP21: reflected
         `_3S.CoDeSys.GVLObject.FileLink` (GVLObject.plugin.dll 3.5.21.40) has the properties `FileName`, `Linkage :
         LinkType`, `TimeStamp`; `LinkType` is the ENUM's name (`ImportBeforeCompile`, `ExportBeforeCompile`) and the
         archive's serializable value name, which is what the census (design.md §1.1 / §0) read. `NwlInterop.Declared`
         reads the CLR property, so `Linkage` is right and `LinkType` would throw Missing. The live corpus re-pull (4.2)
         still proves the spelling.
      3. The doc example was one record combining `%CLASS CHECK` with `%PARAMETER_LIST` / `%NETVAR` / `%FILE_LINK` —
         no object a pull reads. `BuildObjectProperties` now writes each key from realistic example objects (a check
         function, a method in a folder, a parameter list, a sending GVL, a receiving NVL, a GVL linked to a file), each
         row naming its object; the test holds every example to `ReadClass`'s class rule (red on the old record). The
         `%NETVAR` meaning names the sender's `NetVarProperties` on a GVL or `%CLASS PERSISTENT` list and, under
         `%CLASS NVL`, the receiver's members then `ImportNetVarProperties.<member>`.
      4. The doc test now requires at least one line per key (red: dropping the file-link example left `%FILE_LINK`
         with none).
      5. The fold-agreement budget is no hidden regression: timed in one scratch worktree, 02ed3f0e19 (the commit that
         last changed the test), c99a646580 (pre-step-3) and this step's base all took 10.6-11.7 s, and 02ed3f0e19
         already timed out at 5 s there — the cost did not move. The proportional budget stays; the measurement is in
         the test's comment.

      GATE 4a: typecheck green (5 packages), lint green, `bun run check` 18/18, `openspec validate` valid; C#
      `Volt.Engine.Tests` 2523 pass, 0 fail (1 skip; +1 the page-refusal test), `Volt.Ide.Codesys.Tests` 367,
      `Volt.Ide.Twincat.Tests` 478, `Volt.Cli.Tests` 267, `Volt.Connector.Tests` 119, `Volt.Contracts.Tests` 34,
      `Volt.Repo.Gates` 160; volt-cli `test/unit` 112; no fixture or transpiler change (fixture map untouched); full LSP
      suite with `VOLT_REQUIRE_FULL=1` and `VOLT_FIXTURES` unset **10149 pass, 0 fail** (34 skip, 428 todo, 360 files,
      1071 s).
- [x] 4.1b **Merge `hotfix/tc-hierarchy-x86` into dev BEFORE 4.2** (owner, 2026-10-13: the TwinCAT field fix — the Solution
      Explorer hierarchy is read by the x86 helper `VoltTwincatExplorer.exe` with XAE's own msenvp manifest; no Visual
      Studio dependency). Merge it (resolve the overlap in `StReader.cs` / `StDeclaration.cs`: the hotfix only adds
      `RegexOptions.CultureInvariant`), rebuild, and run 4.2's TwinCAT e2e on the merged code. The owner will then remove
      the dev machine's 64-bit msenvp registration (customer conditions), so TwinCAT e2e on unmerged code would fail.
      **Done 2026-10-13 (main session, after the agent's merge was refused by the permission layer):** merged as 2122cdff68, no
      conflicts; C# suites on the merged code: Repo.Gates 162, Engine 2527 (+1 skip), Twincat 490, Codesys 368, Cli 270,
      Connector 120 — all green. The TwinCAT half of 4.2 can now run.
- [ ] 4.2 Re-pull the six corpora on both vendors and diff: exactly the new spellings appear; e2e on both vendors (SP21 +
      TwinCAT together, so the parity suite runs); engine/driver/CLI suites and the full LSP suite cold green.

      **Step 4b, 2026-10-13 — CODESYS half done, TwinCAT half BLOCKED (4.1b not done).** The merge of
      `hotfix/tc-hierarchy-x86` was refused by the session's permission layer (a merge into `dev` is the owner's / gate's
      call), and the dev machine's 64-bit msenvp registration is already gone: `volt init` on the unmerged TwinCAT
      bridge (`-Fixture 14`, instance `bridge-one-to-one`) answers `the Solution Explorer hierarchy is unreadable …
      QueryService(SVsSolution) failed (0x80040154)`. So `twincat-project14` is NOT re-pulled, TwinCAT e2e and the
      vendor-parity suite did not run (parity skipped: no TwinCAT of this instance), and the TwinCAT completeness run was
      not made. Remaining after the merge: re-pull `twincat-project14`, TwinCAT e2e with CODESYS up (parity),
      `completeness.ts twincat`.

      **CODESYS re-pull** (`refresh:corpus`, instance `bridge-one-to-one`, the project files `refresh-corpus.ts` names).
      Every diff line classified by a scratch classifier (deleted). Two classes are NOT this change's and were reverted:
      the pulling IDE's library placeholder resolution (`Library Manager/(unresolved)/…` ⇄ resolved folders; 134 / 942 /
      921 / 948 / 940 byte-identical moves in CTP / bakon / awa / pro / len, 2 differing library files each, 4–175 library
      manifests and files appearing or vanishing — as in `abstract-member-parity` 3.3) and CTP's `VltFixtureMembers.pou`
      (a fixture object authored after the corpus was last pulled). What remains is exactly the new spellings:

      | | CTP | bakon | awa | pro2193 | lenze |
      |---|---|---|---|---|---|
      | `%CLASS CHECK` | | 5 | | 10 | |
      | `%CLASS PERSISTENT` / `NVL` / `TEXTLIST_ENUM` | | 1 / 1 / – | 1 / – / – | 1 / – / 3 | 1 / – / – |
      | `%EXCLUDE_FROM_BUILD` · `%LINK_ALWAYS` · `%ONLINE_CHANGE_RESERVE` | | | – · 1 · – | 11 · 1 · 15 | 1 · 1 · – |
      | `%NETVAR` · `%FILE_LINK` | | 32 · 1 | | | |
      | manifest `-SYSTEM false` · `+REDIRECT` · `LINKALLCONTENT`/`QUALIFIEDONLY` | 20 · 3 · 3 | 117 · 28 · 2 | 113 · 25 · 2 | 126 · 44 · 1 | 128 · 29 · 1 |
      | task `Watchdog:` members spelled | 1 | 3 | 1 | | |
      | device `Disabled:` | | 2 | | | |
      | trailing newlines kept (`+` blank lines / files) | 2 / 2 | 143 / 70 | 81 / 48 | 4278 / 518 | 270 / 141 |

      Watchdog forms seen: `off '' ms (sensitivity 1)`, `off 3200 µs (sensitivity 1)`, `T#15ms ms (sensitivity 1)`,
      `T#4ms '' (sensitivity 1)` — each member as the vendor holds it (for the owner's close report: a `T#` time with a
      unit beside it, and an empty unit, are the vendor's own values).

      **Finding 1 — fixed, test first: every check function was dropped from the pull.** bakon's 5 and pro2193's 10
      `POUObjectCheckFunction`s pulled UNREADABLE (`'POUObjectCheckFunction.POULevel' could not be read`) and the CLI said
      nothing (`volt init`/`pull` print no `unreadable` list; only `volt status` does). Measured (single-use runscript on a
      CodesysOneToOne copy, SP21 Patch 4, deleted): a check function's archive (`IArchivable.SerializableValueNames`) is
      `Implementation, Interface, SpecialFunc` — no `POULevel` (a POUObject's is the seven members design §0.1 lists); the
      census header had listed the CLASS's declared members. `RequireMeasuredConstants` no longer holds a check function to
      `POULevel`; `CodesysObjectPropertiesTests`' check-function double now archives what SP21 archives (red: the
      Unreadable; green after). design §0.1 / §3 corrected. Re-pulled: 5 + 10 `%CLASS CHECK` files, nothing else moved.

      **Finding 2 — by design, for the owner: 13 pro2193 objects leave the corpus.** They sit in four folders excluded
      from build ("Turn Around Magazine", "Wrap Magazine", "Peeling", "Stack Status"); design §3 (3) refuses such a folder
      by name and does not walk it, so a pull no longer materializes them (4 POUs with a body, DUTs, an interface, a
      visualization). Kept as pulled. Every LSP count that moved is exactly these 13 files (restoring them gives the old
      figures back on `test/frontend` and REACH): `corpus-lowering` REACH bodies 304 → 300 (lowered 53 unchanged), and
      the `test/frontend` baselines rewritten (`VOLT_WRITE_BASELINE=1`): files 29170 → 29158, bare name NONE 326 → 146,
      member NONE 590 → 531, ident_expr UNKNOWN 324 → 171, … (7 baseline files, 33 numbers, all down).

      **Conformance (the `%`-lines' rules).** The `%`-lines are no CODESYS syntax — the analyzer never sees them; their
      placement/order/repeat rules are Volt's push rules, covered by `object-properties.test.ts`. The CODESYS-observable
      rules they carry: `%EXCLUDE_FROM_BUILD` (CODESYS compiles nothing in the object) — the corpus gate (LSP findings ⊆ the recorded build) stays green with
      the 12 excluded objects (11 pro2193 — 6 files —, 1 lenze) in the corpus, so the
      disagreement (LSP analyzing an excluded object, binding to it from built code) has 0 occurrences: niche: accepted
      loss (0 occurrences in the corpora); the recorder's fixture format has no `%`-line path, so a recorded fixture
      would need recorder work first. `%CLASS CHECK` (implicit calls) is the transpiler's runtime, not this step's.

      **Numbers.** C# (Release): `Volt.Engine.Tests` 2523 pass / 1 skip, `Volt.Ide.Codesys.Tests` 367, `Volt.Ide.Twincat.Tests`
      478, `Volt.Cli.Tests` 267 (one run under the live re-pull's CPU load failed `Health_polls_across_two_bridges…` at
      15 s; green alone), `Volt.Connector.Tests` 119, `Volt.Contracts.Tests` 34, `Volt.Repo.Gates` 160; volt-cli
      `test/unit` 112. Live CODESYS SP21 (instance `bridge-one-to-one`): full e2e on CodesysTestProject **295 pass / 72
      skip / 0 fail** (367 tests, 233 s; vendor-parity skipped — no TwinCAT); `test/e2e/one-to-one` on CodesysOneToOne
      **11 pass / 3 skip / 0 fail**. Completeness oracle, CODESYS: 61 expected, **1 unexpected, 140 stale** (step 3's fixes
      never re-run live) → `--write-known` → verify run **62 expected, 0 unexpected, 0 stale, 0 uncovered**; known list
      CODESYS 127 keys → 43 (the one added: the persistent-list create, refused by name by design (7b)). Still held:
      `POUImageProperty` (2×, held but not refused), `TextBlobForSerialisation` caches citing no vendor-facts row, CFC/SFC
      creates refused. Full LSP suite COLD (`VOLT_RUSTC_CACHE=0`, `VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`): 10143 pass /
      6 fail (the 6 frontend baseline counts of finding 2) → after the rewrite `test/frontend` 25 / 0; `test/corpus`
      green; `rate:fixtures` exit 0, `map.generated.ts` unchanged; root typecheck, lint, `bun run check` 18/18 green.
      **Gate review of step 4b (2026-10-13)** — seven findings; six fixed (each red first), one triaged niche:
      1. FIXED — an item the pull left out was named nowhere a user looks: `volt init` printed no list, `pull` / `status`
         bare names under "could not read", the reason only in the bridge log (the 13 pro2193 objects in excluded
         folders left git without a word). The wire's `unreadable` (refs and fetch) now carries `{ name, reason }` per
         item (`UnreadableItem`; `VersionedItem.Unread`, `CountUnclassifiable` keep the driver's reason), and `volt init`
         (new `InitResult.Unreadable` / `UnwalkedFolders`), `pull` and `status` print `? <name>: <reason>` under "the IDE
         holds N item(s) volt did not pull … Each, and why:"; `status --json` carries the objects. Consumers moved with
         it: volt-control's `StatusJson.unreadable`, the LSP recorder's `held-as.ts`, the completeness oracle; docs data
         regenerated (`UnreadableItem` schema), logs.html and ARCHITECTURE.md say so. Test first:
         `BlackBoxTests.Init_pull_and_status_name_each_item_not_pulled_with_its_reason` (red: init printed nothing).
      2. NICHE — `POUImageProperty` (2 occurrences, both Pro2193, 449 KB each) has no text form, and a create from the
         text cannot refuse what no line marks; a marker line would be a new text form the owner has not approved. So:
         niche: accepted loss (2 occurrences in the corpora) — the pull logs item + property at Warn, an in-place push
         keeps the image, a create makes the POU without it. design §1.1's row says so (it claimed "a create that needs it
         refuses", which nothing can do), and the six known entries carry that reason. The reason had been LOST once
         already: `mergeKnown` dropped an entry whose every subject ran and re-made it from the run's first finding —
         fixed (a kept entry keeps its reviewed reason; test first: `keeps the reviewed reason of an entry whose every
         subject ran and still fails`, red).
      3. FIXED (recorded) — 101 CODESYS manifests (awa 23, bakon 23, CTP 4, lenze 25, pro2193 26) and 3 TwinCAT ones
         are in the retired spelling (`SYSTEM false`, no REDIRECT / LINKALLCONTENT / QUALIFIEDONLY line): this machine's
         CODESYS resolves those placeholders to `(unresolved)/`, so their re-pull was reverted (TwinCAT: not re-pulled,
         4.1b); and CTP lacks `VltFixtureMembers.pou` (authored 2026-09-28, after CTP's recorded build — adding it means
         re-recording that oracle, the next refresh's work). Not rewritten by hand (a recording is never adapted):
         `test/corpus/support/stale.ts` lists every such file per corpus with its reason, and the new
         `test/corpus/corpus-provenance.test.ts` holds the corpus to that list both ways (a new old-spelling file fails,
         so does a listed one a refresh rewrote). The LSP reads none of the lines that differ (no reader in `src/`).
         test/README.md and TESTING.md list it.
      4. FIXED — the trailing-newline key's only subject, `VltFixtureSfc`, was never RUN: its pull is refused (a
         standalone transition, step 3), so it was no wire item, no oracle candidate, and its 17 known entries (the
         newline, 16 "held transition") outlived every run unjudged. Every item the pull refuses is now a subject
         ("every item the pull refuses", `pickCodesys` / `pickTwincat` take the refs `unreadable` names; `fetchText`
         answers the wire's reason); test first: `takes every item the pull refuses` (red). The full live run judges
         VltFixtureSfc and the 13 excluded-folder objects as refused by name (three `$pull — pull refused` entries) and
         the 17 entries are gone — so no update folds a trailing newline (VltFixtureMembers, re-run alone: update
         accepted, no Text difference).
      5. FIXED — design §1.1 `POULevel` row: 436/436 POUs, a check function archives none (was "451/451").
      6. FIXED — the check-function double answers every name it archives (`Implementation`, `Interface`,
         `SpecialFunc` = its check); test first: `The_check_function_double_answers_every_member_its_archive_names` (red:
         KeyNotFoundException).
      7. FIXED, a real bug — the pipe server queued every connection on the THREAD POOL (the host's: CODESYS in-proc), so
         with the pool's threads blocked a request — `health` included — waited for the pool to inject one. Now a thread
         of its own per connection; test first: `PipeServeThreadTests.Health_answers_while_the_thread_pool_is_saturated`
         (red: no answer in 20 s with 216 pool items blocked; runs alone, its own collection). The completeness run then
         lost one pull to `connect ENOENT`: a short request could dispose its instance before the loop armed the next, and
         the pipe NAME lapsed. The next instance is armed before a connection is served; test first:
         `Back_to_back_calls_never_find_the_pipe_gone` (raw `CreateFileW`, red on the old order 213 / 38 lapses of 8000).

      GATE 4b: completeness oracle CODESYS (full, live SP21, instance `bridge-one-to-one-cmp`): `--write-known` then a
      verify run **75 expected, 0 unexpected, 0 stale, 0 uncovered** (CodesysOneToOne 10 subjects, Pro2193 30; known list
      CODESYS 43 → 29 keys: +3 `$pull — pull refused`, −17 VltFixtureSfc). C# (Release): `Volt.Engine.Tests` 2523 / 1
      skip, `Volt.Ide.Codesys.Tests` 368 (+1), `Volt.Ide.Twincat.Tests` 478, `Volt.Cli.Tests` 270 (+3), `Volt.Connector.Tests`
      119, `Volt.Contracts.Tests` 34, `Volt.Repo.Gates` 160; volt-cli `test/unit` 114 (+2); volt-control 137; root
      typecheck (5 packages), lint (0 errors), `bun run check` 18/18, `openspec validate` valid; no fixture or transpiler
      change (fixture map untouched); full LSP suite (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset) **10152 pass, 0 fail** (34 skip, 428 todo, 361 files — +1 the provenance test file — 762 s).
      TwinCAT half of 4.2 still blocked on 4.1b.
- [ ] 4.3 The close report lists every new text form for the owner; archive.

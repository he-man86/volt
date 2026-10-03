## 0. Design gate — do this first

- [x] 0.1 Verify the observation and confirm or refute PLCAssist's reading (see "Analyse first"); if refuted or intended, record why and stop. Then check each item of the proposal against volt's design: the `onlyItems` directed-preview contract
      (`FetchService.cs:44-49`, `:249-258`), the signature path's per-version immutability (archived
      `cache-library-signatures`), the precompile cost, the CLI's read-only library folders, and any open change that
      decides the same question. Record per item: FITS, or CONFLICTS + why + the volt-native alternative. Implement only
      the FITS items; leave the rest for the owner.
      **Done (gate, 2026-10-03, by code at `8d6912534b`; verdicts table in design.md §0, each citation re-read):**
      - Observation CONFIRMED: `FetchService.cs:210` `librariesRefreshed = onlyItems == null && …`; `:234` extracts only
        under it, so a directed `.library` read answers the manifest alone. Live reproduction is 1.1.
      - Reading CONFIRMED except "TwinCAT returns no signatures": REFUTED — `BeckhoffDriver.cs:228` →
        `TcObjectModel.cs:99` (`ProduceAllLibrarySignatures`, DIALECT C2c/D27: 234 signatures → 230 shipped on the
        fixture). The stale comment is `DriverBase.cs:149-151` (not 140-145); fixed in 2.2. Real gap: no other route.
      - (A) directed `.library` read returns its signatures — FITS. `removed` is already empty for any `onlyItems`
        (`:258`), so the "nothing outside the subset is removed" contract holds. `librariesRefreshed` MUST stay false
        on a directed read: `RefsFetch.cs:100-108` makes it "the complete set for EVERY library folder" and
        `IdeTree.cs:94` `DroppedLibraryFile` would delete the folders of libraries nobody named. Render only the
        signatures whose `LibraryPath` joins a NAMED library's RESOLUTION (`libByResolution` is already filled only
        for items inside the subset, `:149` before `:161`); passing all of them to `AppendLibrarySignatures` would
        put every other library under `(unresolved)` (`LibraryFetch.cs:61-65`). The `RefsFetch.cs:100-108` doc
        ("when it is not [set], … carries no signatures at all") becomes false and is reworded in 3.1.
        **Corrected by gate step 0 (R1 below):** an exact RESOLUTION join alone drops every library whose ref
        carries a WILDCARD resolution (`X, * (Vendor)`) — about 10% of each CODESYS corpus's library API. The join
        is ONE matcher shared by the full and the directed fetch, and it learns the wildcard (R1).
      - Session cache per RESOLUTION — CONFLICTS: archived `2026-07-22-cache-library-signatures` D1 rejected a
        session-scoped cache (Method A: "duplicates CODESYS's own warm-keeping; saves ~nothing") on the measurement
        cold 2469 ms / warm 97 ms (`Build(app)` a no-op warm). Volt-native alternative: none needed on CODESYS —
        1.2 measures a warm directed read on BOTH vendors; TwinCAT's warm `ProduceAllLibrarySignatures` cost is
        unmeasured, and only if it is costly does a cache go to the owner. spec.md's scenario, 2.3 and 3.1 are
        reworded accordingly (R5 below); the owner may still overrule the rejection.
      - Precompile cost — OPEN, not FITS (R2 below): "warm after the first" was measured with no edit in between
        (archived design.md:10, open question :75), and CODESYS's extraction runs `Build(app)` of the whole
        application in the engineer's live IDE (`CodesysObjectModel.Libraries.cs:183`). Neither vendor has a
        per-library call — CODESYS `AllPrecompiledSignatures`, TwinCAT's per-library `ProduceLibrarySignatures(VT_PTR)`
        unusable from an RCW, DIALECT C2c. 1.2 measures the edit-then-read case before 3.1 builds the route.
      - CLI read-only library folders — no workspace write. Both CLI `onlyItems` callers filter the answer by the
        names they asked for: `Commands.cs:934-938` (`.Where(i => differ.ContainsKey(i.Name))`, re-materialized
        pushed items) and `Commands.cs:1031-1035` (`volt show`, `FirstOrDefault(i => i.Name == name)`). Extra
        signature items reach no workspace write. **But not free (R3 below):** `volt show BRIDGE <…>.library` (the
        incoming diff pane on a drifted library) DOES send `onlyItems: [X.library]`, so after 3.1 each such open
        pays a full extraction and discards it.
      - Element addressed alone (`onlyItems: ["TON.fb"]`) — not routed, stays as today: signatures are path-identified
        (`RefsFetch.cs:102`), the client reads the library.
      - Open changes deciding the same question: none (`grep onlyItems|librariesRefreshed|ExtractLibrarySignatures`
        over `openspec/changes/*` outside archive hits only this change). `bridge-refusal-review` is still open
        (internal refactors deferred) and touches fetch/push; ordering stands (proposal: after it).
      - 2.4 scope, measured: `ItemKind.Kinds` has 34 kinds; 4 are never items (`folder` + the container managers,
        `ItemKind.cs:288` `IsContainerManager`). Members inlined in a POU (method, action, property, get/set,
        interface members, transition — `IsInlinedInPou`) have no file of their own: their row is "read through the
        owning POU", not a directed read of their own name, and the table must say so per kind.
      **Gate step 0 — review findings on 0.1 (2026-10-03).** All five are document findings (no product code moves
      in the gate), so there is no red test to write first; each fix is the measurement or the rewording below.
      Counts from `packages/volt-lsp-iec/test-corpus` (files under `Library Manager/`, `.library` stubs excluded):
      - R1 (high) — CONFIRMED. Wildcard refs fold their elements under `(unresolved)`:
        | corpus | library files | under `(unresolved)` | `(unresolved)` dirs | wildcard refs (`%2A`) | dirs whose name = a ref's title | dirs with no ref at all |
        |---|---|---|---|---|---|---|
        | awa-palletizer | 6238 | 688 | 30 | 25 | 25 (556 files) | 5 (132 files) |
        | bakon-nano | 6329 | 688 | 30 | 26 | 26 (573) | 4 (115) |
        | lenze-mid | 7408 | 710 | 31 | 27 | 26 (578) | 5 (132) |
        | pro2193 | 7213 | 713 | 32 | 28 | 27 (595) | 5 (118) |
        | CodesysTestProject | 813 | 58 | 8 | 7 | 7 (53) | 1 (5) |
        | twincat-project14 | — no `Library Manager/` | | | | | |
        Not niche. Concrete: awa's `CmpEventMgr Interfaces, * (System).library` holds no element; its 5 sit under
        `(unresolved)/cmpeventmgr interfaces`. `LibraryLayout.UnresolvedNameFor`'s own doc already names the cause
        (the ref publishes `RESOLUTION X, * (Vendor)`, the signature carries the compiled library's identity, and
        the two are compared as strings that cannot be equal). **Decision (root fix, one matcher):** the RESOLUTION
        join in `AppendLibrarySignatures` gets a second rule, used by BOTH the full and the directed fetch: a ref
        whose RESOLUTION version is `*` matches the signatures whose `LibraryPath` names the same library title
        (and company, if `LibraryPath` carries it — pinned in 1.1 from the recorded raw `LibraryPath`s, never
        guessed). So the full fetch stops foldering those elements under `(unresolved)` and writes them beside their
        `.library`, and a directed read returns the same folder and bytes (2.4's directed == full holds). Two refs
        matching one signature is refused by name (an ambiguous owner), not resolved by order (narrowed by 1.3 F1: only refs with DIFFERENT RESOLUTIONs; one repeated RESOLUTION is one library with one owner).
        The remaining "no ref at all" dirs (`cmpusermgr implementation`, `cmpusermgr interfaces`, `data server
        interfaces`, `monitoring data interfaces`, `syssocket interfaces`/`systypes`; 4-5 per corpus, 115-132 files)
        are the facade split: their elements belong to a library with no `.library` ref, and the corpora show the
        facade refs themselves empty (`CmpUserMgr, 3.5.17.0 (System)`, `CmpEventMgr`, `SysTime`, … — 11-15 empty
        refs per real corpus). A full fetch has the same gap today; matching a facade to its implementation needs a
        rule volt does not have (DEPENDENCIES?) — **left for the owner**, not invented here. Fail loud instead: the
        directed answer names (Warn) every NAMED library that matched zero signatures, and counts the extracted
        signatures that matched no named library, so "manifest alone" is never silent. Tasks 1.1, 2.1, 3.1 carry it.
      - R2 (medium) — CONFIRMED. "Warm after the first" is unestablished: `Build(app)` runs unconditionally in
        `ExtractLibrarySignatures` (`CodesysObjectModel.Libraries.cs:183`), archived design.md:10 measured warm with
        no edit, and :75 leaves the edit case open. With this change a plain READ builds the engineer's application
        in the live GUI IDE. 1.2 now measures edit-then-read (time, and whether the IDE's message view gains build
        output); the precompile-cost verdict is OPEN until then, and if the read is cold after an edit or writes
        build messages, the route goes to the owner before 3.1.
      - R3 (low) — CONFIRMED. design.md §0's CLI row was false ("no CLI caller sends a `.library`"): `Commands.cs:
        1021-1028` `Show("BRIDGE", <…>.library)` sends `OnlyItems = { name }`, and `volt-control` `view/diff.ts:35`
        (`incoming: right "BRIDGE"`) opens it for a drifted library. Row corrected; the cost is real (each open pays
        the extraction and `Show` discards it). Volt-native fix, in 3.1: the CLI's `volt show` asks for the manifest
        only — whether through a request field or by not naming the `.library`, decided in 3.1 with the wire type.
      - R4 (low) — CONFIRMED and FIXED here (cheap, comment-only): the stale "TwinCAT has no / returns no library
        signatures" claim had THREE copies, not one — `DriverBase.cs:149-152`, `LibraryFetch.cs:28` and
        `IIdeSession.cs:105-107`. All three now name `BeckhoffDriver` → `TcObjectModel.ExtractLibrarySignatures`
        (`ProduceAllLibrarySignatures`). The base's empty default itself (only the test doubles inherit it) stays
        for 2.2 to decide.
      - R5 (low) — CONFIRMED. spec.md scenario 3, 2.3 and 3.1 still instructed the rejected cache. Reworded: the
        scenario now asserts a warm (not cold) second read, 2.3 is a measurement, 3.1 no longer names a cache.
      **Gate step 0 numbers (2026-10-03):** `bun run typecheck` 0 errors (5 packages); `dotnet build Volt.sln -c
      Release` 0 errors; C# suites all green — Cli 259/259, Engine 2065 pass + 1 skip /2066, Connector 115/115,
      Ide.Twincat 424/424, Ide.Codesys 297/297 (net48), Contracts 39/39, Repo.Gates 108/108; volt-cli `bun test
      test/unit` 24/24; `openspec validate directed-library-signatures` valid; `bun run check` exit 0 (15/15 smoke),
      its one ✗ ("every cited DIALECT row exists", 6 `D7` citations) is pre-existing at `8d6912534b` and owned by
      `bridge-refusal-review` 6.0. No fixture or transpiler change, so no LSP suite / fixture-map run. Delta vs
      `8d6912534b`: comments only in product code (R4), so every count is unchanged.
- [x] 0.2 Decided (owner, 2026-10-03): (A) — a directed fetch naming `X.library` returns X's manifest and ALL its
      signatures, like any other extension; no new op, no element filter.
- [x] 0.3 Decide whether `MATERIALIZATION` can leave a directed read's manifest without breaking the LSP's format
      check (`LibraryManifest.cs:28-47`).
      **Decided: it STAYS.** (1) The manifest text IS the `.library` version-hash basis (`LibraryManifest.cs:6`,
      `Versioning.cs:31` hashes `mat.Text`): dropping the line on a directed read gives a different version than
      `/refs` and a full fetch for the same item, and 2.4 requires byte-equal content. (2) The LSP reads a missing
      line as format 1 (`frontend/library/manifest.ts:57`, `?? 1`) and `server/diagnostics.ts:185-194` then warns
      the library "was materialized by an older Volt". So the line is load-bearing for the format check. A client that
      keeps no workspace may ignore the line; no product change.

## 1. Reproduce

- [x] 1.1 On the CODESYS fixture, `fetch { onlyItems: ["Standard, <ver> (System).library"] }` and record the answer:
      expect the manifest alone, no signature items. Also record, from a full fetch, the raw `LibraryPath` of every
      signature the matcher folders under `(unresolved)` beside the RESOLUTION of each wildcard ref (R1: pins the
      wildcard rule's title/company comparison on recorded strings).
      **Done (2026-10-03, live, CODESYS 3.5.21.40 SP21 P4 + TwinCAT, `ide.ps1 -Instance directed-library-signatures`).**
      Tools: `packages/volt-cli/scripts/measure-library-signatures.ts` (over the pipe) + `probe-library-signature-cost.py`
      (the CODESYS `-RunScript`: serves the pipe, answers `messages` / `libpaths` / `edit` / `clean` by request file);
      logs `scripts/library-signature-cost-{codesys-fixture,codesys-pro2193,twincat-project14}.log`.
      - REPRODUCED on both vendors. The ref's item NAME is the Library Manager node's, so on the fixture it is
        `Standard.library` (not `Standard, <ver> (System).library`; PLCAssist's fixture differs). `fetch { knownItems: {},
        onlyItems: ["Standard.library"] }` → `librariesRefreshed: false`, `changed` = 1 item, the manifest alone (123
        chars: `LIBRARY Standard` / `NAMESPACE Standard` / `RESOLUTION Standard, 3.5.18.0 (System)` / `PLACEHOLDER true` /
        `SYSTEM false` / `MATERIALIZATION 4`). Pro2193: the same shape (folder `…/09 Misc/Library Manager/Standard`).
        TwinCAT Project14: `Tc2_Standard.library`, manifest alone (152 chars, `RESOLUTION Tc2_Standard, 3.4.5.0 (Beckhoff
        Automation GmbH)`). A full fetch writes TON beside it on both (`TON.pou`, IN/PT → Q/ET, the pins PLCAssist needs);
        Standard holds 22 signatures (CODESYS fixture) / 32 (Tc2_Standard).
      - R1 raw strings (`AllPrecompiledSignatures`, read as `ExtractLibrarySignatures` reads them). A CODESYS
        `LibraryPath` is LOWER-CASED `title, version (company)`: `standard, 3.5.18.0 (system)`, `breakpoint logging
        functions, 3.5.17.0 (3s - smart software solutions gmbh)` — the existing exact join only works because
        `libByResolution` is `OrdinalIgnoreCase`. Fixture: 30 distinct paths / 813 signatures; 22 match a RESOLUTION
        exactly, 8 (58 signatures) match none = exactly the 8 `(unresolved)` folders. Pro2193: 152 paths / 7229
        signatures (7224 rendered; the 5 are render-null PROGRAMs, Warn-logged); 120 exact, 32 (713) none = the 32
        `(unresolved)` folders (agrees with the gate's corpus count).
      - The wildcard rule, tried on those strings — title (before the first comma) AND company (last parenthesis),
        case-insensitive: every wildcard ref that has signatures pairs with EXACTLY ONE path, and no path pairs with two
        WILDCARD refs — on the two projects measured live, not a property of the rule (gate step 1 F1: exact
        RESOLUTIONs DO repeat across refs, and one title exists at two versions). Fixture 7/7 (`CmpIoMgr Interfaces, * (System)` → `cmpiomgr interfaces, 3.5.19.30 (system)`, …); Pro2193
        27/30 (`Datasources Interfaces, * (3S - Smart Software Solutions GmbH)` → `datasources interfaces, 4.7.0.0 (3s -
        smart software solutions gmbh)`, `L_ST2I_ActivateTimeMeasurement, * (Lenze)` → `…, 1.0.0.0 (lenze)`, …). The
        other 3 (`VisuElemBase, * (System)`, `L_SI9P_IoDrvi900, * (Lenze)`, `L_MC4I_TestTools, * (Lenze)`) have no
        signature with that title at all — empty refs, the zero-match Warn's case. The rule needs the TITLE of the
        RESOLUTION, not the ref's item name: `System_VisuElemBase.library` resolves `VisuElemBase, * (System)`.
      - Left after the rule (the facade split, owner): fixture 1 path / 5 signatures (`systypes interfaces, 3.5.2.0
        (system)`, no ref with that title); Pro2193 5 paths / 118 (`cmpusermgr implementation`, `cmpusermgr interfaces`,
        `data server interfaces`, `monitoring data interfaces`, `systypes, 3.1.2.0`). Empty refs (no signature in their
        folder): fixture 8 (the 7 wildcards + facade `CmpEventMgr, 3.5.17.0`), Pro2193 54 (wildcards, facades `SysSem`,
        `SysTime` ×3, `SysSocket`, `SysProcess`, `CmpUserMgr`, `CmpOPCUAStack`, `CmpEventMgr`, 13 `System_Visu*`, `CAA
        Callback Extern`, `Time and Date`, `NotImplementedByDevice`).
      - TwinCAT: 3 refs, no wildcard, no `(unresolved)`, every signature beside its ref (32 / 164 / 38).
      - **NEW, for the owner (out of this step's scope; it bears on 2.4 and on a directed read's identity):** on Pro2193
        13 `.library` FULL NAMES exist in TWO folders — `System_VisuElems.library` is both `Library Manager/
        System_VisuElems` (`RESOLUTION VisuElems, 4.8.1.0 (System)`, the root-level Library Manager) and `Device/Plc
        Logic/Application/09 Misc/Library Manager/System_VisuElems` (`VisuElems, 4.2.0.0`); likewise 12 more
        `System_Visu*`. `DedupeByFullName` keeps the LAST walked per name. Measured (gate step 1 F5,
        `library-signature-cost-codesys-pro2193-settled.log` lines 552-578): `init` answers the ROOT copy (`Library
        Manager/System_VisuElems`, 4.8.1.0) for all 13 and `items` carries that version; a `knownItems` fetch then
        re-sends the APPLICATION copy (`…/09 Misc/Library Manager/System_VisuElems`, 4.2.0.0), whose version is not
        the known one, while the root copy matches and is skipped — so those 13 are re-sent on EVERY known fetch and the
        application copies never reach a workspace on init. A directed `onlyItems: ["System_VisuElems.library"]`
        answers ONE item, the root copy (4.8.1.0), by walk order — not two. The pulled corpus shows 0 such pairs because
        the pull already collapsed them.
- [x] 1.2 Time a full fetch with `librariesRefreshed` on the fixture and on a large project (cold and warm), for the
      cost the new route must stay under. On CODESYS add edit-then-read (R2): edit one POU in the fixture IDE, then a
      directed read of `Standard, <ver> (System).library` — record the time and whether the IDE's message view gained
      build output. Cold after an edit, or build messages written, sends the route to the owner before 3.1.
      **Done (2026-10-03, same tools as 1.1; every number below is in a committed log — gate step 1 F2).** Logs, all
      in `packages/volt-cli/scripts/`: fixture `library-signature-cost-codesys-fixture.log` (run A) and
      `…-codesys-fixture-settled.log` (run B, 60 s settle, two Clean rounds); Pro2193 `…-codesys-pro2193.log` (run A,
      no settle) and `…-codesys-pro2193-settled.log` (run B, 60 s settle, two Clean rounds); TwinCAT
      `…-twincat-project14.log`. Earlier console-only runs (fixture cold 1754, Pro2193 cold 25159 / after-edit 22043 /
      Clean 21227, "0 at open on the first fixture launch") are DROPPED: run B re-measured the settled case.
      Client-side ms over the pipe. `init` = full fetch WITH `librariesRefreshed` (build + extraction + render + send of
      every project item and every signature); `known` = full fetch whose `knownItems` are the live versions (no
      extraction, 13 or 0 items sent: the walk-only floor). init − known is therefore an UPPER BOUND on what the route
      adds to a directed read, not a measurement of `Build(app)` + `AllPrecompiledSignatures` (gate step 1 F3): it also
      carries the render and transport of all 7224 (Pro2193) / 813 (fixture) signatures and of the 881 / 37 project
      items' source, where a directed read renders and sends ONE library's. The cold figures stand regardless — the build
      dominates them (20-25 s of a 25 s init); the warm ones (≈2.4 s Pro2193, ≈0.2-0.28 s fixture) overstate the floor.
      | project (run) | items / sigs | precompiled at open → after 60 s | init cold | init warm ×3 | known ×3 | init − known cold / warm | init after edit | init after Clean → next 3 warm | directed today (first; warm) |
      |---|---|---|---|---|---|---|---|---|---|
      | CODESYS fixture (A) | 37 / 813 | 813 → 813 | 1432 | 190 299 285 | 23 7 6 | ≈1425 / ≈278 | 582 (known 8), next 180 | 565 → 741 (one sample) | 75; 6 7 6 |
      | CODESYS fixture (B) | 37 / 813 | 813 → 813 | 1394 | 195 203 297 | 11 7 7 | ≈1387 / ≈196 | 1051 (known 8), next 189 | 885 → 731 285 277; 546 → 654 305 295 | 73; 14 10 6 |
      | CODESYS Pro2193 (A) | 881 / 7224 | 58 → (no settle) | 24333 | 3182 3803 3233 | 737 751 727 | ≈23596 / ≈2496 | 22425 (known 731), next 3317 | 20513 → 3033 (one sample) | 891; 729 709 729; 941 after edit |
      | CODESYS Pro2193 (B) | 881 / 7224 | 58 → 7228 | 24865 | 3486 3175 3102 | 750 733 742 | ≈24123 / ≈2433 | 22914 (known 731), next 3324 | 20651 → 3858 3614 3314; 20864 → 3510 3814 3596 | 777; 717 724 723; 885 after edit |
      | TwinCAT Project14 (fresh XAE) | 18 / 234 | — | 130 | 117 141 112 | 94 104 98 | ≈32 / ≈19 | — | — | 127; 99 106 103 |
      No larger TwinCAT project exists (Project14 is the only TwinCAT corpus); TwinCAT has no build in the path —
      `ProduceAllLibrarySignatures` plus its render costs ≈19-32 ms (init − known), cold or warm.
      - **R2 answer — CODESYS: a read after an edit is COLD, and every extraction writes build output.** After one ST edit
        (a new local + one statement, through scripting, as typing does), init cost 22.4-22.9 s on Pro2193 (warm
        3.1-3.8 s, cold 24.3-24.9 s): `Build(app)` recompiles the application ("Typify code…"). On the fixture the same
        edit cost 0.58-1.05 s against a warm 0.19-0.30 s. The message view's `CompilerMessageCategory` and
        `StaticAnalysisMessageCategory` are REPLACED by every extraction — before the first one they do not exist; after
        it: `------ Build started: Application: Device.Application -------` / `Typify code...` (or `The application is up
        to date` when warm) / `Compile complete -- 0 errors, 0 warnings` / `Additional code checks ...` (Pro2193 also its
        own pragma message and `Memory usage on device…`). So the route's own rule fires twice: **3.1 goes to the
        owner.** (The same holds for today's full fetch, i.e. every pull whose library versions moved, and every init.)
      - **Clean (gate step 1 F4):** on Pro2193 a Clean forces the cold path — 20.5-20.9 s in three samples against
        3.0-3.9 s for every warm init that follows. On the FIXTURE the data does not separate it: run A's one warm init
        after the Clean (741) was slower than the Clean's (565), and run B's first warm init after each Clean (731, 654)
        is as slow as the Clean's own (885, 546); only the 2nd and 3rd (277-305) fall back to warm. The fixture is too
        small for a Clean to stand out of the spread; it is not evidence that Clean is cold there.
      - **Where the time goes:** NOT the library precompile. The precompiled LIBRARY set (`AllPrecompiledSignatures`,
        no build) is untouched by an edit and by CODESYS's own Clean (Pro2193 7229 → 7229 in both runs; fixture 813 →
        813), yet the next extraction still pays the application build (20.5-22.9 s). And CODESYS precompiles the
        libraries by itself after a load: Pro2193 run B had 58 at open and 7228 after 60 s idle with no build (7229 once
        built) — and the cold extraction cost the same with and without the settle (24.9 s run B, 24.3 s run A). On the
        fixture the set was 813 at open in both logged runs. A volt-native alternative for the owner, measured only this
        far: read `AllPrecompiledSignatures` WITHOUT `Build(app)` when the set is complete for the named library — the
        archived cache-library-signatures measured 281/852 before a build on a fresh load, and run B shows 7228/7229
        after 60 s, so "complete" needs a test of its own (e.g. every RESOLUTION has signatures), never a guess.
      - Warm CODESYS init − known ≈ 200-280 ms (fixture), not the archived 97 ms: that figure was the bare `Build(app)`
        no-op headless; this one includes rendering and sending 813 signatures (F3 above).
      - Directed reads walk the whole project today: 709-941 ms on Pro2193 for one manifest vs 727-751 ms for a full
        `known` fetch (6-75 ms on the fixture).
- [x] 1.3 Gate step 1 — review findings on 1.1 / 1.2 (2026-10-03). All six CONFIRMED; none is a product-code change
      (the step measures), so the "red test first" is the measurement or the script fix named per item.
      - F1 (medium) — CONFIRMED. RESOLUTIONs repeat across refs; 1.1's "no path pairs with two refs" only compared
        wildcards. Corpus count (`packages/volt-lsp-iec/test-corpus`, `.library` RESOLUTION lines grouped by lower
        RESOLUTION, then by lower title|company; element files counted in each ref's folder):
        | corpus | refs sharing one RESOLUTION | element files today | one title+company at two versions |
        |---|---|---|---|
        | awa-palletizer | `CAA Callback` + `CAA Callback Extern` (`CAA Callback Extern, 3.5.17.0 (CAA Technical Workgroup)`) | 38 beside `CAA Callback Extern`, 0 beside `CAA Callback` | SysTime 3.5.17.0 (0) + 3.5.9.0 (5) |
        | bakon-nano | the same CAA pair | 38 / 0 | SysTime 3.5.17.0 (0) + 3.5.9.0 (5) |
        | lenze-mid | the same CAA pair; `SysTimeCore` + `SysTimeCore, 3.5.17.0 (System)` | 38 / 0; 0 / 4 (beside the direct ref) | SysTime 3.5.17.0 (0) + 3.5.9.0 (5); `visuinputs, 4.1.0.0 (system)` (application, 0) + `VisuInputs, 4.7.0.0 (System)` (root, 11) |
        | pro2193 | the same CAA pair; `SysTime` + `SysTime, 3.5.17.0 (System)` | 38 / 0; 0 / 0 | SysTime 3.5.17.0 ×2 + 3.5.5.0 (all 0) |
        | CodesysTestProject | none | — | none |
        | twincat-project14 | none (3 refs) | — | none |
        Live (Pro2193 run B, lines 350-351): `caa callback extern, 3.5.17.0 (caa technical workgroup)` (38 signatures)
        is the ONE path claimed by two refs, both through the EXACT rule; no path is claimed twice through the wildcard
        rule; the fixture claims none twice. Each pair is a placeholder and a direct ref (or two placeholders) to ONE
        compiled library with one NAMESPACE (`CB`, `SysTimeCore`). Today `libByResolution[res] = (walkedFolder,
        it.Name)` (`FetchService.cs:158`) keeps the ref walked LAST, so the 38 land beside `CAA Callback Extern` by walk
        order and the choice is recorded nowhere. A refusal on "two refs claim one signature" applied to exact matches
        would refuse 4 of 5 real CODESYS corpora.
        **Decided (default; the owner may overrule), in design.md "Two refs, one library" and a new spec scenario:** one
        RESOLUTION = one library, never refused; its signatures are written ONCE beside the ref with the ordinal-least
        FULL name (`CAA Callback Extern.library`, `SysTimeCore, 3.5.17.0 (System).library` — the folders every corpus
        already shows), independent of walk order; a directed read naming EITHER ref returns them in that folder. The
        refusal stays for one path claimed by refs with DIFFERENT RESOLUTIONs (only the wildcard rule can produce it: an
        `X, * (V)` ref beside a second version of X). No corpus has a wildcard ref sharing its title + company with any
        other ref; the signature side is recorded live for the fixture and Pro2193 only. 2.1 carries both cases.
      - F2 (low) — CONFIRMED. Console-only numbers re-measured into committed logs (Pro2193 run B with the 60 s settle:
        58 → 7228 at 60 s, cold 24865, after edit 22914, Clean 20651 / 20864; fixture run B) or dropped (fixture 1754,
        "0 at open on the first launch"). The 1.2 table now cites logged runs only, one row per run.
      - F3 (low) — CONFIRMED. init − known is named an upper bound, with what it carries besides the extraction (1.2).
      - F4 (low) — CONFIRMED and re-measured: two Clean rounds, each followed by three warm inits, on both projects
        (1.2 "Clean"). Pro2193 separates (≈20.7 s vs ≈3.5 s); the fixture does not.
      - F5 (low) — CONFIRMED, and the note's stated outcome was wrong: measured, a directed read of each of the 13
        duplicated `System_Visu*` names answers ONE item, the root copy, by walk order (1.1 owner note rewritten with
        the log lines).
      - F6 (low) — CONFIRMED and FIXED: `measure-library-signatures.ts`'s `claimed` set now uses the pairing rule
        itself (`wildMatches`, title AND company), and the script also prints every path claimed by more than one ref
        (exact or wildcard), the refs sharing one RESOLUTION / one title + company with the signatures beside each, and
        the `.library` names a known fetch re-sends with a directed read of each. Run B's "left after the rule" counts
        equal run A's (fixture 1 path / 5 signatures; Pro2193 5 / 118), so the numbers reported to the owner stand.
      **Gate step 1 numbers (2026-10-03):** `bun run typecheck` 0 errors (5 packages); `bun run lint` 0 errors
      (warnings only); `dotnet build Volt.sln -c Release` 0 errors; C# suites all green — Cli 259/259, Engine 2065 pass
      + 1 skip /2066, Connector 115/115, Ide.Twincat 424/424, Ide.Codesys 297/297 (net48), Contracts 39/39, Repo.Gates
      108/108; volt-cli `bun test test/unit` 24/24; `openspec validate directed-library-signatures` valid; `bun run
      check` exit 0 (15/15 smoke) with the same pre-existing ✗ (6 `D7` citations, `bridge-refusal-review` 6.0). No
      fixture or transpiler change, so no LSP suite / fixture-map run. Delta vs `f6b5c8130e`: no product code; the
      measuring script, two new logs, and the change's documents — every count unchanged.

## 2. Test red

- [x] 2.1 An engine test: a directed read of one library returns that library's signature items and no other's —
      including a WILDCARD ref (`X, * (Vendor)`, R1) whose elements then sit beside its `.library` on the full fetch
      too; a named library that matches zero signatures is named in a Warn; one path claimed by refs with DIFFERENT
      RESOLUTIONs refuses by name; two refs with the SAME RESOLUTION (1.3 F1: `CAA Callback` + `CAA Callback Extern`)
      get the signatures once, beside the ordinal-least full name, whatever the walk order, and a directed read of
      either returns them.
      **Done (red, 2026-10-03):** `test/Volt.Engine.Tests/library/DirectedLibraryReadTests.cs`, 17 cases on the
      CODESYS fixture's recorded shape (Application Library Manager, lower-cased `LibraryPath`, the wildcard ref's item
      name `CmpIoMgr Interfaces, %2A (System)`). **11 red** for the reason they exist (the manifest alone; wildcard
      elements under `(unresolved)` — the invented `System_VisuElemBase` signature is gone, 2.5 G1; no Warn; no refusal; the CAA signatures beside the ref walked
      LAST — red for one walk order only; 0 extractions where 2 are due). **6 green guards** that must stay green
      through 3.1: a wildcard `(System)` ref does not claim another company's library, the facade split stays
      `(unresolved)` (owner), a matched library is not warned about, a directed read naming no library extracts nothing,
      the CAA case in the other walk order, and the directed read keeps `librariesRefreshed` false with nothing removed.
      The refusal asserts a `BridgeException` naming both refs' full names and the claimed path (code left to 3.1).
- [x] 2.2 The same on TwinCAT (BeckhoffDriver's `ProduceAllLibrarySignatures`): the same item shape; fix the stale
      `DriverBase.ExtractLibrarySignatures` comment ("TwinCAT has no library signatures yet").
      (Gate step 0 R4: the comment and its two other copies, `LibraryFetch.cs:28` and `IIdeSession.cs:105-107`, are
      already fixed; what remains here is the test and whether the base's empty default should go.)
      **Done (red, 2026-10-03):** `test/Volt.Ide.Twincat.Tests/TcDirectedLibraryReadTests.cs` feeds the engine this
      vendor's REAL signatures — `TcLibrarySignatures.Parse` of the recorded `ProduceAllLibrarySignatures` excerpt
      (`library-signatures.xml`), refs spelled as Project14 answers them (`References/Tc2_Standard`, exact-case
      RESOLUTION). 4 cases: the full fetch's premise (every signature beside its ref, no `(unresolved)`) green; the
      directed read of Tc2_Standard (RS with SET/RESET1 → Q1) and directed == full for Tc2_Standard and Tc2_System
      **3 red**. The suite links `test/shared/FakeIde.cs` for it. **The empty default goes:**
      `DriverBase.ExtractLibrarySignatures` is now `abstract` — "no signatures" is indistinguishable from "no library",
      and only doubles inherited it; the two health doubles in `HonestHealthTests` now throw `NotSupportedException`
      ("a health double reads no library"), as they already do for a body write.
- [x] 2.4 Data-driven over `ItemKind`: for EVERY kind a full fetch can return, a directed `fetch { onlyItems: [X.ext] }`
      returns the same content for X as the full fetch (engine test on both vendors' doubles); a kind with no row fails.
      **Done (red, 2026-10-03):** `test/Volt.Engine.Tests/sync/DirectedReadPerKindTests.cs` — one row per
      `ItemKind.Kinds` constant (34, by reflection; a missing or doubled row fails `Every_kind_has_exactly_one_row`),
      and a row's route is checked against `ItemKind`'s own predicates so a kind cannot be filed under the wrong route:
      19 **File** rows (4 source, the library, 14 descriptors incl. the task), 11 **ThroughOwner** rows (members,
      accessors, transition, TwinCAT's interface accessors 654/655 and task call reference 650 — the owner's directed
      read equals the full fetch's owner), 4 **NeverAnItem** (folder + 3 container managers). File and ThroughOwner rows
      run in BOTH vendor shapes (CODESYS Application spine + Library Manager + lower-cased join; TwinCAT root +
      `References` + exact join). 63 cases: **2 red** — the library row on both vendors (signatures missing from the
      directed answer); every other kind is already readable on its own. (Corrected at gate step 2, 2.5 G2: the
      Transition row passed with the transition in NEITHER answer — it is now NotRendered, pinned as read by no fetch;
      and the TwinCAT-only rows run in the TwinCAT shape only — 60 cases, was 63.)
- [x] 2.3 Measurement, not a cache (0.1 / R5): two directed reads in a row with no library change — the second is a
      WARM extraction (CODESYS `Build(app)` a no-op), on both vendors; numbers from 1.2. A cache is built only if the
      owner overrules archived `cache-library-signatures` D1.
      **Done (baseline, 2026-10-03).** Engine half: `Each_directed_library_read_extracts_once_and_nothing_is_cached`
      (2.1's file) pins NO bridge cache — two directed `.library` reads extract twice, one read naming two libraries
      extracts once (red: 0 today). Live half: the read only extracts after 3.1, so "the second is warm" is measured
      by the tool, not asserted here. `scripts/measure-library-signatures.ts` gained (a) a **2.3 section** — two
      directed reads of DIFFERENT libraries in a row (the largest other library, then Standard), each timed and checked
      against the full fetch's folder — and (b) an opt-in **per-item parity snapshot** (`MEASURE_PARITY=1`, for 4.1 /
      4.3): every name `refs` publishes read on its own, `SAME`/`DIFFERS`/`AMBIGUOUS` against the last full fetch,
      tallied per extension. Baseline runs (`scripts/library-signature-cost-{codesys-fixture,twincat-project14}-step2.log`):
      | project | 2.3 reads today (ms) | parity today (per extension) | warm extraction the route will add (init − known, 1.2 + this run) |
      |---|---|---|---|
      | CODESYS fixture | `Util.library` 8, `Standard.library` 7 — both DIFFERS (115 / 22 signatures missing) | library 22 DIFFERS + 8 SAME (the 7 wildcard refs + facade `CmpEventMgr`: nothing beside them in the full fetch either), pou 4, device 1, projectsettings 1, task 1 SAME | ≈190 (this run: init warm 193/199/298, known 12/8/9); cold ≈2014 |
      | TwinCAT Project14 | `Tc2_System.library` 100, `Tc2_Standard.library` 93 — both DIFFERS (164 / 32 missing) | library 3 DIFFERS; pou 8, dut 2, gvl 1, external_types 1, projectsettings 1, task 1, tmc 1 SAME | ≈20 (init warm 117/137/119, known 95/104/99); cold ≈25 |
      Pro2193 (1.2): warm ≈2.4 s, cold ≈24 s, after an edit ≈22 s — the R2 answer that sends 3.1 to the owner stands.
      **Step 2 numbers:** Engine 2132 pass + 1 skip + 13 red / 2146 (+80 cases); Ide.Twincat 425 pass + 3 red / 428 (+4);
      Cli 259/259; Ide.Codesys 297/297 (net48); Repo.Gates 108/108; `dotnet build Volt.sln -c Release` 0 errors; `bun run
      typecheck` 0 errors; `bun run lint` 0 errors. The 16 red are exactly this step's red tests (11 + 2 Engine library /
      per-kind, 3 TwinCAT); every pre-existing test is green. No fixture or transpiler change, so no LSP suite /
      fixture-map run.

- [x] 2.5 Gate step 2 — review findings on 2.1-2.4 (2026-10-03). All six CONFIRMED and fixed; red-first where a test
      changed (each new or changed test was run red against today's code for the reason it exists).
      - G1 (medium, 2.1) — CONFIRMED. The `System_VisuElemBase` signature (`visuelembase, 4.6.0.0 (system)`) was invented:
        the only recording says `"VisuElemBase, * (System)" -> NONE` (`library-signature-cost-codesys-pro2193-settled.log`
        line 322; empty ref, line 116). Removed; `The_wildcard_rule_matches_the_resolution_title_not_the_item_name` is
        replaced by the recorded case, `A_wildcard_ref_with_no_matched_signature_is_named_in_a_warning` (directed read of
        `System_VisuElemBase.library` answers the manifest alone AND a Warn names it; red: no Warn). **"Title of the
        RESOLUTION vs the item name before the comma" is NOT separable on recorded data:** of the 30 Pro2193 + 7 fixture
        wildcard refs, the one whose item name (before any comma) differs from its RESOLUTION title is `System_VisuElemBase`,
        which matches `NONE`; every ref with signatures has item-name prefix = title — so no test pins it, and 3.1 takes the title
        from the RESOLUTION because that is the recorded string the rule is defined on (1.1), not because a test forces it.
      - G2 (medium, 2.4) — CONFIRMED, and it hid a fake bug. Every ThroughOwner row now carries the child's own text
        (`Shows`, e.g. `x := 2;` for the action, `Pr := x;` for the getter) and asserts it is IN the full fetch's owner
        text before comparing directed == full. Transition moves to a new route **NotRendered**: it asserts `x > 1` is in
        NEITHER answer, so the table no longer claims it readable and fails the day a reader renders one. The TwinCAT-only
        codes (654/655 interface accessors, 650 task call reference) run in the TwinCAT shape only; the interface-property
        row uses each vendor's own accessor code (613 CODESYS / 654 TwinCAT). Red-first found the shared `FakeIde` read
        only 613/614 as accessors, so a TwinCAT-shaped interface accessor vanished from the read (`PROPERTY IP : INT
        END_PROPERTY`) while `BeckhoffDriver` renders 654/655 — fixed in `test/shared/FakeIde.cs` (`AccessorOf` takes
        both codes of the role); the rows now see `GET … END_GET` / `SET … END_SET`. "Every other kind is already
        readable on its own" in 2.4 now reads: every kind except the library (red until 3.1) and the transition (rendered
        by no fetch, out of this change's scope).
      - G3 (low, 2.1) — CONFIRMED, three tests added, all red today: `A_directed_library_read_counts_the_signatures_no_named_library_claimed`
        (a directed Standard read logs a line with `3 extracted signatures` … `claimed by no named library` — the
        wording 3.1 must use); `A_directed_read_of_two_libraries_equals_the_full_fetch_for_both` and
        `A_directed_read_of_a_library_and_a_pou_equals_the_full_fetch_for_both` compare CONTENT with the full fetch, not
        only the extraction count. The directed refusal is G4's.
      - G4 (low, 2.1) — CONFIRMED. **Decided (default, the owner may overrule):** for one path claimed by refs with
        DIFFERENT RESOLUTIONs (0 occurrences in the corpora), a DIRECTED read naming either claimant refuses by name
        (`BridgeException` naming both refs' full names and the path; theory over both claimants); a FULL fetch does NOT
        throw — the path's signatures stay under `(unresolved)`, attributed to neither, every other library still pulls
        (TON beside Standard), and a Warn names both refs and the path. `Full(ide)` throwing is gone from the tests.
      - G5 (low, script) — CONFIRMED. `parity()` could never answer AMBIGUOUS from a deduped init. It now takes
        `twoFolders`: the `.library` names a `knownItems` fetch re-sends from a folder the init did not answer them from
        (the measured symptom of the 13 `System_Visu*` second copies), and a `.library` whose answers both hold the
        manifest alone is `EMPTY`, not `SAME` — the baseline's "library 8 SAME" (CODESYS fixture) reads as 8 EMPTY on the
        next run; 4.1 / 4.3 must not read EMPTY as parity. Not re-run live in this step (no product change; the
        `-step2` logs stay the pre-fix baseline, their SAME rows for libraries meaning EMPTY).
      - G6 (low, script) — CONFIRMED and fixed: `const med = (a`.
      **Gate step 2 numbers:** Engine 2129 pass + 1 skip + 18 red / 2148 (+2: library
      tests 17 → 22, per-kind 63 → 60); Ide.Twincat 425 pass + 3 red / 428; Cli 259/259; Connector 115/115; Ide.Codesys
      297/297 (net48); Contracts 39/39; Repo.Gates 108/108; volt-cli `bun test test/unit` 24/24; `dotnet build Volt.sln -c
      Release` 0 errors; `bun run typecheck` 0 errors (5 packages); `bun run lint` 0 errors (warnings only); `openspec
      validate directed-library-signatures` valid; `bun run check` exit 0 (15/15 smoke) with the same pre-existing ✗ (6
      `D7` citations, `bridge-refusal-review` 6.0). The 21 red are exactly this change's red tests (16 Engine library +
      2 per-kind library rows + 3 TwinCAT), each red for the reason it exists; every pre-existing test is green. No
      fixture or transpiler change, so no LSP suite / fixture-map run.

## 3. Build

- [x] 3.1 The chosen route (0.2) with the one RESOLUTION matcher that learns the wildcard (R1) and gives a repeated RESOLUTION one owner (1.3 F1), the zero-match Warn,
      the wire type and its `onlyItems`/`librariesRefreshed` doc (`RefsFetch.cs:100-108`), `volt show BRIDGE` asking
      for the manifest only (R3), regenerated docs. ~~No session cache (0.1 / R5). Blocked on 1.2's R2 answer.~~ R2 is
      answered by the owner's recorded decision (design.md §3 Choice 2): a per-RESOLUTION session cache for directed reads.
      **Done (2026-10-03, by code; offline — the live repeat is 4.1 / 4.3):**
      - `Volt.Engine/Library/LibraryFetch.cs`: `LibraryRef` (one walked `.library`: full/bare name, folder, RESOLUTION,
        version) and **`LibraryMatcher`, the ONE matcher both fetches use** — exact RESOLUTION (case-insensitive), then
        a WILDCARD ref (`X, * (V)`) claims the path with the same title (before the first comma) AND company (last
        parenthesis); a path with no company is not wildcard-claimed (no recorded path lacks one, so it stays
        `(unresolved)` rather than matching on the title alone — a narrowing of design §0's "and company, when
        `LibraryPath` carries it", named here for the gate). Refs with ONE RESOLUTION share a path: owner = ordinal-least
        full name (then folder), whatever the walk order. AMBIGUOUS (no owner): one path claimed by refs with different
        RESOLUTIONs, and — new test, design's "or two compiled versions of X" — one wildcard RESOLUTION matching more than
        one compiled path. `AppendAll` (full fetch: ambiguous → `(unresolved)` + one Warn per reason naming refs and
        path(s)) and `AppendNamed` (directed: only paths a NAMED ref claims, in the owner's folder; ambiguous →
        `BridgeException` `UNSUPPORTED` naming the named refs, every claimant and the path; Warn per named ref that
        claims nothing; Info `N extracted signatures claimed by no named library (of M)`).
      - `FetchService.cs`: the walk captures EVERY `.library` ref before the `onlyItems` skip; `librariesRefreshed`
        unchanged (false on any directed read); a directed read naming ≥1 `.library` (and not `libraryManifestOnly`)
        reuses the session cache or extracts once and stores it; the full fetch's extraction stores it, never reads it.
      - `Volt.Engine/Library/LibrarySignatureCache.cs` (new): last raw extraction + `{folder/full name → version}` of
        every walked ref + the bound project (vendor + name); reuse iff same project and every NAMED ref has its recorded
        version. Held by the session: `IIdeSession.LibrarySignatureCache`, implemented once in `DriverBase` — no driver
        code (3.2).
      - Wire: `FetchRequest.LibraryManifestOnly` (`libraryManifestOnly`, bool, absent = false); `OnlyItems` and
        `LibrariesRefreshed` docs rewritten (`RefsFetch.cs`); the fetch method summary in `DocDataTests.cs` updated;
        `docs/volt-bridge.openrpc.json` + `docs/assets/data.js` regenerated (`VOLT_WRITE_DOCS=1`).
      - `volt show BRIDGE` (`Commands.Show`) sends `LibraryManifestOnly = true`.
      - Tests (red first, each for its reason): the 2.3 test `Each_directed_library_read_extracts_once_and_nothing_is_cached`
        is REPLACED per design §3 (its premise, §0's no-cache default, is overridden by the owner's recorded decision) by
        `Two_directed_reads_with_no_library_change_extract_once`, `A_directed_read_of_a_library_whose_version_moved_extracts_again`,
        `A_moved_version_of_an_unnamed_library_does_not_extract_again`, `A_full_fetch_never_reads_the_cache_and_refreshes_it`,
        `A_directed_read_after_the_served_project_changed_extracts_again`, `A_manifest_only_directed_read_extracts_nothing_and_answers_the_manifest`;
        plus `A_directed_read_of_a_wildcard_ref_matching_two_compiled_versions_refuses_by_name` and
        `A_full_fetch_keeps_two_compiled_versions_of_one_wildcard_ref_unresolved_and_warns` (DirectedLibraryReadTests),
        and `ShowCommandTests.Show_BRIDGE_of_a_library_reads_the_manifest_only_and_never_extracts` (Cli; red: one
        extraction on a drifted library). `FakeIde.HealthProjectName` became settable for the project-switch case.
        Spec delta: "a second read is warm … without a session cache" replaced by the cache scenarios, the manifest-only
        scenario and the one-compiled-library refusal.
      - Not fixed (niche, 0 occurrences in the corpora): two compiled versions under one wildcard ref both land in ONE
        `(unresolved)/<title>` folder with the same file names (`UnresolvedNameFor` drops the version) — the same as any
        two unresolved versions of one title today.
- [x] 3.2 TwinCAT: the same route through `BeckhoffDriver`; both vendors' answers identical in shape.
      **Done:** no driver code — the route and the cache are engine-held; `BeckhoffDriver.ExtractLibrarySignatures` is
      the only vendor input. `TcDirectedLibraryReadTests` (real `ProduceAllLibrarySignatures` excerpt) 4/4 green (3 were
      red), and `DirectedReadPerKindTests`' library row is green in BOTH vendor shapes.
      **Step 3 numbers:** Engine 2154 pass + 1 skip / 2155 (was 2129 + 1 skip + 18 red / 2148; +7 tests, 0 red);
      Ide.Twincat 428/428 (3 red → green); Cli 260/260 (+1); Ide.Codesys 297/297 (net48); Connector 115/115; Contracts
      39/39; Repo.Gates 108/108; volt-cli `bun test test/unit` 24/24; `dotnet build Volt.sln -c Release` 0 errors; `bun run
      typecheck` 0 errors; `bun run lint` exit 0 (warnings only); `bun run check` 15/15 smoke with the same pre-existing ✗
      (6 `D7` citations, `bridge-refusal-review` 6.0). No fixture or transpiler change, so no LSP suite / fixture-map run.
- [x] 3.3 Gate step 3 — review findings on 3.1 / 3.2 (2026-10-04). Four findings, all CONFIRMED; three fixed in code
      red-first (each new test run red against the step-3 code for the reason it exists), one documented and left
      for the owner.
      - H1 (low, `LibraryFetch.cs`) — CONFIRMED and FIXED. The owner tie-break among claimants with ONE full name in TWO
        folders was `ThenBy(Folder)`, so `Device/…` beat `Library Manager/…` while `DedupeByFullName` keeps the LAST
        walked stub (CODESYS walks the root Library Manager last, 1.1 F5): signatures went into a folder whose stub had
        been deduped away (no `IdeTree.LibraryRoots` root → no read-only guard / removal exemption). Now the owner is the
        LAST walked ref with the ordinal-least full name — the stub that survives. Test
        `Two_copies_of_one_library_name_keep_the_signatures_beside_the_surviving_stub` (full AND directed; red: signature
        in `Device/Plc Logic/Application/Library Manager/X`, stub in `Library Manager/X`). 0 occurrences in the corpora
        (Pro2193's 13 pairs differ in RESOLUTION); fixed because it was one line.
      - H2 (low, `LibrarySignatureCache.cs`) — CONFIRMED and FIXED (cheap, so not left as niche). The cache is now keyed
        on EVERY walked ref's {folder/full name → version} (none added, removed or moved) plus the project — exactly D1's
        full-fetch signal — not on the NAMED refs only. Test `A_directed_read_after_an_unnamed_library_was_added_answers_as_a_fresh_read`
        (the finding's repro: the session's directed read of the wildcard throws the same UNSUPPORTED message as a fresh
        IDE's; red: no exception, stale 3.5.17.0 signatures). `A_moved_version_of_an_unnamed_library_does_not_extract_again`
        is REPLACED by `A_moved_version_of_an_unnamed_library_extracts_again`: its premise (a per-named-library key) is
        wrong on grounds independent of the code — the spec's "answering the same items a full fetch writes", which the
        repro shows a per-named key breaks. Cache doc, design §3 Choice 2 ("no new hole" → the hole D1 has, and only
        it), the `OnlyItems` wire doc and the two spec cache scenarios reworded. 0 occurrences in the corpora.
      - H3 (low, `LibraryFetch.cs`) — CONFIRMED; the gate RULES for the narrowing: a path with no company is NOT
        wildcard-claimed (stays `(unresolved)`). The rule is title AND company as recorded (1.1: every recorded path
        carries one); a title-only match on an unrecorded shape would be a guess. Pinned by
        `A_wildcard_ref_does_not_claim_a_path_without_a_company` (full: `(unresolved)`; directed: not returned) — green
        on the code, red if `{ Company: { } company }` is removed (checked); design §0 and a new spec scenario say so.
      - H4 (low, `FetchService.cs`) — CONFIRMED, documented, **left for the owner** (not cheap to force correctly). A
        workspace pulled before step 3 keeps wildcard refs' signatures under `(unresolved)/<title>` until the next
        `.library` version move, while a fresh `volt init` writes them beside the ref (688-713 files per real CODESYS
        corpus; all five CODESYS corpora are in the old layout). design "Migration" now says the full fetch changes too.
        The volt-native force — a `LibraryManifest.Materialization` bump (moves every `.library` version → one refresh,
        LSP names the stale workspace) — would also mark the 695 format-4 manifests of the six committed corpora stale
        and silence their network-text diagnostics until each is re-pulled live; a bridge-side "a known `(unresolved)`
        folder a wildcard could claim" trigger would rebuild on EVERY pull where the folder stays unresolved (other
        company, two compiled versions) — a `Build(app)` per pull on CODESYS. Owner: bump + corpus re-pull, or accept
        convergence on the next library change.
      **Gate step 3 numbers (2026-10-04):** Engine 2157 pass + 1 skip / 2158 (was 2154 + 1 / 2155: +4 tests, 1 replaced
      → +3; `DirectedLibraryReadTests` 32 cases); Cli 260/260; Connector 115/115; Ide.Twincat 428/428; Ide.Codesys 297/297
      (net48); Contracts 39/39; Repo.Gates 108/108; volt-cli `bun test test/unit` 24/24; `dotnet build Volt.sln -c
      Release` 0 errors; `bun run typecheck` 0 errors; `bun run lint` exit 0 (warnings only); `openspec validate
      directed-library-signatures` valid; `bun run check` exit 0 (15/15 smoke) with the same pre-existing ✗ (6 `D7`
      citations, `bridge-refusal-review` 6.0). `VOLT_WRITE_DOCS=1` regeneration: no change from these fixes (the
      `onlyItems` text is not in the generated docs). No fixture, LSP or transpiler change, so no LSP suite /
      fixture-map run (the change names the C# suites and `bun run check`, 4.2).

## 4. Verify

- [x] 4.1 Repeat 1.1 live on CODESYS: TON's pins are in the answer.
      **Done (2026-10-04, live, CODESYS 3.5.21.40 SP21 P4, `ide.ps1 -Instance directed-library-signatures`, fixture copy;
      log `packages/volt-cli/scripts/library-signature-cost-codesys-fixture-step4.log`).** `fetch { knownItems: {},
      onlyItems: ["Standard.library"] }` as the session's FIRST read (no extraction before it): `librariesRefreshed:
      false`, `changed` = 23 = the manifest (unchanged, 123 chars, `MATERIALIZATION 4`) + Standard's 22 signatures, 0 under
      `(unresolved)`, `items` = 1. `TON.pou` @ `Device/Plc Logic/Application/Library Manager/Standard`: `VAR_INPUT IN : BOOL;
      PT : TIME;` / `VAR_OUTPUT Q : BOOL; ET : TIME;` / `VAR M : BOOL; STARTTIME : TIME;` — and the whole directed
      answer (folder, name, version, text of all 23 items) equals what init #1 writes in Standard's folder: `4.1
      directed #0 (own cold extraction) vs init #1 (own extraction): SAME (23 items)`. That is the one comparison of two
      INDEPENDENT extractions (gate step 4 F1): directed #0 extracted on its own (nothing cached yet), init #1 extracted
      again and Stored; every later directed read (2.3, 4.3, the warm repeats) is answered by `Reuse` from the cache a
      full fetch Stored, so its parity only shows that `AppendNamed` and `AppendAll` split ONE extraction the same way.
      The read cost 1756 ms cold (it ran `Build(app)`: the message view gained `Typify code…` / `Compile complete -- 0
      errors, 0 warnings` / `Additional code checks …`, as 1.2 R2 predicted) — the session's cold extraction figure; init
      #1 after it is NOT cold (316 ms, "The application is up to date"; gate step 4 F2) — and 13-25 ms warm from the
      session cache (×3, and 9 ms right after an ST edit — no library version moved, no build output). The same on
      TwinCAT Project14 (`…-twincat-project14-step4.log`): `Tc2_Standard.library` directed first read 149 ms, 33 items
      (manifest + 32), `TON.pou` @ `References/Tc2_Standard` IN/PT → Q/ET, `SAME (33 items)` against init #1; warm
      96-110 ms (the walk floor, known fetch 93-110). Wildcard refs now hold their signatures on the full fetch too: fixture
      `(unresolved)` 58 → 5 signatures, 8 → 1 folder — the one left is `systypes interfaces, 3.5.2.0 (system)`, the
      facade split left to the owner (1.1).
- [x] 4.3 Live, both vendors: the 2.4 table over a fixture project — every readable extension read on its own matches
      the full fetch (LD/FBD network text rows deferred to its design work, listed as such).
      **Done (2026-10-04, `MEASURE_PARITY=1`, same two logs): every name `refs` publishes read on its own and compared
      (folder, name, version, text — for a `.library`, everything in its folder) with the last full fetch.**
      | project | names | per extension | not SAME |
      |---|---|---|---|
      | CODESYS fixture | 37 | library 29 SAME + 1 EMPTY, pou 4, device 1, projectsettings 1, task 1 SAME | `CmpEventMgr.library` EMPTY: the facade (`CmpEventMgr, 3.5.17.0`) holds no signature in either answer — the owner's facade split, not a directed-read gap |
      | TwinCAT Project14 | 18 | library 3, pou 8, dut 2, gvl 1, external_types 1, projectsettings 1, task 1, tmc 1 SAME | none |
      Step-2 baseline for comparison: CODESYS library 22 DIFFERS + 8 EMPTY (read SAME by the pre-G5 script), TwinCAT
      library 3 DIFFERS — every library row now matches. 2.3 live: `Util.library` (116 items) then `Standard.library`
      (23), both SAME, 11/16 ms (CODESYS); `Tc2_System.library` (165) then `Tc2_Standard.library` (33), SAME, 102/94 ms.
      These rows (and 2.3) compare a cache `Reuse` with the full fetch that Stored it — the extraction itself is checked
      independently only by 4.1's directed #0 row (gate step 4 F1).
      **Outside every directed answer (gate step 4 F4):** a directed read returns only the folder of the name it asks
      for, and the tally iterates the names `refs` publishes, so a signature the full fetch writes outside every ref's
      folder is in no row. CODESYS fixture: full fetch 813 signatures, 808 in a ref's folder, **5 outside** (all in
      `(unresolved)/systypes interfaces` — the owner's open facade split, 1.1); no directed read of any name returns
      them. TwinCAT Project14: 234 / 234 / 0.
      No `.library` is re-sent by a known fetch on either fixture, so no AMBIGUOUS row (the 13 `System_Visu*` second
      copies exist only on Pro2193, 1.1 F5).
      **Owner rules covered OFFLINE only (gate step 4 F3):** neither fixture has a repeated RESOLUTION or a shared
      title + company (both logs: `refs sharing one RESOLUTION: 0 group(s)`, `sharing one title + company: 0
      group(s)`), so one owner per repeated RESOLUTION (the CAA Callback + CAA Callback Extern pair, 1.3 F1, 4 of 5 real
      CODESYS corpora) and the ambiguous-owner refusal are pinned by the step-2/3 engine tests alone; nothing live in
      this step shows them. A live check needs a corpus with the pair (awa-palletizer, Pro2193) — not run here.
      Coverage: of the 2.4 table's 19 File kinds, 9 occur on these two live fixtures (pou, dut, gvl, library, device,
      task, project_settings, external_types, tmc_file); the other 10 (interface, project_info, trace, recipe,
      symbol_config, image_pool, parameter_list, text_list, visualization, class_diagram) are pinned offline only by
      2.4 in both vendor shapes. ThroughOwner kinds are covered through their owner's `.pou` row. **LD/FBD network text:
      DEFERRED to its design work (`support-all-ld-fbd`).** For the record, Project14's four graphical POUs (`ladder`,
      `ladderLabel`, `POUexecute`, `POU_PBD`) were among the 8 pou SAME with `VOLT_GRAPHICAL` on (ide.ps1's default);
      the CODESYS fixture's bodies are not separated by language in this measurement.
- [x] 4.2 Full C# suites and `bun run check` green.
      **Done (2026-10-04, at `c04fb2356f` + this step's script/log changes; no product code changed in step 4):**
      `dotnet build Volt.sln -c Release` 0 errors; Cli 260/260; Engine 2157 pass + 1 skip / 2158; Connector 115/115;
      Ide.Twincat 428/428; Ide.Codesys 297/297 (net48); Contracts 39/39; Repo.Gates 108/108; volt-cli `bun test test/unit`
      24/24; `bun run check` exit 0 (15/15 smoke) with the same pre-existing ✗ (6 `D7` citations, owned by
      `bridge-refusal-review` 6.0). No fixture, LSP or transpiler change, so no LSP suite / fixture-map run.
      Step 4 changed only `scripts/measure-library-signatures.ts` (1.1 now prints the manifest and TON in full, every
      other directed item by name, and a `4.1 TON in the directed answer` line) and added the two `-step4` logs.
- [x] 4.4 Gate step 4 — review findings on 4.1-4.3 (2026-10-04). Four findings, all CONFIRMED, all low; none touches
      product code. Both `-step4` logs re-recorded live with the fixed script (same instance, fixtures, `MEASURE_PARITY=1`).
      - F1 (4.3 parity circular for the extraction): CONFIRMED — `FetchService` Stores on `librariesRefreshed` and the
        directed read `Reuse`s. The script now compares directed #0 (its own cold extraction) with init #1 (its own
        extraction): CODESYS `SAME (23 items)`, TwinCAT `SAME (33 items)`; 4.1 / 4.3 reworded.
      - F2 (stale "init #1 COLD" labels): CONFIRMED — relabelled `init #1 (first full fetch, after directed #0's cold
        extraction)`; the summary now prints `extraction cold = directed #0 <ms>` and init #1 as NOT cold. Re-recorded:
        cold 1756 ms (directed #0, `Typify code…`) vs init #1 316 ms ("up to date"); the old log's "extraction cold ≈ 293"
        was a warm figure. Header comment and the R2 "today's path" label fixed too.
      - F3 (repeated-RESOLUTION / ambiguous-owner rules not live): CONFIRMED — stated under 4.3 as offline-only (0 groups
        on both fixtures); no corpus run.
      - F4 (signatures outside every directed answer): CONFIRMED — the 4.3 run now prints the count: CODESYS 813 = 808 +
        5 outside (`(unresolved)/systypes interfaces`), TwinCAT 234 = 234 + 0; stated under 4.3.
      **Gate step 4 numbers (2026-10-04, at `c04fb2356f` + this step's script/log/tasks changes):** `bun run typecheck`
      0 errors; `bun run lint` exit 0 (warnings only); `dotnet build Volt.sln -c Release` 0 warnings / 0 errors; Cli
      260/260; Engine 2157 pass + 1 skip / 2158; Connector 115/115; Ide.Twincat 428/428; Ide.Codesys 297/297 (net48);
      Contracts 39/39; Repo.Gates 108/108; volt-cli `bun test test/unit` 24/24; `bun run check` exit 0 (15/15 smoke), the
      same pre-existing ✗ (6 `D7` citations, `bridge-refusal-review` 6.0). No fixture, LSP or transpiler change, so no
      LSP suite (`VOLT_REQUIRE_FULL`) or fixture-map run is named by this change.

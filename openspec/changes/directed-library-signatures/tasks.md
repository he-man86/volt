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
        matching one signature is refused by name (an ambiguous owner), not resolved by order.
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

- [ ] 1.1 On the CODESYS fixture, `fetch { onlyItems: ["Standard, <ver> (System).library"] }` and record the answer:
      expect the manifest alone, no signature items. Also record, from a full fetch, the raw `LibraryPath` of every
      signature the matcher folders under `(unresolved)` beside the RESOLUTION of each wildcard ref (R1: pins the
      wildcard rule's title/company comparison on recorded strings).
- [ ] 1.2 Time a full fetch with `librariesRefreshed` on the fixture and on a large project (cold and warm), for the
      cost the new route must stay under. On CODESYS add edit-then-read (R2): edit one POU in the fixture IDE, then a
      directed read of `Standard, <ver> (System).library` — record the time and whether the IDE's message view gained
      build output. Cold after an edit, or build messages written, sends the route to the owner before 3.1.

## 2. Test red

- [ ] 2.1 An engine test: a directed read of one library returns that library's signature items and no other's —
      including a WILDCARD ref (`X, * (Vendor)`, R1) whose elements then sit beside its `.library` on the full fetch
      too; a named library that matches zero signatures is named in a Warn; two refs claiming one signature refuse.
- [ ] 2.2 The same on TwinCAT (BeckhoffDriver's `ProduceAllLibrarySignatures`): the same item shape; fix the stale
      `DriverBase.ExtractLibrarySignatures` comment ("TwinCAT has no library signatures yet").
      (Gate step 0 R4: the comment and its two other copies, `LibraryFetch.cs:28` and `IIdeSession.cs:105-107`, are
      already fixed; what remains here is the test and whether the base's empty default should go.)
- [ ] 2.4 Data-driven over `ItemKind`: for EVERY kind a full fetch can return, a directed `fetch { onlyItems: [X.ext] }`
      returns the same content for X as the full fetch (engine test on both vendors' doubles); a kind with no row fails.
- [ ] 2.3 Measurement, not a cache (0.1 / R5): two directed reads in a row with no library change — the second is a
      WARM extraction (CODESYS `Build(app)` a no-op), on both vendors; numbers from 1.2. A cache is built only if the
      owner overrules archived `cache-library-signatures` D1.

## 3. Build

- [ ] 3.1 The chosen route (0.2) with the one RESOLUTION matcher that learns the wildcard (R1), the zero-match Warn,
      the wire type and its `onlyItems`/`librariesRefreshed` doc (`RefsFetch.cs:100-108`), `volt show BRIDGE` asking
      for the manifest only (R3), regenerated docs. No session cache (0.1 / R5). Blocked on 1.2's R2 answer.
- [ ] 3.2 TwinCAT: the same route through `BeckhoffDriver`; both vendors' answers identical in shape.

## 4. Verify

- [ ] 4.1 Repeat 1.1 live on CODESYS: TON's pins are in the answer.
- [ ] 4.3 Live, both vendors: the 2.4 table over a fixture project — every readable extension read on its own matches
      the full fetch (LD/FBD network text rows deferred to its design work, listed as such).
- [ ] 4.2 Full C# suites and `bun run check` green.

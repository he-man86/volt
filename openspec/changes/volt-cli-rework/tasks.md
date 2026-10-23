Requires: `ld-fbd-coverage` and `multi-application-tree` — both archived; this change may start.

**Goal (owner, 2026-10-18): a new vendor is one IDE host** (proposal, spec). Every step below is judged by it: code is
placed so a vendor outside the CODESYS family (Siemens, Rockwell) implements the `Ide/` contract in its own host and
nothing above that contract learns its name. Shared code goes to `Volt.Engine` only if it names no CODESYS-family fact;
a CODESYS-family fact (NWL, DIALECT N1, the object model) stays BELOW the contract, in the hosts. Whether the two hosts
share such code is NOT decided (owner, 2026-10-18: "careful about combining those 2 into 1 package" — different runtimes,
net48 in-proc vs the x86 worker; TwinCAT reaches NWL its own way; one vendor's fix must not risk the other). 1.1 lists
the candidates with evidence; 1.2 decides each; the default is two self-contained hosts.

Order (owner, 2026-10-17): **behind the wire first** — `Volt.Engine`, `Volt.Ide.Codesys`, `Volt.Ide.Twincat` (and their
tests), with the wire as it stands after `multi-application-tree` as the fixed reference (3.3: byte-identical before/after).
The rework never changes the wire; a wire defect it finds (1.1a included) becomes its own small change — and any wire
change means wire protocol 2, so it is coordinated with PLC Assist and lands in a release that may bump the number. The front of the wire (`Volt.Cli`,
the connector, volt-control, volt-vscode) follows afterwards, against the same wire.

**The wire itself is reviewed critically first** (owner, 2026-10-17: "agents tend to add logic to solve edge cases that are
not needed"). Step 1.1 includes a wire audit: every field, op, error code and rule in `Volt.Contracts/Wire` — who reads it,
which measured case needs it, what breaks without it. Anything added for an edge case that is not measured or not needed
is listed for deletion. And the shape: one way to say each fact, consistent names, no field that only
mirrors how the code happened to be built — the interface as it should be, not as it grew. Stripped of every legacy
or unstructured field (owner): a leftover of a removed design, a loose string where a structure belongs, a bag of
optional values whose combinations mean different things. The owner decides the list in 1.2; the deletions land as one small wire change BEFORE the
behind-the-wire refactor, so the fixed reference is the simplified wire.

**Find what an outside client finds** (owner, 2026-10-18). PLC Assist, writing a second client against the docs, found
seven defects our gates missed (strict members on push only; case-insensitive paths on push only; `unreadable` without a
kind; a protocol number that never moved; a move onto an existing path; an unsaved TwinCAT window with no row; an LSP
stack overflow). The pattern: a rule enforced at several call sites, one of which drifted; and tests that only ever pair
a client and a bridge from the same commit. **The premise behind that gap is false** (owner, 2026-10-18): the wire is
not an internal seam between our CLI and our bridge — PLC Assist ships the bridge bundles and drives the pipe itself, so
the bridge + wire is a PUBLIC API with a second client. Every review step (1.1, 2.x) judges the bridge as that API: what
does it do for a request our CLI never sends (other case, other order, a taken name, an old protocol, an IDE state the
CLI happens to avoid)? A rule that holds only because our CLI is polite is a finding. The audit and the rework add, as
standing practice:
- **A contract suite driven by the OpenRPC document, not by our CLI**: every op and member the schema allows,
  including the awkward combinations, sent straight to the pipe against both live bridges; it asserts the response
  shape and the error code `wire.html` promises (an IDE state is never `INTERNAL_ERROR`). Built in 1.3 from the audit,
  BEFORE the rework, so it is the oracle 3.3 compares against; run in every e2e cell.
- **Foreign-client review**: an agent given ONLY `docs/wire.html` and the OpenRPC document, no repo context, writes a
  minimal client and reports every inconsistency between the contract, the read side and the write side. Run in 1.1,
  and as a step of every change that touches `Volt.Contracts/Wire` (the change workflow gets it).
- **One place per rule, gated**: every wire rule (path comparer, wire-name minter, strict request reader, protocol number
  beside the schema pin) has one implementation and a `Volt.Repo.Gates` test that a new call site cannot bypass it. The
  audit lists every rule that lives in more than one place.
- **A mixed-version e2e cell**: the current CLI against the previous release's bridge (and the reverse), which must be
  refused by name before any op, never misread.
- (The LSP size and fuzz inputs are `volt-lsp-iec`, outside this change: openspec `lsp-size-fuzz`.)

## Inputs since 2026-10-18 (known items, placed by the map)

- OWNER DECISION 2026-10-23 (step 7.2): a push `deleteItem` that quotes `ifVersion` for a path that names nothing is refused
  `ITEM_MISSING` — one rule: a quoted version must hold, or the push is refused. A delete with no `ifVersion` stays the
  idempotent no-op. Protocol stays 1 (the code is already on the wire); PLC Assist gets a one-line note in their next
  update.
- OWNER DEFAULT 2026-10-23 (step 8): protocol stays 1, so step 8 is the documents only. `networkText` → `languages` and
  the vendor enum from the vendor table wait for a protocol-2 release coordinated with PLC Assist.

- Fix (behind the wire): TwinCAT reads `LinkAlways`, `External`, item `CompilerDefines` and `AdditionalAllocation` from
  the saved `.plcproj` (the save lag DIALECT C39 measured for exclusion); read them from the live `ProduceXml`
  VSProperties as `Exclude` is.
- Performance (behind the wire, profiled 2026-10-19): the declarations index built from the op's own walk instead of a
  second `ItemLookup.All` (~300 s per TwinCAT e2e run), and the Explorer hierarchy read for the PLC subtree only
  (~300 s). Deferred from the low-risk speed fixes; each needs an identity test (refs/fetch byte-identical).
- Unsaved CFC/SFC bodies are not carried by a TwinCAT move (`TcItemArchive.CarryLive`): measure, then refuse by name
  rather than lose the edit.
- Tests: the e2e redundant-read cut (audit 2026-10-19: ~1,750 refs per TwinCAT run, ~10 min; the last independent read
  after a write stays); `ide-restart` rewritten to the one-worker-per-XAE model (a new XAE gets a new worker).
- Front of the wire (later phase): `RotInstances.TryEnumeratePids` (`--list-xae-pids`) still calls every DTE and can
  stall on a busy XAE; `ComMessageFilter.RetryRejectedCall` retries without a cap (owner decision).

## 1. Map

- [x] 1.0 LOC baseline (`input/loc-baseline.md`, at e2405e51bd) (owner, 2026-10-18), measured at the commit the rework starts from: per project in `src/` and
      `test/`, C# lines split code / comment / blank (bin, obj excluded), plus `scripts/`. Recorded here; 4.1 measures
      the same way and reports before → after per project.
- [x] 1.0a (`input/map-and-rating.md`) QUALITY RATING before (owner, 2026-10-20): per project behind the wire, a score 1–10 on fixed criteria, each
      with its evidence (file:line or a count) so the after-rating is comparable: placement (code in its owning project),
      duplication (rules implemented more than once), vendor-neutrality above `Ide/` (vendor/NWL names, the 1.3 gate's
      count), legacy (dead code and history comments), test strength (red-before-fix coverage, fakes asserting bugs
      away), public-API robustness (requests our CLI never sends), size (LOC, comment share). Same criteria, same scale,
      every time.

- [x] 1.1 (`input/map-and-rating.md`) Per project BEHIND THE WIRE (`Volt.Engine`, `Volt.Ide.Codesys`, `Volt.Ide.Twincat`, `Volt.Contracts`/`Wire` and
      their tests; the CLI, connector and frontends are the later phase): what it owns (ARCHITECTURE.md, README) vs what its code does; list misplaced code, duplicated
      logic between the hosts, and cross-project leaks. Merge with the 2026-10-16 simplify reviews (what is left).
      Open question for 1.2 (owner, 2026-10-17, not decided): the translation model → NWL nodes is done twice, once per
      driver (`CodesysNetworkWriter` 875 lines; `TcArchiveBuilder` + `TcNetworkWriter` 1660) although the NWL model is
      identical on both vendors (DIALECT N1). NWL is the CODESYS family's format, not vendor-neutral — a future vendor
      (Siemens, Rockwell) has no NWL — so the Engine core stays at `NetworkModel`. Candidate (with evidence; the default is two
      self-contained hosts): one shared CODESYS-family NWL layer used by both drivers, each only placing it.
- [x] 1.1a (`input/vendor-neutrality.md`) Vendor-neutrality audit of the two contracts a new vendor meets (goal): the WIRE — every fact that is
      CODESYS-family (item kinds `.pou/.dut/.gvl/.visualization/.task/.device`, the path shape, `IMPLEMENTATION LD/FBD`
      network text) and how a Siemens (FB/FC/DB/UDT/OB) or Rockwell (programs/routines/tags) project would say its own;
      and the `Ide/` CONTRACT (`ICodeStore`, `IProjectTree`, …) judged by "could a non-CODESYS host implement this?"
      (folders, POU children, get/set properties, NWL bodies). Output: a list for 1.2, not a fix.
      The audit does NOT design a Siemens host — what that looks like is unknown (owner); it checks that the SPLIT makes
      sense for it. Siemens is the probe question, not a spec: its kinds (FB, FC, OB, DB, UDT, tag tables), its text
      language SCL (close to ST, not the same), and its LAD/FBD in its own model (SimaticML via TIA Openness), with STL
      unsupported like IL. Three splits to hold:
      - KINDS by extension (owner): the extension names the kind and picks the item's handler; the host states its
        kinds; nothing above it holds the list. The extension set that `bun run check` keeps identical across C#, the
        LSP, volt-control, the VS Code extension and the plugin becomes ONE registry each vendor adds to, refusing two
        vendors that spell one extension differently.
      - LANGUAGES by the `IMPLEMENTATION <LANG>` line: one kind may hold bodies in several languages (a Siemens FB in
        SCL or LAD); each language's reader/writer is plugged in by that name (`IMPLEMENTATION SCL` slots in).
      - NETWORKS: `NetworkModel` + network text are ONE graphical form, hoped to be reused for TIA LAD/FBD but not
        known to fit; nothing above the contract may assume every graphical body is one, so a vendor can bring its own.
- [x] 1.1b (`input/foreign-client-review.md`) Foreign-client review (above): ONLY `docs/wire.html` + the OpenRPC document, no repo context.
- [x] 1.2 DECIDED 2026-10-20 (owner delegated): option C in `design.md` — rewrite the `Ide/` contract and the Engine above
      it, refactor both hosts in place, bugs first, then the 1.3 safety net. Owner review of the map: which projects are refactored, which (if any) reimplemented — with the POTENTIAL
      rating per project after the proposed work (same criteria as 1.0a, each score tied to the findings that move it).

- [x] 1.3 Safety net before any rework, from the 1.2 decisions:
      - [x] the OpenRPC-driven contract suite (above): `test/e2e/contract/openrpc-contract.test.ts`, 173 cases, green on
            CODESYS 3.5.21.40 and TwinCAT MultiProject with 5 FINDINGS held red-first (the suite's `FINDINGS`);
      - [x] the wire TRANSCRIPT recorder + comparer (`scripts/wire-transcript.ts`), run per release-matrix cell;
      - [x] the transcript REFERENCES per vendor fixture (`test/transcripts/<cell>.jsonl`, `bun run release:matrix
            --record-transcripts`) — the byte-identical reference 3.3 compares against; recorded 2026-10-22 on b2e67e79a3
            for the five fixture cells (CODESYS 3.5.18.30-64, 3.5.21.40-64, 3.5.21.60-32, 3.5.22.40-64, twincat-32), each
            then compared identical (3.5.18.30 on an `--only` rerun: in the full run its first `refs` once answered a
            transient projectVersion, a STALE_PROJECT_VERSION on the scenario's create), with no normalisation change;
      - [x] one implementation + one `Volt.Repo.Gates` test per wire rule (path comparer, wire-name minter, strict request
            reader, protocol number beside the schema pin, error-code mapping): `WireRulesHaveOneImplementationTests`,
            ratchets where a rule has several sites today;
      - [x] the mixed-version e2e cell (current CLI ↔ the previous release's bridge, 0.1.17931 today, refused by name before
            any op): `scripts/mixed-version.ts`, the `mixed-version` cell of `bun run release:matrix`;
      - [x] the new-vendor gate: a `Volt.Repo.Gates` test that `Volt.Engine` above `Ide/`, `Volt.Contracts` and `Volt.Cli`
            name no `Codesys`/`Twincat`/`Beckhoff`/`Nwl` symbol, and that `Ide/I*.cs` and `Sync/` hold no `ItemKind.Plc*`
            code or NWL type (`NewVendorGateTests`; a ratchet at 33 and 38 — the counts are the work list);
      - [x] a minimal third test vendor OUTSIDE the CODESYS family (no NWL, its own object model) that passes the
            transport suite (design step 4): `test/shared/Fakeco.cs` over `SeamDriverAdapter`, `ThirdVendorTransportTests`
            (refs, fetch, push update/create/delete, build, health over the pipe) and `ThirdVendorContractTests`; its
            findings F1–F7 in design.md "Step 4 findings" (F3 held red-first until step 5).

## 2. Find (parallel per project, each finding adversarially verified)

- [x] 2.1 Legacy: code/comments/docs of removed designs and old formats. Done 2026-10-23 (offline, behind the wire): the
      history-comment sweep — the 1.0a proxy 82/70/84/25 → 35/18/21/9 (Engine+Host / Codesys / Twincat / Contracts+Wire;
      what is left matches "is gone" in the IDE sense, not history), PLCopen mentions 7/5/17 → 3/3/5 (each a vendor fact:
      TwinCAT's own PLCopen import, CODESYS's export as a measurement), the stale `codesys-pipe.ps1` reference and the ARCH
      FOLLOW-UP note restated; comments only, no code moved. Legacy CODE found, for 3.1 (no users, no backward compat):
      the network-text v1 detector (`NetworkText.V1Constructs`/`HoldsV1`/`FileHoldsV1`/`IsV1Header`/`V1Refusal`, the
      reader's v1 branch, the CLI's `V1Note`, `NetworkTextV1DetectionTests`) and `TcNetworkWriter.ImportedPinName` (echoes
      the pin names the deleted PLCopen lowering gave boxes Volt created).
- [x] 2.2 Hidden bugs: masking fallbacks, silent defaults, untested branches — a failing test per bug. Done 2026-10-23
      (offline scan of every `?? ""`, `?? false`, bare `catch` in Engine, hosts, Contracts, Wire): FIXED — a TwinCAT
      device whose `ProduceXml` does not parse was read as the empty manifest (T5/B6), now refused by name
      (`TcDeviceDescriptorTests.A_document_that_does_not_parse_is_refused_by_name`); HELD RED until 3.1 — a TwinCAT library
      pin with a name and no `DataType` is dropped silently where CODESYS refuses it (`TcLibraryUntypedPinTests`; a refusal
      fails the whole fetch, so it waits for the live dump); RECORDED — `BeckhoffDriver.BuildProjects` reports an
      unreadable `Solution.Saved` as `dirty: false` (`servedDirty ?? false`), a wire fact (a nullable `dirty`) for the
      protocol-2 release. C5 and the rest of T5 stay in 3.1 (need a live IDE).
- [x] 2.3 Hidden features: behaviour no doc or test states. Done 2026-10-23 (design.md "Step 2.3 as built"): 3 found, 2 kept and pinned, 1 deleted (`KnownOn`). Default (owner 2026-10-23, "continue till fully done"):
      load-bearing behaviour is documented and pinned by a test; behaviour nothing reads is deleted; each one listed
      in design.md with the choice made, so the owner can reverse it. Not a stop for the owner.
      GATE 2026-10-23: 3 review findings fixed red-first (items.html's unreadable-item sentence; the push lookup now
      inverts the minter, `Versioning.FileOf`; `IsVerbatimKind` Ordinal like every extension reader); 4 test cases
      added. Numbers: C# 5120 pass / 0 fail / 1 skip (Engine 3133+1 skip, Cli 357, Connector 153, Twincat 709, Codesys 471,
      Contracts 42, Repo.Gates 255); TS unit 201/0; typecheck + `bun run check` green; path-comparer ratchet 108 → 107
      (TreeLookup 3 → 2). Offline gate: no live IDE run (wire unchanged for every corpus item).
- [x] 2.4 Public-API lens (every project the wire reaches): each request the schema allows but our CLI never sends —
      what the bridge does with it; a wrong code, a lost write or an `INTERNAL_ERROR` for an IDE state is a bug (2.2).
      Done 2026-10-23 (design.md "Step 2.4"): 130 requests probed; 3 root causes FIXED red-first — a null the schema
      does not allow (3 INTERNAL_ERROR, 5 read as absent) refused by the strict reader; a `to` of another kind (accepted,
      write lost) refused in the pre-flight; a path `refs` could not publish (6 shapes accepted under another identity)
      refused by `RequireWireNames`. RECORDED: P3 (project-name comparer → 3.1), P4 (protocol 2), a WRONG_PROJECT
      wording. 45 test cases added (4 files), 0 fixtures; C# Engine 3149+1 skip, Cli 364, Contracts 59, Codesys 476,
      Twincat 709, Connector 153, Relay 72, Repo.Gates 255; TS unit 201. Offline: no live IDE run (the fixes sit above
      the vendor seam; wire unchanged for every CLI request).
      GATE 2026-10-23 (design.md "Step 2.4" Gate): 3 review findings fixed red-first — `volt push` splits a rename git
      paired across KINDS into a delete and a create (it was one `set` the new re-type refusal failed, whole batch);
      the null-entry check is a type-info modifier, so a refusal inside a list entry keeps its index (`$.ops[1].bogus`,
      was `$.bogus`); the dead `ops: null` throw in `PushService.Handle` deleted (census stays 9). 4 test cases added.
      Numbers: C# 5241 pass / 0 fail / 1 skip (Engine 3149+1 skip, Cli 365, Contracts 62, Codesys 476, Twincat 709,
      Connector 153, Relay 72, Repo.Gates 255); TS unit 201/0; typecheck, lint, `bun run check` green; 0 fixtures (no
      LSP/transpiler change, so no fixture map or LSP suite run).

## 3. Rework (project by project, test-first)

- [ ] 3.1 Move misplaced code to its owning project (CODESYS-family code above the contract → down into the hosts;
      shared between the hosts only where 1.2 approved it); delete legacy; fix each bug behind its test.
      - [x] design step 3, design first: "New Ide/ contract" in design.md (the interfaces member by member, the
            Siemens/Rockwell probe, the old contract on the new one, what stays below).
      - [x] design step 3, built beside the old: `Volt.Engine/Seam/` — `IVendorDriver` (session primitives + tree +
            store), the four registries (`KindRegistry`, `LanguageRegistry`, `PropertyKeyRegistry`, `VendorRegistry`) in a
            `Catalog`, `Content`/`BodyText`, `IItemFormat`, `IBodyReader`, `ImplementationLine`. Not wired into `Sync/`.
            Tests: `Volt.Engine.Tests/seam/SeamRegistryTests.cs` (unknown extension refused by name, a duplicate spelling
            refused naming both vendors, the family table expressible and registered twice with the same source set).
      - [x] the new-vendor gate's exact zero over `Volt.Engine/Seam/` (`NewVendorGateTests`).
      - [x] design steps 5–8 (design.md "Step 5/6/7/8 as built"): Sync on the new contract; both hosts implement it;
            the old contract, the adapter and DriverBase deleted; F2–F4 closed; four contract-suite FINDINGS fixed and the
            fifth decided (owner 2026-10-23: a quoted deleteItem version must hold, ITEM_MISSING); docs regenerated
            (protocol stays 1; the wire cleanups are deferred to a protocol-2 release). Pushed e907af268d, small matrix
            green and transcripts identical.
      - [ ] What keeps 4.0b's "after" below "potential" (`input/rating-after.md`), each test-first:
            - the duplicate rule copies (`IsAbstract`, `RejectAll`), the path comparer in ONE place (ratchet 108 toward
              its floor), the exception-to-code mapping toward one place (15);
            - the remaining history comments in src/ (83 Engine lines) and `FamilyContent.cs:104`'s refusal text;
            - C1, T3/T4 (`input/map-and-rating.md`);
            - the silent fallbacks that need a live IDE (C5: `CodesysObjectModel.Libraries` Namespace/Name ?? "",
              `.Task` skipping pous, `.Properties` _objMgr == null; T5: `TcDeviceDescriptor` unparseable XML as an
              empty manifest, `ReadImplementation` binder miss as ""; T2: production branches shaped for the offline
              doubles): measure on an own ide.ps1 instance, then refuse by name or prove the value correct;
            - hidden features (default 2026-10-23, the owner may override): `Materializer.IsVerbatimKind` KEPT and
              pinned by a test; `CodesysPlatform.Capability.KnownOn` DELETED (`test/e2e/lib/platform.ts` holds the
              platform facts) — DONE in 2.3;
            - the behind-the-wire inputs since 2026-10-18 above: unsaved CFC/SFC on a TwinCAT move (`CarryLive`), the
              e2e redundant-read cut, `ide-restart` on the one-worker-per-XAE model.
            - from 2.1/2.2: delete the network-text v1 detector and `ImportedPinName`; the untyped TwinCAT library pin
              (`TcLibraryUntypedPinTests`, held red): measure the full live dump, then refuse by name.
      - [x] 3.1a (gate, 2026-10-23) of the first half of the list above — DONE: the duplicate rule copies (`IsAbstract` →
            `StReader.MemberHeaderIsAbstract`, `RejectAll`), the ONE path comparer (`ItemPath.SameItem`/`SameSpelling`;
            ratchet 107 → 37, the rest compare no wire path), the exception-to-code mapping (15 → 10, `TreeLookup.Read`),
            C1 (`CodesysObjectModel.Modify`), T3 (`TcArchive.Bits`), the network-text v1 detector and `ImportedPinName`
            deleted. Not claimed by this gate: the history comments (partly touched), T4, C5/T5/T2 (live), the inputs, the
            untyped library pin. Review findings fixed first, each test-first:
            - the shared case set lost `v1-let`: put back as `let-statement` and `header-number` with the bridge's own
              phrases (red on the LSP), then the LSP's v1 pre-scan (`parser.ts` `v1Constructs`, `words.ts` `v1Refusal`)
              deleted — both readers now give one answer; the server test that pinned "re-pull" now pins the push's
              header refusal (its premise, the v1 detector, is deleted by this list).
            - DIALECT N22 and `parity-fixes.test.ts` no longer describe the deleted stamp.
            - `StReader.MemberHeaderIsAbstract(null)` refuses again (`FallbackRefusalTests`, red first); the guard's
              declarations are typed non-null, as `Member`/`ItemContent` already are.
            - volt-control's conflict-note comment and test describe the note the CLI still sends (UNSUPPORTED), not v1.
            - FOR THE OWNER (no code change): TwinCAT `MAX(a, b)` over a body holding `In1`/`In2` (the old PLCopen import's
              names, `importer-max.TcPOU`) was accepted with the names blanked and is now REFUSED naming the pin
              (`TcStructuralEditTests.A_positional_push_over_named_pins_is_refused_naming_the_first`). Asked for by this
              list and loud; 0 occurrences in the six corpora. A behaviour flip, not a refactor result.
            Numbers: C# 5191 pass / 0 fail / 1 skip (Engine 3114+1 skip, Cli 352, Contracts 62, Codesys 476, Twincat 707,
            Connector 153, Relay 72, Repo.Gates 255; −50 vs 2.4: the v1 tests deleted with the detector); TS unit 201/0;
            volt-control 145/0; LSP full suite (VOLT_REQUIRE_FULL=1) 10386 pass / 0 fail / 34 skip / 428 todo, after its own v1
            parse test was rewritten to the push's phrases (first full run: 1 fail there); typecheck, lint, `bun run check` green; fixture map unchanged (no
            fixture or transpiler change). Live small matrix: at the next push (3.3).
      - [x] 3.1b (2026-10-23) the live remainder, each measured on an own `ide.ps1 -Instance volt-cli-rework` IDE, then
            refused by name or proved correct, red first:
            - C5 (live CODESYS 3.5.21.40 64-bit, CodesysTestProject): 60 library references, every one answers
              `Namespace` and `Name` (0 unreadable); the walk's de-duplication key now READS them and a reference answering
              neither is named by its display name (`CodesysLibraryRefReadTests.References_that_answer_no_namespace_and_no_name_are_each_named`),
              never folded into another's key and read as deleted. Every task facet has `pous` (task-writable e2e, call
              list pushed and read back); a facet without it is UNSUPPORTED by name (`CodesysTaskCallListRefusalTests`).
              `ContainerRefusal`'s `_objMgr == null` → "holds none" deleted: a folder with no object manager is named
              unreadable and its contents unwalked (`CodesysContainerRefusalTests`).
            - T5: `ReadImplementation`'s binder miss MEASURED correct (live TcXaeShell 15.0, Project14: a GVL, DUT, folder,
              task and library manager raise `RuntimeBinderException` for `ImplementationText`; every POU/method/action
              answers a string) — kept, documented (DIALECT D35); the unparseable device XML was fixed in 2.2.
            - T2: `TcObjectModel.Build`/`Exclusion`/`SavedFacts` lost their "no ProduceXml → nothing to read" branch (no
              TwinCAT tree item lacks it); the offline doubles answer it (`TcItemXml`), and a node that does not fails loud
              (`TcSilentFallbackTests.A_node_that_answers_no_automation_XML_is_not_read_as_a_plain_built_object`).
            - Hidden features: `IsVerbatimKind` kept + pinned, `KnownOn` deleted — done in 2.3.
            - Inputs since 2026-10-18: `CarryLive` — XAE answers a CFC/SFC `ImplementationText` as the element the
              `.TcPOU` saves (equal as parsed XML, `VltFixtureCfc`/`VltFixtureSfc`; DIALECT D45), so the round trip moves
              one held as saved and REFUSES one edited since the save by name before anything is deleted (`TcItemArchiveTests`,
              3 cases). The e2e redundant-read cut: `applications()` read once, `pushOps`/`updateItem` reuse the `refs` they
              just read, `fetchItem` of a path asks `fetch` alone; the harness now counts and prints its requests
              (`test/request-count.ts`). Measured, full CODESYS e2e on the same IDE: `refs` 2918 → 2237 (−681, −23 %),
              every other op unchanged, 534 pass / 0 fail / 79 skip both runs. `ide-restart` rewritten to the
              one-worker-per-XAE model (the killed XAE's worker answers `PLC_DISCONNECTED`; the project opened again
              through the same instance is a new XAE served by a new worker): 2/2 live (VOLT_E2E_IDE_CHAOS=1, Project14).
            - The untyped TwinCAT library pin: the full live dump (Project14, 3 libraries, 181,179 characters) holds 1,457
              entries, every one named and typed, so the refusal costs no measured project its signatures;
              `TcLibraryUntypedPinTests` un-held (green), the pin refused naming it and its signature.
            Numbers: C# Twincat 712, Codesys 479, Repo.Gates 255 (census: Task.cs 9 → 10, TcItemArchive 1 → 2 and
            TcLibrarySignatures 1 → 2 throws); TS unit 210/0; typecheck green; live: CODESYS e2e 534/0/79, TwinCAT
            no-save + folder-preservation + task-writable 23/0, ide-restart 2/0. 0 fixtures (no LSP or transpiler change).
            Gate review findings, fixed first (each test-first):
            - `ide-restart` (b) served a FRESH fixture copy (`ide.ps1 up -Fixture` deletes and re-copies), so "the same
              project" held by construction. `ide.ps1 up -Reopen` (TwinCAT) now opens the instance's OWN recorded copy as
              it is on disk — no fresh copy, no recovery entry cleared — and the test writes a marker into that copy before
              the kill and asserts it, and the folder, after. The worker is still spawned by `ide.ps1` with the connector's
              arguments (the real connector would attach workers to XAE windows this run does not own); the connector's
              half — a new XAE pid gets its own worker, the closed one's is reaped — is pinned offline
              (`TwincatFleetTests.A_project_opened_again_in_a_new_XAE_gets_a_new_worker_and_the_closed_one_is_reaped`).
              Live 2/2 (VOLT_E2E_IDE_CHAOS=1, Project14).
            - 3.1 and "What keeps 4.0b's after below potential" UNTICKED: not done by 3.1a/3.1b and still open — the
              history comments in src/ (29 Engine lines match `used to|no longer|is gone|was deleted|WAS:`),
              `FamilyContent.cs:104`'s refusal text, and T4. They are the rest of 3.1.
            - A nameless library pin: CODESYS (`CodesysObjectModel.LibraryVars`, split out and pinned by
              `CodesysLibrarySignatureVarsTests`) now refuses it by name as TwinCAT does; the one nameless variable CODESYS
              states, an `Alias` signature's base in `AllVariables`, is read as `AliasBase` and skipped by name. TwinCAT's
              nameless `TypeSignature` (skipped with no tally) is refused naming its library
              (`TcLibrarySignaturesTests.A_signature_with_no_name_is_refused_naming_its_library`). Measured live: CODESYS
              libcache + full e2e and TwinCAT libcache extract every signature with the refusals in place.
            - A plain library reference answering no namespace, no name and no placeholder name has NO identity: the
              manager is now refused saying so (deliberately, not by `RefDisplayName` throwing inside a catch), nothing
              under it read as deleted; two unkeyed references with one placeholder name are one identity, named once
              (`CodesysLibraryRefReadTests`, 2 cases).
            - `fetchItem` of a path asks `refs` again: every create-then-read keeps checking that `refs` lists what `fetch`
              serves. Re-measured, full CODESYS e2e: `refs` 2918 → 2871 (−47, −2 %; the −681 above came mostly from that
              skipped check), 534 pass / 0 fail / 79 skip.
            Gate numbers: C# 5208 pass / 0 fail / 1 skip (Engine 3114+1 skip, Cli 352, Contracts 62, Codesys 485, Twincat 714,
            Connector 154, Relay 72, Repo.Gates 255; census: Libraries.cs UNSUPPORTED 1 → 2, uncoded 17 → 18,
            TcLibrarySignatures 2 → 3); TS unit 210/0; typecheck, lint, `bun run check` green; LSP full suite
            (VOLT_REQUIRE_FULL=1) 10386 pass / 0 fail / 34 skip / 428 todo; live: CODESYS e2e 534/0/79, TwinCAT libcache 2/0, ide-restart 2/0. Fixture map
            unchanged (no fixture or transpiler change).
- [x] 3.2 (option C: the Engine above the contract was rewritten in steps 5–7; nothing else reimplemented) Reimplement only the projects the owner approved in 1.2, behind the same tests.
- [ ] 3.3 (live check per push, owner 2026-10-23: the SMALL matrix, `bun run release:matrix --only
      codesys-3.5.22.40-64,twincat-32 --jobs 1`; the FULL matrix once before 4.1) Every step: full C# suites + TS e2e on both vendors + the contract suite; the wire transcript byte-identical
      to 1.3's recording (a 1.2 wire deletion re-records it once, in its own change, before the rework).
- [ ] 3.4 The new-vendor gate from 1.3 green; the third test vendor still passes.

## 4. Close

- [x] 4.0b QUALITY RATING after: the 1.0a criteria re-scored with evidence, before → potential (1.2) → after.
      Done 2026-10-23 offline: `input/rating-after.md` (Engine 5 → ~8 → 6.5, Codesys 6.5 → ~8 → 6.5, Twincat 5.5 → ~7.5 → 6,
      Contracts + Wire 6 → ~8 → 6; what keeps "after" below "potential" is listed there).
- [x] 4.0 LOC after: the 1.0 measurement again, before → after per project (code / comment / blank).
      Done 2026-10-23: `input/rating-after.md` (baseline, pre-rework `3fab0d5266` and after; the rework added 846 Engine code lines).
- [x] 4.0a `ARCHITECTURE.md` gains "Adding a vendor": exactly what a host implements (the `Ide/` contract), and the
      registration points above the wire a vendor still needs — the connector's launch, the installer payload, the LSP
      dialect — which are the front-of-wire phase's work, not this change's.
- [ ] 4.0c QUALITY RATING again after 2.x and the rest of 3.1, into `input/rating-after.md` (before → potential → after).
- [ ] 4.1 ARCHITECTURE.md / DIALECT.md / READMEs match the code; final placement review; archive.

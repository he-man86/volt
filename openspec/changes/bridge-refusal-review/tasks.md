> **Re-baseline before working on DUT items (note 2026-10-02).** `push-without-header-check` §5 pivoted (2026-10-02)
> to ONE DUT extension `.dut` — no subtype on the wire, no classifier. Every refusal or finding below that concerns
> DUT naming, the DUT subtype or `INVALID_CODE_HEADER` must be re-baselined against the code AFTER §5 lands, before
> it is worked on: its file, line, code or premise may no longer exist.

## 0. Order and method

- [ ] 0.1 Start after `push-without-header-check` (its header removal is done; do not repeat it). Its 4.1 fixtures
      (unclosed `(*` in DUT/FB/GVL) are the pattern for §5.
- [ ] 0.2 Every REMOVE/CHANGE task is test-first: a C# test that is red on today's refusal and asserts the new
      behaviour (the write happens / the code is the right one). Where a code check goes, the IDE's recorded compile
      error replaces it: record the build live (CODESYS SP21; TwinCAT where the construct exists) as a conformance
      fixture, and add the LSP parity case (§5). A test whose premise was a removed code check is rewritten, not
      deleted: its premise (the bridge judges the code) is wrong on grounds independent of behaviour.

## 1. Remove — code checks

- [ ] 1.1 `StReader.cs:460` — drop the "IMPLEMENTATION ST whose body is network text" refusal. Test: an ST body
      holding `NETWORK … END_NETWORK` under `IMPLEMENTATION ST` is written as sent; record the CODESYS build error.
- [ ] 1.2 `StReader.cs:489` — delete `RefuseReservedNames`. Test: `implementation : INT;`, `x := implementation;`
      and an enum value `Implementation` push; the boundary-shaped lines stay refused by 386/525. Record: compiles
      clean.
- [ ] 1.3 `NetworkTextReader.cs:1003` — drop "shaped like a wire and undeclared". A bare `gN` is a Leaf. Test with
      `g5 AT %IX0.0 : BOOL;` (a real variable) and with an undeclared `g7`; record the build's undeclared-identifier
      error for the latter.
- [ ] 1.4 `Materializer.cs:37` — delete `RefuseRetiredComment` on pull. Test: a DUT, a GVL and a POU holding
      `(* @volt-note *)` in the IDE pull and are readable.
- [ ] 1.5 `CodesysNetworkWriter.cs:163` — drop the `.ENO`-without-EN arm; keep :155 and :159. Test: the push writes
      the box; record CODESYS "Missing EN pin".

## 2. Change

- [ ] 2.1 `StReader.cs:123` — retired-comment scan only when no boundary line exists, as a hint inside Unmarked (734).
      Test: current-format POU with `(* @volt-x *)` in an ST body pushes.
- [ ] 2.2 `StReader.cs:333` — unexpected composite kind → `ArgumentException` / INTERNAL_ERROR.
- [ ] 2.3 `StReader.cs:464` — delete the sniffed LD/FBD "not network text" copy; `NetworkTextReader:189` answers with
      NETWORK_PARSE and a line. Delete `NetworkText.OpensNetwork` with 1.1.
- [ ] 2.4 `StReader.cs:795` — "nothing after ':'" no longer refused in the reader; the TwinCAT driver refuses an
      interface-member create whose seed type is null, by name. Record the build error for a METHOD with `:` and no type.
- [ ] 2.5 `StReader.cs:805` — no modifier vocabulary: the name is the last word before `:`, the line passes through
      (after 3.1). Record the build error for `METHOD FOO Bar`.
- [ ] 2.6 `StReader.cs:852` — "property must declare a type" goes for POU properties (build reports it); interface
      property on TwinCAT handled as 2.4.
- [ ] 2.7 `NetworkTextReader.cs:285` — second / late VAR_TEMP block: read, and let the writer canonicalize.
- [ ] 2.8 `NetworkTextReader.cs:292` — declared-never-defined wire: dropped on write, not refused.
- [ ] 2.9 `NetworkTextReader.cs:330` — empty VAR_TEMP block accepted.
- [ ] 2.10 `NetworkTextReader.cs:362` — wire named like a scope variable: accepted (wires resolve first).
- [ ] 2.11 `NetworkTextReader.cs:1015` — wire also spelled as another name: accepted, same rule.
- [ ] 2.12 `NetworkTextGate.cs:88` — `NETWORK_NOT_CANONICAL` goes: write the model; return the canonical text (push
      response or next pull). Remove the code from `Volt.Contracts/Vocabulary/ConflictCodes.cs`. `PushedText` keeps
      comparing layout-free.
- [ ] 2.13 `TaskDescriptorFormat.cs:117` — non-canonical `.task` written; canonical text comes back.
- [ ] 2.14 `PushService.cs:435` — last-moment set re-check raises `STALE_ITEM_VERSION` (with D15, D16).
- [ ] 2.15 `PushService.cs:459` — last-moment delete re-check raises `STALE_ITEM_VERSION`.
- [ ] 2.16 `PushService.cs:903` — take the wire kind from the caller that validated it; delete the re-derivation.
- [ ] 2.17 `PushService.cs:1369` — unknown top-level kind → INTERNAL_ERROR.
- [ ] 2.18 `ItemKind.cs:275` — unknown member kind → INTERNAL_ERROR.
- [ ] 2.19 `Materializer.cs:92` — a DUT whose text states no subtype stays addressable (decided in D1). Record both
      vendors' build errors for `TYPE X : END_TYPE` and the unclosed-comment DUT.
- [ ] 2.20 `CodesysNetworkWriter.cs:284` — unreachable FB-without-instance arm → INTERNAL_ERROR, model-invariant
      message, no v1 wording.
- [ ] 2.21 `CodesysNetworkWriter.cs:37` — graphical text at an item with no Implementation aspect → one named
      UNSUPPORTED (with D26).
- [ ] 2.22 `CodesysNetworkWriter.cs:51` — FBD↔LD view change written (after 3.5), else one named refusal in pre-flight (D7).
- [ ] 2.23 `CodesysDriver.Content.cs:190` — unknown view mode → UNSUPPORTED body marker naming it; declaration and
      members still pull (D27).
- [ ] 2.24 `CodesysDriver.Content.cs:208` — unknown body aspect → marker (D27).
- [ ] 2.25 `CodesysObjectModel.Descriptors.cs:296` — unknown task `Type:` → BAD_REQUEST (as TcTaskSchedule).
- [ ] 2.26 `CodesysObjectModel.Libraries.cs:427` — accessor create after the fact → NotSupportedException / UNSUPPORTED.
- [ ] 2.27 `BeckhoffDriver.Content.cs:60` — `ValidateSource` takes the engine's validated models, no re-parse (D8).
- [ ] 2.28 `BeckhoffDriver.Content.cs:66` — PLCopen create refusals pre-flighted per BODY (D21). Test: a new graphical
      method with an Execute box in an existing POU is refused before any op lands.
- [ ] 2.29 `BeckhoffDriver.Content.cs:343` (and :359) — missing/unknown DefaultViewMode → marker (D27).
- [ ] 2.30 `TcNetworkWriter.cs:152` — unreachable arm → INTERNAL_ERROR.
- [ ] 2.31 `TcNetworkWriter.cs:165` — FBD↔LD view change written via DefaultViewMode on update (after 3.5).
- [ ] 2.32 `TcNetworkWriter.cs:934` — RESET in `Bits` → InvalidOperationException with CODESYS's message (D23).
- [ ] 2.33 `TcPlcOpenWriter.cs:339` (and :177, :187, :295, :328, :341, :394, :427, :477, :483) — model invariants →
      INTERNAL_ERROR, "Volt bug", not "cannot express as PLCopen".
- [ ] 2.34 `TcArchive.cs:73` — unknown `<root>` language → marker (D27).
- [ ] 2.35 `BeckhoffDriver.Tree.cs:322` — move post-condition → INTERNAL_ERROR.

## 3. Measure (live; record the outcome in DIALECT.md, then keep or change)

- [ ] 3.1 `StReader.cs:809` — what `CreateChild` does with a non-IEC / non-ASCII name on CODESYS and TwinCAT. Clean
      vendor refusal → delete and map it; otherwise keep a pre-flight that is the vendor's measured rule.
- [ ] 3.2 `NetworkTextReader.cs:1036` — does the build report a declared wire type contradicting its producer?
      Yes → remove and record; silently kept → vendor-limit, keep.
- [ ] 3.3 `BodyFormatGuard.cs:164` — can FBD/LD → ST be written in place on either vendor?
- [ ] 3.4 `BodyFormatGuard.cs:168` — can ST → LD/FBD be written on an existing body? Fix the message either way
      (graphical bodies ARE created by push).
- [ ] 3.5 `NetworkText.cs:148` — can DefaultViewMode be set on an update on live CODESYS (TwinCAT: on create already)?
- [ ] 3.6 `CodesysDriver.Content.cs:441` — CODESYS interface-accessor write: taken, refused or crash? (D28)
- [ ] 3.7 `BeckhoffDriver.Content.cs:516` — which NotSupportedExceptions reach the Stamp catch on real creates (D24).
- [ ] 3.8 `TcNetworkWriter.cs:166` / `TcPlcOpenWriter.cs:50` — TwinCAT's negation/edge order.
- [ ] 3.9 `TcTaskSchedule.cs:82` — XML-escaped `Priority:` passed through: does TwinCAT's read-back decide validity?

## 4. Design issues

- [ ] 4.1 D1 — decide ONE source for a DUT's subtype (owner decision). Either a DUT stating no subtype stays
      addressable under its bare identity (listed unreadable, updatable by any `X.<subtype>` push with a version from
      its raw text), or record that it needs `--force` and correct `push-without-header-check` 1.2. Test the
      `c802b74d` DUT: push, refs, fix, push again.
- [ ] 4.2 D2 — CODESYS POU kind from the IDE's object/POU-type fact (measure SP21); no `PlcPouFb` default — an
      unknown kind is reported by name.
- [ ] 4.3 D3 — `declarationOf` returns (kind, declaration), kind from the wire name or the IDE tree; delete
      `IsCallableHeader`, `IsGlobalListHeader`, `FunctionBlockHeader`; `ProjectDeclarations` / `DeclarationsIn`
      select GVLs by kind.
- [ ] 4.4 D4 — a call-target type neither the project nor the library manifest names is refused by name; delete
      `NonBlockTypeWords`.
- [ ] 4.5 D5 — no refusal depends on the regex scope (closed by 1.3, 2.10, 2.11); if a name set is still needed,
      take it from the IDE.
- [ ] 4.6 D6 — carry the live body language on `ItemContent`/`Member` from the driver; `BodyFormatGuard` stops
      sniffing text.
- [ ] 4.7 D7 — one language-change comparison in `BodyFormatGuard`, pre-flight, UNSUPPORTED, same on both vendors;
      `RefuseViewModeChange` leaves the drivers; CODESYS's raw member error replaced by the named refusal.
- [ ] 4.8 D8 — pre-flight validates each network body once and passes the `NetworkBody` model to the write; drivers
      take a model, never text; the create-arm copies go.
- [ ] 4.9 D9 — StReader content scans gone (1.2, 2.1); one message for empty text and Unmarked; `Shape` does not
      match a bare `Implementation` wrapped-expression line (test: an ST body with that line pulls).
- [ ] 4.10 D10 — `ParseSignature` returns name + type text, no vocabulary (2.4-2.6, 3.1).
- [ ] 4.11 D11 — one shape table per kind on `ItemKind`; reader, writer, guard, `CanHold` ask it; fix the
      `InterfaceMethod` branch in `BodyFormatGuard`.
- [ ] 4.12 D12 — merged into 4.8 / 2.27; verify TwinCAT validates each body once.
- [ ] 4.13 D13 — canonical gates gone (2.12, 2.13) and the reader's layout rules with them (2.7-2.11).
- [ ] 4.14 D14 — `TaskDescriptorException` becomes a coded `BridgeException` (BAD_REQUEST); every re-code in §2
      covered by a code-asserting test.
- [ ] 4.15 D15 — one last-moment version helper on `Versioning.SafeVersion`; null folder/kind → ITEM_UNVERIFIED on
      both arms.
- [ ] 4.16 D16 — `currentFolder` nullable ("unknown"); uncached item → ITEM_UNVERIFIED, not a hash against root;
      move compare treats unknown as unknown.
- [ ] 4.17 D17 — `Owner()` and member-folder misses throw NOT_FOUND by name.
- [ ] 4.18 D18 — rewrite `ItemKind.cs:293` and `DutSubtypeChanges` docs/message to the current rule.
- [ ] 4.19 D19 — compute the landing wire name once; the same one goes to the engine read and `ValidateSource`.
- [ ] 4.20 D20 — TwinCAT member kind: no `?? Method` / `?? ""`; share one `MemberKind(code, ownerIsInterface)` in
      the engine.
- [ ] 4.21 D21 — covered by 2.28.
- [ ] 4.22 D22 — N21 stated once (engine), vendor fact as data; after 1.5 only the "cannot build what the text means"
      arms remain on both vendors.
- [ ] 4.23 D23 — covered by 2.32.
- [ ] 4.24 D24 — a dedicated regrouping exception; the Stamp catch catches only it (after 3.7).
- [ ] 4.25 D25 — the in-place refusal travels as the inner exception / in the message when the rebuild also refuses;
      fix :488's wording.
- [ ] 4.26 D26 — a body pushed at an item with no body slot is refused by name on both vendors; ask the object, not a
      kind table.
- [ ] 4.27 D27 — covered by 2.23, 2.24, 2.29, 2.34; the marker grammar accepts a vendor-named unknown language.
- [ ] 4.28 D28 — covered by 3.6: refusal TwinCAT-only if CODESYS takes the write.
- [ ] 4.29 D29 — measure `ErrorList.ErrorItems` on TcXaeShell; read diagnostics structurally or record why not.
- [ ] 4.30 D30 — `LibraryManifestFromXml` requires the members the vendor XML always carries (measure which); a
      missing one makes the manifest unreadable.

## 5. LSP parity (`packages/volt-lsp-iec`)

- [ ] 5.1 Conformance fixtures + live recordings for every row of the proposal's "What the LSP must pick up" table
      (1.1, 1.2, 1.3, 1.5, 2.4, 2.5, 2.6, 2.19, and 3.1/3.2 if they remove).
- [ ] 5.2 LSP reports each recorded error with the build's message and line; reports nothing for `implementation` as
      an identifier, a `(* @volt-` comment, and the layout rules. Colocated src test per fix.

## 6. Gate — no code-check left

- [ ] 6.1 Full C# suites green; e2e on both vendors.
- [ ] 6.2 Grep gate (in `Volt.Repo.Gates` or a script) over `packages/volt-cli/src`: zero hits for `OpensNetwork`,
      `RefuseReservedNames`, `RefuseRetiredComment`, `NETWORK_NOT_CANONICAL`, `IsCallableHeader`,
      `IsGlobalListHeader`, `IsFunctionBlockType`, `NonBlockTypeWords`, `INVALID_CODE_HEADER`, `ParseCodeHeader`,
      `?? ItemKind.Kinds.Method`, `PlcPouFb; // default`; `CodeHelper.HeaderLine` used only by child delimiting.
- [ ] 6.3 Re-census: every `throw` / refusal site in `Volt.Engine/Format`, `Volt.Engine/Sync`, `Volt.Engine/Ide` and
      both drivers appears in the proposal's table as keep; any new site is classified before it lands.

## Error-code vocabulary (owner question, 2026-09-29)

All 22 codes are still raised somewhere (no dead code), but not all fit what they report.

- [ ] V.1 Codes on the wrong situation: a stale item version raised as `BAD_REQUEST` → `STALE_ITEM_VERSION`; a refused
      `.task` and known vendor limits raised as `INTERNAL_ERROR` → `UNSUPPORTED`; model errors worded as "cannot express as
      PLCopen" (PLCopen is deleted) → say what the model lacks. `INTERNAL_ERROR` is left for Volt's own broken invariants only.
- [ ] V.2 `NETWORK_NOT_CANONICAL` goes with the layout-only gate (design issue 6): text that is complete and writable is
      written; the code is removed from Volt.Contracts, ConflictCodes, wire.html and the LSP's network code list.
- [ ] V.3 `NO_SIDECAR` ("supply knownItems … or run `volt init`") is named after an internal cache a client never sees:
      rename to a request-shape code or fold into `BAD_REQUEST` with the same message; update clients and wire.html.
- [ ] V.4 Gate: every code in BridgeErrorCodes/ConflictCodes is raised by production code AND documented in wire.html
      with the situation it means; a code raised for two different kinds of situation fails the gate.

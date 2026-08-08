## 0. Evidence already in hand (do not re-derive)

Four independent surveys of the current architecture. Their findings are the basis of this change; the numbers
below are measured, not estimated.

- **Layering:** `PlcOpenDocument.cs` is 4 unrelated tenants; `PlcOpenPouParser` has zero dependencies;
  `GraphicalCode.Read` is test-only in production; two wrong-direction edges out of `PlcOpenDocument`.
- **IDE surface:** `ICodeStore.ReadImplementation` has zero production call sites. The single-document write
  covers **update only** — create and move still issue a COM call per child. Two splice-and-import implementations
  coexist (`PouDocument.Splice` and `GraphicalCode.Write`).
- **Blast radius:** 49 files, ~86% mechanical, 0 build-tooling coupling, 0 cross-package impact.
- **Dialect census:** 16 category-A (tolerant union), 7 category-B (genuinely per-vendor), 6 category-C (vendor
  limits), **16 category-D (never measured)**. Full table in `dialect-census.md`.

Hard constraints, both verified:

- `Volt.Engine` is `netstandard2.0` (loads in CODESYS's net48 IronPython host AND net8) and is copied to five
  `dist/` targets. **No new assemblies.**
- `WireVocabularyGuardTests.cs:62` keys an exemption set on **bare filenames**. Splitting a file in that set breaks
  the build; widening the set carelessly disables a guard that has already caught three real leaks.

## 1. Defects first — behaviour before layout

A rename commit must not carry a behaviour change. Each of these lands, with its own test, BEFORE anything moves.

- [x] 1.1 **DONE — CFC body classified as textual.** Add tolerance for the nested shape
      (`<body>/<addData>/<data name="…/cfc">/<CFC>`) to the body-language lookup and to `GraphicalBodyLang`.
      Regression test over the RECORDED `codesys-pou/FB_GraphicalChild.plcopen.xml`, asserting the language reads
      as `CFC` and that a textual write onto it is REFUSED. Red before the fix — today it reads `ST`.
      > Note the existing `PouDocumentTests` CFC case passes only because the guard does not fire. It must be
      > re-read after this fix: its assertion (the CFC block survives byte-identical) should still hold, but for
      > the right reason. If the fix turns it red, the FIX is right and the test's premise was wrong.
- [x] 1.2 **DONE — deleted.** Every caller, production and test, either omitted the parameter or passed the element's own name, so the override never carried anything and the case it documented was never handled. Threading a real COM language in would cost a per-item vendor call on the read path (~20 ms on CODESYS) to fix an EMPTY body's label; the gap is recorded in `DIALECT.md` instead.
      Original text: decide the **LD-as-FBD read override**: thread the vendor's COM body language through `Materializer`, or
      delete the parameter. Do not leave a parameter documented as handling a case it never receives.
- [x] 1.3 **DONE — the ladder writer re-emits it**, before the network-title marker (the shape both vendors emit, recorded in `tc-ld/ld_four_networks_shared_rails.plcopen.xml:33`). Regression test asserts presence, ORDER, and that it reads back.
      Original text: **LD network `<comment>` dropped on push** — `WriteLadderBody` re-emits it like `WriteFbdBody` does, or
      the drop is recorded as deliberate in `DIALECT.md`. Silent deletion of a user's comment is neither.
- [x] 1.4 **DONE** — Engine 392 / Cli 124 / Connector 80, and live CODESYS e2e **98 pass / 8 skip / 0 fail**.
      Original gate: three offline suites + live CODESYS e2e at the current baseline (**98 pass / 8 skip / 0 fail**).

## 2. Dead surfaces — delete before moving, so less moves

- [x] 2.1 **DONE** — `ICodeStore.ReadImplementation` — zero production call sites. Compiler-verified; both drivers, `FakeIde`
      and one test double lose a member.
- [x] 2.2 **DONE** — `PlcOpenDocument.OwnDescendant` (singular) — no callers since the two-copy declaration fix.
- [x] 2.3 **DONE — KEPT, and now says why.** It is the only entry point exercising the whole read pipeline against a fake code store with no live IDE; its doc-comment now names the 13 tests and the cross-package marker contract that hang off it, so the next reader does not mistake it for dead weight.
      Original text: re-check `GraphicalCode.Read`/`DeclarationFrom` (test-only in production). **Do NOT delete blind**: 13
      tests in `GraphicalCodeTests` drive the offline gate through it, including the cross-package
      `Graphical_body_marker_matches_the_lsp_hover_shape` contract. Either keep it and say plainly that it is a
      test seam, or move those tests onto the production path. Deleting it silently drops that coverage.

## 3. The move — mechanical, one commit, no behaviour change

- [x] 3.1 **DONE** — `Volt.Engine.PlcOpen` exists; `PlcOpenPouParser` → `PlcOpen/PouReader.cs`.
      Create `Volt.Engine.PlcOpen`. Move `PlcOpenPouParser` → `PlcOpen/PouReader.cs` (rename: it reads a whole
      POU, it is not only a parser).
- [x] 3.2 **DONE** — split four ways exactly as planned.
      Split `PlcOpenDocument.cs`:
      - shared privates (`OwnerOf`, `ItemBody`, `OwnDescendants`, `Serialize`) → `PlcOpen/PlcOpenDocument.cs`
      - group B (the six splice members) → `PlcOpen/PouSplice.cs`
      - group C (`SpliceFbdLdBody`, `ValidateExisting`, `SafeToDrop`, `HasPinMod`, `FindFbdLd`) →
        `Graphical/GraphicalBodySplice.cs`
      - `InstanceTypes` → `Workspace/SourceText/`
      - `DeclFromExport`, `FindFbdLdBody`, `GraphicalBodyLang` → follow their callers; `GraphicalBodyLang` is the
        CODESYS driver's, the other two are `GraphicalCode.Read`'s (see 2.3 first).
- [x] 3.3 **DONE, and the stated expectation was WRONG.** 3.4 removed `PouSplice`'s dependency on `ItemKind`,
      but the file still legitimately contains `"Method"`/`"action"`/`"Property"` — those are XML ELEMENT names in
      the vendor schema, and the guard matches raw literals whatever the reason. So `PouSplice.cs` DOES need the
      entry, and so does the new `PlcOpenDocument.cs`: the split turned one exempt file into three, each resolving
      elements BY NAME. Same rule, same reason, more files — not a widened exemption.
      Original text: update `WireVocabularyGuardTests`'s filename set to the NEW files, deciding per file whether it
      legitimately holds `"pou"`/`"method"`/`"action"` as XML element names. After 3.4, `PouSplice.cs` should NOT
      need an entry — that is the check that 3.4 actually worked.
- [x] 3.4 **DONE** — `AddChild` takes `PouMember`; `Sync.PouDocument.MemberOf` maps.
      `AddChild` takes a PlcOpen-native member kind, not `ItemKind.Kinds.*`; `Sync/PouDocument` maps. Removes
      the Workspace→PlcOpen wrong-direction edge.
- [x] 3.5 **HELD** — reader/writer/parser/writer untouched and still in one namespace.
      Do NOT split `PlcOpenReader`/`PlcOpenWriter`/`VgParser`/`VgWriter` behind visibility boundaries — six
      suites assert them in a single round-trip expression, and per-leg assertions weaken
      "round-trips losslessly OR is refused".
- [x] 3.6 **HELD** — neither `Materializer.VgBodyOf` nor the LSP's TypeScript `VgBody` was touched.
      Watch the `VgBody` name collision: `Materializer` has a private `VgBodyOf`, and `volt-lsp-iec` declares
      its own unrelated TypeScript `interface VgBody`. Neither is to be touched.
- [x] 3.7 **DONE** — Engine 392 / Cli 124 / Connector 80, counts unchanged.
      Gate: build + three offline suites, unchanged counts. A moved file that changes a test count means
      something moved that shouldn't have.

## 4. Docs — the layer table IS the design statement

- [x] 4.1 **DONE** — layer table now has a `PlcOpen/` row and a rewritten `Graphical/` row; the content-vs-structure rule is a stated invariant; `:180` `Core.Graphical` fixed; the accessor invariant now cites `PouReader.Accessor` (the old symbol did not exist); convention 11 records the FIFTH instance of the same name-scoping bug.
      `ARCHITECTURE.md`: rewrite the `Graphical/` layer row; add the `PlcOpen/` row; state the content-vs-
      structure rule plainly. Fix `:180` (`Core.Graphical` — stale since a previous rename) and `:135-136`, which
      cites `PlcOpenDocument.InterfacePropertyAccessors`, **a member that does not exist**.
- [x] 4.2 **DONE** — the §13 table's paths are still correct (those files stayed in `Graphical/`); two `src/...` shorthand paths made absolute.
      `docs/vg-language.md` §13 reference table (five literal paths), `:156`, `:327`.
- [x] 4.3 **DONE** — paths verified correct; no change needed.
      `docs/vg-diagnostics.md` `:8`, `:76`.
- [x] 4.4 **DONE** — layer stack updated and the content-vs-structure rule named, pointing at `DIALECT.md`.
      Root `CLAUDE.md` `:106` layer stack.
- [x] 4.5 **DONE** — it is now "the PLCopen DOCUMENT — a POU's whole content", with why the old label was wrong.
      `ICodeStore`'s section header — it is not "Transport 2: graphical" any more.
- [x] 4.6 **DONE** — all six. Two were deleted with their code in §1; the other four are corrected in place, each saying what it used to claim so the correction is not silently re-reverted.
      The six false comments the census found (list in `dialect-census.md` Part 9). Convention 8: a false
      comment is a defect.
- [x] 4.7 **HELD** — `openspec/changes/archive/` untouched.
      Leave `openspec/changes/archive/` untouched. Rewriting a frozen record falsifies it.

## 5. The dialect, made checkable

- [x] 5.1 **DONE** — the census moved to `src/Volt.Engine/PlcOpen/DIALECT.md`, beside the code it describes. A change folder gets archived; two vendors do not stop existing. The change dir keeps a pointer.
      `PlcOpen/DIALECT.md` — the A/B/C/D census as the ONE home for vendor facts, each citing the fixture that
      proves it or marked UNMEASURED. Retire the ~20 scattered doc-comments that currently hold these claims, so
      there is one place to correct when a measurement lands.
- [x] 5.2 **DONE — recorded, and it closed TWO unknowns.** `tc-pou/FB_TcMembers.plcopen.xml`, captured live from
      TcXaeShell (an FB with a method, a property and BOTH accessors — a shape that existed nowhere in the repo).
      **D5 closed: the member shape is IDENTICAL to CODESYS's** (`<data name="…/method"><Method>`,
      `<data name="…/property"><Property>` with the accessors nested), so `AddChild` was right for both vendors —
      nothing was checking that. **D6 closed and it DIFFERS**: TwinCAT emits Get-before-Set, CODESYS
      Set-before-Get, so `SetAccessor`'s "vendors emit Set before Get" was a false universal (corrected).
      Also corroborated: a TwinCAT method with a declared `VAR_INPUT` carries ONE plaintext copy, so the two-copy
      declaration really is CODESYS-only.
      Original text: **Record the missing TwinCAT fixture**: one TwinCAT FB with a method, a property, and BOTH accessors.
      `<Method>`, `<Property>`, `<GetAccessor>`, `<SetAccessor>` appear **zero times** across all six recorded
      TwinCAT fixtures, so `AddChild`, `SetAccessor` and property-add have never been tested against a TwinCAT
      shape at all. Highest-value item in this change.
- [x] 5.3 **DONE** — four vendor-neutral assertions now run over BOTH vendors' recorded exports (add a method,
      leave existing members intact, add a property with both accessor slots, and write the NAMED accessor). The
      last one exists because of D6: anything picking "the first accessor" rather than the named one would pass on
      one vendor and silently write the wrong accessor on the other.
      Original text: Make `PlcOpenSpliceTests` a **matrix**: every splice assertion that is vendor-neutral runs over BOTH
      vendors' recorded fixtures. A divergence then fails a test instead of surprising us live.
- [x] 5.4 **DONE** — named in `DIALECT.md` and left unbuilt: one dialect parameter on `AddChild`/`SetAccessor`, the only two members that CREATE vendor-shaped elements.
      Do NOT build a dialect abstraction. Record the agreed extension point — one dialect parameter consumed by
      `AddChild` and `SetAccessor`, the only two members that CREATE vendor-shaped elements — and leave it
      unbuilt until §5 of `pou-writes-via-plcopen` measures TwinCAT. Three times in that change a conclusion drawn
      from reading our own interfaces instead of the vendor turned out to be false; this is the fourth opportunity.

## 6. Explicitly NOT in this change

- Extending the single-document write to **create** and **move**. Both still route through `existing: null`, so a
  push that creates an FB with 5 methods still issues ~12 COM writes and then runs the orphan walk. Real, and its
  own change.
- Collapsing the two splice-and-import implementations (`PouDocument.Splice` vs `GraphicalCode.Write`).
- §5 TwinCAT measurement, and deleting `ICodeStore.WritesPouAsOneDocument` — gated on it.
- `PlcOpenTransport.ReplaceByReimport`'s unguarded restore (a known TwinCAT-only data-safety defect: if the
  restore throws, the primary exception is lost and the item stays deleted).

## 7. Close-out

- [x] **Complete.** Final gate: Release build clean, **Engine 400 / Cli 124 / Connector 80** offline, live CODESYS
      e2e **98 pass / 8 skip / 0 fail** (the post-§3.1b baseline, unchanged by the restructure), `bun run check`
      14/14.

**What actually shipped, against what was proposed:**

| Proposed | Outcome |
|---|---|
| Move PLCopen out of `Graphical/` | Done — `Volt.Engine.PlcOpen` with `PouReader`, `PouSplice`, `PlcOpenDocument` |
| Split `PlcOpenDocument`'s four tenants | Done — plus `Graphical/GraphicalBodySplice` and `Workspace/SourceText/InstanceTypes` |
| Kill both wrong-direction dependencies | Done — `PouMember` replaced `ItemKind` at the boundary; the `GraphConstants` edge vanished with `ValidateExisting` |
| No dialect abstraction | Held — and vindicated: the two shapes turned out IDENTICAL where it mattered |
| A two-vendor fixture matrix instead | Done — and it closed the two largest unknowns |

**Three things the surveys predicted and the work confirmed**, worth keeping for the next restructure:

1. §3.3's stated expectation was WRONG, and saying so is the point. Removing the `ItemKind` dependency did not
   free `PouSplice` from the wire-vocabulary guard — the file still holds `"Method"`/`"action"` as XML ELEMENT
   names. One exempt file became three. The rule did not change; the file count did.
2. The defects found while surveying were worth more than the move. The CFC one was a live, latent
   read-and-write bug that every offline fixture was blind to.
3. Doing behaviour first and layout second was right. §1 turned two of my own tests red for the correct reason;
   had that landed inside the rename commit it would have looked like rename fallout.

**Still open, deliberately** (each named in `proposal.md` §"NOT in scope"): extending the single-document write to
CREATE and MOVE — the seam this whole programme exists to remove is still the entire create path, where a push
that creates an FB with 5 methods still issues ~12 COM writes; collapsing the two splice-and-import
implementations; and §5 of `pou-writes-via-plcopen` (TwinCAT's IMPORT, D1–D4 in `DIALECT.md`), which no export
can answer and which gates deleting `ICodeStore.WritesPouAsOneDocument`.

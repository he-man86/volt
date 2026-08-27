## 0. Evidence already in hand (do not re-derive)

All of it measured on the live IDEs, 2026-08-27. Full tables in `transport-census.md`.

- **The bug:** every TwinCAT POU fails to materialize; `refs` returns libraries/DUTs/GVLs/task and no POUs.
- **The cause:** `InterfaceAsPlainText` is a vendor `addData` block the TC6 XSD defines as discardable, and
  `Materializer.BuildPouFromXml` requires it. 8/8 June exports carry it (2 of them with no variables at all, so
  it is unconditional); 0/2 live exports do, one of which declares 45 variables. 21 of the 22 element-level
  differences between the two generations are explained by POU content; that one is not.
- **Not a call Volt gets wrong:** reproduced through the COM interface AND the IDE's own export.
  `PlcOpenExport(bstrFile, bstrSelection)` has no options argument; `PlcOpenExport2` adds only `bSubTree`.
- **The aspect is exact and cheap:** `DeclarationText` / the `Interface` aspect, 0.1–0.3 ms against a ~20 ms
  document export, both vendors, get and set.
- **ST is safe:** `<ST><xhtml>` measured byte-identical to native CDATA. The typed `<interface>` is lossy for
  source text (alignment, blank lines) and is NOT a substitute.
- **Native transports rejected:** TwinCAT `DocumentXml` and CODESYS `export_native` are different encodings, and
  CODESYS's is GUID-typed. Two converters replacing one shared implementation — refused.

### Baseline

Offline **691 / 142 / 80 / 3**; CODESYS e2e **132 pass / 20 skip / 0 fail**; `bun run check` green with 4
`[UNMEASURED:]` markers. **TwinCAT e2e cannot run at all** — that is the thing this change fixes, and the real
gate.

---

## 1. Make TwinCAT readable again — the smallest change that does it

- [x] 1.1 **`Materializer.BuildPouFromXml` takes the declaration from `ide.ReadDeclaration(item)`**, not from
      `parsed.Declaration`. The throw stays, but moves: an item whose ASPECT has no declaration is still a hard
      failure. Test: `MaterializerDeclarationTransportTests`, three cases, RED before the change.
- [x] 1.2 **Live gate.** TwinCAT e2e RAN for the first time: **37 pass / 11 skip / 94 fail**. Every one of the 94
      was the write path — `"PLCopen export for 'X' has no <InterfaceAsPlainText> to write the declaration into"`.
      That is the number §2 had to move.
- [x] 1.3 Shipped as its own step, as written.

## 2. The write half — one method, symmetric

- [x] 2.1 **No new `ICodeStore` member was needed.** `WriteText(item, declaration, implementation: null)` already
      IS the declaration write on both drivers, so the proposed `WriteDeclaration` would have been a second name
      for an existing method. One less thing on the contract than the proposal budgeted for.
- [x] 2.2 **`PushService` writes the declaration through it**, and `PouDocument`/`PouSplice` no longer carry one.
- [x] 2.3 `Source/Declaration.cs` — **NOT deleted; see §7.** Members still reach the document on CREATE.
- [ ] 2.4 Retire A7 / U21 / U22 in `DIALECT.md` with a line saying why. **Open** — §7.

### 2.5 The ordering, which is the part the proposal got wrong

Writing the aspect BEFORE the document was silently undone by it. On a TwinCAT export→import round trip **with no
edit at all**:

```
sent: 	x : INT;            sent: 	yLonger   : BOOL;        sent: (blank line before END_VAR)
back: 	x: INT;             back: 	yLonger: BOOL;           back: (gone)
```

With no verbatim block in the document, **TwinCAT's importer regenerates the declaration from the typed
`<interface>`** — the exact lossy path the proposal ruled out for reads, arriving through writes instead. So the
order is now **document first, declaration aspect second**, and the item is re-found from a fresh tree root in
between (the import invalidates handles to what it replaced, D4d — and invalidates `<root>` with them, which
`MoveAfterWriteTests` caught when the helper first took a parent argument).

The aspect write is **guarded**: it is issued only when the declaration actually differs, so a no-op push stays a
no-op. Both sides are compared trimmed, because `Materializer` trims what it writes into the file — comparing
against the IDE's RAW text reported a change on trailing whitespace alone and made the guard vacuous on every DUT
and GVL.

## 3. Tests are deleted with their subject, not adapted

- [x] 3.1 Four tests asserted "a declaration edit lands" against the spliced DOCUMENT. The **defects they pin are
      still defects** — only the transport moved — so the assertions moved with it into
      `PushDeclarationTransportTests` rather than being deleted. What WAS deleted is the document-level assertion
      itself, which is now vacuous. `DeclarationOnlyDocumentTests.B` is gone with a note recording that this
      change **reverses an earlier migration on purpose**: DUT/GVL declarations were moved INTO the document so
      there would be "no longer a second transport to keep in step with this one". That goal is intact and is why
      this change is uniform — every declaration now travels the aspect, so there is still exactly ONE. The
      document was the wrong single transport, not single-transport the wrong goal.
- [x] 3.2 Counts recorded honestly below. They went UP, not down — the proposal predicted a drop.
- [ ] 3.3 The `addData` guard. **Open** — §7.

## 4. Fixtures and the vendor record — **open**, §7.

## 5. Explicitly NOT in this change

Unchanged from the proposal: no native transport, no rendering from the typed `<interface>`, no upstream report,
no `splice-graphical-body` §2.x.

## 6. Close-out

### What shipped

| | before | after |
|---|---|---|
| Offline (Engine / Cli / Connector / TC) | 691 / 142 / 80 / 3 | **698 / 142 / 80 / 3** |
| CODESYS e2e | 132 / 20 / 0 | **132 / 20 / 0** — unchanged |
| **TwinCAT e2e** | **could not run** | **141 pass / 11 skip / 0 fail** |

The TwinCAT gate went 37/94 → 92/43 (read fixed) → 120/21 (ordering + clean fixtures) → **141/0**.

### Every prediction that turned out wrong

1. **`PlcOpenExport2` was expected to carry an options flag.** It carries `bSubTree`. (Type library, §4.)
2. **CODESYS was asserted to have no native transport.** It has `export_native` / `CreateNativeXmlExportService`.
3. **"The aspect write must be what reformats declarations."** Refuted by direct measurement:
   `set_DeclarationText` round-trips byte-exact modulo line endings, preserving a space before the colon,
   irregular alignment padding, and a blank line before `END_VAR`. The reformatter is the **import**. Had this not
   been measured, the fix would have been to revert §2 — the opposite of correct.
4. **"Offline totals will DROP."** They rose 691 → 698: the moved assertions cover more shapes than the document
   tests did, and the member path gained coverage that never existed.
5. **The proposal scoped the regression to the ROOT declaration.** It applies to **members** too, in both
   directions — §7.

### Fixture damage, found and repaired

The pre-ordering-fix runs wrote through the import and **destroyed declarations in the committed fixtures** —
`PLC_PRG` in Project13 lost its whole `VAR … END_VAR` block; in Project14 it came back empty. Restored from git;
the change's own e2e now leaves the declaration byte-intact (only the vendor's `Id`/`LineIds` normalization
churns). `POU_PBD.TcPOU` was preserved throughout — it is the disabled-network capture and is still uncommitted.

Project14 had no `VltFixtureCfc`/`VltFixtureSfc`; they existed in Project13 only, so `graphical / unsupported`
failed whenever it landed on 14. Authored through the IDE (a hand-written `.TcPOU` would invent a shape) and
registered in `Untitled2.plcproj` — note that `Solution.SaveAs` does NOT register a new POU; `File.SaveAll` does,
and the first attempt produced a green run that would not have reproduced from a cold start.

## 7. Still open — carried forward

- **`Source/Declaration.cs` is not deleted.** A member is still created through the document (`AddChild` carries
  its declaration so the element is well-formed), so the "find a declaration in XML" code still has one caller.
  The write-side splice for an EXISTING member no longer uses it.
- **2.4 / 3.3 / all of §4** — the `DIALECT.md` rows, the A7/U21/U22 retirement, the `addData` source guard, the
  `POU_PBD` + `FB_PackML_Unit` fixtures, the `DISABLED` marker close-out, and the TLB recipe.
- **Accessor declarations still travel the document.** `SetAccessor` takes `Getter.Declaration` /
  `Setter.Declaration`. They are usually blank (`AccessorOf` drops empty ones), and the suite is green — but this
  is the one declaration that did NOT move to the aspect, and it should for symmetry.
  `[UNMEASURED: whether a non-empty accessor declaration survives this install's export.]`
- **Per-member cost on CODESYS.** Uniformity means every member now costs one `ReadDeclaration` per push. On
  CODESYS the value matches and no write follows, so it is a read, not a write — but it is N reads on a path that
  was previously zero.

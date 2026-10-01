## 1. Reproduce

- [x] 1.1 CODESYS fixture copy: an FB with a method whose body holds a stray `VAR … END_VAR` after the
      implementation marker (the `c802b74d` shape). Build, and record the published diagnostic: expect
      `name: null`, `line: 0`, `code: C0578`.
      **Result (2026-10-01, live SP21 3.5.21.40, `ide.ps1 up -Vendor codesys -Instance dcn -RunScript
      scripts/probe-diagnostic-child-guid.py` on a copy of `CodesysTestProject.project`):** confirmed. The pipe's
      `build` answered `{ code: "C0578", message: "Unexpected statement", line: 0, column: 0 }` with NO `name` for the
      error in method `FB_DcnMeth.MExecute`, while the same build named `FB_DcnDecl.fb` for an error in an FB's own
      declaration. With a parse error left in the FB body AND in a method, a property GET and an action, only the FB
      body's came back named (`FB_DcnBody.fb`); the other three had no name.
- [x] 1.2 For that message, record `ObjectGuid`, whether it is `Guid.Empty`, and which object it belongs to. It
      could be the method, the FB, or something else.
      **Result:** the CHILD, never `Guid.Empty`, never the FB. Resolved against a full walk of the project tree:
      method body → `Device/Plc Logic/Application/FB_DcnMeth/MExecute`; property GET body →
      `FB_DcnMeth/PProp/Get` (the ACCESSOR, one level below the property); action → `FB_DcnMeth/AAct`; a method's
      declaration → the method. The FB's own body and declaration → the FB. So the cause is exactly the one the
      proposal suspected: `NamesFor` looked the guid up among top-level items only. Log:
      `packages/volt-cli/scripts/diagnostic-child-guid.log` (reproduced byte-identical in a second session).
- [x] 1.3 Record `Position` / `PositionOffset` for three known positions: FB body, FB declaration, method body.
      **Result (14 scenarios, one fault each, built one at a time; DIALECT C27):**

      | planted at | Position | PositionOffset | Length |
      |---|---|---|---|
      | FB body, impl line 3 col 3 (`zzBody1`) | 17 | 2 | 7 |
      | FB body, impl line 5 col 9 | 23 | 8 | 7 |
      | FB body, impl line 3 col 3, line 1 made 28 chars longer | 27 | 2 | 7 |
      | FB body, impl line 2 col 10 (mid-line `zzMid`) | 30 | 9 | 5 |
      | FB decl, line 4 col 2 (tab) | 18 | 1 | 1 |
      | FB decl, line 6 col 2 | 29 | 1 | 1 |
      | FB decl, line 4 col 9 (8 spaces) | 38 | 8 | 1 |
      | method body, impl line 2 col 5 | 12 | 4 | 6 |
      | method body, impl line 4 col 2 | 17 | 1 | 6 |
      | method decl, line 4 col 2 | 22 | 1 | 1 |
      | property GET body, line 2 (`zzGet` col 10) | 7 | 9 | 5 |
      | action body, line 2 col 1 | 4 | 0 | 5 |
      | method, stray `VAR..END_VAR` at impl line 2 | 9 | 0 | 21 |
      | method, stray `VAR..END_VAR` at impl line 4 | 16 | 0 | 21 |

      `PositionOffset` = the 0-based column of the offending token in its line (every case; a tab counts one).
      `Length` = the token's length (the whole `VAR..END_VAR` span is 21). `Position` is NOT a line and NOT a
      character offset: the same line 3 moves 17 → 27 when only line 1 grows, and declaration line 4 moves 18 → 38
      when a tab becomes 8 spaces. It is the opaque id `PositionHelper.SplitPosition` unpacks and
      `IObject.GetPositionText` renders (reflected 2026-09-23, not called here).

## 2. Test red

- [x] 2.1 A driver test on a C# double of the object tree: a diagnostic whose guid is a METHOD resolves to
      `name` = the parent's full name and `member` = the method.
      `test/Volt.Ide.Codesys.Tests/CodesysDiagnosticChildNameTests.cs`, driven through the real
      `CodesysDriver.GetBuildDiagnostics` over a `MessageStorage` + object-manager double in the vendor's namespaces.
      The driver answers the BARE parent name (`FB_Motor`); `BuildService.PromoteNames` makes it the full name, pinned
      by `BuildDiagnosticNameTests.The_member_is_kept_as_the_driver_gave_it` and live by 4.1. **Red before the fix:**
      `Expected ("FB_Motor", "Execute", "C0578")`, `Actual (null, null, "C0578")`.
- [x] 2.2 The same for property accessors and actions.
      Same file, a theory over GET, SET, the property itself, an action, a transition and a method filed in a
      POU-internal folder (member = the method, not the folder; an accessor's member = its PROPERTY). Plus: the item's
      own guid has no member, a guid that is nowhere names nothing, and a diagnostic on a top-level item reads no
      POU's children. **Red before the fix:** 7 of 10 failed (`Actual (null, null)`); the 3 guards passed.

## 3. Fix

- [x] 3.1 `NamesFor`: resolve child guids to their parent item, walking children only when a wanted guid is not
      a top-level item (a clean build still walks nothing).
      `CodesysDriver.NamesFor` returns a `Placement(Name, Member)` per guid: top-level items first (early exit when all
      are placed, as before); only for guids still unplaced does it descend — structurally, `get_children`/`guid`/
      `is_folder`/`get_name`, no object reads — under the items whose kind holds members
      (`ItemKind.HoldsMembers`: prg/fb/func/itf). The member is the child directly under the item, through
      POU-internal folders. Green: 10/10.
- [x] 3.2 `BridgeDiagnostic.Member` (optional), and `PromoteNames` keeps it as it is.
      `Volt.Contracts/Wire/BuildModels.cs` (`member`, omitted when null); `PromoteNames` never touches it (pinned for a
      resolvable and an unresolvable name). `FakeIde.GetBuildDiagnostics` copied fields by hand and dropped `Member` —
      that made the new test red until the fake carried it. Regenerated docs (`docs/volt-bridge.openrpc.json`,
      `docs/assets/data.js`, `VOLT_WRITE_DOCS=1`). `volt build` prints `FB_Motor.fb(Execute):6` and `--json` carries
      `member` (`BlackBoxTests.Build_prints_and_emits_the_member_a_diagnostic_is_inside`, red without the print).
- [x] 3.3 TwinCAT: a method-body error names the parent and sets `member`. Add a test.
      **The proposal's assumption was wrong: TwinCAT had the same gap.** Measured on live TcXaeShell 15.0 (Project14
      copy, Build pane read over the DTE; DIALECT D36): a child's error is written `...\FB.TcPOU;FB.Compute(6)`,
      `;FB.Prop.Get(2)`, `;FB.Act(3)`; only the POU's own body is `...\FB.TcPOU(6)`. The stem test took
      `FB.TcPOU;FB` as the name, which no item has, so the live e2e answered `name: undefined, member: undefined` for
      the method, the action and the GET (3 red). Fix: `TcObjectModel.FileOf`/`MemberOf` split the capture at `;`, and
      the cross-pane dedupe key (`DedupeKey`) now carries the member — two methods of one POU with the same error on
      the same line stayed ONE diagnostic otherwise. Offline: `TcBuildOutputTests` (4 red → green). Live: the scratch
      worker (built to a separate output; the Release one was locked by another session's workers) answered
      `VltE2E_raw.fb` + `Compute` / `Prop` / `Act`, and `test/e2e/endpoints/build-diagnostics.test.ts` 9/9 on TwinCAT.
      The TwinCAT `line` is the vendor's line inside that OBJECT (declaration first), carried unchanged.
- [x] 3.4 Line, only if 1.3 gives unambiguous units: emit `line` relative to the wire file, pinned by a
      conformance recording. Otherwise add the finding to DIALECT.md and keep `0`.
      Not unambiguous: `Position` is an opaque id (1.3). Finding added as DIALECT C27; `line` stays `0` on CODESYS.
      **Still unmeasured:** `IObject.GetPositionText` on these messages (the vendor's own `Line N, Column M (Impl)`
      rendering) — the route to a real line, together with mapping an `(Impl)`/`(Decl)` line into the wire file.

## 4. Verify

- [x] 4.1 Repeat 1.1: the diagnostic names the FB and the method.
      Same probe, rebuilt bridge: `{ name: "FB_DcnMeth.fb", member: "MExecute", code: "C0578", line: 0 }`, and
      `member: "AAct"` / `member: "PProp"` for the action and the GET; the FB body's error stays
      `FB_DcnBody.fb` with no member. `test/e2e/endpoints/build-diagnostics.test.ts` (four new cases: method, action,
      property GET, own body) 9/9 on a fresh CODESYS copy and 9/9 on TwinCAT.
- [x] 4.2 Conformance recordings updated; full C# suites green.
      No recording changes: `volt-lsp-iec/test/conformance/recordings/*.build.json` store `message`/`severity`/`line`
      only, and line is unchanged by this work (and that package belongs to another session today). Suites:
      Contracts 19/19, Engine 1834/1835 (1 skipped, pre-existing), Ide.Codesys 185/185, Ide.Twincat 262/262,
      Connector 110/110, Repo.Gates 54/54 (`DedupeKey` added to the same-file allow-list beside `ParsePaneText`),
      Cli 266/266 (the new black-box test included); `bun run check` 14/14.

## 5. Review gate

- [x] 5.1 TwinCAT dedupe dropped a real diagnostic: `FB.Prop.Get` and `FB.Prop.Set` both publish `member: Prop`, and
      TwinCAT writes no column, so the key built from the wire's fields merged a GET's error into the SET's identical
      one while CODESYS returned both. **Red first:** `TcBuildOutputTests.AGetAndASetWithTheSameErrorAreNotDuplicates`
      (`Actual [("FB","Prop")]`, one of two). Fix: `TcObjectModel.CollectPane` keys the cross-pane dedupe on the OBJECT
      the compiler named (file stem + the dotted path after `;`), and `DedupeKey` is gone. Live (TwinCAT Project14
      copy): GET `Prop := zzChild;` and SET `x := zzChild;` both answer line 2, column 0 — the shape the old key merged
      — and now come back as 4 errors on TwinCAT, exactly as on CODESYS. Also red first and fixed:
      `AnObjectPathOutsideTheFilesPouNamesNothing` — a path that does not start at the file's own POU is a shape nobody
      measured and is published with neither name nor member (logged), instead of reading its second segment as a
      member.
- [x] 5.2 A member without its name: `PromoteNames` nulled `name` (ambiguous, unreadable, or the walk threw) and left
      `member` set — a child of nothing. **Red first:** `BuildDiagnosticNameTests.The_member_is_kept_as_the_driver_gave_it`
      (its `SomethingElse` row pinned the orphan; the premise contradicted the field's own contract, "the CHILD of
      Name"), `A_fault_while_naming_drops_the_member_with_the_name`, and `A_member_picks_the_item_that_can_hold_one`
      (the realistic trigger, V71's `CM_Carrier.fb` + `CM_Carrier.visualization`). Fix: the member is cleared with the
      name and restored only when the name resolves; a diagnostic that carries a member is resolved among the items
      that can hold one (`ItemKind.HoldsMembers`), so the visualization is not a candidate and the FB is named.
- [x] 5.3 Live e2e pins the COUNT, not just presence: `build-diagnostics.test.ts` asserts exactly one
      `Identifier '…' not defined` per planted fault (method, action, GET, own body) and exactly two for the GET+SET
      case. The first run matched on the token and was wrong on CODESYS — the IDE says more than one thing about a fault
      (`zzChild := 1;` also gives C0018, `Prop := zzChild;` also C0032), every one returned as given — so the assertion
      names the one message. 10/10 on CODESYS SP21 (fixture copy) and 10/10 on TwinCAT (Project14 copy, one worker).
      **Unmeasured on TwinCAT:** transitions (covered offline on CODESYS only) and a method in a POU-internal folder
      (whether its path is `FB.Folder.Method`, which would publish the folder as the member) — DIALECT D36.
- [ ] 5.4 The shipped frontends print `name:line` and ignore `member` (`volt-vscode/src/commands.ts`,
      `volt-desktop/src/commands.ts`). On TwinCAT a child's `line` is counted inside the CHILD (D36), so those two now
      show the right file with the wrong line, where before this change they showed no location. The wire now states
      the frame (`BridgeDiagnostic.Line`/`Member` docs: a position is `name(member):line`, as `volt build` prints it);
      the two renderers still have to print the member. **Open:** outside `packages/volt-cli`, not done in this run.

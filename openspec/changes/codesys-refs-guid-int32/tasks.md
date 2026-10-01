## 1. Reproduce

- [x] 1.1 Pro2193 copy via `ide.ps1 up -Vendor codesys`: `refs` with NO probe read, 5 fresh sessions — record pass/fail each.
      **2026-10-01, SP21 Patch 4, unfixed bridge: 5/5 sessions pass, 9/9 calls** (session 1: 1 call; 2-5: 2 each).
      Every call: 881 items, `unreadable` [], `unwalkedFolders` []; first call 12-16 s, the second 0.7-1.1 s.
      (Session 3 served under session 2's pipe NAME: the loop had exported `VOLT_PIPE` into its own shell and the
      next `up` inherited it — the host honours it as an override. A harness slip, not a finding; fixed in the loop.)
- [x] 1.2 Same copy: `probe-dut-subtype-push.py` read of `SER_OperationModeType` (write
      `x|SER_OperationModeType` to `%LOCALAPPDATA%\volt-bridge\dut-probe.req`), then `refs` — record the full error
      and stack from the bridge log.
      **Reproduced, and the mechanism measured.** Launched with `ide.ps1 up -RunScript <wrapper>` (new parameter: the
      wrapper runs the repo probe verbatim and adds a timer that logs the ObjectMgr's `GetMethods()` order).
      - before any probe read: concrete `_3S.CoDeSys.ObjectManager.ObjectManager` lists
        `#128 GetObjectToRead(Int32, Guid)`, `#129 GetObjectToRead(Int32, Int32)`;
      - probe read: `SER_OperationModeType guid dcdf49b8-… in 'Data' READ FAILED (handle 0 int): ValueError: Object
        of type 'System.Guid' cannot be converted to type 'System.Int32'.`;
      - after it, the SAME type lists `#87 GetObjectToRead(Int32, Int32)`, `#88 GetObjectToRead(Int32, Guid)` (and
        `GetObjectToModify` likewise flipped);
      - `refs` x2: `INTERNAL_ERROR: Object of type 'System.Guid' cannot be converted to type 'System.Int32'.` (659 ms,
        49 ms).
      Stack: the bridge log (`%LOCALAPPDATA%\Volt\logs\codesys-2026-10-01.log`) has NO line for the failure at all; the
      path is the code's — `CodesysDriver.WalkItems` → `KindCodeOf` → `CodesysObjectModel.ReadObject` →
      `InvokeMethod(_objMgr, "GetObjectToRead", handle, guid)` → `TryInvokeMethod`, which bound "the first method
      named so with 2 parameters" → `RuntimeType.TryChangeType` (the same frame the red test 2.1 shows).
      **Cause: not the objects, not the probe — Volt's arity-only binder** (bridge AND the probe's `voltprobe.call`
      had it). The probe was only the trigger that reordered the method list.
- [x] 1.3 For the three objects (`SER_OperationModeType`, `enumRecipeCommandResult`, `PlcDataType`): what kind of
      object each is, and what `HandleOf` / `GuidOf` return for it.
      Measured in the poisoned session (wrapper probe):
      | object | wrapper → raw | IObject | handle | guid | parent |
      |---|---|---|---|---|---|
      | `SER_OperationModeType` | ScriptObject | `TextListEnumerationObject` (ITextListEnumerationObject) | 0 (int) | dcdf49b8-a8c2-4367-96dc-a9641c9d89ae | Data |
      | `enumRecipeCommandResult` | ScriptObject | `TextListEnumerationObject` (ITextListEnumerationObject) | 0 (int) | 4d9e5045-6405-436e-9547-d1cf4a7bb801 | Enumerations |
      | `PlcDataType` | ScriptObject | `DUTObject` (IDUTObject) | 0 (int) | 91b1e3cb-aeb3-42b8-94d8-5e56aa1ae669 | 13 Dashboard |
      | `IQSlices` (control, never failed) | ScriptObject | `TextListEnumerationObject` | 0 (int) | 82ddc0c0-94f2-4bf7-962b-c65f9188e049 | IQ Handling |
      All four read cleanly through the TYPED `GetObjectToRead(Int32, Guid)` in that same session. Handle 0 is the
      PROJECT handle every object shares — nothing about these objects is special; they were simply the ones read.

## 2. Test red

- [x] 2.1 A test that fails the way 1.1 or 1.2 does, on a C# double of the object shape the IDE really has.
      `test/Volt.Ide.Codesys.Tests/CodesysObjectManagerOverloadTests.cs`: a `VendorObjectManager` double with SP21's
      overload pairs, index overload declared first; nodes keyed by guid, all handle 0; a text-list enum and a DUT.
      Red before the fix — all three facts, `System.ArgumentException: Een object van type System.Guid kan niet naar
      het type System.Int32 worden geconverteerd` from `RuntimeType.TryChangeType` (the field error, Dutch locale):
      `The_walk_reads_each_object_by_its_guid_not_by_an_index`,
      `A_write_checks_the_object_out_by_its_guid_not_by_an_index` (the push path — `GetObjectToModify` has the same
      pair), `One_object_that_cannot_be_read_is_named_and_the_walk_goes_on`.
- [x] 2.2 A test that one unreadable object is reported unreadable by name and the rest of `refs` succeeds.
      Driver half: the third fact above (red: the walk threw). Engine half:
      `test/Volt.Engine.Tests/sync/UnclassifiableObjectTests.cs` (FakeIde gained `UnclassifiableItems`) — refs names
      it in `unreadable` and returns the other items; fetch names it and neither op reports anything removed; it
      counts toward `projectVersion` (differs from the project WITHOUT it) identically on refs, fetch and the push
      gate. All 3 red before the fix (collections differ / strings equal).

## 3. Fix

- [x] 3.1 Fix at the line that confuses the Guid and the Int32 handle (or retire the probe if it alone is the cause).
      The line: `TryInvokeMethod` in `CodesysObjectModel.Reflection.cs` — "matches by name + ARG COUNT only (the first
      such overload)", whose comment claimed no CODESYS surface has two of an arity. Now `Reflection.Overload` binds
      by the arguments' TYPES through the framework's `Type.DefaultBinder` (ambiguity throws, a non-fitting call
      names its types). `NwlInterop.Call` had the identical first-of-arity binder and uses it too. A scan of every
      CODESYS SP21 assembly for same-name same-arity overloads of the 29 methods Volt invokes by name found only the
      `GetObjectToRead`/`GetObjectToModify` pairs on the object manager to matter (others are on types Volt does not
      call them on). The probe is not retired — it was not the cause — but `scripts/voltprobe.call` had the same
      binder and now picks by type as well.
      And one object never fails the walk: `WalkResult.UnreadableObjects` (name, folder, reason); the CODESYS walk
      guards the classification read and names the object; `WalkResult` derives its folder into `UnwalkedFolders`
      (kind unknown, so nothing there reads as deleted); refs/fetch/push count it through one function
      (`Versioning.CountUnclassifiable`). Targeted tests green: Codesys 3/3, Engine 3/3 (+ PartialWalk/Unreadable/
      Parity groups 41/41).
- [x] 3.2 Record the vendor fact in DIALECT.md. — **C26**.
- [x] 3.3 TwinCAT: check the equivalent read path; test if it can fail the same way.
      It cannot fail the same way: TwinCAT reads a node's kind as the COM `ItemType` PROPERTY (`TcObjectModel.ItemType`,
      through `dynamic`), with no overloaded method bound by Volt; no TwinCAT code binds by arity (the only two
      arity binders were both CODESYS). Its walk already survived a node whose kind faulted, but only marked the folder
      and did not say WHICH object — a different wire answer for the same state. Now it names it like CODESYS.
      `test/Volt.Ide.Twincat.Tests/TcWalkUnreadableObjectTests.cs`: red against the old catch (`Assert.Single()
      Failure: The collection was empty`), green after.

## 4. Verify

- [x] 4.1 Repeat 1.1 and 1.2 with the fix: `refs` succeeds, or names exactly the unreadable item(s).
      Fixed Release bridge, 2026-10-01. **1.1: 5/5 fresh sessions, 10/10 calls pass** — 881 items, `unreadable` [],
      `unwalkedFolders` [] every time (first call 12-32 s, second 0.8-2.2 s).
      **1.2: the flip REPRODUCED and no longer matters.** Before the probe: `#128 (Int32, Guid)`, `#129 (Int32, Int32)`;
      probe read of all three objects (now through the fixed `voltprobe.call`) — each reads its declaration
      (`ITextListEnumerationObject` x2, `IDUTObject`); after it: `#87 (Int32, Int32)`, `#88 (Int32, Guid)` — the
      exact order that broke `refs`. Then `refs` x2: ok, 881 items, `unreadable` [] (1369 ms, 929 ms). And the WRITE
      path in that flipped state (`GetObjectToModify` has the same pair): a `push` of an edited
      `SER_OperationModeType.enum` declaration was accepted and a re-`fetch` returned the edit (on the fixture COPY).
      Nothing was unreadable, so the "names exactly the unreadable items" branch is covered by the offline tests
      (2.2, 3.3) only — no live object that cannot be read was available to show it.
- [x] 4.2 Full C# suites green.
      Engine 1827 passed / 1 skipped; Ide.Codesys 169; Ide.Twincat 256; Contracts 19; Connector 110; Repo.Gates 54;
      Cli 265 — 0 failed. (The TS e2e tier was not run: it drives a live bridge and is outside this change's tasks.)

## 5. Review (gate, 2026-10-01)

Each finding: a test red first, then the fix. All five held.

- [x] 5.1 **A root-level unclassifiable object protected nothing beneath it** (high). `WalkResult` marked only the
      object's PARENT, which for a root child (CODESYS: the Device node) is `""`, and `Removal.UnderAny` matched
      `""` only for root-level items, so a pull deleted every file under `Device/...`. Both drivers also spelled a
      failed ROOT enumeration `"<root>"`, which no known folder is under. Fix: `WalkResult` marks the object's own
      subtree (`FolderPath.Append(folder, name)`) as well; ONE root spelling, `""` (the folder path every root-level
      item has), and `UnderAny` reads it as covering everything; both drivers record `""`. Red:
      `A_root_level_object_that_cannot_be_classified_reports_nothing_beneath_it_removed`,
      `An_unwalkable_root_reports_nothing_removed_anywhere` (Engine; the fake now never enters an unclassifiable
      object, and its unwalkable root covers everything, as a real walk does),
      `A_root_child_that_cannot_be_read_marks_its_own_subtree_not_walked`,
      `A_root_whose_children_cannot_be_read_is_unwalked_as_the_root` (Codesys),
      `A_root_node_whose_kind_faults_marks_its_own_subtree_not_walked` (TwinCAT).
- [x] 5.2 **The classification catch swallowed binder failures** (high). Now
      `when (ex is not (MissingMemberException or AmbiguousMatchException))`: an ambiguous or non-fitting overload,
      or a vendor member that is not there, would hit every object and fails the walk by name. Red:
      `An_ambiguous_read_overload_fails_the_walk_by_name`, `A_read_overload_that_takes_no_guid_fails_the_walk_by_name`.
      (TwinCAT's classification catch predates this change and reads a COM property, not a Volt-bound overload; left
      as it was.)
- [x] 5.3 **Unclassifiable objects collapsed by bare name** (medium). `Versioning.CountUnclassifiable` keyed the
      version map by bare name, so the FB `CM_Carrier` and the visualization `CM_Carrier` were one entry and deleting
      either left `projectVersion` unchanged. Now one entry per OBJECT, keyed `/<folder>/<name>#<n>` (a key no wire
      name has); the `unreadable` list keeps one bare name per object. Red:
      `Two_unclassifiable_objects_with_one_name_are_two_objects_in_the_project_version`.
- [x] 5.4 **`NwlInterop.Call` on the new binder, unproven** (medium). Measured: `DefaultBinder` does refuse a boxed
      `Int32` for an enum parameter that `MethodInfo.Invoke` coerced (.NET Framework 4.8). No `Call` site passes one:
      every site passes `int` indices, `string`s and NWL objects. The claim that `Call` "used to reach the interface"
      was wrong: first-of-arity bound the concrete method and `Invoke` threw `ArgumentException`. Fixed anyway, because
      it is the right shape: a source whose overloads cannot take the arguments is skipped, and the next interface is
      tried. Red: `A_concrete_method_that_cannot_take_the_arguments_does_not_hide_the_interface_method_that_can`.
      **Live:** `ide.ps1 up -Vendor codesys -Instance refsguid` (fixture copy, fixed Release bridge), then
      `bun test test/e2e/graphical` gave **119 pass / 0 fail** across 19 files (every `CodesysNetworkWriter` `Call`
      site: RemoveNetwork, AppendTree, AppendParam, SetInputTree, Insert …).
- [x] 5.5 **An update of an unclassifiable object put the sentinel on the wire** (low). It was `StaleItemVersion` with
      `CurrentVersion = "UNREADABLE000000"`. `PushConflicts` now refuses any `SetItemOp` that names the bare name of an
      unclassifiable object and is not a published identity, as `UNREADABLE` by name with no version. This
      covers both create and update, and works because the version map no longer holds the object under a wire name.
      Red: `An_update_of_an_object_that_cannot_be_classified_is_refused_as_unreadable`,
      `A_create_on_the_name_of_an_object_that_cannot_be_classified_is_refused_as_unreadable`.
- [x] 5.6 Gate: `Volt.sln` Release builds with 0 errors. It was built to a scratch `BaseOutputPath`, because the
      in-tree TwinCAT Release output is locked by two running `VoltBridgeTwincat` workers this run did not start. Cli
      265; Engine 1832 passed / 1 skipped; Ide.Codesys 175; Ide.Twincat 257; Connector 110; Contracts 19; Repo.Gates 54;
      `bun test test/unit` 4. 0 failed.

# Tasks: XML-Based POU Materialization

## Step 1: `PlcOpenPouParser` ✅

- [x] Create `packages/volt-bridge/src/Volt.Bridge.Core/Graphical/PlcOpenPouParser.cs`
- [x] Define `ParsedPou` and `ParsedChild` records
- [x] Implement `Parse(string xml)`: extract declaration, body, children
- [x] Add unit tests (PlcOpenPouParserTests.cs) — UNTESTED, exercised only via integration
- [x] Test: textual ST POU with methods
- [x] Test: FBD POU with action children
- [x] Test: interface with methods
- [x] Test: POU with no children
- [x] Test: CFC body
- [x] Test: malformed XML

## Step 2: `Materializer` — XML code path ✅

- [x] `BuildSource`: XML path for `{program, function_block, function, interface}`
- [x] `BuildFromXml`: unified method for XML-based children + COM properties
- [x] `CollectPropertyChildren`: extracted from old CollectChildren, properties only
- [x] `CollectChildrenFull`: kept as COM fallback
- [x] COM fallback in BuildSource on ReadXml failure
- [x] `VgBodyOf`: unified body text conversion (ST/IL raw, FBD/LD VG, CFC/SFC marker)

## Step 3: PushService — receipt optimization ✅

- [x] Pre-apply snapshot stores full wire names (`currentFullNames`)
- [x] Receipt walk reuses pre-apply versions for unchanged items
- [x] `operatedNames` set includes ToName for renames
- [x] Only operated-on items get fresh materialization

## Step 4: Test fixtures ✅

- [x] All 247 tests pass (COM fallback path + XML parser unit tests)
- [x] PlcOpenPouParserTests directly exercises the XML path (9 passing tests)
- [x] Either: add XML to test items, OR: accept COM fallback as the test path → direct parser unit tests added

## Step 5: Manual verification ✅

- [x] `/refs` on CODESYS 854-item project: 43.6s → 10.1s (4.3x)
- [x] `/fetch` explicit test (same Materializer path, should be same 4.3x) — verified on CODESYS headless (27 items, returns version hashes) + TwinCAT (7 items)
- [x] Push cycle test (pre-apply + receipt walk timing) — no-op push: CODESYS 124ms, TwinCAT 106ms
- [x] TwinCAT compatibility — TcXaeShell 15.0: refs (166ms), fetch, push (106ms), debug?xml=1 (1920 chars) all work

## Step 6: Cleanup ✅

- [x] Remove per-kind timing in RefsService (VoltLog.Info → VoltLog.Debug)
- [x] Remove cumulative counters in CodesysObjectModel
- [x] Remove `/debug?timing=` endpoint
- [x] Remove `ResetTimers`/`GetTimerSummary` from DriverBase
- [x] Consider removing old COM-only `BuildPouCom`/`BuildInterfaceCom`/`CollectChildrenFull` (or keep for resilience)

## Step 7: Critical review items

- [x] PlcOpenPouParser needs unit tests
- [x] `DeclFromElement` exclusion of child `<pou>` elements — verified by PlcOpenPouParserTests (nested child POUs with their own InterfaceAsPlainText don't leak into parent declaration)
- [x] FBD/LD body round-trip: refactored into single source of truth — `GraphicalCode.RenderBody()` shared by both old COM path (`GraphicalCode.Read`) and new XML path (`Materializer.BuildPouFromXml`). `PlcOpenReader.ReadBody` now accepts optional language param (eliminates `with { Language = lang }` override at call sites). 247 tests pass, 272 FBD/LD POUs in 854-item project produce identical VG through either path.
- [x] Interface properties: COM path preserved, verify on real project — verified on TwinCAT Project12: interface `ITF` with method `METH` and property `Prop` (getter/setter) materialized correctly. Push cycle works (no-op accepted).
- [x] TwinCAT: BeckhoffDriver.ReadXml returns valid PLCopen XML — verified on Project12 (TcXaeShell 15.0): debug?xml=1 returns valid 1920-char PLCopen XML. 180 CODESYS POUs with `<Method>` children correctly parsed.

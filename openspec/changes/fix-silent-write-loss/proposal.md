## Why

The line-by-line audit of `packages/volt-cli/src` (`audit-volt-cli-src`, 12 batches, ~15,000 LOC) escalated 168
behaviour-changing findings. **Seven of them share one shape, and it is the worst shape a PLC tool can have: a
write is lost or lands on the wrong object, and Volt reports success.**

They are collected here rather than left in `arch-notes.md` because they are one class, they need one live
verification session, and each is a *silent* failure — no error, no log line, no red test.

| # | defect | what the user loses |
|---|---|---|
| 1 | `CodesysObjectModel.InvokeMethod` returns null instead of throwing when no overload matches, and every mutating call routes through it — so `SetObject(meta, true, null)` never commits | the edit. `push` reports success. `Build()` then sees no errors and returns true |
| 2 | `CodesysObjectModel.CreateChild` has no case for the four property-accessor kind codes, so it falls to `default:` and creates a **FUNCTION BLOCK named "Get"/"Set"** | the accessor — replaced by a junk POU. TwinCAT creates it correctly, so this is also an observable vendor divergence |
| 3 | `PlcOpenDocument.FindFbdLd` and `InlineInsert` scope to the WHOLE document, not the root POU's `<body>`; `ReadXml` returns a children-bearing export on both vendors | a graphical **method's** body, overwritten by the root POU's new body |
| 4 | `TcObjectModel.ReadImplementation` swallows a failed COM read into `""`, which `BodyLanguage` reports as "textual ST", which disarms `PushService`'s body-format guard | a live CFC/SFC body, overwritten by a textual push |
| 5 | `VgParser`'s `EXECUTE` scan does not stop at `END_NETWORK`, so a missing/misspelled `END_EXECUTE` swallows the rest of the body into one Execute box — and it survives `GraphicalCode.Validate` because the ST is re-emitted verbatim | N networks, collapsed into one |
| 6 | `TrayContext.CloseDesktopGui` calls `GetProcessesByName("Volt")`, which matches ordinal-ignore-case — and the installed CLI is `<app>\bin\volt.exe`, ProcessName `volt`. A console process has no `MainWindowHandle`, so `CloseMainWindow()` returns false and the next expression `Kill()`s it | an in-flight `volt push`, killed by an auto-update **mid-write to the live PLC and the git repo** |
| 7 | `IdeTree.BuildVoltIdeTree` matches removed item **names** against src-relative **paths** | nothing is lost, but an item deleted in the IDE never leaves the workspace unless it sat in the project root. **Independently found by two auditors** reading opposite sides of the call |

## What Changes

Each defect lands as its own commit, **red-first**, in the order below — cheapest and most testable first, so the
riskiest changes are made against a tree that has already proven the method works.

1. **`IdeTree` name-vs-path** — offline-testable today. The existing `Removed_items_are_dropped_from_the_new_tree`
   uses a ROOT item, which is exactly the case that passes; the new test puts the removed item in a SUBFOLDER.
2. **`VgParser`'s `EXECUTE` bound** — offline-testable. Stop the scan at `END_NETWORK`/`NETWORK` and raise the
   existing coded `VG_PARSE` with the `EXECUTE` line.
3. **`PlcOpenDocument` document scoping** — offline-testable with a children-bearing export fixture. Resolve the
   root `<pou>` once and take its DIRECT `<body>` child, in `FindFbdLd`, `InlineInsert` and `GraphicalBodyLang`
   (the last was fixed by an audit surgeon and correctly reverted as out of scope — restore it here).
4. **`CloseDesktopGui` process match** — filter by full path under the install root, not by friendly name.
5. **`ReadImplementation` fail-closed** — a body Volt could not read must never classify as textual.
6. **`CreateChild` accessor cases** + replace `default:` with a throw naming the unhandled kind, per
   `PushService.PouKindToCode`'s own stated policy.
7. **`InvokeMethod` throws** on no-match, matching `InvokeWithOptionals`/`CreateNamed` in the same file.

**4-7 cannot be unit-tested** — they live in the two IDE-host projects, and no test csproj can reference a net48
assembly or a live COM attach. Their gate is the live e2e on both vendors, run in one session at the end, plus
the specific manual observation each commit names.

## Capabilities

### New Capabilities

- `bridge-write-integrity`: a write that does not reach the IDE must fail loudly, and a write must land on the
  object it names.

## Impact

- **Code:** `CodesysObjectModel`, `PlcOpenDocument`, `VgParser`, `TcObjectModel`, `TrayContext`, `IdeTree`.
- **Tests:** three new offline tests (1-3); 4-7 rely on the live suites.
- **Risk:** every one of these is on the write path to someone's PLC. That is also why they are worth doing:
  each currently fails SILENTLY, and the failure mode of the fix is a loud refusal.

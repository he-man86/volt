## Why

**A CODESYS build error inside a method, property or action is published with no name and `line: 0`.** It is
anchored to nothing, so the client cannot tell which item to open, let alone which line.

It was seen in a PLCAssist chat on 2026-09-29, `c802b74d`: a generated PackML framework, CODESYS 3.5.21.40.
- The first `plcBuild` returned 5 × `C0578 Unexpected statement`, each with `name: ""` and `line: 0`.
- All five were in METHOD bodies of `FB_PackML_Unit` / `FB_PackML_ModeManager`: a stray `VAR … END_VAR` after the
  implementation marker.
- The model had to guess where the errors were. It searched the error-code docs first, then patched by reasoning.
- The same build's errors in FB and PRG *bodies* came through named: `FB_PackML_ModeManager.fb`,
  `PRG_PackML_Unit.prg`.

What is known, from reading the code:
- `CodesysObjectModel.GetBuildDiagnostics` reads `IMessage.ObjectGuid` correctly.
- `CodesysDriver.NamesFor` resolves that guid by walking `WalkItems().Items` only, which is **top-level items**.
- A method, property or action is its own CODESYS object with its own guid. It is never in that walk, so its
  guid resolves to nothing and `Name` stays null.
- TwinCAT does not have this gap as far as the code shows. Its diagnostics come from `file(line,col)`, and a
  method lives in its parent's `.TcPOU`, so the name is the parent's.

What is not known:
- Whether `ObjectGuid` on these messages is the child object's guid (the likely case) or `Guid.Empty`. The latter
  would make this a different bug. Task 1 settles it.

**Line.** `line: 0` on every CODESYS diagnostic is already a known and deliberate gap: `Position` /
`PositionOffset` are not read because their units were never measured. With the item named, "which item" is
answered. "Which line" stays open until someone measures, so it is proposed here as a separate, measured step.
It is not bundled into the naming fix.

## What Changes

- **Prove the cause first.** On a fixture with a syntax error in one method body, record the message's
  `ObjectGuid` and what it resolves to in the object model: the child object, and its parent item.
- **A child guid resolves to its parent item.** The diagnostic's `name` becomes the parent's full wire name
  (`FB_PackML_Unit.fb`). The file the client opens is the parent's, and that is where the method's source lives on
  the wire.
- **The child is named too, in a new optional field** (`member`, e.g. `Execute`). An FB with twelve methods is
  otherwise still a hunt. The field is additive and null when the diagnostic is about the item itself.
- **Line, measured separately:** record `Position` / `PositionOffset` for known error positions (top-level body,
  declaration, method body) against the conformance corpus. Only if the units are unambiguous, emit `line`
  relative to the file the client sees. Otherwise record in DIALECT.md why not, and keep `0`.

## Impact

- `packages/volt-cli/src/Volt.Ide.Codesys/Driver/CodesysDriver.cs` (`NamesFor`) and possibly
  `Ide/CodesysObjectModel.Build.cs`.
- `Volt.Contracts/Wire/BuildModels.cs`: `BridgeDiagnostic.Member` (additive, optional). `BuildService.PromoteNames`
  must keep it as it is.
- Clients: PLCAssist shows `name` today and would show `name` + `member`.
- TwinCAT: confirm that a method-body error names the parent, and add a test so both vendors stay the same.

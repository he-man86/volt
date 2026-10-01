## 1. Reproduce

- [ ] 1.1 CODESYS fixture copy: an FB with a method whose body holds a stray `VAR … END_VAR` after the
      implementation marker (the `c802b74d` shape). Build, and record the published diagnostic: expect
      `name: null`, `line: 0`, `code: C0578`.
- [ ] 1.2 For that message, record `ObjectGuid`, whether it is `Guid.Empty`, and which object it belongs to. It
      could be the method, the FB, or something else.
- [ ] 1.3 Record `Position` / `PositionOffset` for three known positions: FB body, FB declaration, method body.

## 2. Test red

- [ ] 2.1 A driver test on a C# double of the object tree: a diagnostic whose guid is a METHOD resolves to
      `name` = the parent's full name and `member` = the method.
- [ ] 2.2 The same for property accessors and actions.

## 3. Fix

- [ ] 3.1 `NamesFor`: resolve child guids to their parent item, walking children only when a wanted guid is not
      a top-level item (a clean build still walks nothing).
- [ ] 3.2 `BridgeDiagnostic.Member` (optional), and `PromoteNames` keeps it as it is.
- [ ] 3.3 TwinCAT: a method-body error names the parent and sets `member`. Add a test.
- [ ] 3.4 Line, only if 1.3 gives unambiguous units: emit `line` relative to the wire file, pinned by a
      conformance recording. Otherwise add the finding to DIALECT.md and keep `0`.

## 4. Verify

- [ ] 4.1 Repeat 1.1: the diagnostic names the FB and the method.
- [ ] 4.2 Conformance recordings updated; full C# suites green.

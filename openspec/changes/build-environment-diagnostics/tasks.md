## 1. Find the handle

- [ ] 1.1 Reproduce: a project referencing a library version not installed; record the message's number/prefix,
      ObjectGuid and anything else stable across UI languages.
- [ ] 1.2 TwinCAT: how does XAE report the same? Record in DIALECT.md.

## 2. Implement

- [ ] 2.1 `BridgeDiagnostic.Category` (optional); set `environment` from the handle in 1.1.
- [ ] 2.2 Build result: one `environment` entry per library, with its reason.
- [ ] 2.3 Tests: a driver double emitting the library message → marked; code errors in the same build unchanged.

## 3. Verify

- [ ] 3.1 Live on the 1.1 project, English and one other UI language.

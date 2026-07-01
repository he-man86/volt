## MODIFIED Requirements

### Requirement: Content detection covers whole files and inlined graphical methods

`volt-vscode` SHALL highlight VG by a content injection on the `NETWORK` token. Because editable
graphical POU bodies now materialize as `.st` (not `.fbd`/`.ld`), the injection SHALL cover both a
whole graphical POU stored in a `.st` file *and* a graphical body inlined inside a `.st` POU (a
graphical method) — in every case keyed by the same `NETWORK` token used by the LSP router, with no
reliance on a `.fbd`/`.ld` extension. Read-only `.cfc`/`.sfc` bodies remain distinct and are not
analyzed as VG.

#### Scenario: A whole graphical POU in a .st file is highlighted as VG
- **WHEN** a `.st` file's body begins with `NETWORK` (an editable FBD/LD POU)
- **THEN** it is highlighted as VG via the injection, with no `.fbd`/`.ld` extension involved

#### Scenario: A graphical method inside a .st file is highlighted as VG
- **WHEN** a `.st` POU contains a method body beginning with `NETWORK`
- **THEN** that body is highlighted as VG via the injection, while the rest of the file stays ST

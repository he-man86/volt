## MODIFIED Requirements

### Requirement: Content detection covers whole files and inlined graphical methods

`volt-vscode` SHALL highlight VG by a content injection on the `NETWORK` token. Because a POU is named
by its KIND (`.fb`/`.prg`/`.fun`), an editable graphical POU is stored in a kind-named file, not a
`.st`/`.fbd`/`.ld` file — so the injection SHALL be keyed purely by the `NETWORK` token (the same
discriminator the LSP router uses), never by a graphical extension, and SHALL cover both a whole
graphical POU (e.g. a `.fb` file whose body begins with `NETWORK`) *and* a graphical body inlined
inside a POU (a graphical method). Read-only CFC/SFC bodies (also kind-named) SHALL materialize with a
leading `READONLY <LANG>` marker instead of a `NETWORK` block, and SHALL NOT be analyzed as VG — giving
a clean 3-way body discriminator: `NETWORK` → editable VG, `READONLY` → read-only graphical, else ST.

#### Scenario: A read-only CFC/SFC body is not analyzed as VG
- **WHEN** a kind-named POU file's body begins with `READONLY` (a CFC/SFC body)
- **THEN** it is treated as read-only graphical — not highlighted or analyzed as VG, and flagged read-only

#### Scenario: A whole graphical POU is highlighted as VG
- **WHEN** a kind-named POU file (e.g. `Motor.fb`) has a body beginning with `NETWORK` (an editable FBD/LD POU)
- **THEN** it is highlighted as VG via the injection, keyed by the `NETWORK` token with no graphical extension involved

#### Scenario: A graphical method inside a POU is highlighted as VG
- **WHEN** a POU file contains a method body beginning with `NETWORK`
- **THEN** that body is highlighted as VG via the injection, while the rest of the file stays ST

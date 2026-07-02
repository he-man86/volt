## MODIFIED Requirements

### Requirement: FBD/LD are editable; CFC/SFC are read-only

ST, FBD, and LD bodies SHALL be read-write and round-trip as text (FBD/LD as editable VG). CFC and SFC
bodies SHALL have **no text representation** and are authored only in the IDE; they are not a read-only
*access* state, they simply are not materialized as editable code. A CFC/SFC body SHALL materialize as
a single informational marker comment identifying the language and directing the reader to the IDE, and
SHALL NOT be analyzed as VG or ST. There is no read-only-language flag.

#### Scenario: A CFC body is materialized as an informational marker
- **WHEN** a project contains a CFC (or SFC) body
- **THEN** it materializes as an informational marker (e.g. `(* Graphical CFC — edit in the IDE; Volt does not represent it as text *)`) and is not analyzed as VG or ST

### Requirement: Content detection covers whole files and inlined graphical methods

`volt-vscode` SHALL highlight VG by a content injection on the `NETWORK` token. Because a POU is named
by its KIND (`.fb`/`.prg`/`.fun`), an editable graphical POU is stored in a kind-named file, not a
`.st`/`.fbd`/`.ld` file — so the injection SHALL be keyed purely by the `NETWORK` token (the same
discriminator the LSP router uses), never by a graphical extension, and SHALL cover both a whole
graphical POU (e.g. a `.fb` file whose body begins with `NETWORK`) *and* a graphical body inlined
inside a POU (a graphical method). The body discriminator is 2-way: a body beginning with `NETWORK` is
editable VG (FBD/LD); anything else is treated as text (ST, or a CFC/SFC informational marker comment,
which yields no analysis). There is no `READONLY <LANG>` control marker.

#### Scenario: An editable graphical body is detected by NETWORK
- **WHEN** a kind-named POU file's body begins with `NETWORK`
- **THEN** it is highlighted and analyzed as editable VG, regardless of extension

#### Scenario: A CFC/SFC informational marker is not analyzed
- **WHEN** a kind-named POU (or inlined method) body is a CFC/SFC informational marker comment
- **THEN** it is not highlighted or analyzed as VG, and produces no diagnostics (it is a comment)

# vg-language Specification

## Purpose
TBD - created by archiving change review-vg-language. Update Purpose after archive.
## Requirements
### Requirement: VG is its own language, routed by content

Editable FBD/LD graphical bodies SHALL be represented as VG (Volt Graphical) — a distinct language
with its own grammar, parser, and analysis, not Structured Text. A POU body whose first significant
token is `NETWORK` SHALL be routed to the VG analysis path; everything else is ST. The declaration
(`PROGRAM`/`VAR … END_VAR`) remains ordinary ST; the VG parser sees only the body.

#### Scenario: A NETWORK body is analyzed as VG
- **WHEN** a POU body begins with a `NETWORK` marker
- **THEN** it is parsed and analyzed by the VG path, not the ST path

### Requirement: The round trip is exact and the bridge is the source of truth

The bridge SHALL round-trip PlcOpen XML ⇄ graph ⇄ VG exactly (`VgWriter(VgParser(x)) == x`). A
push whose VG is non-canonical or non-convergent SHALL be refused before it reaches the IDE, with a
structured diagnostic that returns the canonical text. So a graphical body can be read, edited, and
written entirely as VG text without drift.

#### Scenario: A non-canonical body is refused with its canonical form
- **WHEN** a push sends VG that is valid but not canonical (`VgWriter(VgParser(x)) != x`)
- **THEN** the bridge refuses it with `VG_NOT_CANONICAL` and returns the canonical text to paste

### Requirement: The bridge owns format, the LSP owns code correctness

The bridge SHALL enforce VG *structural* well-formedness (the `VG_*` gate) since those checks depend
only on the text. The LSP SHALL provide *code* correctness — type inference (wire types are inferred,
never written), undeclared-variable detection, hover, completion, navigation — and SHOULD mirror the
structural codes as diagnostics so a body is fixed before it is pushed.

#### Scenario: A wire's type is inferred, not stored
- **WHEN** the LSP hovers an internal `LET` wire
- **THEN** it shows a type inferred from the defining expression (the VG text carries no wire type)

### Requirement: FBD/LD are editable; CFC/SFC are read-only

ST, FBD, and LD bodies SHALL be read-write and round-trip as text (FBD/LD as editable VG). CFC and SFC
bodies SHALL have **no text representation** and are authored only in the IDE; they are not a read-only
*access* state, they simply are not materialized as editable code. A CFC/SFC body SHALL materialize as
a single informational marker comment identifying the language and directing the reader to the IDE, and
SHALL NOT be analyzed as VG or ST. There is no read-only-language flag.

#### Scenario: A CFC body is materialized as an informational marker
- **WHEN** a project contains a CFC (or SFC) body
- **THEN** it materializes as an `(* @volt-graphical: <LANG> *)` informational marker comment (e.g. `(* @volt-graphical: CFC *)`, which the LSP hover explains) and is not analyzed as VG or ST

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


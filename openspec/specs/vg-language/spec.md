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

FBD and LD bodies SHALL be surfaced as editable VG. CFC and SFC bodies SHALL be surfaced read-only
and SHALL NOT be analyzed as VG.

#### Scenario: A CFC body is read-only
- **WHEN** a project contains a CFC body
- **THEN** it is surfaced read-only and is not editable as VG

### Requirement: Content detection covers whole files and inlined graphical methods

`volt-vscode` SHALL highlight VG by a content injection on the `NETWORK` token, so it covers whole
`.fbd`/`.ld` files *and* a graphical body inlined inside a `.st` POU (a graphical method). The
discriminator SHALL be the same `NETWORK` token used by the LSP router.

#### Scenario: A graphical method inside a .st file is highlighted as VG
- **WHEN** a `.st` POU contains a method body beginning with `NETWORK`
- **THEN** that body is highlighted as VG via the injection, while the rest of the file stays ST


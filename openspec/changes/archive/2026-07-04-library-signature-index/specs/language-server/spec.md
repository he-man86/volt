## ADDED Requirements

### Requirement: The LSP resolves library symbols from mirrored signatures + namespace stubs

The LSP SHALL resolve referenced-library symbols using the materialized artifacts, with NO dedicated
ambient-scope machinery: (a) library element signature files use the ordinary kind extensions
(`.fb`/`.fun`/`.struct`/`.enum`/`.gvl`/`.itf`/…), so the existing source scan ingests them into the project
symbol table — a bare or member reference to a library element resolves like any project symbol; (b) each
`.library` stub's `NAMESPACE` line registers that library's namespace, so a qualified-reference ROOT
(`PACK_ML.State`, `MEM.LowWord`) is not flagged unresolved. Namespaces are keyed independently of project
symbols, so a library `State` and a project `State` do not collide. The hand-curated standard-function
table is retained only as a fallback for names not covered by a mirrored library.

#### Scenario: A library element resolves via the ingested signature
- **WHEN** a built object references a library FB/function/type whose signature is materialized under the Library Manager
- **THEN** the LSP resolves it (and its members) and emits no unresolved-identifier diagnostic

#### Scenario: A transitive-dependency namespace root resolves
- **WHEN** source references `MEM.LowWord` and a `CAA Memory.library` stub with `NAMESPACE MEM` is present
- **THEN** the `MEM` root is not flagged unresolved

### Requirement: Bare members of a non-qualified_only enum resolve

The unresolved-identifier check SHALL skip a bare identifier that names a member of a project enum that does
NOT carry `{attribute 'qualified_only'}`. Per IEC 61131-3 / CODESYS such members are global constants
reachable unqualified (`StateAutomatic`), yet the member symbol lives in the enum's own scope (for qualified
access + go-to-definition), off the resolver's parent chain — so a bare reference would otherwise false-flag.
A member of a `{attribute 'qualified_only'}` enum SHALL still require qualification.

#### Scenario: A bare enum member is not flagged
- **WHEN** an enum `sState` (no `qualified_only`) declares `StateAutomatic` and source references it bare
- **THEN** the LSP does not flag `StateAutomatic` unresolved

#### Scenario: A qualified_only enum still requires qualification
- **WHEN** `sState` carries `{attribute 'qualified_only'}` and source references `StateAutomatic` bare
- **THEN** the LSP flags it (only `sState.StateAutomatic` resolves)

### Requirement: The graphical (VG) unresolved check consults the library and device catalogs

The VG (FBD/LD) `vg-undeclared-identifier` check SHALL skip the same names the Structured-Text
unresolved-identifier check skips: known library namespaces (from `.library` stubs) and device-tree
instances (from `.device` files). A device instance or library root referenced inside a graphical body
SHALL NOT false-flag when the equivalent Structured-Text reference resolves.

#### Scenario: A device instance in a graphical body resolves
- **WHEN** an FBD/LD network references a device instance (`EtherCAT_Master`, `Axis_MainDrive`) mirrored as a `.device`
- **THEN** the VG check does not flag it, matching Structured-Text behavior

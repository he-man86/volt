## ADDED Requirements

### Requirement: every volt-cli concern lives in the project that owns it
Code in `packages/volt-cli` SHALL live in the project that owns its concern: shared logic that names no vendor and no
CODESYS-family fact in `Volt.Engine`; vendor and CODESYS-family code in `Volt.Ide.Codesys` / `Volt.Ide.Twincat`; the CLI verbs in `Volt.Cli`;
supervision in the connector; wire types in `Volt.Contracts`.

#### Scenario: vendor-neutral logic found in an IDE host
- **WHEN** the same logic exists in both IDE hosts, or a host holds logic that names no vendor fact
- **THEN** it moves to `Volt.Engine` if it names no CODESYS-family fact; otherwise it stays in the hosts unless the
  owner approves sharing it; both vendors still serve byte-identical wire responses

#### Scenario: a recorded vendor asymmetry
- **WHEN** code differs between the hosts because of an entry in `Ide/DIALECT.md`
- **THEN** it stays in its host and is not unified

### Requirement: a new vendor is one IDE host
Adding a vendor SHALL require only a new IDE host project that states a `VendorDeclaration` (its vendor row, kinds,
languages and `%`-keys, registered into one `Catalog`) and implements the `Volt.Engine/Seam` contract (`IVendorDriver` =
session + tree + store). The contract SHALL name no vendor, no NWL and no CODESYS-family kind code. Every vendor or NWL
symbol still above it (in the Engine, Contracts and the CLI) SHALL be pinned by a ratchet that fails when the count rises,
and when it falls without its pin being lowered.

#### Scenario: a vendor outside the CODESYS family
- **WHEN** a vendor with no NWL and no CODESYS object model is added
- **THEN** it declares its kinds and languages and implements `IVendorDriver` in its own host, and the Engine serves it
  over the pipe through the catalog with no Engine, wire or CLI branch for it; above the wire it adds one registration
  each in the connector, the installer and the LSP dialect

#### Scenario: the claim is tested without a third real vendor
- **WHEN** the suites run
- **THEN** a gate holds `Volt.Engine/Seam/` at exactly zero vendor, NWL and family-code symbols, a ratchet holds the
  count above it, and a minimal test vendor outside the CODESYS family passes the transport and contract suites

#### Scenario: a CODESYS-family fact above the seam
- **WHEN** Engine code above the contract depends on a fact only the CODESYS family has (NWL, its object types)
- **THEN** the ratchet counts it; adding one fails the gate, and moving one below the contract lowers the pin

### Requirement: no legacy code, no hidden behaviour
`packages/volt-cli` SHALL contain no code, comment or doc that serves a removed design or an old format, and no
behaviour that neither a doc nor a test states.

#### Scenario: a fallback masks a broken state
- **WHEN** a default, catch or fallback hides a state the code cannot handle
- **THEN** a failing test shows the state, and the code fails loud or handles it — no silent guess

#### Scenario: an undocumented feature
- **WHEN** behaviour exists that no doc or test states
- **THEN** it is documented and tested, or deleted, by owner decision

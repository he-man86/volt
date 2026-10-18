## ADDED Requirements

### Requirement: every volt-cli concern lives in the project that owns it
Code in `packages/volt-cli` SHALL live in the project that owns its concern: shared, vendor-neutral logic in
`Volt.Engine`; only irreducible vendor glue in `Volt.Ide.Codesys` / `Volt.Ide.Twincat`; the CLI verbs in `Volt.Cli`;
supervision in the connector; wire types in `Volt.Contracts`.

#### Scenario: vendor-neutral logic found in an IDE host
- **WHEN** the same logic exists in both IDE hosts, or a host holds logic that names no vendor fact
- **THEN** it moves to `Volt.Engine`, and both vendors still serve byte-identical wire responses

#### Scenario: a recorded vendor asymmetry
- **WHEN** code differs between the hosts because of an entry in `Ide/DIALECT.md`
- **THEN** it stays in its host and is not unified

### Requirement: a new vendor is one IDE host
Adding a vendor SHALL require only a new IDE host project implementing the `Volt.Engine/Ide` contract (driver + pipe
host); `Volt.Engine` above that contract, the wire and the CLI SHALL assume no CODESYS-family fact; a vendor appears above it only as a
name (the binding's `vendor`, which names the pipe), never as a branch.

#### Scenario: a vendor outside the CODESYS family
- **WHEN** a vendor with no NWL and no CODESYS object model is added
- **THEN** it implements the `Ide/` contract in its own host, and no Engine, wire or CLI code changes to admit it

#### Scenario: a CODESYS-family fact above the seam
- **WHEN** Engine code above the `Ide/` contract depends on a fact only the CODESYS family has (NWL, its object types)
- **THEN** it moves into a family layer the two current hosts share, below the contract

### Requirement: no legacy code, no hidden behaviour
`packages/volt-cli` SHALL contain no code, comment or doc that serves a removed design or an old format, and no
behaviour that neither a doc nor a test states.

#### Scenario: a fallback masks a broken state
- **WHEN** a default, catch or fallback hides a state the code cannot handle
- **THEN** a failing test shows the state, and the code fails loud or handles it — no silent guess

#### Scenario: an undocumented feature
- **WHEN** behaviour exists that no doc or test states
- **THEN** it is documented and tested, or deleted, by owner decision

## ADDED Requirements

### Requirement: one model per concern, identical in both backends

The transpiler SHALL hold one model each for loop execution, string storage, pointers and references, and instance
initialization, described in `docs/architecture.md`, and the interpreter and the emitted Rust SHALL implement the same
model. For every lowered fixture, both backends SHALL give CODESYS's recorded values, and SHALL agree with each other on
the deterministic edge inputs (`edge` in the fixture map), except where the map names a known divergence.

#### Scenario: a loop past a million passes
- **WHEN** a FOR loop runs 1,000,001 times
- **THEN** both backends complete it, as CODESYS does

#### Scenario: bytes past a string's terminator
- **WHEN** a program stores `s[4] := 0` and then fills `s[3]..s[0]`
- **THEN** both backends give CODESYS's result, `'4321'`

#### Scenario: a pointer into an instance survives a copy
- **WHEN** an FB instance holding `ADR(own member)` is copied whole
- **THEN** reading through the copy's pointer gives what CODESYS gives

### Requirement: a leanness step never changes program output

A step that only makes the emitted Rust leaner SHALL leave the corpus-output snapshot (every lowered fixture's values on
recorded and edge inputs, both backends) byte-identical, and SHALL move the fixture map's `size`, `pedantic` and lint
totals in the direction it claims.

#### Scenario: prelude on demand
- **WHEN** the prelude emits only the helpers a program calls
- **THEN** the corpus-output snapshot is unchanged and the `dead_code` count falls

## ADDED Requirements

### Requirement: every NWL shape has one spelling or a named refusal
The network-text gate SHALL generate every NWL node class, slot and flag combination from the vendor schema, read from
the CODESYS NWL assembly into a committed census that a test regenerates and compares, and SHALL fail when a
combination has neither exactly one text spelling nor a refusal by name (the writer's, or the CODESYS reader's for a
stored shape it refuses before any model exists).

#### Scenario: a shape no corpus holds
- **WHEN** the schema allows a flag on a slot that no corpus network uses
- **THEN** the gate still generates it and requires its spelling or its named refusal

#### Scenario: a model bit the text has no position for
- **WHEN** a generated model carries a bit the writer would not spell (a flag only the assignment item holds)
- **THEN** model → text → model differs and the gate fails naming the shape, until the writer refuses it by name

#### Scenario: a second spelling
- **WHEN** a production the reference shows, or a text the writer spelled, reads to a model the writer spells differently
- **THEN** the gate fails naming the text

### Requirement: the generated shapes are a shared, versioned fixture
The gate SHALL export every generated shape, with its class, slot, flag holder, flags and outcome (the text, or the
refusal's name), to a versioned file at a stable path, with its coverage and every cut stated beside it, so the LSP and
Sim-Assist check the same list.

#### Scenario: the editor reads what the writer spells
- **WHEN** the LSP reads every spelled text of the export against the export's scope
- **THEN** its network check reports nothing

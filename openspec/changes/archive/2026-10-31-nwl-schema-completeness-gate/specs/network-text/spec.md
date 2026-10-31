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
- **WHEN** a generated model carries a bit the writer would not spell (a Set bit only the assignment item holds)
- **THEN** model → text → model differs and the gate fails naming the shape, until the writer refuses it by name

#### Scenario: a second spelling
- **WHEN** a production the reference shows, or a text the writer spelled, reads to a model the writer spells differently
- **THEN** the gate fails naming the text

### Requirement: a stored shape that changes the program is spelled, an inert bit refused by name
A shape CODESYS stores that changes the picture or the generated code SHALL have one spelling: a value standing alone
(`a;`, `NOT AND(a, b);`, `BRANCH(FEED := start, a, b);`, `RAIL();`), the assignment item's marks last in its chain
(`y := NOT := a;`), a marked jump (`NOT JMP.l := a;`), a negated Execute ENO, the rail-fed branch
(`BRANCH(FEED := RAIL(), a, b)`), and the operand comment `COMMENT(a, 'why')` wherever an operand stands. A bit the IDE
keeps but neither draws nor compiles (a coil flag on a pin, a value or a box, the falling bit beside a rising one, a
Set bit on the assignment item, a named or jumping return, a marked rail) SHALL be refused by name.

#### Scenario: the operand comment survives a pull
- **WHEN** an operand holds a comment the engineer typed beside it
- **THEN** the pull writes it as `COMMENT(a, 'why')` and a push stores it back on the same operand

#### Scenario: an inert bit
- **WHEN** a pin carries a Set bit
- **THEN** the pull shows the network as `%UNSUPPORTED "a coil flag on a pin"`, never the network without the bit

### Requirement: the generated shapes are a shared, versioned fixture
The gate SHALL export every generated shape, with its class, slot, flag holder, flags and outcome (the text, or the
refusal's name), to a versioned file at a stable path, with its coverage and every cut stated beside it, so the LSP and
Sim-Assist check the same list.

#### Scenario: the editor reads what the writer spells
- **WHEN** the LSP reads every spelled text of the export against the export's scope
- **THEN** its network check reports nothing

## ADDED Requirements

### Requirement: A refusal names whose limit it is

Every refusal Volt raises about a graphical body SHALL state whether the limit belongs to VOLT (a door its host
has, or lacks) or to the VENDOR (a shape the IDE will not hold). A message that blames the vendor SHALL be
backed by a measurement that the IDE itself cannot hold the shape — not by the failure of one transport.

#### Scenario: a shape the IDE holds but Volt cannot create

- **WHEN** a driver refuses a body whose shape exists in a committed hand-drawn fixture
- **THEN** the message says what VOLT cannot do and what the engineer can do instead, and never says the vendor
  cannot hold it

#### Scenario: a vendor limit

- **WHEN** a refusal names the vendor
- **THEN** a recorded measurement shows the IDE rejecting the shape by its own means, not through one importer

### Requirement: Every output of an item survives a pull

A pulled body SHALL mention every output the archive holds. An item driving several targets — coils, a jump
destination, or any mixture — SHALL render all of them, and the text SHALL read back as the SAME item rather
than as several.

#### Scenario: a rung drives a coil and a jump

- **WHEN** one `BoxTreeAssign` holds a jump destination and an ordinary coil in its output list
- **THEN** the pulled text names both, and pushing that text back produces one item with two outputs

#### Scenario: the destination is chosen by its flag

- **WHEN** a jump's destination is not the first target in the archive's output list
- **THEN** the rendered `JMP` names the target carrying the jump flag, not the first one

### Requirement: Coverage counts what was never tried

The graphical coverage report SHALL count constructs the format can READ, not only those a push can create — so
a shape no driver can state is visible as a gap rather than absent from the denominator.

#### Scenario: a construct no driver can create

- **WHEN** the format can read a construct that neither driver can create
- **THEN** the report lists it as uncovered, and names the hand-drawn fixture that stands in for it, or that
  none exists

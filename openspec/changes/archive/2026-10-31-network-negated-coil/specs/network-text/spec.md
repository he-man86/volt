## ADDED Requirements

### Requirement: A negated coil keeps its own spelling
Network text SHALL spell a negated coil and the rising and falling edge coils so that a pull, push, pull keeps the coil's own flag, if the owner picks a spelling for them.

#### Scenario: A drawn negated coil round-trips
- **WHEN** a network with a negated coil `-(/)-` fed by contact `a` is pulled and pushed back
- **THEN** CODESYS stores a negated coil fed by a normally open contact, not a negated contact into a plain coil

## ADDED Requirements

### Requirement: a network body converts to buildable ST
Volt SHALL convert an LD or FBD network body to ST that builds in CODESYS and runs as the network, declaring every instance the network-only forms need.

#### Scenario: edge contact becomes a declared R_TRIG
- **WHEN** the body `y := R_EDGE(a) AND b;` is converted
- **THEN** the ST declares an R_TRIG instance, calls it with CLK := a, and assigns y from its Q AND b

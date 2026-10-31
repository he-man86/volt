## ADDED Requirements

### Requirement: an unnamed jump label reads as unnamed
The network-text readers SHALL read `JMP.??? := v;` and `y := JMP.??? := v;` as a jump whose label is unnamed, the way
`???` reads as an unnamed operand elsewhere in a network, with one diagnostic on the label naming it unnamed, and SHALL
not report that the jump takes no `:=`.

#### Scenario: a freshly inserted jump
- **WHEN** a network holds `y := JMP.??? := c;`
- **THEN** the network reads as coil `y` and a jump on `c`, and the only network diagnostic is on `???`, naming the label
  unnamed

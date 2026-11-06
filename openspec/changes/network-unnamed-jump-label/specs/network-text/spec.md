## ADDED Requirements

### Requirement: an unnamed jump label reads as unnamed
The network-text readers SHALL read `ASSIGN(v, Q => JMP.???);` and `ASSIGN(v, Q => y, Q => JMP.???);` as a jump whose
label is unnamed, the way `???` reads as an unnamed operand elsewhere in a network, with one diagnostic on the label
naming it unnamed.

#### Scenario: a freshly inserted jump
- **WHEN** a network holds `ASSIGN(c, Q => y, Q => JMP.???);`
- **THEN** the network reads as coil `y` and a jump on `c`, and the only network diagnostic is on `???`, naming the label
  unnamed

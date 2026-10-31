## ADDED Requirements

### Requirement: plain-ST network text is lowered by the interpreter
The transpiler SHALL lower an LD/FBD body in plain-ST network text to the ST statements the network runs as, so the
interpreter runs it with the behaviour CODESYS gives the same network; a box no rule writes SHALL be refused by name.

#### Scenario: an LD body runs
- **WHEN** a POU whose body is `%LANGUAGE LD` network text is run by the interpreter
- **THEN** each scan's outputs equal those of the network's exec twin, which CODESYS runs as the network

#### Scenario: a wire read before its definition
- **WHEN** a network reads its wire `w1` before the statement that defines it
- **THEN** scan 1 reads the wire type's initial value and every later scan the value the previous scan defined
  (recorded: `nt_wire_read_before_definition_scan1|2`)

#### Scenario: a network's hidden state has a path
- **WHEN** a harness reads `__nw<N>_<wire>`, `__nw<N>_eno<k>` or `__nw<N>_trig<k>` (`<N>` the network's 1-based index in
  its body; `__nw_<body>_<N>_…` in an ACTION's body) through `Runner.get`
- **THEN** it reads that wire, ENO temp or edge detector of network `<N>`

#### Scenario: a box the lowering has no rule for
- **WHEN** a network holds a box the exec twin refuses (an enabled non-comparison box read inside a tree, a box showing
  ENO without EN at a root or on an FB, …)
- **THEN** lowering refuses the body with `network-box` (or `network-invalid` where CODESYS does not compile it), naming
  the box and the twin's reason

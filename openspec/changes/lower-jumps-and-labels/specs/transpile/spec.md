## ADDED Requirements

### Requirement: jumps and labels run
The interpreter SHALL run ST `JMP` and labels and the network jump and return targets with the semantics CODESYS
records, and the Rust emitter SHALL emit the same behaviour from the same IR.

#### Scenario: an LD body that jumps
- **WHEN** an LD body holds `JMP.skip := a;` and a later network labelled `skip`
- **THEN** with `a` TRUE the networks between are not run in that scan, as recorded on CODESYS

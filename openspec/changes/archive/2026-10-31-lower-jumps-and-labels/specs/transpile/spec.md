## ADDED Requirements

### Requirement: jumps and labels run
The interpreter SHALL run ST `JMP` and labels and the network jump and return targets with the semantics CODESYS
records, and the Rust emitter SHALL emit the same behaviour from the same IR.

#### Scenario: an LD body that jumps
- **WHEN** an LD body holds `JMP.skip := a;` and a later network labelled `skip`
- **THEN** with `a` TRUE the networks between are not run in that scan, as recorded on CODESYS (`nt_jmp_over_network`)

#### Scenario: a coil beside a jump
- **WHEN** an LD network holds `y := JMP.skip := a;` with `a` TRUE
- **THEN** `y` is written TRUE and the networks before `skip` are not run (`nt_coil_written_before_jump`)

#### Scenario: a backward jump
- **WHEN** an ST body jumps back to a label while a counter is below 5
- **THEN** the body repeats from the label until the counter ends it (`tr_jmp_backward_counter_loop`)

### Requirement: a labeled body is one IR node
Lowering SHALL lower a body whose top level holds a label a JMP names to one `labeled` node, its statements cut at each
such label into segments, and a JMP to a `jump` to its segment; a JMP to a label inside a block SHALL be refused by name.

#### Scenario: a jump out of a loop
- **WHEN** a JMP inside a FOR names a label after the loop
- **THEN** the loop is left and the body goes on at the label (`tr_jmp_out_of_loop_to_later_label`)

#### Scenario: a label inside a block
- **WHEN** a JMP names a label standing inside an IF or a loop
- **THEN** lowering refuses it as `stmt-jmp`

#### Scenario: Rust has no goto
- **WHEN** the Rust emitter prints a labeled body
- **THEN** it prints a loop over a `match` on the segment to run next (one segment: the loop alone), with no `unsafe`

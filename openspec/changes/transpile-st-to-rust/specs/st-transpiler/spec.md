## ADDED Requirements

### Requirement: ST POUs transpile to executable Rust for headless testing

The toolchain SHALL transpile a Structured Text POU to Rust that compiles and runs its scan logic, so PLC logic
can be exercised and asserted without the IDE. The transpiler SHALL consume the shared ST AST/core (no separate
parser) and cover the executable core of the language — assignment, expressions, control flow, and FB calls.

#### Scenario: A POU transpiles, builds, and produces the expected outputs
- **WHEN** a POU with known inputs is transpiled to Rust, built, and driven for one or more scan cycles
- **THEN** its outputs match the values the same logic produces in the IDE/compiler for those inputs

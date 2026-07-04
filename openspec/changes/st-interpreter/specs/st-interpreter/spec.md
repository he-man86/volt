## ADDED Requirements

### Requirement: Deterministic scan-cycle execution of ST POUs

The interpreter SHALL execute a Structured Text POU (function block, program, or function) by tree-walking its `st-body-ast` statement/expression tree, evaluating one scan cycle per invocation. Execution SHALL be deterministic: identical inputs and identical prior state SHALL always produce identical outputs. The interpreter SHALL persist instance state (function-block instance variables and RETAIN variables) across scans, so that stateful logic (counters, edge detection, state machines) behaves as it does in a PLC runtime. Time-dependent behavior SHALL be driven by an injected clock, not wall-clock time, so tests are reproducible.

#### Scenario: Stateful logic persists across scans
- **WHEN** a program with `count := count + 1;` is run for 3 scans from a zero-initialized state
- **THEN** reading `count` after the runs returns 3

#### Scenario: Inputs drive outputs within a scan
- **WHEN** a function block body is `q := a AND b;` and it is invoked with `a := TRUE, b := FALSE`
- **THEN** the output `q` reads FALSE after the scan

#### Scenario: Determinism
- **WHEN** the same POU is run twice with the same input sequence and injected clock
- **THEN** both runs produce byte-identical output sequences

### Requirement: IEC-correct value semantics

The interpreter SHALL model IEC 61131-3 elementary values with their standard semantics: integer types SHALL respect their declared width and signedness including wraparound on overflow; REAL/LREAL SHALL follow IEEE-754; BOOL, TIME/LTIME, STRING/WSTRING, enumerations, structures, and arrays SHALL be supported; and implicit conversions SHALL follow IEC promotion rules. When the interpreter encounters a construct or standard library element it does not implement, it SHALL fail the affected test explicitly (naming the unimplemented element) rather than silently returning a wrong value.

#### Scenario: Integer overflow wraps
- **WHEN** a `BYTE` (or `USINT`) variable holding 255 is incremented by 1
- **THEN** the interpreter yields 0, matching PLC wraparound semantics

#### Scenario: Unimplemented element fails loudly
- **WHEN** a body calls a standard function block the interpreter does not yet implement
- **THEN** the test fails with a message naming the missing element, not a silently-wrong result

### Requirement: Headless test API

The interpreter SHALL expose a headless API usable from the repository test runner (`bun test`) that lets a test set input variables, run a chosen number of scans, and assert on output/internal variable values — with no vendor IDE, runtime, or hardware required.

#### Scenario: Test a function block headlessly
- **WHEN** a test sets a rising-edge detector's input across a sequence of scans (FALSE, TRUE, TRUE, FALSE)
- **THEN** the test can assert the edge output is TRUE only on the scan where the input first became TRUE, running entirely in CI

### Requirement: Correctness proven against the vendor-runtime oracle

Interpreter correctness SHALL be validated by diffing its outputs against the vendor toolchain acting as ground truth (the same oracle discipline as the existing compiler-vs-LSP harness). A representative set of real POUs SHALL be executed both in the interpreter and (via the headless bridge / vendor runtime) in CODESYS/TwinCAT, and their outputs SHALL match. A divergence SHALL be treated as an interpreter defect, not accepted as a new baseline.

#### Scenario: Interpreter matches the runtime on a real POU
- **WHEN** a real project POU is exercised with a fixed input sequence in both the interpreter and the vendor runtime
- **THEN** the two output sequences are equal; any mismatch fails the harness and is triaged as an interpreter bug

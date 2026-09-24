## ADDED Requirements

### Requirement: one row per fixture, in one generated file

Everything derived about a conformance fixture SHALL live in a single generated module keyed by fixture name, and
SHALL be merged onto the fixture at runtime so that reading one fixture answers all of it: how well it is
evidenced, what its ST lowers to, which oracle reached the emitted Rust, what the linter says about that Rust, and
which vendors it is recorded as diverging from.

The vendor recordings SHALL NOT hold any of it: a recording is the vendor's own answer and only a recorder writes
it. An authored decision with a stated reason, such as a known divergence, SHALL keep its reason in the file where
it is authored; only its membership joins the row.

#### Scenario: a fixture's rating and its transpile quality are read together
- **WHEN** a reader asks what is known about one fixture
- **THEN** one row names its evidence, its tier, its oracle, its surviving lints and its divergences

#### Scenario: regenerating the map does not rewrite a recording
- **WHEN** the map is regenerated
- **THEN** no file under `recordings/` changes

### Requirement: every fixture carries a measured transpile tier

Each conformance fixture that lowers SHALL carry a tier derived from the IR its source lowers to, over the ordered
set `decl` < `arith` < `control` < `aggregate` < `call` < `indirect`. The tier SHALL be the highest band the
FIXTURE'S OWN body reaches, and SHALL be computed from the lowered IR rather than declared on the fixture or
inferred from the folder it lives in.

#### Scenario: a primitive declaration is the lowest tier
- **WHEN** a fixture declares `x : INT;` with an empty body
- **THEN** its tier is `decl`

#### Scenario: the harness that instantiates a fixture does not set its tier
- **WHEN** a function-block fixture is assembled under a synthesized program that declares an instance and calls it
- **THEN** its tier comes from its own body, not from that call

#### Scenario: a fixture that stops lowering has no tier
- **WHEN** a fixture does not lower
- **THEN** it carries no tier and no lint list, and the sweep does not count it as clean

### Requirement: every fixture carries which oracle reached its emitted Rust

A fixture that lowers SHALL carry `vendor` when the CODESYS recording's values were reproduced by the compiled
Rust, and `compiles` when the Rust was accepted by the compiler but no recorded value reaches it.

There SHALL be no value claiming the interpreter-versus-Rust comparison, because that gate runs on a fixed sample:
a per-fixture row may not claim evidence that moves when the sample size moves.

#### Scenario: a recorded fixture whose Rust reproduces the values
- **WHEN** the run recording holds values for a fixture and the emitted Rust prints the same ones
- **THEN** its oracle is `vendor`

#### Scenario: a fixture with no recorded values
- **WHEN** no recording names any of a fixture's variables
- **THEN** its oracle is `compiles`

### Requirement: the emitted Rust is linted, and every allowed lint carries its reason

The pass that compiles each fixture's emitted Rust SHALL run the Rust linter in the same invocation, and SHALL
record the findings that survive an allow-list. Each allowed lint SHALL be accompanied by the reason it is Volt's
own answer rather than a defect, and the gate SHALL fail on an entry with no reason.

Findings SHALL be attributed to the emitted code only, not to the harness the pass appends to it.

#### Scenario: a width cast is the language rule, not a defect
- **WHEN** the emitted Rust narrows a promoted `i32` back to `i16` for an INT assignment
- **THEN** the cast lints are allowed, because IEC arithmetic promotion is what produced them

#### Scenario: a cast that does nothing is a finding
- **WHEN** the emitted Rust casts a value to the type it already has
- **THEN** an unnecessary-cast finding is recorded against that fixture

#### Scenario: a lint from the test harness is not the emitter's
- **WHEN** the harness appended to a fixture's Rust raises a lint of its own
- **THEN** it is not recorded against the fixture

### Requirement: a fixture may report only the lints its row already carries

The build SHALL record lints rather than deny them, and the gate SHALL fail when a fixture reports a lint its
stored row does not carry, naming the fixture and the lint. A fixture whose emitted Rust is free of surviving lints
SHALL NOT regress into carrying one. A row that could SHRINK SHALL NOT fail the gate, so that an improvement to the
emitter does not arrive as a red suite.

#### Scenario: a printer change that reintroduces a finding
- **WHEN** a change to the emitter makes a previously clean fixture report a lint
- **THEN** the gate fails and names that fixture

#### Scenario: a printer change that removes a finding
- **WHEN** a change to the emitter removes a recorded lint
- **THEN** the gate stays green, and regenerating the map lowers the count

#### Scenario: denying the lints instead of recording them
- **WHEN** the build is told to deny warnings
- **THEN** every finding arrives at error level and no row records it, which is why the build records instead

### Requirement: the map is generated and never hand-written

The rows SHALL be written by one producer and recomputed by the gate, which SHALL fail if a stored row disagrees
with what the recordings, the IR and the compiler say. The producer SHALL refuse to run without the linter rather
than write rows whose empty lint lists cannot be told from clean ones.

#### Scenario: a stale row
- **WHEN** a fixture's emitted Rust changes but the generated module does not
- **THEN** the gate fails

#### Scenario: no linter available to the producer
- **WHEN** the map is regenerated on a machine with no Rust linter
- **THEN** the producer refuses and writes nothing

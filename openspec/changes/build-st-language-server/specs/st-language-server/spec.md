## ADDED Requirements

### Requirement: A layered architecture with one source of truth per concern

The server SHALL be organized as strict layers — `syntax` (lexer/AST/parser), `symbols` (binder), `types` (the
type system), `analysis` (diagnostics), `services` (LSP features), `server` (protocol) — where imports point
only downward (`syntax ← symbols ← types ← analysis ← services ← server`). Each concern SHALL have exactly one
source of truth: elementary type facts, type compatibility, type rendering, scope navigation, cursor→symbol
resolution, and symbol-kind labels each live in a single module that every consumer uses. A second list or a
duplicated relation SHALL be treated as a defect.

#### Scenario: A fact or relation is defined once
- **WHEN** an elementary type's range/rank, or a type-compatibility rule, is needed by any check or query
- **THEN** it is read from the single owning module, so the same input yields the same answer everywhere and a
  change is made in exactly one place

### Requirement: The AST models the language completely

The parser SHALL produce an AST that carries the semantic content backends need, so no consumer re-parses raw
tokens: type expressions carry structured dimensions, string length, subrange bounds, and vector shape;
literals carry their evaluated value and precise type; variable initializers are expression trees. The parser
SHALL be error-tolerant — a malformed input yields a partial tree plus diagnostics, and precision never
regresses.

#### Scenario: A consumer reads structured nodes, not spans
- **WHEN** the formatter, a range check, or the transpiler needs an array bound, a string length, or an
  initializer value
- **THEN** it reads the structured/evaluated node directly from the AST rather than re-lexing a source span

### Requirement: One conservative type system, reused by every backend

The `types` layer SHALL provide a single expression-inference engine, a single compatibility relation, constant
evaluation, and a rich `Type` model whose `UNKNOWN` case is the total fallback. It SHALL be conservative and
non-authoritative: an unresolved type or non-constant value yields unknown / no result and raises no
diagnostic, and the IDE compiler remains the authority for final type-checking and codegen. The same type
system SHALL power diagnostics, hover, completion, navigation, and code generation — not a per-backend copy.

#### Scenario: Unknown types never false-positive
- **WHEN** an expression's type cannot be fully resolved
- **THEN** no type diagnostic is emitted for it — the zero-false-positive contract on valid real code holds

### Requirement: Diagnostics match the vendor compilers byte-for-byte

Every diagnostic the server shares with a compiler SHALL read byte-identical to that compiler's message, per
vendor. This SHALL be enforced by an oracle harness: each rule has a conformance fixture recorded against the
live CODESYS and TwinCAT compilers; an offline replay asserts the server's diagnostic message SET equals the
recording per vendor, with a documented divergence ledger the only opt-out. A committed real-project corpus
SHALL be the regression net — a miss it surfaces becomes a new fixture, never a threshold change.

#### Scenario: A diagnostic cannot ship unless it matches both compilers
- **WHEN** a check produces a message the compiler also produces
- **THEN** the replay passes only if the message is byte-identical to the recorded compiler output for that
  vendor; otherwise CI fails

### Requirement: Vendor differences are a single toggleable, provenance-tagged registry

Every place CODESYS and TwinCAT differ SHALL be a data entry in ONE registry — per-vendor message wording,
vendor-only rules, and documented divergences — NOT a hardcoded `activeVendor` branch scattered across
checks. Each entry SHALL be individually enable/disable-able and tagged with provenance (verified against the
live compiler vs. suspected bridge artifact vs. deferred). Checks and message builders SHALL read their
per-vendor output from the registry; disabling an entry SHALL fall back to a single shared behavior. So a
difference later found to be a bridge bug (e.g. a phantom `__SETVALUE` on a GET-only interface property) is
removed by flipping one flag, and every difference is auditable in one place.

#### Scenario: A suspected bridge artifact is disabled without touching checks
- **WHEN** a recorded CS↔TC difference is judged a bridge artifact rather than real vendor behavior
- **THEN** its registry entry is disabled (one flag), the LSP reverts to shared behavior for that construct, and
  no check code changes

#### Scenario: Every vendor difference is reviewable in one place
- **WHEN** someone audits the CODESYS↔TwinCAT surface
- **THEN** the full set of differences (with provenance and enabled state) is the registry — not a grep across
  check files

### Requirement: The graphical sublanguage is native, not a parallel stack

The FBD/LD graphical languages — materialized as readable text — SHALL be a front-end that reuses the shared
core: it has its own surface syntax and graph-structure checks, but its type inference, diagnostics
orchestration, and feature services are the shared `types`/`analysis`/`services`, not duplicates. The module
SHALL be an umbrella for the graphical-language family, with the current text encoding as one member and room
for future formats.

#### Scenario: Graphical type inference uses the shared engine
- **WHEN** a graphical wire expression's type is needed
- **THEN** it is inferred by the shared `types` engine, not a separate string-based inferencer

### Requirement: Modern LSP feature set and minimal configuration

The server SHALL implement the LSP 3.17 feature set appropriate to PLC code — including inlay hints (inferred
types + parameter names), code lens, type-definition, prepare-rename, on-type/range formatting, and push AND
pull diagnostics with progress and cancellation — in addition to the core navigation/display/structure/format
features. Configuration SHALL be minimal and meaningful: the vendor dialect plus a small opt-in set of
stricter-than-compiler lints; compiler-mirroring diagnostics are not individually configurable, and client
capabilities are read from the protocol, not re-declared as config.

#### Scenario: Inferred types are shown inline
- **WHEN** a variable's type is inferred and inlay hints are enabled
- **THEN** the server offers an inlay hint showing that type, sourced from the shared type engine

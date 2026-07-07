## MODIFIED Requirements

### Requirement: Narrowing-conversion diagnostic

The language server SHALL emit a WARNING for EVERY implicit type conversion the compiler warns on — not only
`LREAL→REAL`, but the whole family: narrowing / loss-of-precision (higher width → lower, e.g. `DINT→INT`,
`LREAL→REAL`) reported as "possible loss of information", and signed↔unsigned "change of sign" (same width
across the signed/unsigned boundary, e.g. `WORD→INT`, `INT→UINT`). Each warning SHALL be produced from the one
`classifyConversion` function (see "Type conversion is classified by a single function"), mapped to its
per-vendor wording via `messages`, and enabled by default only where a recorded conformance fixture confirms
both compilers emit it. The check SHALL remain conservative — an `UNKNOWN` operand yields no diagnostic — and,
being warnings (the code still compiles), these SHALL be validated by the conformance oracle and reported
separately by the corpus harness, never counted in the zero-ERROR precision floor.

#### Scenario: LREAL to REAL narrowing warns
- **WHEN** an `LREAL` expression is assigned to a `REAL` variable
- **THEN** a narrowing-conversion warning is raised, matching the compiler's warning on the same site

#### Scenario: Signed/unsigned conversion warns with "change of sign"
- **WHEN** a `WORD` (unsigned) value is assigned to an `INT` (signed) target, or an `INT` to a `UINT`
- **THEN** a warning is raised with the compiler's "Possible change of sign" wording — not silence

#### Scenario: An unknown operand suppresses the warning
- **WHEN** either side of a conversion resolves to `UNKNOWN` (an unresolved library/user type)
- **THEN** no conversion diagnostic is emitted (conservative-skip; zero false positives)

## ADDED Requirements

### Requirement: Type conversion is classified by a single function

The type system SHALL own ONE total function `classifyConversion(src, dst)` that returns a conversion kind
(`identity` / `widen` / `narrow` / `sign-change` / `cross-family` / `incompatible`) computed from the
elementary type lattice (family, bit width, signedness, widening rank) per the IEC 61131-3 conversion hierarchy
and the reference-compiler behavior. This function SHALL be the single source of truth for conversion decisions:
`isAssignable` is `classifyConversion(...) !== "incompatible"`, `isNarrowing` is `classifyConversion(...) ===
"narrow"`, and every conversion diagnostic (the narrowing/sign-change WARNINGS and the assignment /
conversion-source ERRORS) SHALL derive its severity from the returned kind rather than a second, duplicated
rule. The `analysis` layer maps a kind to a per-vendor message; it SHALL NOT re-decide the conversion.

#### Scenario: One classification drives both a warning and an error
- **WHEN** the same conversion (e.g. `INT := DINT`) is evaluated for a diagnostic
- **THEN** its kind is taken from `classifyConversion`, and the layer maps that one kind to the correct
  severity + wording — with no independent narrowing/assignability tables that could disagree

### Requirement: Type-conversion parity is matrix-verified against the compiler oracle

Conversion coverage SHALL be proven, not assumed: a generated conversion matrix (every elementary type pair
across the contexts that change the answer — plain assignment, typed and untyped literals, arithmetic results,
comparisons) SHALL be recorded against live CODESYS and TwinCAT, and the recording SHALL be diffed against
`classifyConversion` + `messages` through the conformance replay. Any disagreement between the LSP's
classification and the recorded compiler behavior SHALL be treated as a defect — corrected in the classification
or encoded as a per-vendor rule — so the recording validates the rules rather than the rules being guessed from
the recording. A representative slice SHALL be committed as fixtures; the full matrix SHALL be reproducible from
its generator.

#### Scenario: A misclassified pair is caught by the oracle
- **WHEN** `classifyConversion` labels a pair (say `USINT := 256`) differently from what CODESYS/TwinCAT emit for it
- **THEN** the conformance replay reports the divergence, and the classification (or a per-vendor rule) is fixed
  so the LSP and the build pane agree

## MODIFIED Requirements

### Requirement: Narrowing-conversion diagnostic

The language server SHALL emit a WARNING for EVERY implicit type conversion the compiler warns on — not only
`LREAL→REAL`, but the whole family, exactly as calibrated against the live compilers by the conversion matrix:
- **loss of information** — a real target that can't hold the source exactly: real narrowing (`LREAL→REAL`) and
  an integer wider than the float mantissa (REAL 24 bits, LREAL 53 bits: `DINT→REAL`, `LINT→LREAL`, …).
- **change of sign** — crossing the signed/unsigned boundary where the target can't represent the source's
  range: signed → unsigned at ANY width (`INT→WORD`, `SINT→UINT` — a negative never fits), and unsigned → signed
  only at the SAME width (`WORD→INT`; a WIDER signed target holds every unsigned value, so it stays a safe widen).

Integer NARROWING (`DINT→INT`) is NOT a warning — the compilers reject it as an ERROR (`Cannot convert type …`);
that severity likewise comes from `classifyConversion` (kind `incompatible`). Each warning SHALL be produced from
the one `classifyConversion` function (see "Type conversion is classified by a single function"), mapped to its
per-vendor wording via `messages`, and enabled by default only where a recorded conformance fixture confirms
both compilers emit it. The check SHALL remain conservative — an `UNKNOWN` operand yields no diagnostic — and,
being warnings (the code still compiles), these SHALL be validated by the conformance oracle and reported
separately by the corpus harness, never counted in the zero-ERROR precision floor.

#### Scenario: LREAL to REAL narrowing warns
- **WHEN** an `LREAL` expression is assigned to a `REAL` variable
- **THEN** a narrowing-conversion warning is raised, matching the compiler's warning on the same site

#### Scenario: Signed/unsigned conversion warns with "change of sign"
- **WHEN** a `WORD` (unsigned) value is assigned to an `INT` (signed) target, or a signed value to a WIDER
  unsigned target (e.g. `SINT→UINT`)
- **THEN** a warning is raised with the compiler's "Possible change of sign" wording — not silence

#### Scenario: A large integer assigned to a real warns "loss of information"
- **WHEN** an integer wider than the target real's mantissa is assigned (e.g. `DINT→REAL`, `LINT→LREAL`)
- **THEN** a "possible loss of information" warning is raised, matching the compiler; but a fitting int (`INT→REAL`,
  `DINT→LREAL`) is a silent safe widen

#### Scenario: An unknown operand suppresses the warning
- **WHEN** either side of a conversion resolves to `UNKNOWN` (an unresolved library/user type)
- **THEN** no conversion diagnostic is emitted (conservative-skip; zero false positives)

## ADDED Requirements

### Requirement: Type conversion is classified by a single function

The type system SHALL own ONE total function `classifyConversion(dst, src)` that returns a conversion kind
(`identity` / `widen` / `narrow` / `sign-change` / `incompatible`) computed from the elementary type lattice
(family, bit width, signedness, widening rank) per the IEC 61131-3 conversion hierarchy and the reference-compiler
behavior (cross-family int↔real folds into the same widen/narrow/incompatible kinds — no separate category). This function SHALL be the single source of truth for conversion decisions:
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

## ADDED Requirements

### Requirement: the LSP reports what the IDE build reports

For every source in the corpora and the conformance fixtures, the LSP's diagnostics SHALL equal the recorded CODESYS and
TwinCAT builds' messages (text, place, severity), except where a known divergence is recorded with its reason.

#### Scenario: a false positive
- **WHEN** the LSP reports a message the recorded build does not
- **THEN** it is a finding: fixed, or recorded as a known divergence that fails the suite once it matches

### Requirement: one pipeline turns a document into the analysis's diagnostics

`computeDiagnostics` (`src/analysis/pipeline/diagnostics.ts`) SHALL be the only composition of the ST checks: it runs every
registry check the vendor's run includes, in registry order, and then applies the policy once (configurable severity and
"off", TwinCAT's per-line dedupe). The server, the conformance replay, the evidence rating and the scripts SHALL call it
rather than compose checks themselves; the server adds only server policy (the library-file gate, dead POUs and members,
unstated bodies, the other-materialization gate, the missing-language, retired-comment and manifest findings). Network
text is not in it: its own pass stays where it was (parked for the LD/FBD coverage change).

#### Scenario: a parse error is reported once
- **WHEN** a document has one parse error
- **THEN** the server shows exactly one diagnostic for it (the pipeline's), not a second codeless copy from the raw parse stream

#### Scenario: a restricted run that would starve a reader is refused
- **WHEN** `computeDiagnostics` is asked for a subset of groups that holds a check reading earlier findings but not every
  group that produces them
- **THEN** it refuses by name instead of running the reader on findings that were never produced

### Requirement: the registry is data and its order is a contract

Every check SHALL be one entry of `REGISTRY` (`src/analysis/pipeline/registry.ts`) carrying its group, its vendor scope
(`both` or one vendor, with what was measured in its note) and the codes it `reads` from earlier findings. The run order
SHALL be the listed order, and every code a check reads SHALL be produced by checks that run before it.

#### Scenario: a reorder
- **WHEN** an entry is moved so that a check runs before a producer of a code it reads
- **THEN** `registry.test.ts` fails, naming the reader and the code

#### Scenario: a vendor's run
- **WHEN** the analysis runs for one vendor
- **THEN** it runs the registry minus the other vendor's entries, in the same order

### Requirement: the analysis layering rules A1–A6 are a gate

`scripts/check-layering.ts` (run by `bun run lint` and `test/frontend/layering.test.ts`) SHALL fail on any violation of:
A1 analysis reaches the reference catalog only through `reference/index.js` (the front-end only through its indexes);
A2 outside `src/analysis/`, the only analysis file imported is `analysis/index.js`;
A3 a check imports no other check and never the registry or the pipeline;
A4 only the registry and the pipeline import a check;
A5 no analysis test imports a rank above analysis;
A6 every `checks/<group>/<name>.ts` has its `<name>.test.ts` beside it, and every such test its subject.
The known-violation list for these rules (`KNOWN_ANALYSIS_VIOLATIONS`) SHALL be empty.

#### Scenario: a check imports a sibling check
- **WHEN** a file under `src/analysis/checks/` imports another check
- **THEN** the gate fails with an `A3` line naming both files

#### Scenario: a check without its test
- **WHEN** `checks/<group>/<name>.ts` has no `<name>.test.ts` beside it
- **THEN** the gate fails with an `A6` line naming the file

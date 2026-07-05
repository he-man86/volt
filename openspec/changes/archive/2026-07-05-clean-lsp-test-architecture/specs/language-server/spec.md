## ADDED Requirements

### Requirement: LSP behavior is verified by feature tests against the live compiler, with the corpus as the safety net

The language server's behavior SHALL be verified by a test architecture with three layers, each with a distinct role and no duplication of mechanism:

1. **Feature tests, organized by language principle** — a catalog of cases grouped by IEC construct (operators, data types, conversions, interfaces, OOP, lifecycle, pragmas, …). Each case's **diagnostic outcome SHALL be verified against the live vendor bridge** (the CODESYS/TwinCAT compiler as oracle): the compiler's per-object diagnostics are recorded and the LSP's diagnostics on the same source SHALL agree (documented divergences excepted).
2. **Navigation queries** (go-to-definition, hover, completion, references, rename, …) SHALL be verified by assertion tests, since the compiler provides no navigation ground truth — each such query SHALL have exactly one authoritative test, not parallel snapshot + assertion coverage.
3. **The committed real-project corpus** SHALL serve as the regression safety net: a false positive or missed case it surfaces that the feature tests did not is a signal to **add a new feature test**, not merely to adjust a threshold.

The compiler ground truth SHALL be refreshable from within the LSP package (a `record:language` recorder that pushes each case + a `PLC_PRG` instantiation to a live bridge, builds, and records the compiler's diagnostics); the replay that diffs LSP vs recorded truth SHALL run offline.

#### Scenario: A language feature is proven against the real compiler
- **WHEN** a feature test's source is analyzed by the LSP and built by the live vendor compiler
- **THEN** the LSP's diagnostics match the compiler's for that case (or the divergence is explicitly documented)

#### Scenario: A corpus-surfaced miss becomes a feature test
- **WHEN** the corpus ratchet surfaces a diagnostic the feature tests did not cover
- **THEN** a new feature test is added for that case (and its compiler ground truth recorded), rather than only adjusting a corpus threshold

#### Scenario: Each query has one authoritative test
- **WHEN** a navigation query (definition/hover/completion/…) is tested
- **THEN** it has a single authoritative test, not duplicated snapshot-and-assertion coverage of the same behavior

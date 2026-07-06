## ADDED Requirements

### Requirement: The bridge reports skipped and errored items

The bridge SHALL surface every item it skips, drops, or fails to materialize during `/fetch` and `/refs` —
each with a stable `kind`, the item `name`, and a `reason` — through the API response and/or a retrievable
log, so a missing item at a customer site is diagnosable rather than silent. The report SHALL be additive
(non-breaking) and vendor-neutral (identical for CODESYS and TwinCAT).

#### Scenario: An unmatched library element is reported, not silently dropped
- **WHEN** a referenced-library element signature's `LibraryPath` matches no `.library` ref by `RESOLUTION`
- **THEN** the bridge omits it from the workspace AND records a skip entry (`kind` = `library-sig-unmatched`,
  the element `name`, and the `reason`) that the caller can read

#### Scenario: A deliberately excluded object is distinguishable from a lost one
- **WHEN** a project POU is omitted because it is exclude-from-build, or (with `omitDeadCode`) uncompiled
- **THEN** the bridge records why it was omitted, so a customer can tell it was excluded on purpose, not lost

#### Scenario: A library with no precompiled signatures is signalled
- **WHEN** a referenced library yields zero precompiled signatures (e.g. a target/device library headless)
- **THEN** the bridge records that the library produced no elements, distinguishing "unavailable" from a bug

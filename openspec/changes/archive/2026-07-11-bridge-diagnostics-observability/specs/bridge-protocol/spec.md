## ADDED Requirements

### Requirement: The bridge logs skipped and errored items

The bridge SHALL record every item it skips, drops, or fails to materialize during `/fetch` and `/refs` — with
the item `name` and a reason — to its durable, retrievable log (`%LOCALAPPDATA%\Volt\logs`, per-source daily
files), so a missing item at a customer site is diagnosable rather than silent. Each sync operation SHALL log a
completion line carrying its counts (items, and a per-kind drop tally). The logging SHALL be vendor-neutral
(identical for CODESYS and TwinCAT, being Core-shared) and non-breaking (the wire response is unchanged).

#### Scenario: An unmatched library element is surfaced and logged, not silently dropped
- **WHEN** a referenced-library element signature's `LibraryPath` matches no `.library` ref by `RESOLUTION`
- **THEN** the bridge folders it under an explicit `(unresolved)` marker in the workspace (never silently
  dropped, never guessed into a real library's folder) AND logs the element `name`, its owning library, and the
  reason, plus a `lib-unmatched` count on the fetch completion line

#### Scenario: A deliberately excluded object is distinguishable from a lost one
- **WHEN** a project POU is omitted because it is exclude-from-build
- **THEN** the bridge logs the item `name` with an `exclude-from-build` reason (and tallies it on the completion
  line), so a customer can tell it was excluded on purpose, not lost

#### Scenario: An unreadable item is logged as an error
- **WHEN** an item exists but its body cannot be materialized (`SafeVersion` catches the read failure)
- **THEN** the bridge logs it at Warn with the item `name` and the failure reason — the body did not reach the
  pull — rather than silently recording a sentinel version

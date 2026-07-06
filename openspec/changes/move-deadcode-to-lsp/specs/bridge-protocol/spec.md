## REMOVED Requirements

### Requirement: The bridge returns only items with compiler ground truth

**Reason:** Split into two distinct behaviors. Excluded-from-build objects are still omitted (no ground truth), but dead/uncalled code is NO LONGER dropped by the bridge — it is returned as ordinary source and reachability becomes the LSP's job. Replaced by "The bridge omits build-excluded objects and returns everything else."

## ADDED Requirements

### Requirement: The bridge omits build-excluded objects and returns everything else

The `/refs` and `/fetch` responses SHALL omit objects the IDE will not compile — excluded-from-build (accounting for folder inheritance) — entirely: absent from `changed`, `items`, and the aggregate versions. Such an object has no compiler ground truth, so delivering it would only produce false positives against code the toolchain itself never checks.

Everything else SHALL be returned as ordinary source, INCLUDING dead/uncalled code (a POU reachable from no task). The bridge SHALL NOT compute reachability, SHALL NOT expose an `omitDeadCode` (or equivalent) flag, and SHALL NOT carry `excludeFromBuild`, `deadCode`, or any ground-truth metadata field, nor write in-file markers — determining what is unreachable is the LSP's job (see `st-language-server` "Dead code is detected structurally and its diagnostics are config-gated"). Both vendor bridges SHALL behave identically for the same project state.

#### Scenario: An excluded-from-build object is not returned
- **WHEN** a project contains an object flagged "exclude from build" (or inside an excluded folder)
- **THEN** neither `/refs` nor `/fetch` lists it (no `changed` entry, no `items` version), and the response carries no `excludeFromBuild` field

#### Scenario: A dead (uncalled) POU IS returned as ordinary source
- **WHEN** a project POU is never called or instantiated from any task's program (dead code)
- **THEN** the bridge still returns it in `changed`/`items` like any other source item — no `deadCode` field, no omission, no flag required

#### Scenario: No fetch flag governs dead code
- **WHEN** any client fetches the project (verbose or not)
- **THEN** the response is identical with respect to dead code — there is no request flag that drops uncalled POUs

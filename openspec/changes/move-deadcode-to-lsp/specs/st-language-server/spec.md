## REMOVED Requirements

### Requirement: Diagnostics skip build-excluded objects

**Reason:** Build-excluded objects are no longer delivered to the workspace at all (the bridge omits them — see `bridge-protocol` "The bridge omits build-excluded objects and returns everything else"), so there is nothing on disk for the LSP to gate. The related concern — code the compiler does not check — is now handled structurally for DEAD code by the new requirement below. No in-file `excludeFromBuild` marker exists.

### Requirement: Build-excluded source is marked in content, not a side manifest

**Reason:** The `(* @volt-exclude-from-build *)` marker mechanism is retired. Excluded objects are never fetched (so never materialized, marked, or pushed), and the CLI's marker-strip on push is already removed. Nothing writes or reads the marker.

## ADDED Requirements

### Requirement: Dead code is detected structurally and its diagnostics are config-gated

Dead (uncalled/unreachable) code IS delivered to the workspace as ordinary source — the bridge does not omit it. The LSP SHALL determine reachability itself, from the project's own structure, and SHALL gate diagnostics on dead code behind a `diagnoseDeadCode` config flag.

Reachability SHALL be computed project-wide: the ROOTS are the PROGRAM POUs (IEC entry points — tasks invoke programs), and a unit is REACHABLE if it is in the transitive closure from a root via calls, FB instantiations (`inst : FB_A;` declarations count), `EXTENDS`/`IMPLEMENTS`, and declared-type references. A top-level POU not reachable is DEAD.

When `diagnoseDeadCode` is `false` (the default, matching the CODESYS compiler, which never compiles dead code), the LSP SHALL suppress ALL diagnostics whose owning top-level unit is dead. When `true`, the LSP SHALL diagnose every unit, dead or not.

The reachability analysis SHALL be conservative: when reachability is UNCERTAIN — dynamic dispatch, an interface-typed or pointer assignment, or any edge the analysis cannot resolve — the unit SHALL be treated as LIVE. Marking a reachable unit dead would suppress real diagnostics; over-including is the only safe bias. Consequently the coverage invariant "a clean-compiling project yields zero ERROR diagnostics" holds with `diagnoseDeadCode` off, because genuinely dead code (which the compiler never checked) is suppressed while every reachable unit is fully checked.

#### Scenario: A dead POU produces no diagnostics by default
- **WHEN** an FB is never called or instantiated from any PROGRAM's reachable graph, and its body references an identifier declared nowhere
- **THEN** with `diagnoseDeadCode` off (default) the LSP emits no diagnostic for it — matching the compiler, which never checked it

#### Scenario: The same dead POU is diagnosed when the flag is on
- **WHEN** the same dead FB is analyzed with `diagnoseDeadCode` on
- **THEN** the LSP reports its unresolved reference (and any other real diagnostic) — dead code is fully analyzed

#### Scenario: A reachable POU is always fully checked
- **WHEN** an FB is instantiated (`m : FB_Motor;`) inside a reachable program and has a genuine error
- **THEN** the LSP reports it regardless of the flag — instantiation is a reachability edge, and reachable code is never suppressed

#### Scenario: Uncertain reachability resolves to live
- **WHEN** an FB is only ever reached through an interface-typed variable or other dynamic dispatch the analysis cannot statically resolve
- **THEN** the LSP treats it as LIVE (never dead), so its diagnostics are never wrongly suppressed

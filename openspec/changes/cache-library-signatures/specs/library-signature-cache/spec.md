## ADDED Requirements

### Requirement: Library extraction is cached by resolution fingerprint

The CODESYS bridge SHALL cache referenced-library signature extraction keyed by the set of referenced-library resolutions (each carrying its version). When the live referenced-resolution set matches a cached extraction, the bridge SHALL return the cached signatures without precompiling.

#### Scenario: Unchanged libraries skip the precompile

- **WHEN** a fetch runs and the live referenced-library resolution set equals the cached fingerprint
- **THEN** `Build(app)` is not invoked and the previously extracted signatures are returned

#### Scenario: A version swap invalidates the cache

- **WHEN** a referenced library's version changes (or a library is added/removed) so the live resolution set differs from the cached fingerprint
- **THEN** the bridge precompiles, re-extracts, and stores the new signatures under the new fingerprint

### Requirement: The cache never weakens live change detection

The cache SHALL apply ONLY to the library-signature path. Project-item versions SHALL continue to be computed from a live walk on every fetch/refs, so an edit on either side (IDE or workspace) is always detected.

#### Scenario: Project edits still detected while libraries are cached

- **WHEN** the referenced libraries are unchanged (cache hit) but a project item changed in the IDE
- **THEN** the fetch still reports that item as changed (its version comes from the live walk, not the cache)

### Requirement: A cache hit is byte-identical to a cold extract

A fetch served from the library cache SHALL produce the same signature items (folders, names, contents, versions) and the same `projectVersion`/`structureVersion` as an equivalent cold extract.

#### Scenario: Output parity

- **WHEN** the same project is fetched cold (cache miss) and warm (cache hit) with no changes between
- **THEN** the two fetch responses are equal for the library-signature items and the aggregate versions

### Requirement: The resolution fingerprint is read without a build

The referenced-resolution fingerprint SHALL be obtainable without precompiling (from Library-Manager reference metadata), so a cache hit incurs no build.

#### Scenario: Fingerprint is build-free

- **WHEN** the bridge computes the referenced-resolution fingerprint on a cache-hit fetch
- **THEN** no precompile/`Build(app)` is triggered by the fingerprint read

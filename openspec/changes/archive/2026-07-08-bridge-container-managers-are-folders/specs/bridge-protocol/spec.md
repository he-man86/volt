## ADDED Requirements

### Requirement: Container-manager nodes are folders, never items

A container-manager — a library manager, recipe manager, or visualization manager — SHALL be represented on the
wire as a FOLDER holding its children, and SHALL NOT be emitted as a tracked item. It groups its children (library
references, recipes, visualizations) and has no content of its own, so it produces no stub file beside the folder.
Both vendor bridges SHALL behave identically (the rule is enforced in shared Core, not per-driver), so a container
manager never materializes a `<Manager>.<kind>` stub. Because item wire identity is the bare name and opaque
non-source names may legitimately repeat, the changed-item set of a fetch SHALL contain at most one entry per full
name (matching the name-keyed version map), so a repeated name never materializes as two files.

#### Scenario: A library manager materializes as a folder, not a stub
- **WHEN** a project's Library Manager holds referenced libraries
- **THEN** the libraries materialize under a `Library Manager/<lib>/<lib>.library` folder and no
  `Library Manager.library_manager` stub file is emitted beside it

#### Scenario: The invariant holds for both vendors
- **WHEN** the same project structure is walked by the CODESYS and the TwinCAT bridge
- **THEN** neither emits a container-manager item — the folder + children representation is identical

#### Scenario: A repeated opaque name does not orphan a duplicate file
- **WHEN** two distinct opaque objects legitimately share a bare name at different folders
- **THEN** the fetch's changed set carries at most one entry for that full name, matching the version map — no
  second, orphaned file

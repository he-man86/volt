## ADDED Requirements

### Requirement: The CODESYS bridge loads as one self-contained assembly
Everything Volt loads into the CODESYS process SHALL ship as a single assembly with its dependencies merged and
internalized, so that no dependency is resolved at runtime and no second copy of a Volt dependency can be loaded,
however the start script is run.

#### Scenario: Started from the download folder
- **WHEN** the start script runs from a folder that is on IronPython's `sys.path`
- **THEN** exactly one Volt assembly is loaded into the process and every pipe call succeeds

#### Scenario: Another copy of a shared dependency is already loaded
- **WHEN** the process already holds a different `System.Text.Json`
- **THEN** the bridge does not bind to it and does not load a second Volt copy

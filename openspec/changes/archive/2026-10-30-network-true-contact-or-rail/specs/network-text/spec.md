## ADDED Requirements

### Requirement: A TRUE-fed coil has one documented picture
The network-text documentation SHALL state whether `x := TRUE;` in LD is a coil fed directly from the rail or a `TRUE` contact before the coil, matching what CODESYS draws for the bridge's text.

#### Scenario: Rail-fed coil
- **WHEN** an LD network holds `y := TRUE;`
- **THEN** the documentation shows the picture CODESYS draws for it, and names the spelling of the other picture if CODESYS has both

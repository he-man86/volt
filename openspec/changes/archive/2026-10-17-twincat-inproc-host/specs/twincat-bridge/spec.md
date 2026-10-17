## ADDED Requirements

### Requirement: TwinCAT writes graphical bodies without PLCopen
The TwinCAT bridge SHALL create and edit LD/FBD bodies through the vendor's own NWL object model, or through an archive
gated by a save-reload-reread check. It SHALL never use a PLCopen import, unless the owner accepts the PLCopen route with
the measurements as evidence.

#### Scenario: a shape PLCopen cannot express
- **WHEN** a push creates a network holding a single-consumer branch point on TwinCAT
- **THEN** it is created, survives save and reopen, builds with 0 errors, and pulls back as the same text

#### Scenario: a fan-out
- **WHEN** a push creates a branch point feeding two coils
- **THEN** it comes back as pushed, not reshaped, with no importer leftovers

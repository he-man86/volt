## ADDED Requirements

### Requirement: every LD and FBD body is shown as network text
Every LD or FBD body the bridge pulls SHALL be materialized as network text, identical on both vendors, and SHALL push back
unchanged; a shape the design keeps refused SHALL be refused by name, never shown partially.

#### Scenario: a shape that was unsupported
- **WHEN** a body with an assign below the top level is pulled from either vendor
- **THEN** it is written as network text, and pushing it back and pulling again gives the same text and a clean build

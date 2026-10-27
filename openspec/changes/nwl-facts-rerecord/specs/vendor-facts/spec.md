## ADDED Requirements

### Requirement: every committed vendor-facts row is reproducible by its recorder
Every row in `vendor-facts.codesys.json` and `vendor-facts.twincat.json` SHALL be reproduced by
`vendor-facts --write` from its push source in `vendor-facts.table.ts`, using the grammar the shipped reader accepts.

#### Scenario: an NWL row is re-recorded
- **WHEN** `bun scripts/vendor-facts.ts <vendor> --only <nwl row>` runs on a fixture instance
- **THEN** every push of the row is accepted and the written row equals the committed one, or the difference is
  reported as a changed vendor fact

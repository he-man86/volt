## ADDED Requirements

### Requirement: push does not parse the header

The push path SHALL take an item's kind from its wire name's extension and SHALL NOT parse or check the declaration header of the pushed text. The text SHALL be pushed as sent; errors in it are reported by the IDE's build.

#### Scenario: doc comment never closed
- **WHEN** `ST_X.struct` is pushed whose text opens `(*` on line 1 and never closes it
- **THEN** it is pushed, and a later build reports the error

#### Scenario: header of another kind
- **WHEN** `FB_X.fb` is pushed whose text starts `PROGRAM FB_X`
- **THEN** it is not refused for its header

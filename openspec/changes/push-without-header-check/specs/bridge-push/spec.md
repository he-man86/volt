## ADDED Requirements

### Requirement: push does not parse the header

The push path SHALL take an item's kind from its wire name's extension and SHALL NOT parse or check the declaration header of the pushed text. The text SHALL be pushed as sent; errors in it are reported by the IDE's build.

#### Scenario: doc comment never closed
- **WHEN** `ST_X.dut` is pushed whose text opens `(*` on line 1 and never closes it
- **THEN** it is pushed, and a later build reports the error

#### Scenario: header of another kind
- **WHEN** `FB_X.fb` is pushed whose text starts `PROGRAM FB_X`
- **THEN** it is not refused for its header

### Requirement: every DUT is named `.dut`

The bridge SHALL publish every DUT, on both vendors, as `name.dut`, taking "it is a DUT" from the IDE object and never reading the text to name it. No DUT subtype appears in a wire name, and no Volt code decides a DUT's subtype.

#### Scenario: a struct changed to an enum in place
- **WHEN** `ST_X.dut`'s text is changed in the IDE from a STRUCT to an enumeration
- **THEN** the next pull reports `ST_X.dut` with new content — the same name, no rename

#### Scenario: a DUT whose text declares nothing
- **WHEN** a DUT's text is an unclosed comment
- **THEN** it is still published as `name.dut`, and the IDE's build reports the error

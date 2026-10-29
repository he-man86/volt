## ADDED Requirements

### Requirement: a read-only build property is never read as a default
A build property TwinCAT publishes `readonly` SHALL be read only where a measurement proves its meaning, and every
other read-only state SHALL be refused by name, naming every read-only property and the remedy.

#### Scenario: CompilerDefines read-only on an item
- **WHEN** an item's `CompilerDefines` and `LinkAlways` are published read-only in an unmeasured state
- **THEN** the item is refused by name, the message naming both properties

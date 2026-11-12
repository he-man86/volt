## ADDED Requirements

### Requirement: a constant's completion detail names it constant
The completion item of a variable declared in a `CONSTANT` section SHALL name the section with its qualifier in its
detail, `<type> · VAR_GLOBAL CONSTANT` or `<type> · VAR CONSTANT`, so a client can tell it from a variable it may write.

#### Scenario: a GVL constant
- **WHEN** completion runs after `G.` and the GVL `G` declares `K : INT := 3;` in `VAR_GLOBAL CONSTANT`
- **THEN** the item `K` has the detail `INT · VAR_GLOBAL CONSTANT`

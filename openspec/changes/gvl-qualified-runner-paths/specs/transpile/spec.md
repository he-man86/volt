## ADDED Requirements

### Requirement: the runner addresses globals by their qualified path
`Runner.get/set` SHALL address a global of a `qualified_only` GVL by `<GVL>.<name>`, so two GVLs may declare the same name.

#### Scenario: two GVLs with the same name
- **WHEN** `GVL_A.count` and `GVL_B.count` are declared and `set("GVL_A.count", 1)` is called
- **THEN** `get("GVL_A.count")` is 1 and `get("GVL_B.count")` is unchanged

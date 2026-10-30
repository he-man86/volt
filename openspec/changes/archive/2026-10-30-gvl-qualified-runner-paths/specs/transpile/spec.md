## ADDED Requirements

### Requirement: the runner addresses globals by their qualified path
`Runner.get/set` SHALL address every global of every GVL by `<GVL>.<name>`, so two GVLs may declare the same name. The bare
name SHALL address a global only when one list declares that name and the list is not `qualified_only`; any other bare
name SHALL be refused by name — as ambiguous when two lists declare it, naming the qualified path when a `qualified_only`
list declares it. The POU's own variable SHALL shadow a global of its name.

#### Scenario: two GVLs with the same name
- **WHEN** `GVL_A.count` and `GVL_B.count` are declared and `set("GVL_A.count", 1)` is called
- **THEN** `get("GVL_A.count")` is 1 and `get("GVL_B.count")` is unchanged

#### Scenario: the bare name of a name two lists declare
- **WHEN** `GVL_A.count` and `GVL_B.count` are declared and `get("count")` is called
- **THEN** the call is refused: `count is ambiguous: GVL_A.count, GVL_B.count`

#### Scenario: the bare name of a qualified_only list's variable
- **WHEN** only the `qualified_only` list `GVL_E` declares `v0` and `get("v0")` is called
- **THEN** the call is refused naming `GVL_E.v0`

## ADDED Requirements

### Requirement: a rename or move onto an item the IDE holds is refused before anything lands
The push SHALL refuse, before any op of the batch is applied and whether or not `force` is set, a `set` whose `to`
differs from its `name` ignoring case and names a path the IDE holds, compared ignoring case. The conflict SHALL carry
`ITEM_EXISTS` on the op's `name` and name `to`. An item of another kind with the same bare name SHALL NOT make it a
collision.

#### Scenario: renaming onto an existing item
- **WHEN** the IDE holds `…/FB_A.pou` and `…/FB_B.pou`, and a push sends `set { "name": "…/FB_A.pou", "to":
  "…/FB_B.pou" }` with `FB_A`'s current version
- **THEN** the push is rejected with one conflict `ITEM_EXISTS` on `…/FB_A.pou` naming `…/FB_B.pou`, and the project is
  unchanged

#### Scenario: with force
- **WHEN** the same rename is pushed with `force: true` and no lease
- **THEN** it is refused `ITEM_EXISTS` as without force

#### Scenario: a case-only rename
- **WHEN** a push renames `…/Calc.pou` to `…/calc.pou`
- **THEN** it is not refused as a collision

#### Scenario: beside a visualization of the same name
- **WHEN** a push moves `…/POUs/Y.pou` into `…/IO`, which holds `Y.visualization` and no `Y.pou`
- **THEN** the move is not refused as a collision

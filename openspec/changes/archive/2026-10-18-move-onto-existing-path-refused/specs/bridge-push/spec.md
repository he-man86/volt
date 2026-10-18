## ADDED Requirements

### Requirement: a rename or move onto an item the IDE holds is refused before anything lands
The push SHALL refuse, before any op of the batch is applied and whether or not `force` is set, a `set` whose `to`
differs from its `name` ignoring case and names a path the IDE holds, compared ignoring case. The conflict SHALL carry
`ITEM_EXISTS` on the op's `name`, name `to`, and carry the version of the item at `to` as `currentVersion`. A
visualization with the same bare name SHALL NOT make it a collision.

#### Scenario: renaming onto an existing item
- **WHEN** the IDE holds `…/FB_A.pou` and `…/FB_B.pou`, and a push sends `set { "name": "…/FB_A.pou", "to":
  "…/FB_B.pou" }` with `FB_A`'s current version
- **THEN** the push is rejected with one conflict `ITEM_EXISTS` on `…/FB_A.pou` naming `…/FB_B.pou`, `currentVersion`
  `FB_B`'s version, and the project is unchanged

#### Scenario: with force
- **WHEN** the same rename, or a pure move onto a held path, is pushed with `force: true` and no lease
- **THEN** it is refused `ITEM_EXISTS` as without force

#### Scenario: a case-only rename
- **WHEN** a push renames `…/Calc.pou` to `…/calc.pou`
- **THEN** it is not refused as a collision

#### Scenario: beside a visualization of the same name
- **WHEN** a push moves `…/POUs/Y.pou` into `…/IO`, which holds `Y.visualization` and no `Y.pou`
- **THEN** the move is not refused as a collision

### Requirement: a rename onto a name its application holds is refused before anything lands
Both IDEs hold one object of a name per application for a POU, a DUT and a GVL, in any folder (DIALECT C38). The push
SHALL refuse, before any op is applied and whether or not `force` is set, a `set` whose `to` changes the bare name to
one a POU, DUT or GVL of the same application holds, when `to` is itself a POU, DUT or GVL. The conflict SHALL carry
`ITEM_EXISTS` on the op's `name`, name the item that holds the name, and carry its version as `currentVersion`.

#### Scenario: another folder, another kind
- **WHEN** the IDE holds `POUs/FB_X.pou` and `Other/D_Z.dut` in one application, and a push renames `Other/D_Z.dut` to
  `Other/FB_X.dut`
- **THEN** it is refused `ITEM_EXISTS` naming `POUs/FB_X.pou`, with or without force, and the project is unchanged

#### Scenario: another application
- **WHEN** the name is held only in another application
- **THEN** the rename is not refused as a collision

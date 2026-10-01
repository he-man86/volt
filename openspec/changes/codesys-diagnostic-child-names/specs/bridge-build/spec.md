## ADDED Requirements

### Requirement: a diagnostic inside a child object names its parent item

When a CODESYS build diagnostic's `ObjectGuid` is a method, property, action or transition, the published diagnostic SHALL carry the parent item's full wire name as `name`, and the child's name as `member`. `name` SHALL
NOT be null only because the object is a child.

#### Scenario: syntax error in a method body
- **WHEN** a build fails with `C0578` in method `Execute` of `FB_Motor`
- **THEN** the diagnostic has `name: "FB_Motor.fb"`, `member: "Execute"` and `code: "C0578"`

#### Scenario: error in the item's own body
- **WHEN** a build fails in the body of `FB_Motor` itself
- **THEN** the diagnostic has `name: "FB_Motor.fb"` and no `member`

### Requirement: CODESYS and TwinCAT name a method-body error the same way

A diagnostic in a method body SHALL resolve to the same `name` / `member` pair on both vendors.

#### Scenario: the same error on both vendors
- **WHEN** the same method-body syntax error is built on CODESYS and on TwinCAT
- **THEN** both diagnostics name the parent item, and `member` names the method

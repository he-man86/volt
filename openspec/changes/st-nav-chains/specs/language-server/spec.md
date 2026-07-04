## ADDED Requirements

### Requirement: Navigation resolves through member/index/call chains

Go-to-definition, hover, and completion SHALL resolve a reference through its full expression chain — `a.b.c`, `arr[i].x`, `fb.method` — by inferring the base expression's type and looking up the member in that type's scope, rather than resolving only the bare tail identifier. When the chain's type cannot be resolved, the query SHALL fall back to the current name-based behavior (no worse than today).

#### Scenario: Go-to-definition follows a member chain
- **WHEN** the cursor is on `speed` in `motor.speed` and `motor` is a struct/FB with a `speed` field
- **THEN** go-to-definition jumps to that field's declaration, not to every `speed` in the project

#### Scenario: Completion after a chain offers the right members
- **WHEN** completion triggers after `a.b.` where `b`'s type is a struct/FB
- **THEN** the offered members are `b`'s type's members, resolved through the chain

### Requirement: References and rename narrow by owning type

References, rename, and document-highlight SHALL narrow a member reference by its owning type so a member `x.Start` matches only references to that type's `Start`, not every same-named identifier project-wide. Call-hierarchy SHALL include member-call sites (`fb.method()`). When the owning type is unresolved, the query SHALL fall back to name-based matching.

#### Scenario: Rename of a field does not rename unrelated same-named identifiers
- **WHEN** a struct field `Start` is renamed
- **THEN** only references to that struct's `Start` are renamed, not unrelated `Start` identifiers on other types

#### Scenario: Member calls appear in call-hierarchy
- **WHEN** call-hierarchy is computed for a method invoked as `fb.method()`
- **THEN** that call site is included (previously member calls were dropped)

### Requirement: Bare enum members have full navigation

Beyond resolution (not flagging them unresolved), the LSP SHALL provide go-to-definition, hover, and completion for a bare reference to a non-`qualified_only` enum member.

#### Scenario: Go-to-definition on a bare enum member
- **WHEN** the cursor is on a bare enum member `StateAutomatic`
- **THEN** go-to-definition jumps to its declaration in the enum, and hover shows the enum + value

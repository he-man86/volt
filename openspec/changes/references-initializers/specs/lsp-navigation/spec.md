## ADDED Requirements

### Requirement: a use in an initial value is a reference
References and rename of a variable or a member SHALL include every use of it in a declaration's initial value
(`a : INT := g;`, `b : TIME := t.ET;`), and references, rename and definition asked at such a use SHALL resolve it.

#### Scenario: a global in an initial value
- **WHEN** rename runs at `g` in `GVL.gvl` to `h`, and Main declares `a : INT := g;`
- **THEN** Main declares `a : INT := h;`

#### Scenario: asked at a member in an initial value
- **WHEN** references run at `ET` in `b : TIME := t.ET;`
- **THEN** the result holds that `ET` and every other use of `TON.ET`

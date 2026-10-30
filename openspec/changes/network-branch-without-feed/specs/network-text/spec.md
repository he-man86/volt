## ADDED Requirements

### Requirement: A parallel branch has one spelling
Network text SHALL spell a series in front of a parallel branch with `AND`, and `BRANCH` / `BRANCH_SHORTCIRCUIT` SHALL take only their branches. The writer SHALL write `f AND (a OR b)` when every branch is contact-shaped, and `f AND BRANCH(…)` only where a branch holds a box.

#### Scenario: Contacts in parallel after a contact
- **WHEN** the writer writes a rung with the contact `auto`, then `a` and `b` side by side, then the coil `x`
- **THEN** the text is `x := auto AND (a OR b);`

#### Scenario: A branch holding a box
- **WHEN** the writer writes the contact `c`, then the contact `a` beside an `R_TRIG` box `r1` fed by `b`
- **THEN** the text is `x := c AND BRANCH(a, r1(CLK := b));`, with no `FEED :=`

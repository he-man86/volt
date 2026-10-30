## ADDED Requirements

### Requirement: A negated box input has one picture per spelling
The network-text documentation SHALL state which picture `IN := NOT a` is in LD (a negated contact on the rung pin, or a contact on a negated pin) and in FBD, and SHALL give a distinct spelling where CODESYS has both models.

#### Scenario: LD rung pin
- **WHEN** an LD network holds `q := t1(IN := NOT a, PT := T#1S).Q;`
- **THEN** the documentation names one picture for it, the one the bridge writes this text for

## ADDED Requirements

### Requirement: a client can hold exactly what a read would give after a push

After an accepted push, a client SHALL be able to know the stored text of each item the push changed, as a fetch
would return it, without a further fetch, by asking the push to return it (an opt-in request flag); the answer then carries each
changed item's stored text in volt's canonical form, as a fetch would render it. The canonical form itself does not
change.

#### Scenario: create, then patch the end of the body
- **WHEN** a client creates an FB whose body ends `xRunning := xEnable;` directly followed by `END_FUNCTION_BLOCK`,
  then patches a search spanning those two lines taken from what it now holds
- **THEN** the patch matches without a re-read

#### Scenario: members in another order than the canonical one
- **WHEN** a client creates an FB with a PROPERTY written before an ACTION
- **THEN** what the client holds after the push lists them in the order a fetch returns

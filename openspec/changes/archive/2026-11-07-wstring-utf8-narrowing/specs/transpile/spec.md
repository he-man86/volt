## ADDED Requirements

### Requirement: WSTRING narrowing follows CODESYS
Converting a WSTRING to a STRING (and back) SHALL produce the bytes CODESYS produces, as recorded by `record:exec`,
including characters past ASCII.

#### Scenario: a character past ASCII
- **WHEN** a program evaluates `LEN(WSTRING_TO_STRING("größe"))`
- **THEN** the result equals the recorded CODESYS value (7)

#### Scenario: bytes that are no UTF-8 sequence
- **WHEN** a program widens a STRING whose bytes start no complete UTF-8 sequence with `STRING_TO_WSTRING`
- **THEN** the conversion is refused by name, because CODESYS then reads past the terminator

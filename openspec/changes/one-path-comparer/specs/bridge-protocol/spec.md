## ADDED Requirements

### Requirement: an addressed path finds the IDE item ignoring case; a held key is exact
A path a client ADDRESSES (`fetch.onlyItems`, a push op's `name` and `to`) SHALL find the IDE item whose path is equal
ignoring case, and every path the bridge answers SHALL be spelled as the IDE spells it. A key a client HOLDS
(`knownItems`) SHALL be compared exactly: a known key the walk does not hold in that spelling SHALL be answered in
`removed`, as sent.

#### Scenario: onlyItems in another case
- **WHEN** the IDE holds `Device/Plc Logic/Application/FB_Motor.pou` and a client sends `fetch { "onlyItems":
  ["device/plc logic/application/fb_motor.pou"] }`
- **THEN** `changed` holds the item, named `Device/Plc Logic/Application/FB_Motor.pou`

#### Scenario: a case-only rename in the IDE
- **WHEN** the client's `knownItems` holds `…/Calc.pou` and the engineer renames it `calc` in the IDE
- **THEN** `refs` and `fetch` answer `…/Calc.pou` in `removed` and `…/calc.pou` in `items`, and `volt pull` leaves one file

#### Scenario: push name in another case
- **WHEN** a push sends `set { "name": "device/plc logic/application/fb_motor.pou", … }` with the version of `…/FB_Motor.pou`
- **THEN** the gate and the apply resolve `…/FB_Motor.pou` and update it, as today

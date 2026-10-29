## ADDED Requirements

### Requirement: the runner exposes every declared global
Lowering SHALL keep every global declared in the GVL files it is given in `pou.globals`, whether or not the program references it, so `Runner.get/set` can address it.

#### Scenario: an unused global
- **WHEN** `GVL_V1` declares `gSpeed : REAL := 1.5` and the program never references `gSpeed`
- **THEN** `pou.globals` lists `gSpeed` and `get("gSpeed")` is 1.5

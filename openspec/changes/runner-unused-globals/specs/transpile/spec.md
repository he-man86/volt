## ADDED Requirements

### Requirement: the runner exposes every declared global
Lowering SHALL keep every `VAR_GLOBAL` declared in the GVL files it is given, whether or not the program references it: a
declaration that lowers is a global slot in `pou.globals` that `Runner.get/set` address; one whose declaration does not
lower is named in `pou.unlowered` with its refusal, and `Runner.get/set` refuse its path by name. An unreferenced global
SHALL refuse the POU only when CODESYS would run something for it before the first scan that the init step does not model.

#### Scenario: an unused global
- **WHEN** `GVL_V1` declares `gSpeed : REAL := 1.5` and the program never references `gSpeed`
- **THEN** `pou.globals` lists `gSpeed` and `get("GVL_V1.gSpeed")` is 1.5

#### Scenario: an unused global whose declaration does not lower
- **WHEN** `GVL_X` declares `bad : STRING := 'é'` and the program never references it
- **THEN** the POU lowers, `pou.unlowered` names `GVL_X.bad` with `string-non-ascii`, and `get("GVL_X.bad")` is refused with that refusal

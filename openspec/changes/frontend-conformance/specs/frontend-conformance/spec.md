## ADDED Requirements

### Requirement: the parser accepts exactly what CODESYS accepts

The LSP's parser SHALL parse with zero errors every source CODESYS builds (per the build recordings and the corpora), and
SHALL report a parse error only where CODESYS reports one, at the same location. The printer SHALL be a fixed point on
every parsed source.

#### Scenario: a corpus file CODESYS builds
- **WHEN** a corpus POU that the recorded CODESYS build compiles is parsed
- **THEN** the LSP reports no parse error, and printing it gives the same text back

### Requirement: names resolve as CODESYS resolves them

Every identifier SHALL resolve to the declaration CODESYS uses, across POU, method, action, property, GVL, namespace,
library and inheritance scopes; the LSP's "not defined" and "ambiguous" messages SHALL equal the recorded ones.

#### Scenario: a method parameter shadowing an FB field
- **WHEN** a METHOD's VAR_IN_OUT has the same name as a field of its FB
- **THEN** the method body's references resolve to the parameter, as CODESYS does

### Requirement: every expression has CODESYS's type

The type engine SHALL give every expression the type CODESYS gives it, for every typing rule in the rule catalogue, and
every rule SHALL be pinned by a CODESYS-recorded fixture.

#### Scenario: mixed-sign arithmetic
- **WHEN** an INT and a UDINT are added
- **THEN** the inferred type and the computed value match CODESYS's recorded run

### Requirement: the front-end is a layer

`syntax`, `symbols` and `types` SHALL form one front-end layer that imports nothing from analysis, services, server,
network or transpile, and back-ends SHALL import it only through its index, enforced by a test.

#### Scenario: a back-end reaching into the front-end
- **WHEN** a transpiler file imports a front-end file other than its index
- **THEN** the import-rule test fails naming both files

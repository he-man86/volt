## ADDED Requirements

### Requirement: an existing member is never refused by its name
The push pre-flight SHALL only refuse names of members the push would CREATE. A method, action or property that already
exists under the item SHALL never be refused by name.

#### Scenario: patching a POU with an existing Chinese-named method
- **WHEN** a POU holds a method `区域可占用` created in the IDE, and a push patches the POU's body
- **THEN** the push succeeds, and the method is kept as it was

#### Scenario: a new member with a measured reserved word
- **WHEN** a push adds a NEW method named `Log` under a function block
- **THEN** the pre-flight refuses it before any op of the batch is written, as today

### Requirement: a non-ASCII name is the IDE's to refuse
A NEW item or member whose name is not an ASCII identifier SHALL be sent to the IDE. Only the IDE's own refusal SHALL reject
it, reported with the IDE's sentence.

#### Scenario: creating a method with a CJK name where the IDE accepts it
- **WHEN** a push creates a method `读取命令`, and the IDE accepts that name
- **THEN** the method is created and the push succeeds

#### Scenario: the IDE refuses the name
- **WHEN** the IDE refuses a new non-ASCII name
- **THEN** the push answers the refusal with the IDE's sentence, as any other `ChildRefusedException`

### Requirement: the language server reads non-ASCII identifiers
The IEC language server (`volt-lsp-iec`) SHALL lex an identifier the IDE accepts and builds as an identifier, whatever its
script, and SHALL report no syntax error for it.

#### Scenario: a DUT with CJK member names
- **WHEN** the language server checks a DUT `点位绑定信息` whose members are named in Chinese, and the IDE builds it clean
- **THEN** it reports no diagnostics. Today it reports `Identifier expected instead of '点'` (chat be8c6faa, 2 errors in one
  DUT, 10 in `电机控制.pou`).

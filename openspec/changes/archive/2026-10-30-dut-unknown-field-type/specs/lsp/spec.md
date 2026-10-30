## ADDED Requirements

### Requirement: a type name that names nothing is reported in every declaration position
A type a declaration writes — a variable in any VAR section, a STRUCT or UNION field, an alias's target, a FUNCTION's,
METHOD's or INTERFACE METHOD's result, a PROPERTY's type, and the name an ARRAY, POINTER or REFERENCE wraps — whose name
resolves to nothing SHALL be reported as the compiler reports it, "Unknown type: '<name>'", on that name, in the file that
declares it, once per thing declared of that type.

#### Scenario: a typo in a field type
- **WHEN** a DUT declares `STRUCT a : INTT; END_STRUCT` and a program declares a variable of that DUT
- **THEN** the LSP reports "Unknown type: 'INTT'" on `INTT` in that DUT, and nothing in the program

#### Scenario: the element of an array
- **WHEN** a declaration is `v : ARRAY[0..1] OF ARRAY[0..2] OF NoSuchType;`
- **THEN** the LSP reports "Unknown type: 'NoSuchType'" once, on `NoSuchType`

#### Scenario: two names of one unknown type
- **WHEN** a declaration is `a, b : NoSuchType;`
- **THEN** the LSP reports "Unknown type: 'NoSuchType'" twice

### Requirement: a STRUCT's base that names nothing is reported as an FB's is
A STRUCT whose EXTENDS names nothing SHALL get "No definition found for base class '<name>'" and, on CODESYS,
"Unknown type: '<name>'", on the base's name.

#### Scenario: a struct extending a typo
- **WHEN** a DUT is `TYPE S EXTENDS NoSuchType : STRUCT v : INT; END_STRUCT END_TYPE`
- **THEN** the LSP reports both messages on `NoSuchType`

### Requirement: an enumeration's base is an elementary type's name
A name after an enumeration's value list that is no elementary type SHALL be the syntax error the vendor reports where the
declaration's `:=` or `;` belongs — whether or not the project declares that name.

#### Scenario: an alias as an enum base
- **WHEN** a DUT is `TYPE E : (a, b) DUT_IntAlias; END_TYPE`
- **THEN** the LSP reports "':= or ;' expected instead of 'DUT_IntAlias'" and no unknown type

### Requirement: a name nothing declares in a type's constant is no constant
An ARRAY bound, a subrange bound or a STRING length that is a variable or a name nothing declares SHALL be reported as no
constant value ("Border '<x>' of array is no constant value", "String length '<x>' is no constant value"); a STRING length
naming nothing is also "Identifier '<x>' not defined".

#### Scenario: an undeclared array bound
- **WHEN** a declaration is `v : ARRAY[0..NoSuchBound] OF INT;`
- **THEN** the LSP reports "Border 'NoSuchBound' of array is no constant value" and nothing else

### Requirement: an operator's type operand that names nothing is an unknown type
The operand of `__NEW` that names nothing SHALL be "Unknown type: '<name>'" and not an undefined identifier; the operand of
`SIZEOF`/`XSIZEOF` that names nothing SHALL be both.

#### Scenario: a typo in __NEW
- **WHEN** a body holds `p := __NEW(NoSuchType);`
- **THEN** the LSP reports "Unknown type: 'NoSuchType'" and no "Identifier 'NoSuchType' not defined"

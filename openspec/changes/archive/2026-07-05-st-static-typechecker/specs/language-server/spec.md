## ADDED Requirements

### Requirement: Type analysis is a static typechecker over a rich type model

The language server's type analysis SHALL be a static typechecker on the statement/expression tree — name
resolution, type inference, and type-rule checking — built on a `Type` model that carries the facts type rules
require: an elementary type's numeric **range** and family, a **subrange**'s bounds, an **array**'s dimension
bounds, a **string**'s maximum length, and an **enum**'s members. A single `inferExprType` SHALL remain the
entry point every consumer (diagnostics, hover, completion, signature-help, navigation) shares. Type
compatibility SHALL be decided by ONE assignability relation over the model — applied uniformly at every type
context (assignment, initializer, argument passing, return, array index, CASE label) — and the analysis SHALL
support constant evaluation of literals and constant expressions so value-range rules can be checked. An
unresolved or non-constant sub-part SHALL yield an unknown type / no constant (never a false positive). The
typechecker SHALL NOT perform compiler back-end work (IR, optimization, codegen) nor runtime/configuration
analysis (device addresses, dynamic-memory, application config), which remain the IDE's authority.

#### Scenario: A constant outside a type's range is flagged

- **WHEN** a constant is assigned or initialized outside its target's representable range — a literal over an
  elementary type's max (`INT := 40000`), outside a subrange (`INT(1..100) := 200`), or a constant array index
  outside the declared bounds
- **THEN** the typechecker flags it with the compiler's verdict and message (recorded per vendor), because the
  `Type` carries the range and constant evaluation supplies the value

#### Scenario: One assignability relation governs every type context

- **WHEN** the same type-compatibility question arises in different syntax (`:=`, a VAR initializer, an argument
  passed to a parameter, a function return)
- **THEN** the same assignability relation decides it, so narrowing/conversion/overflow behave identically
  wherever they occur — no per-context drift

#### Scenario: Unknown or non-constant operands never false-positive

- **WHEN** an operand's type cannot be fully resolved, or a value is not a compile-time constant
- **THEN** the typechecker yields unknown / no-constant and raises no diagnostic, preserving the zero-false-
  positive contract on the real-project corpus

## ADDED Requirements

### Requirement: The emitted Rust agrees with CODESYS for every input it allows

For every program CODESYS compiles and every input CODESYS accepts, the emitted Rust and the interpreter SHALL produce
the value CODESYS produces. They SHALL stop where CODESYS stops, and SHALL NOT panic or fail to compile where CODESYS
returns a value. A program CODESYS refuses SHALL end in a lowering diagnostic. Two backends that agree with each other
are not evidence: the oracle is the CODESYS recording.

#### Scenario: mixed-sign operands of different widths meet signed
- **WHEN** `ul : ULINT := 6` is divided by `s : SINT := -2`, or `z : DWORD := 0` is compared `> i` with `i : INT := -2`
- **THEN** the result is -5 and TRUE, computed in LINT/DINT as CODESYS names the meet

#### Scenario: a literal-initialised integer constant holds its declared type
- **WHEN** `C : INT := 40000` is used in an initializer, a CASE label or a FOR step
- **THEN** it reads -25536 everywhere, as the recorded run does

#### Scenario: REAL constants fold to the value the runtime computes
- **WHEN** `C : REAL := 0.1` initialises an LREAL, or `(CBig + 1) - CBig` initialises a REAL
- **THEN** the values are 0.10000000149011612 and 1, equal to the same expressions assigned at run time

#### Scenario: a VAR_INPUT CONSTANT parameter holds the caller's argument
- **WHEN** a FUNCTION with `VAR_INPUT CONSTANT n : INT := 1` uses `BY n` and is called with `n := 3`
- **THEN** the loop steps by 3

#### Scenario: all-constant expressions above the LINT range fold as ULINT
- **WHEN** `18446744073709551615 > 5` and `16#FFFFFFFFFFFFFFFF / 16` are evaluated
- **THEN** they give TRUE and 1152921504606846975

#### Scenario: a literal wider than its neighbour widens the meet
- **WHEN** `x : DINT := 5` meets `-3000000000`, or `ud : UDINT` meets `5000000000`
- **THEN** `x > -3000000000` is TRUE and `ud + 5000000000` into LINT is 6000000000 (with ud = 1000000000)

#### Scenario: a negative literal is a constant
- **WHEN** `MAX(-5, 3000000000)` and `-5 + 3000000000` are assigned to LINT
- **THEN** they give 3000000000 and 2999999995

#### Scenario: negating an unsigned 32/64-bit value is signed
- **WHEN** `li : LINT := -u` with `u : UDINT := 5`
- **THEN** li is -5 and `-u < 0` is TRUE

#### Scenario: ROL/ROR of an expression rotate in the expression's width
- **WHEN** `ROL(w AND m, 1)` with `w : WORD := 16#8001`, `m := 16#FFFF`
- **THEN** the result is 3

#### Scenario: a date conversion evaluates its source once
- **WHEN** `DT_TO_DATE(F(calls))` where F increments a VAR_IN_OUT
- **THEN** calls is 1 and the DATE is a whole day

#### Scenario: string conversions are length-agnostic
- **WHEN** `STRING_TO_INT` reads a STRING(200) whose digits sit past column 80, or `WSTRING_TO_STRING` converts 100 characters
- **THEN** the digits are parsed and all 100 characters arrive

#### Scenario: long date types convert to text
- **WHEN** `LDT_TO_STRING(LDT#2024-02-29-13:05:09.5)` and `LTOD_TO_STRING(LTOD#01:02:03.000001)` run
- **THEN** they give 'LDT#2024-02-29-13:05:09.500000000' and 'LTOD#01:02:03.000001000'

#### Scenario: a FOR limit wider than the counter compiles
- **WHEN** `FOR i := 1 TO k - 1` with INT i and k
- **THEN** the emitted Rust compiles and the loop runs k-1 times

#### Scenario: a latch through a multi-target pointer latches
- **WHEN** `p^ R= TRUE` with p pointing at a FALSE variable, one of two recorded targets
- **THEN** the variable stays FALSE

#### Scenario: copying an FB instance keeps its pointers' addresses
- **WHEN** `b := a` copies an FB whose `p := ADR(x)`, then `a.x` changes
- **THEN** `b.p^` reads a.x, or the copy is refused

#### Scenario: copying an FB instance keeps its in-out binding usable
- **WHEN** `w2 := w` after both were called with their own in-out, then `w2.AddTen()`
- **THEN** the call adds 10 to the variable w was bound to, or the copy is refused, and nothing panics

#### Scenario: pValue reads at the pointer's own type
- **WHEN** a DINT 1065353216 passed to ANY is read through a POINTER TO REAL from pValue
- **THEN** the value is 1.0, or the dereference is refused

#### Scenario: a queried interface stored into a global is not rebound per instance
- **WHEN** one FB instance queries its child into a global interface and another instance calls through it
- **THEN** the call reaches the first instance's child, or lowering refuses it

#### Scenario: a METHOD's in-out shadows the member of the same name
- **WHEN** a METHOD with `VAR_IN_OUT x` is called as `fb.M(x := v)` on an FB that also has a field x
- **THEN** v is read and written, not the field

#### Scenario: a routine's output target is resolved after the call
- **WHEN** `fb1.M(o => arr[fb1.k])` and M increments k
- **THEN** the output lands in arr[1]

#### Scenario: a namespace-qualified function runs the library's body
- **WHEN** a project FUNCTION and a namespaced library FUNCTION share a name and both are called
- **THEN** `LIB.F()` runs the library body and `F()` runs the project body, in any order

#### Scenario: implicit initialization completes before FB_Init
- **WHEN** FB_Init dereferences a field initialised with `ADR(m)`
- **THEN** it reads m's initial value and does not fault

#### Scenario: FB_Init arguments see earlier initializers
- **WHEN** `x : INT := F_Inc(3); h : FB_A(v := x);`
- **THEN** FB_Init receives 4

#### Scenario: a VAR_TEMP initializer is evaluated on every call
- **WHEN** `VAR_TEMP t : INT := g; END_VAR` and g grows by one per call
- **THEN** t reads 7, then 8

#### Scenario: array elements start at their element type's default
- **WHEN** `ARRAY[0..1] OF E` with `E : (A := 3, B := 4)`, or `ARRAY OF MyInt` with `MyInt : INT := 5`
- **THEN** every element starts at 3 or at 5

#### Scenario: SIZEOF of an FB matches the vendor's layout
- **WHEN** SIZEOF is taken of an FB with a replaced scalar VAR CONSTANT and one DINT, or one IMPLEMENTS clause and one DINT
- **THEN** the sizes are 16 and 24

#### Scenario: long loops complete
- **WHEN** `FOR i := 1 TO 1000001` runs, or a WHILE runs 5,000,000 passes
- **THEN** both backends finish with the counts CODESYS records, and neither panics

#### Scenario: MAX/MIN/LIMIT on reals select as CODESYS does
- **WHEN** `MAX(NaN, 1.0)`, `MAX(1.0, NaN)` and `LIMIT(0.0, NaN, 5.0)` are evaluated
- **THEN** they give 1.0, NaN and 5.0

#### Scenario: a user METHOD named like a prelude trait method is called
- **WHEN** an FB declares `METHOD Clone` and it is called as a statement or in an expression
- **THEN** the user's method runs

#### Scenario: a composite VAR_TEMP resets to its initializer
- **WHEN** `VAR_TEMP arr : ARRAY[0..2] OF INT := [5,6,7]` is read on each call
- **THEN** arr[1] is 6 every call

#### Scenario: BIT converts like BOOL
- **WHEN** `TO_STRING(bitField)` and `BIT_TO_REAL(bitField)` run on a TRUE BIT
- **THEN** they give 'TRUE' and 1.0, and the Rust compiles

#### Scenario: LTIME prints unsigned over its whole range
- **WHEN** `LTIME_TO_STRING(LTIME#106752d)` runs
- **THEN** it gives 'LTIME#106752d'

#### Scenario: LREAL text rounds a 16th-digit tie up
- **WHEN** `LREAL_TO_STRING(1234567890123445.0)` runs
- **THEN** it gives '1.23456789012345e15'

#### Scenario: bytes behind a string terminator survive
- **WHEN** `t : STRING(10) := 'abcdef'; t[2] := 0; t[2] := 88;`
- **THEN** t is 'abXdef'

// Helper functions to increment numbers
{attribute 'no_explicit_call' := 'Static helper class to do simple increment on any number'}
{attribute 'hide_all_locals'}
PROGRAM Increment
VAR
	uInput		: PointerSizesUnion;
END_VAR

END_PROGRAM

// Increment any integer with x when a condition is true
METHOD PUBLIC AnyInt
VAR_INPUT
	input		: ANY_INT;				// Number to increment
	incrementBy	: INT		:= 1;		// Input increments with this value (optional; defaults to 1)
	condition	: BOOL		:= TRUE;	// Only increment when the condition is true (optional)
END_VAR
IF NOT condition THEN
	RETURN;
END_IF

uInput.p1_Byte := input.pValue;

CASE input.diSize OF
	1:	uInput.p1_Sint^	:= uInput.p1_Sint^	+ TO_SINT(incrementBy);
	2:	uInput.p2_Int^	:= uInput.p2_Int^	+ incrementBy;
	4:	uInput.p4_Dint^	:= uInput.p4_Dint^	+ incrementBy;
	8:	uInput.p8_Lint^	:= uInput.p8_Lint^	+ incrementBy;
END_CASE
END_METHOD

// Increment any floating point with x when a condition is true
METHOD PUBLIC AnyReal
VAR_INPUT
	input		: ANY_REAL;				// Number to increment
	incrementBy	: REAL		:= 1.0;		// Input increments with this value (optional; defaults to 1)
	condition	: BOOL		:= TRUE;	// Only increment when the condition is true (optional)
END_VAR
IF NOT condition THEN
	RETURN;
END_IF

uInput.p1_Byte := input.pValue;

CASE input.diSize OF
	4:	uInput.p4_Real^		:= uInput.p4_Real^	+ incrementBy;
	8:	uInput.p8_LReal^	:= uInput.p8_LReal^	+ incrementBy;
END_CASE
END_METHOD

// Increment any integer with x when a condition is true, rollover to Zero when larger than a maximum
METHOD PUBLIC Rollover
VAR_INPUT
	input		: ANY_INT;				// Number to increment
	rollover	: INT;					// When Input larger than this, reset input to zeroValue (endpoint is inclusive)
	incrementBy	: INT		:= 1;		// Input increments with this value (optional; defaults to 1)
	zeroValue	: INT		:= 0;		// Input resets to this value (optional; defaults to 0)
	condition	: BOOL		:= TRUE;	// Only increment when the condition is true (optional)
END_VAR
IF NOT condition THEN
	RETURN;
END_IF

uInput.p1_Byte := input.pValue;

CASE input.diSize OF
	1:	uInput.p1_Sint^	:= TO_SINT(	SEL(uInput.p1_Sint^	+ incrementBy > rollover, uInput.p1_Sint^	+ incrementBy, zeroValue));
	2:	uInput.p2_Int^	:=			SEL(uInput.p2_Int^	+ incrementBy > rollover, uInput.p2_Int^	+ incrementBy, zeroValue);
	4:	uInput.p4_Dint^	:=			SEL(uInput.p4_Dint^	+ incrementBy > rollover, uInput.p4_Dint^	+ incrementBy, zeroValue);
	8:	uInput.p8_Lint^	:=			SEL(uInput.p8_Lint^	+ incrementBy > rollover, uInput.p8_Lint^	+ incrementBy, zeroValue);
END_CASE

// Example; Call function with these parameters:
//
// iState := 0;
// FOR i := 1 TO 999 DO
//	Increment.Rollover(iState, 5, 1, 2);
// END_FOR
//
// iState will be:
// 1, 2, 3, 4, 5, 2, 3, 4, 5, 2, 3, etc.
END_METHOD

// Await the result of a boolean condition and then change the state to a new state
METHOD PUBLIC State
VAR_INPUT
	input		: ANY_INT;				// Number to increment
	condition	: BOOL;					// Only increment when the condition is true
	newState	: DINT;
END_VAR
IF NOT condition THEN
	RETURN;
END_IF

uInput.p1_Byte := input.pValue;

CASE input.diSize OF
	1:	uInput.p1_Sint^	:= TO_SINT(newState);
	2:	uInput.p2_Int^	:= TO_INT(newState);
	4:	uInput.p4_Dint^	:= newState;
	8:	uInput.p8_Lint^	:= newState;
END_CASE
END_METHOD

// Await the result of a enum condition and then change the state to a new state
METHOD PUBLIC StateEnum
VAR_INPUT
	input		: ANY_INT;				// Number to increment
	condition	: enumResultGeneric;	// Only increment when there is a result
	newSuccessState	: DINT;
	newErrorState	: DINT;
END_VAR
IF condition = enumResultGeneric.NoResult THEN
	RETURN;
END_IF

uInput.p1_Byte := input.pValue;

CASE input.diSize OF
	1:	uInput.p1_Sint^	:= TO_SINT(	SEL(condition = enumResultGeneric.Success, newErrorState, newSuccessState));
	2:	uInput.p2_Int^	:= TO_INT(	SEL(condition = enumResultGeneric.Success, newErrorState, newSuccessState));
	4:	uInput.p4_Dint^	:=			SEL(condition = enumResultGeneric.Success, newErrorState, newSuccessState);
	8:	uInput.p8_Lint^	:=			SEL(condition = enumResultGeneric.Success, newErrorState, newSuccessState);
END_CASE
END_METHOD

// Increment any subrange number with x when a condition is true, rollover to lower_limit when larger than upper_limit
METHOD PUBLIC Subrange
VAR_INPUT
	input		: ANY;					// Subrange number to increment (for example INT(4..6)
	lower_limit	: INT;					// Lower limit of the subrange type
	upper_limit : INT;					// Upper limit of the subrange type
	incrementBy	: INT		:= 1;		// Input increments with this value (optional; defaults to 1)
	condition	: BOOL		:= TRUE;	// Only increment when the condition is true (optional)
END_VAR

// (Method is needed because subrange type numbers are not part of ANY_INT. That is why we need input of type ANY)
IF input.TypeClass <> TYPE_CLASS.TYPE_SUBRANGE THEN
	RETURN;
END_IF

IF NOT condition THEN
	RETURN;
END_IF

uInput.p1_Byte := input.pValue;

CASE input.diSize OF
	1:	uInput.p1_Sint^	:= TO_SINT(	SEL(uInput.p1_Sint^	+ incrementBy > upper_limit, uInput.p1_Sint^	+ incrementBy, lower_limit));
	2:	uInput.p2_Int^	:=			SEL(uInput.p2_Int^	+ incrementBy > upper_limit, uInput.p2_Int^		+ incrementBy, lower_limit);
	4:	uInput.p4_Dint^	:=			SEL(uInput.p4_Dint^	+ incrementBy > upper_limit, uInput.p4_Dint^	+ incrementBy, lower_limit);
	8:	uInput.p8_Lint^	:=			SEL(uInput.p8_Lint^	+ incrementBy > upper_limit, uInput.p8_Lint^	+ incrementBy, lower_limit);
END_CASE
END_METHOD

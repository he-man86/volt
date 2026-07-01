// Used for mapping a real input value from one range to another.
FUNCTION RANGE_TO_RANGE : REAL
VAR_INPUT
	input		: REAL;	// input is limited to: input_LO <= input <= input_HI
	input_LO	: REAL;
	input_HI	: REAL;
	output_LO	: REAL;
	output_HI	: REAL;
END_VAR
VAR
	inputRange	: REAL;
	outputRange	: REAL;
END_VAR

(*

Zie hier voor voorbeeld:
https://stackoverflow.com/questions/929103/convert-a-number-range-to-another-range-maintaining-ratio

Update 24-03-2023: Added logic from SCALE_R function in Oscat library.
*)

inputRange	:= input_HI - input_LO;
outputRange	:= output_HI - output_LO;

IF inputRange = 0 THEN // Never divide by zero
	RANGE_TO_RANGE := output_LO;
ELSE
	RANGE_TO_RANGE := outputRange / inputRange * (LIMIT(input_LO, input, input_HI) - input_LO) + output_LO;
END_IF

END_FUNCTION

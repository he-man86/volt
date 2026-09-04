
// Used for mapping a REAL input value into a WORD (from 0 to 65535)
FUNCTION RANGE_TO_WORD : WORD
VAR_INPUT
	input		: REAL;	// input is limited to: input_LO <= input <= input_HI
	input_LO	: REAL;
	input_HI	: REAL;
END_VAR

// Update 24-03-2023: Added logic from RANGE_TO_WORD function in Oscat library.
// Update 08-06-2023: Removed logic here and use RANGE_TO_RANGE method instead (because devide by zero exception was possible)

RANGE_TO_WORD := TO_WORD(
					TRUNC(
						RANGE_TO_RANGE(
							input		:= input,
							input_LO	:= input_LO,
							input_HI	:= input_HI,
							output_LO	:= 0.0,
//							output_HI	:= 65535.0)));
							output_HI	:= 16384.0)));		// For Lenze analog outputs the maximum range is 16384.


// Example use:
// MapAnalogOut			:= Brink.RANGE_TO_WORD(input := rSetPointCharger,			input_LO := 0.0,	input_HI := rMaxChargerSetting);
// MapAnalogOut			:= Brink.RANGE_TO_WORD(input := profile.rVel,				input_LO := 0.0,	input_HI := rMaxSpeedSetting);
// wSetPointCharger		:= Brink.RANGE_TO_WORD(input := Data.rSetPointCharger,		input_LO := 0.0,	input_HI := 20.0);
// wSetPointCharger[i]	:= Brink.RANGE_TO_WORD(input := Data.rSetPointCharger[i],	input_LO := 0.0,	input_HI := 20.0);

END_FUNCTION

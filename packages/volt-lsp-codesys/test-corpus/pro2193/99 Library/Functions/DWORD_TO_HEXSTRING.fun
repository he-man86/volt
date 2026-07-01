// Convert PLC memory address into a string with hex characters represented by 0..9 and A..F.
FUNCTION DWORD_TO_HEXSTRING : STRING(8)
VAR_INPUT
	IN		: DWORD;		// Address - result of ADR()
END_VAR
VAR
	i		: USINT;
	temp	: BYTE;
	pt		: POINTER TO BYTE;
END_VAR

(*

Copy from oscat_basic_334 library

version 1.3	29. mar. 2008
programmer	hugo
tested by	tobias

DWORD_TO_STRINGH converts a DWORD to a String of Hexadecimal represented by '0' .. '9' and 'A' .. 'F'.
The lowest order Character will be on the right and the high order Character on the left.

*)

pt	:= ADR(DWORD_TO_HEXSTRING) + 8;					// Read output adress to pointer
pt^	:= 0;											// Write the closing byte (terminator) for the string

FOR i := 1 TO 8 DO									// Write the 8 hex characters backwards
	pt		:= pt - 1;								// Decrement the pointer
	temp	:= TO_BYTE(IN AND 16#0000000F);			// Read the lowest order hex value
	IF temp <= 9 THEN
		pt^	:= enumASCII.NUMBER_0 + temp;			// Convert value to hex character 0 - 9
	ELSE
		pt^	:= enumASCII.UPPERCASE_A + temp - 10;	// Convert value to hex character A - F
	END_IF
	IN		:= SHR(IN, 4);							// Shift 4 bits to right for next hex character
END_FOR

END_FUNCTION

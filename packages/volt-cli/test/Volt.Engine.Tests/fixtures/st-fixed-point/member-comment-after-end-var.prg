// Helper functions to set or reset bits in integers
{attribute 'hide_all_locals'}
PROGRAM BitLogic
VAR
	uInput		: PointerSizesUnion;
END_VAR
IMPLEMENTATION ST

END_PROGRAM

// Population count: Count the number of bits that are 1 in a byte
METHOD PUBLIC CountByte : USINT
VAR_INPUT
	in	: BYTE;			// Count number of 1's
END_VAR

// This method uses Brian Kernighan's algorithm. Google it for more info.
IMPLEMENTATION ST
WHILE in <> 0 DO
	CountByte	:= CountByte + 1;
END_WHILE
END_METHOD

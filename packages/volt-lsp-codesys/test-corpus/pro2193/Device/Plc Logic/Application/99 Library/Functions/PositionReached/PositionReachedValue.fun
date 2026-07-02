// Check if two positions match (within rValue mm).
FUNCTION PositionReachedValue : BOOL
VAR_INPUT
	rActPos		: REAL;
	rSetPos		: REAL;
	rValue		: REAL;
END_VAR

PositionReachedValue	:= ABS(rActPos - rSetPos) <= rValue;

END_FUNCTION

// Check if two positions match (within 1 mm).
FUNCTION PositionReached : BOOL
VAR_INPUT
	rActPos		: REAL;
	rSetPos		: REAL;
END_VAR
(* @volt-implementation *)
PositionReached			:= PositionReachedValue(rActPos, rSetPos, 1);

END_FUNCTION

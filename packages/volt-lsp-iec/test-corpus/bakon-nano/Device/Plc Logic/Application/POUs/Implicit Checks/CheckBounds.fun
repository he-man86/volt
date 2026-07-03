// Implicitly generated code : DO NOT EDIT
FUNCTION CheckBounds : DINT
VAR_INPUT
	index, lower, upper: DINT;
END_VAR

// Implicitly generated code : Only an Implementation suggestion
IF  index < lower THEN
	CheckBounds := lower;
ELSIF  index > upper THEN
	CheckBounds := upper;
ELSE  
	CheckBounds := index;
END_IF

END_FUNCTION

// Implicitly generated code : DO NOT EDIT
FUNCTION CheckDivReal : REAL
VAR_INPUT
	divisor:REAL;
END_VAR

// Implicitly generated code : Only an Implementation suggestion
IF divisor = 0 THEN
	CheckDivReal:=1;
ELSE
	CheckDivReal:=divisor;
END_IF;

END_FUNCTION

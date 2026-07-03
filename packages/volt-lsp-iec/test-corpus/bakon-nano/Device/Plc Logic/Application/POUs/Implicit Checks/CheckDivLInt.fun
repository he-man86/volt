// Implicitly generated code : DO NOT EDIT
FUNCTION CheckDivLInt : LINT
VAR_INPUT
	divisor:LINT;
END_VAR

// Implicitly generated code : Only an Implementation suggestion
IF divisor = 0 THEN
	CheckDivLInt:=1;
ELSE
	CheckDivLInt:=divisor;
END_IF;

END_FUNCTION

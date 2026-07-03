// Implicitly generated code : DO NOT EDIT
FUNCTION CheckDivLReal : LREAL
VAR_INPUT
	divisor:LREAL;
END_VAR

// Implicitly generated code : Only an Implementation suggestion
IF divisor = 0 THEN
	CheckDivLReal:=1;
ELSE
	CheckDivLReal:=divisor;
END_IF;

END_FUNCTION

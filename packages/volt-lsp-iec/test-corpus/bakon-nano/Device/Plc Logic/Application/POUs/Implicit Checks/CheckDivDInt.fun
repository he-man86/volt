// Implicitly generated code : DO NOT EDIT
FUNCTION CheckDivDInt : DINT
VAR_INPUT
	divisor:DINT;
END_VAR

// Implicitly generated code : Only an Implementation suggestion
IF divisor = 0 THEN
	CheckDivDInt:=1;
ELSE
	CheckDivDInt:=divisor;
END_IF;

END_FUNCTION

// Implicitly generated code : DO NOT EDIT
FUNCTION CheckDivLReal : LREAL
VAR_INPUT
	divisor		: LREAL;
END_VAR

IF divisor <> 0 THEN
	CheckDivLReal := divisor;
ELSE
	LogPlc.Fatal('CheckDivLReal Error; Do not divide by 0!');

	CheckDivLReal := 1;

	{IF defined (IsSimulationMode)}
		ThrowException('RtsExceptions.RTSEXCPT_DIVIDEBYZERO');
	{END_IF}

	IF GlobalVars.CheckBoundFunctionsThrowExceptions THEN
		ThrowException('RtsExceptions.RTSEXCPT_DIVIDEBYZERO');
	END_IF
END_IF

END_FUNCTION

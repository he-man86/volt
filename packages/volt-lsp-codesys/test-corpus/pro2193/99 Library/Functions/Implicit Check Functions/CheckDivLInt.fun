// Implicitly generated code : DO NOT EDIT
FUNCTION CheckDivLInt : LINT
VAR_INPUT
	divisor		: LINT;
END_VAR

IF divisor <> 0 THEN
	CheckDivLInt := divisor;
ELSE
	LogPlc.Fatal('CheckDivLINT Error; Do not divide by 0!');

	CheckDivLInt := 1;

	{IF defined (IsSimulationMode)}
		ThrowException('RtsExceptions.RTSEXCPT_DIVIDEBYZERO');
	{END_IF}

	IF GlobalVars.CheckBoundFunctionsThrowExceptions THEN
		ThrowException('RtsExceptions.RTSEXCPT_DIVIDEBYZERO');
	END_IF
END_IF

END_FUNCTION

// Implicitly generated code : DO NOT EDIT
FUNCTION CheckDivDInt : DINT
VAR_INPUT
	divisor		: DINT;
END_VAR

IF divisor <> 0 THEN
	CheckDivDInt := divisor;
ELSE
	LogPlc.Fatal('CheckDivDINT Error; Do not divide by 0!');

	CheckDivDInt := 1;

	{IF defined (IsSimulationMode)}
		ThrowException('RtsExceptions.RTSEXCPT_DIVIDEBYZERO');
	{END_IF}

	IF GlobalVars.CheckBoundFunctionsThrowExceptions THEN
		ThrowException('RtsExceptions.RTSEXCPT_DIVIDEBYZERO');
	END_IF
END_IF

END_FUNCTION

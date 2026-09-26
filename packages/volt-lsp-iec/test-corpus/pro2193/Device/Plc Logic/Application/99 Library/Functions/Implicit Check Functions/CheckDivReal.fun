// Implicitly generated code : DO NOT EDIT
FUNCTION CheckDivReal : REAL
VAR_INPUT
	divisor		: REAL;
END_VAR
(* @volt-implementation *)
IF divisor <> 0 THEN
	CheckDivReal := divisor;
ELSE
	LogPlc.Fatal('CheckDivReal Error; Do not divide by 0!');

	CheckDivReal := 1;

	{IF defined (IsSimulationMode)}
		ThrowException('RtsExceptions.RTSEXCPT_DIVIDEBYZERO');
	{END_IF}

	IF GlobalVars.CheckBoundFunctionsThrowExceptions THEN
		ThrowException('RtsExceptions.RTSEXCPT_DIVIDEBYZERO');
	END_IF
END_IF

END_FUNCTION

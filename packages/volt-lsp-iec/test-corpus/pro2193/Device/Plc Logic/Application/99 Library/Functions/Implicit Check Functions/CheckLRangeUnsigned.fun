// Implicitly generated code : DO NOT EDIT
FUNCTION CheckLRangeUnsigned : ULINT
VAR_INPUT
	value, lower, upper : ULINT;
END_VAR

IF value >= lower AND value <= upper THEN
	CheckLRangeUnsigned := value;
ELSE
	LogPlc.Fatal(CONCAT7(	'CheckLRangeUnsigned Error. Act value ',
							TO_STRING(value),
							' not in range (',
							TO_STRING(lower),
							', ',
							TO_STRING(upper),
							')'));

	CheckLRangeUnsigned := LIMIT(lower, value, upper);

	{IF defined (IsSimulationMode)}
		ThrowException('RtsExceptions.RTSEXCPT_MISALIGNMENT');
	{END_IF}

	IF GlobalVars.CheckBoundFunctionsThrowExceptions THEN
		ThrowException('RtsExceptions.RTSEXCPT_MISALIGNMENT');
	END_IF
END_IF

END_FUNCTION

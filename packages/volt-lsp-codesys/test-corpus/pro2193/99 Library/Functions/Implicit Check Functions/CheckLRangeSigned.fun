// Implicitly generated code : DO NOT EDIT
FUNCTION CheckLRangeSigned : LINT
VAR_INPUT
	value, lower, upper : LINT;
END_VAR

IF value >= lower AND value <= upper THEN
	CheckLRangeSigned := value;
ELSE
	LogPlc.Fatal(CONCAT7(	'CheckLRangeSigned Error. Act value ',
							TO_STRING(value),
							' not in range (',
							TO_STRING(lower),
							', ',
							TO_STRING(upper),
							')'));

	CheckLRangeSigned := LIMIT(lower, value, upper);

	{IF defined (IsSimulationMode)}
		ThrowException('RtsExceptions.RTSEXCPT_MISALIGNMENT');
	{END_IF}

	IF GlobalVars.CheckBoundFunctionsThrowExceptions THEN
		ThrowException('RtsExceptions.RTSEXCPT_MISALIGNMENT');
	END_IF
END_IF

END_FUNCTION

// Implicitly generated code : DO NOT EDIT
FUNCTION CheckRangeSigned : DINT
VAR_INPUT
	value, lower, upper : DINT;
END_VAR

IF value >= lower AND value <= upper THEN
	CheckRangeSigned := value;
ELSE
	LogPlc.Fatal(CONCAT7(	'CheckRangeSigned Error. Act value ',
							TO_STRING(value),
							' not in range (',
							TO_STRING(lower),
							', ',
							TO_STRING(upper),
							')'));

	CheckRangeSigned := LIMIT(lower, value, upper);

	{IF defined (IsSimulationMode)}
		ThrowException('RtsExceptions.RTSEXCPT_MISALIGNMENT');
	{END_IF}

	IF GlobalVars.CheckBoundFunctionsThrowExceptions THEN
		ThrowException('RtsExceptions.RTSEXCPT_MISALIGNMENT');
	END_IF
END_IF

END_FUNCTION

// Implicitly generated code : DO NOT EDIT
FUNCTION CheckRangeUnsigned : UDINT
VAR_INPUT
	value, lower, upper : UDINT;
END_VAR

IF value >= lower AND value <= upper THEN
	CheckRangeUnsigned := value;
ELSE
	LogPlc.Fatal(CONCAT7(	'CheckRangeUnsigned Error. Act value ',
							TO_STRING(value),
							' not in range (',
							TO_STRING(lower),
							', ',
							TO_STRING(upper),
							')'));

	CheckRangeUnsigned := LIMIT(lower, value, upper);

	{IF defined (IsSimulationMode)}
		ThrowException('RtsExceptions.RTSEXCPT_MISALIGNMENT');
	{END_IF}

	IF GlobalVars.CheckBoundFunctionsThrowExceptions THEN
		ThrowException('RtsExceptions.RTSEXCPT_MISALIGNMENT');
	END_IF
END_IF

END_FUNCTION

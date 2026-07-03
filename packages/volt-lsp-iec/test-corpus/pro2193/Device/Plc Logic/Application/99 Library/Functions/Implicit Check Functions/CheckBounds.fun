// Implicitly generated code : DO NOT EDIT
FUNCTION CheckBounds : DINT
VAR_INPUT
	index, lower, upper : DINT;
END_VAR

IF index >= lower AND index <= upper THEN
	CheckBounds := index;
ELSE
	LogPlc.Fatal(CONCAT7(	'CheckBounds Error. Act index ',
							TO_STRING(index),
							' not in range [',
							TO_STRING(lower),
							', ',
							TO_STRING(upper),
							']'));

	CheckBounds := LIMIT(lower, index, upper);

	{IF defined (IsSimulationMode)}
		ThrowException('RtsExceptions.RTSEXCPT_ARRAYBOUNDS');
	{END_IF}

	IF GlobalVars.CheckBoundFunctionsThrowExceptions THEN
		ThrowException('RtsExceptions.RTSEXCPT_ARRAYBOUNDS');
	END_IF
END_IF

END_FUNCTION

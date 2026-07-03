FUNCTION ParseInstanceName
VAR_INPUT
	pInstanceName				: Stu.CharBufferPtr;	// Pointer to string(80)
END_VAR
VAR
	tempString					: STRING(80);
	i							: INT;
END_VAR
VAR CONSTANT
	dotString					: STRING(1) := '.';
	underscoreString			: STRING(1) := '_';
END_VAR

// Check if input string is not empty
IF Stu.StrIsNullOrEmptyA(pInstanceName) THEN
	RETURN;
END_IF

// Check if the input string starts with a known prefix
FOR i := 1 TO 5 DO
	CASE i OF
		1: tempString := 'Device.Application.';
		2: tempString := 'PLC.Application.';
		3: tempString := 'Device.Sim.Device.Application.';
		4: tempString := 'PLC.Sim.PLC.Application.';
		5: tempString := '';
	END_CASE

	IF Stu.StrCmpStartA(pString := pInstanceName, pPrefix := ADR(tempString)) = 0 THEN
		EXIT;
	END_IF
END_FOR

// If prefix is found, remove this prefix
IF i <> 5 THEN
	Stu.StrMidA(
		pst					:= pInstanceName,
		uiInputBufferSize	:= 80,
		iLength				:= TO_INT(StrLenA(pInstanceName) - StrLenA(ADR(tempString))),
		iPosition			:= TO_INT(StrLenA(ADR(tempString)) + 1),
		pstResult			:= pInstanceName,
		uiResultBufferSize	:= 80);
END_IF

// Find all '.' chars and replace with underscores
i := 1;		// Start search at position 1
WHILE (i := StrFindA(pst1 := pInstanceName, pst2 := ADR(dotString), uiSearchStart := TO_UINT(i))) > 0 DO
	StrReplaceA(
		pstInput			:= pInstanceName,
		uiInputBufferSize	:= 80,
		pstReplaceWith		:= ADR(underscoreString),
		iLengthInput		:= 1,	// Don't know function of this parameter..
		iLengthToReplace	:= 1,
		iLengthToReplaceWith:= 1,
		iPosition			:= i);	// i is position where the dot was found
END_WHILE

END_FUNCTION

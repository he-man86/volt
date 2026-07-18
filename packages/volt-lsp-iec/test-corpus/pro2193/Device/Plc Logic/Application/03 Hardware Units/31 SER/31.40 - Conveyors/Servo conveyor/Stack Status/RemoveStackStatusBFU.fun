FUNCTION RemoveStackStatusBFU
VAR_IN_OUT
	TempStatus : ARRAY[*] OF StackStatusType;
END_VAR
VAR
	di : DINT;
END_VAR

FOR di := UPPER_BOUND(TempStatus,1) TO 1 BY -1 DO
	IF TempStatus[di].Present THEN
		ClearProducts.Stack(Tempstatus[di]);
		EXIT;
	END_IF
END_FOR

END_FUNCTION

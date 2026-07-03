FUNCTION ATD_SR : bool
VAR_INPUT
	iSet:BOOL;
	iReset: BOOL;
END_VAR
VAR
END_VAR
VAR_IN_OUT
	ioSR_value: BOOL;
END_VAR

ioSR_value S=iSet;
ioSR_value R=iReset;

END_FUNCTION

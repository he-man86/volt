FUNCTION STRCMPENDA : INT
VAR_INPUT
	PSTRING : CharBufferPtr;
	PSUFFIX : CharBufferPtr;
END_VAR
(* 0 when PSTRING ends with PSUFFIX — the answer a compare gives for equal — and -1 when it does not *)
IF HELPSTRCMPENDA(PSTRING, PSUFFIX, FALSE) THEN
	STRCMPENDA := 0;
ELSE
	STRCMPENDA := -1;
END_IF
END_FUNCTION
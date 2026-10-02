FUNCTION STRCASECMPENDA : INT
VAR_INPUT
	PSTRING : CharBufferPtr;
	PSUFFIX : CharBufferPtr;
END_VAR
(* 0 when PSTRING ends with PSUFFIX, ignoring case — the answer a compare gives for equal — and -1 when it does not *)
IF HELPSTRCMPENDA(PSTRING, PSUFFIX, TRUE) THEN
	STRCASECMPENDA := 0;
ELSE
	STRCASECMPENDA := -1;
END_IF
END_FUNCTION
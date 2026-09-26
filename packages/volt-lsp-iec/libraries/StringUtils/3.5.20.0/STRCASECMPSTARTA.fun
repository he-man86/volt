FUNCTION STRCASECMPSTARTA : INT
VAR_INPUT
	PSTRING : CharBufferPtr;
	PPREFIX : CharBufferPtr;
END_VAR
(* 0 when PSTRING begins with PPREFIX, ignoring case — the answer a compare gives for equal — and 1 when it does not *)
IF HELPSTRCMPSTARTA(PSTRING, PPREFIX, TRUE) THEN
	STRCASECMPSTARTA := 0;
ELSE
	STRCASECMPSTARTA := 1;
END_IF
END_FUNCTION
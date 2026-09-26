FUNCTION STRCPYA : DINT
VAR_INPUT
	PBUFFER : CharBufferPtr;
	IBUFFERSIZE : DINT;
	PSTR : CharBufferPtr;
END_VAR
VAR
	i : DINT;
END_VAR
(* PSTR into the buffer, cut at the IBUFFERSIZE - 1 bytes the buffer holds before its terminator; the answer is how
   many bytes were copied *)
IF PBUFFER = 0 OR PSTR = 0 OR IBUFFERSIZE <= 0 THEN
	RETURN;
END_IF
WHILE i < IBUFFERSIZE - 1 AND_THEN PSTR[i] <> 0 DO
	PBUFFER[i] := PSTR[i];
	i := i + 1;
END_WHILE
PBUFFER[i] := 0;
STRCPYA := i;
END_FUNCTION
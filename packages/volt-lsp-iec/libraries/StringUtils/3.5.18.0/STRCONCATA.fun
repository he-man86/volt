FUNCTION STRCONCATA : BOOL
VAR_INPUT
	PSTFROM : CharBufferPtr;
	PSTTO : CharBufferPtr;
	IBUFFERSIZE : INT;
END_VAR
VAR
	i : DINT;
	nTo : DINT;
	nFrom : DINT;
END_VAR
(* PSTFROM appended to PSTTO. The result and its terminator must fit the IBUFFERSIZE bytes of PSTTO's buffer, or
   nothing is written and the answer is FALSE *)
IF PSTFROM = 0 OR PSTTO = 0 THEN
	RETURN;
END_IF
nTo := STRLENA(PSTTO);
nFrom := STRLENA(PSTFROM);
IF nTo + nFrom + 1 > IBUFFERSIZE THEN
	RETURN;
END_IF
FOR i := 0 TO nFrom - 1 DO
	PSTTO[nTo + i] := PSTFROM[i];
END_FOR
PSTTO[nTo + nFrom] := 0;
STRCONCATA := TRUE;
END_FUNCTION
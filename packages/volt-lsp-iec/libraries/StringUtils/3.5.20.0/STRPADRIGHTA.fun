FUNCTION STRPADRIGHTA : BOOL
VAR_INPUT
	BYPADCHAR : BYTE;
	PSTFROM : CharBufferPtr;
	PSTTO : CharBufferPtr;
	DIBUFFERSIZE : DINT;
END_VAR
VAR
	i : DINT;
	n : DINT;
END_VAR
(* PSTFROM, filled up on the RIGHT with BYPADCHAR to the DIBUFFERSIZE - 1 bytes the destination holds, into PSTTO.
   A source that is already longer does not fit: nothing is written and the answer is FALSE *)
IF PSTFROM = 0 OR PSTTO = 0 THEN
	RETURN;
END_IF
n := STRLENA(PSTFROM);
IF n > DIBUFFERSIZE - 1 THEN
	RETURN;
END_IF
FOR i := 0 TO n - 1 DO
	PSTTO[i] := PSTFROM[i];
END_FOR
FOR i := n TO DIBUFFERSIZE - 2 DO
	PSTTO[i] := BYPADCHAR;
END_FOR
PSTTO[DIBUFFERSIZE - 1] := 0;
STRPADRIGHTA := TRUE;
END_FUNCTION
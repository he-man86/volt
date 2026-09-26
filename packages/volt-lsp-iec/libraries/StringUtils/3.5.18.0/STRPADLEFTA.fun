FUNCTION STRPADLEFTA : BOOL
VAR_INPUT
	BYPADCHAR : BYTE;
	PSTFROM : CharBufferPtr;
	PSTTO : CharBufferPtr;
	DIBUFFERSIZE : DINT;
END_VAR
VAR
	i : DINT;
	n : DINT;
	pad : DINT;
END_VAR
(* PSTFROM, filled up on the LEFT with BYPADCHAR to the DIBUFFERSIZE - 1 bytes the destination holds, into PSTTO.
   A source that is already longer does not fit: nothing is written and the answer is FALSE *)
IF PSTFROM = 0 OR PSTTO = 0 THEN
	RETURN;
END_IF
n := STRLENA(PSTFROM);
pad := DIBUFFERSIZE - 1 - n;
IF pad < 0 THEN
	RETURN;
END_IF
FOR i := 0 TO pad - 1 DO
	PSTTO[i] := BYPADCHAR;
END_FOR
FOR i := 0 TO n - 1 DO
	PSTTO[pad + i] := PSTFROM[i];
END_FOR
PSTTO[pad + n] := 0;
STRPADLEFTA := TRUE;
END_FUNCTION
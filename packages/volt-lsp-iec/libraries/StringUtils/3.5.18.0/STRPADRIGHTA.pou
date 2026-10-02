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
(* PSTFROM, filled up on the RIGHT with BYPADCHAR to DIBUFFERSIZE characters, into PSTTO (recorded: lib_stu_pad —
   'abc' to 6 is 'abc...'). A source that is already longer does not fit: nothing is written and the answer is FALSE *)
IF PSTFROM = 0 OR PSTTO = 0 THEN
	RETURN;
END_IF
n := STRLENA(PSTFROM);
IF n > DIBUFFERSIZE THEN
	RETURN;
END_IF
FOR i := 0 TO n - 1 DO
	PSTTO[i] := PSTFROM[i];
END_FOR
FOR i := n TO DIBUFFERSIZE - 1 DO
	PSTTO[i] := BYPADCHAR;
END_FOR
PSTTO[DIBUFFERSIZE] := 0;
STRPADRIGHTA := TRUE;
END_FUNCTION